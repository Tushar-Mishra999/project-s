import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

const MODEL_ICONS = {
  gemini: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#fab_gi)"/><defs><radialGradient id="fab_gi" cx="30%" cy="30%"><stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#3b82f6"/></radialGradient></defs></svg>,
  gemma: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2L4 7v10l8 5 8-5V7z" fill="url(#fab_gma)"/><defs><radialGradient id="fab_gma" cx="30%" cy="30%"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></radialGradient></defs></svg>,
  glm: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><rect x="3" y="3" width="18" height="18" rx="4" fill="url(#fab_glm)"/><defs><radialGradient id="fab_glm" cx="30%" cy="30%"><stop offset="0%" stopColor="#f472b6"/><stop offset="100%" stopColor="#9333ea"/></radialGradient></defs></svg>,
  kimi: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4l2 4h4l-3 3 1 4-4-2.5L8 17l1-4-3-3h4z" fill="url(#fab_kimi)"/><defs><radialGradient id="fab_kimi" cx="30%" cy="30%"><stop offset="0%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#f59e0b"/></radialGradient></defs></svg>,
};

const MODEL_OPTIONS = [
  { id: 'gemini', label: 'Gemini 2.5 Flash' },
  { id: 'gemma', label: 'Gemma 4 26B A4B IT' },
  { id: 'glm', label: 'GLM 5' },
  { id: 'kimi', label: 'Kimi K2 Thinking' },
];

function SourcesList({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="sources">
      <button className="sources-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Sources ({sources.length})
      </button>
      {open && (
        <ul className="sources-list">
          {sources.map((s, i) => {
            const isPptx = (s.filetype || '').toLowerCase().includes('pptx');
            const label = isPptx ? `Slide ${s.chunk_index + 1}` : `Chunk ${s.chunk_index}`;
            return (
              <li key={i}>
                <a href={s.file_url} target="_blank" rel="noopener noreferrer" download>{s.filename}</a>{' '}
                <span className="source-label">— {label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ChatFAB({ activePart, activeUserId, activeUser }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatModel, setChatModel] = useState('gemini');
  const [showModels, setShowModels] = useState(false);
  const scrollRef = useRef(null);
  const modelRef = useRef(null);

  const scopeLabel = activeUser?.role === 'MD'
    ? 'All documents'
    : (activeUser?.part || activeUser?.team || activePart || '…');

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    function onClick(e) { if (modelRef.current && !modelRef.current.contains(e.target)) setShowModels(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const send = async (e) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q || sending || !activeUserId) return;
    const newUser = { role: 'user', content: q };
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, newUser]);
    setInput(''); setSending(true);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, user_id: activeUserId, conversation_history: history, chat_model: chatModel }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setMessages((m) => [...m, { role: 'assistant', content: json.answer, sources: json.sources || [] }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong. (${err.message})`, error: true }]);
    } finally { setSending(false); }
  };

  return (
    <>
      {/* FAB button */}
      <button
        className={`chat-fab${open ? ' chat-fab-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Chat with Pluto"
        aria-label="Chat with Pluto"
      >
        <div className="chat-fab-inner">
          {open ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
        </div>
        <div className="chat-fab-ring" />
        <div className="chat-fab-ring chat-fab-ring-2" />
        <span className="chat-fab-tooltip">Chat with Pluto</span>
      </button>

      {/* Backdrop overlay */}
      <div className={`chat-fab-backdrop${open ? ' chat-fab-backdrop-open' : ''}`} onClick={() => setOpen(false)} />

      {/* Chat panel */}
      <div className={`chat-fab-panel${open ? ' chat-fab-panel-open' : ''}`}>
        <div className="chat-fab-panel-header">
          <div>
            <div className="chat-fab-panel-title">Chat with Pluto</div>
            <div className="chat-fab-panel-scope">{scopeLabel}</div>
          </div>
          <div ref={modelRef} style={{ position: 'relative' }}>
            <button className="ghost-btn small" onClick={() => setShowModels((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {MODEL_ICONS[chatModel]}
              <span style={{ fontSize: 11 }}>{MODEL_OPTIONS.find((o) => o.id === chatModel)?.label}</span>
            </button>
            {showModels && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 10, overflow: 'hidden', zIndex: 60, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
                {MODEL_OPTIONS.map((opt) => {
                  const active = opt.id === chatModel;
                  return (
                    <button key={opt.id} onClick={() => { setChatModel(opt.id); setShowModels(false); setMessages([]); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: active ? 'rgba(59,130,246,.12)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--text)', fontSize: 12 }}>
                      {MODEL_ICONS[opt.id]} {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="chat-fab-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-fab-empty">
              <div className="chat-fab-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Ask Pluto anything</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Grounded answers from your documents</div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-fab-bubble ${m.role}${m.error ? ' error' : ''}`}>
              {m.role === 'assistant' && !m.error ? (
                <div className="md"><ReactMarkdown>{m.content}</ReactMarkdown></div>
              ) : m.content}
              {m.role === 'assistant' && <SourcesList sources={m.sources} />}
            </div>
          ))}
          {sending && (
            <div className="chat-fab-bubble assistant typing"><span /><span /><span /></div>
          )}
        </div>

        <form className="chat-fab-input" onSubmit={send}>
          <input type="text" placeholder="Ask anything…" value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} />
          <button type="submit" disabled={sending || !input.trim()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </>
  );
}
