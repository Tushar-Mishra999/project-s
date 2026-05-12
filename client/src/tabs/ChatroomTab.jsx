import { useEffect, useRef, useState } from 'react';

function formatTs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${time}`;
}

function Avatar({ name, size = 36, gradient }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: gradient || 'linear-gradient(135deg,#374151,#4b5563)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: '#fff',
    }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}

function ContactList({ contacts, activeId, onSelect }) {
  return (
    <div style={{
      width: 220, flexShrink: 0,
      borderRight: '1px solid var(--border-strong)',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{ padding: '12px 14px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        Direct Messages
      </div>
      {contacts.map((c) => {
        const active = c.id === activeId;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 14px', border: 'none', background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
              borderLeft: active ? '3px solid #6366f1' : '3px solid transparent',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              transition: 'background .12s',
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
          >
            <Avatar name={c.name} size={30} gradient={c.role === 'MD' ? 'linear-gradient(135deg,#6366f1,#3b82f6)' : undefined} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#e2e8f0' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {c.role === 'MD' ? 'MD' : c.part}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Message({ msg, isOwn, canDelete, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await onDelete(msg.id); }
    finally { setDeleting(false); setConfirming(false); }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirming(false); }}
      style={{
        display: 'flex', flexDirection: isOwn ? 'row-reverse' : 'row',
        gap: 8, marginBottom: 14, alignItems: 'flex-end',
      }}
    >
      <Avatar
        name={msg.sender_name}
        size={28}
        gradient={isOwn ? 'linear-gradient(135deg,#6366f1,#3b82f6)' : undefined}
      />
      <div style={{ maxWidth: '70%', minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
          flexDirection: isOwn ? 'row-reverse' : 'row',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatTs(msg.created_at)}</span>
          {canDelete && hovered && !confirming && (
            <button onClick={() => setConfirming(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, padding: '1px 3px', borderRadius: 3 }}>✕</button>
          )}
          {confirming && (
            <span style={{ display: 'flex', gap: 4 }}>
              <button onClick={handleDelete} disabled={deleting} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                {deleting ? '…' : 'Delete'}
              </button>
              <button onClick={() => setConfirming(false)} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-3)', color: 'var(--text)', border: 'none', cursor: 'pointer' }}>
                Cancel
              </button>
            </span>
          )}
        </div>
        <div style={{
          padding: '9px 13px',
          borderRadius: isOwn ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          background: isOwn ? 'linear-gradient(135deg,rgba(99,102,241,0.32),rgba(59,130,246,0.26))' : 'var(--surface-2)',
          border: '1px solid', borderColor: isOwn ? 'rgba(99,102,241,0.28)' : 'var(--border-strong)',
          fontSize: 14, lineHeight: 1.5, color: 'var(--text)', wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function ConversationView({ contact, activeUserId, isMD }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/chatroom?user_id=${encodeURIComponent(activeUserId)}&with=${encodeURIComponent(contact.id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setMessages(json.messages || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); setInput(''); }, [contact.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handlePost = async (e) => {
    e?.preventDefault();
    const content = input.trim();
    if (!content || posting) return;
    setPosting(true);
    try {
      const res = await fetch('/api/chatroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUserId, recipient_id: contact.id, content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send');
      setMessages((m) => [...m, json.message]);
      setInput('');
      inputRef.current?.focus();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  };

  const handleDelete = async (id) => {
    const res = await fetch(`/api/chatroom/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: activeUserId }),
    });
    if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Delete failed'); }
    setMessages((m) => m.filter((msg) => msg.id !== id));
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        borderBottom: '1px solid var(--border-strong)', flexShrink: 0,
      }}>
        <Avatar name={contact.name} size={36} gradient={contact.role === 'MD' ? 'linear-gradient(135deg,#6366f1,#3b82f6)' : undefined} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{contact.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{contact.role === 'MD' ? 'Managing Director' : contact.part}</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', minHeight: 0 }}>
        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 13, color: '#f87171', marginBottom: 12 }}>
            {error}
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No messages yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Start your conversation with {contact.name}.</div>
          </div>
        )}
        {messages.map((msg) => (
          <Message
            key={msg.id}
            msg={msg}
            isOwn={msg.sender_id === activeUserId}
            canDelete={msg.sender_id === activeUserId || isMD}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handlePost} style={{
        display: 'flex', gap: 10, padding: '12px 16px',
        borderTop: '1px solid var(--border-strong)', flexShrink: 0,
      }}>
        <input
          ref={inputRef}
          type="text"
          placeholder={`Message ${contact.name}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={posting}
          style={{
            flex: 1, padding: '10px 14px',
            background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
            borderRadius: 10, color: 'var(--text)', fontSize: 14,
            fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Refresh"
          style={{
            padding: '10px 11px', background: 'var(--surface-2)',
            border: '1px solid var(--border-strong)', borderRadius: 10,
            cursor: 'pointer', color: 'var(--text-muted)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            opacity: loading ? 0.5 : 1, transition: 'color .15s',
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
        <button type="submit" className="primary-btn" disabled={posting || !input.trim()} style={{ padding: '10px 20px' }}>
          {posting ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

export default function ChatroomTab({ activeUserId, activeUser, users = [] }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const isMD = activeUser?.role === 'MD';
  const isExec = isMD || activeUser?.role === 'PartHead';

  const contacts = users.filter(
    (u) => u.id !== activeUserId && (u.role === 'MD' || u.role === 'PartHead')
  );

  if (!isExec) {
    return (
      <div className="wrap">
        <div className="header"><h1>Direct Messages</h1></div>
        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Access is restricted to MD and Part Heads.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <ContactList
        contacts={contacts}
        activeId={selectedContact?.id}
        onSelect={setSelectedContact}
      />

      {selectedContact ? (
        <ConversationView
          contact={selectedContact}
          activeUserId={activeUserId}
          isMD={isMD}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Select a conversation</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Choose someone from the list to start messaging.</div>
        </div>
      )}
    </div>
  );
}
