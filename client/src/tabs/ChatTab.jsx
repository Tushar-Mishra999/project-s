import { useEffect, useRef, useState } from 'react';

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

export default function ChatTab({ parts }) {
  const [part, setPart] = useState('');
  const [messages, setMessages] = useState([]); // {role, content, sources?}
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { if (parts.length) setPart((p) => p || parts[0]); }, [parts]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (e) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q || sending) return;
    if (!part) return;

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
        body: JSON.stringify({ query: q, part, conversation_history: history }),
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
          <select value={part} onChange={(e) => setPart(e.target.value)}>
            {parts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="ghost-btn" onClick={() => setMessages([])} disabled={messages.length === 0}>
            Clear
          </button>
        </div>
      </div>

      <div className="chat-window" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="state-text" style={{ textAlign: 'center', padding: 40 }}>
            Ask a question about documents accessible to <strong>{part || '…'}</strong>.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble-row ${m.role}`}>
            <div className={`bubble ${m.role}${m.error ? ' error' : ''}`}>
              {m.content}
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
