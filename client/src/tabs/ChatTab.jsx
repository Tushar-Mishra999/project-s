import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

const THINK_STEPS = ['Routing query…', 'Searching documents…', 'Generating answer…'];

function ThinkingRow() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % THINK_STEPS.length), 1500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="bubble-row assistant">
      <div className="bubble assistant" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="typing"><span /><span /><span /></div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{THINK_STEPS[step]}</span>
      </div>
    </div>
  );
}

function SearchBadge({ searchType }) {
  if (!searchType) return null;
  const isGraph = searchType === 'graph';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6,
      padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      background: isGraph ? 'rgba(139,92,246,0.12)' : 'rgba(59,130,246,0.12)',
      color: isGraph ? '#a78bfa' : '#60a5fa',
      border: `1px solid ${isGraph ? 'rgba(139,92,246,0.3)' : 'rgba(59,130,246,0.3)'}`,
    }}>
      {isGraph
        ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><line x1="8" y1="11" x2="16" y2="6"/><line x1="8" y1="13" x2="16" y2="18"/></svg> Graph Search</>
        : <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Vector Search</>
      }
    </span>
  );
}

const MODEL_ICONS = {
  gemini: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#gi)"/>
      <defs><radialGradient id="gi" cx="30%" cy="30%"><stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#3b82f6"/></radialGradient></defs>
    </svg>
  ),
  gemma: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2L4 7v10l8 5 8-5V7z" fill="url(#gma)"/>
      <defs><radialGradient id="gma" cx="30%" cy="30%"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></radialGradient></defs>
    </svg>
  ),
  glm: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="url(#glm)"/>
      <defs><radialGradient id="glm" cx="30%" cy="30%"><stop offset="0%" stopColor="#f472b6"/><stop offset="100%" stopColor="#9333ea"/></radialGradient></defs>
    </svg>
  ),
  kimi: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4l2 4h4l-3 3 1 4-4-2.5L8 17l1-4-3-3h4z" fill="url(#kimi)"/>
      <defs><radialGradient id="kimi" cx="30%" cy="30%"><stop offset="0%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#f59e0b"/></radialGradient></defs>
    </svg>
  ),
};

function ModelDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = MODEL_OPTIONS.find((o) => o.id === value) || MODEL_OPTIONS[0];

  useEffect(() => {
    function onClick(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 10px 6px 10px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border-strong)',
          borderRadius: 10, cursor: 'pointer',
          color: 'var(--text)', fontSize: 12, fontWeight: 500,
          fontFamily: 'inherit', transition: 'border-color .15s, box-shadow .15s',
          boxShadow: open ? '0 0 0 2px rgba(59,130,246,.25)' : 'none',
          minWidth: 200,
        }}
      >
        {MODEL_ICONS[selected.id]}
        <span style={{ flex: 1, textAlign: 'left' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, display: 'block', lineHeight: 1.2 }}>Model</span>
          <span style={{ letterSpacing: '0.01em' }}>{selected.label}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
          borderRadius: 12, overflow: 'hidden', zIndex: 50, minWidth: 260,
          boxShadow: '0 8px 32px rgba(0,0,0,.45)',
        }}>
          <div style={{ padding: '6px 10px 4px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Select model
          </div>
          {MODEL_OPTIONS.map((opt) => {
            const active = opt.id === value;
            return (
              <button
                key={opt.id}
                onClick={() => { onChange(opt.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px', border: 'none',
                  background: active ? 'rgba(59,130,246,.12)' : 'transparent',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  borderLeft: active ? '2px solid #3b82f6' : '2px solid transparent',
                  transition: 'background .12s',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,.04)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: active ? 'rgba(59,130,246,.18)' : 'var(--surface-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {MODEL_ICONS[opt.id]}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#93c5fd' : 'var(--text)' }}>{opt.label}</div>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <path d="M2.5 7l3 3 6-6" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

function ScoreBadge({ label, value }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 80 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{pct}%</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
    </div>
  );
}

function EvalPanel({ query, answer, evalChunks }) {
  const [state, setState] = useState('idle');
  const [scores, setScores] = useState(null);
  const [error, setError] = useState(null);

  if (!evalChunks || evalChunks.length === 0) return null;

  const evaluate = async () => {
    setState('loading');
    try {
      const res = await fetch('/api/chat/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, answer, chunks: evalChunks }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Evaluation failed');
      setScores(json);
      setState('done');
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  };

  if (state === 'idle') {
    return (
      <button
        onClick={evaluate}
        style={{
          marginTop: 8, padding: '4px 10px', fontSize: 11, fontWeight: 600,
          background: 'transparent', border: '1px solid var(--border-strong)',
          borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)',
          fontFamily: 'inherit', transition: 'border-color .15s, color .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#a5b4fc'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        Evaluate Response
      </button>
    );
  }

  if (state === 'loading') {
    return (
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Evaluating…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{ marginTop: 8, fontSize: 11, color: '#f87171' }}>Eval failed: {error}</div>
    );
  }

  return (
    <div style={{
      marginTop: 10, padding: '10px 14px',
      background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 10, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 4 }}>
        RAG Eval
      </span>
      <ScoreBadge label="Context Precision" value={scores.contextPrecision} />
      <ScoreBadge label="Faithfulness" value={scores.faithfulness} />
      <ScoreBadge label="Response Relevance" value={scores.responseRelevance} />
    </div>
  );
}

const MODEL_OPTIONS = [
  { id: 'gemini', label: 'Gemini 2.5 Flash' },
  { id: 'gemma', label: 'Gemma 4 26B A4B IT' },
  { id: 'glm', label: 'GLM 5' },
  { id: 'kimi', label: 'Kimi K2 Thinking' },
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
        body: JSON.stringify({ query: q, user_id: activeUserId, conversation_history: history, chat_model: chatModel }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: json.answer, sources: json.sources || [], evalChunks: json.eval_chunks || [], query: q, searchType: json.search_type || null },
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
          <ModelDropdown value={chatModel} onChange={switchModel} />
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
              {m.role === 'assistant' && <SearchBadge searchType={m.searchType} />}
              {m.role === 'assistant' && <SourcesList sources={m.sources} />}
              {m.role === 'assistant' && !m.error && (
                <EvalPanel query={m.query} answer={m.content} evalChunks={m.evalChunks} />
              )}
            </div>
          </div>
        ))}
        {sending && <ThinkingRow />}
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
