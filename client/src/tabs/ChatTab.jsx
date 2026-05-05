import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

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
                <a href={s.file_url} target="_blank" rel="noopener noreferrer" download>
                  {s.filename}
                </a>{' '}
                <span className="source-label">— {label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const MODEL_OPTIONS = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'gemma', label: 'Gemma 4' },
];

export default function ChatTab({ activePart, activeUserId, activeUser }) {
  const scopeLabel = activeUser?.role === 'MD'
    ? 'All documents'
    : (activeUser?.part || activeUser?.team || activePart || '…');
  const [messages, setMessages] = useState([]); // {role, content, sources?}
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatModel, setChatModel] = useState('gemini');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  function switchModel(id) {
    if (id === chatModel) return;
    setChatModel(id);
    setMessages([]); // clear history — models have different context windows / styles
  }

  const send = async (e) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q || sending) return;
    if (!activeUserId) return;

    const newUser = { role: 'user', content: q };
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((m) => [...m, newUser]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, user_id: activeUserId, conversation_history: history, chat_model: chatModel === 'gemma' ? 'gemma' : 'gemini' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: json.answer, sources: json.sources || [] },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `Something went wrong, please try again. (${err.message})`, error: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Insights Chatbot</h1>
          <div className="sub">Ask questions across your team's documents.</div>
        </div>
        <div className="chat-controls">
          <span className="part-badge">{scopeLabel}</span>
          <div style={{ display: 'flex', gap: 0, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
            {MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => switchModel(opt.id)}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: chatModel === opt.id ? 600 : 400,
                  background: chatModel === opt.id ? '#2563eb' : '#fff',
                  color: chatModel === opt.id ? '#fff' : '#374151',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button className="ghost-btn" onClick={() => setMessages([])} disabled={messages.length === 0}>
            Clear
          </button>
        </div>
      </div>

      <div className="chat-window" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-title">Ask anything</div>
            <div className="chat-empty-sub">
              Get grounded answers from your team's documents — every response cites its sources.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble-row ${m.role}`}>
            <div className={`bubble ${m.role}${m.error ? ' error' : ''}`}>
              {m.role === 'assistant' && !m.error ? (
                <div className="md"><ReactMarkdown>{m.content}</ReactMarkdown></div>
              ) : (
                m.content
              )}
              {m.role === 'assistant' && <SourcesList sources={m.sources} />}
            </div>
          </div>
        ))}
        {sending && (
          <div className="bubble-row assistant">
            <div className="bubble assistant typing">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <form className="chat-input-bar" onSubmit={send}>
        <input
          type="text"
          placeholder="Ask anything…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
        />
        <button className="primary-btn" type="submit" disabled={sending || !input.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
