import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MD_COMPONENTS = {
  table: ({ node, ...props }) => (
    <div className="md-table-wrap"><table {...props} /></div>
  ),
};

function ThinkingBubble({ searchType }) {
  return (
    <div className="chat-fab-bubble assistant" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="typing"><span /><span /><span /></div>
      {searchType
        ? <SearchBadge searchType={searchType} />
        : <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Agent thinking…</span>
      }
    </div>
  );
}

function SearchBadge({ searchType }) {
  if (!searchType) return null;
  const isGraph = searchType === 'graph';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 5,
      padding: '2px 7px', borderRadius: 20, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      background: isGraph ? 'rgba(139,92,246,0.12)' : 'rgba(59,130,246,0.12)',
      color: isGraph ? '#a78bfa' : '#60a5fa',
      border: `1px solid ${isGraph ? 'rgba(139,92,246,0.3)' : 'rgba(59,130,246,0.3)'}`,
    }}>
      {isGraph
        ? <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><line x1="8" y1="11" x2="16" y2="6"/><line x1="8" y1="13" x2="16" y2="18"/></svg> Graph Search</>
        : <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Vector Search</>
      }
    </span>
  );
}

const MODEL_ICONS = {
  gemini: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#fab_gi)"/><defs><radialGradient id="fab_gi" cx="30%" cy="30%"><stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#3b82f6"/></radialGradient></defs></svg>,
  gemma: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2L4 7v10l8 5 8-5V7z" fill="url(#fab_gma)"/><defs><radialGradient id="fab_gma" cx="30%" cy="30%"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></radialGradient></defs></svg>,
  glm: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><rect x="3" y="3" width="18" height="18" rx="4" fill="url(#fab_glm)"/><defs><radialGradient id="fab_glm" cx="30%" cy="30%"><stop offset="0%" stopColor="#f472b6"/><stop offset="100%" stopColor="#9333ea"/></radialGradient></defs></svg>,
  kimi: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4l2 4h4l-3 3 1 4-4-2.5L8 17l1-4-3-3h4z" fill="url(#fab_kimi)"/><defs><radialGradient id="fab_kimi" cx="30%" cy="30%"><stop offset="0%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#f59e0b"/></radialGradient></defs></svg>,
  gpt: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" fill="url(#fab_gpt)"/><path d="M8 12h8M12 8v8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/><defs><radialGradient id="fab_gpt" cx="30%" cy="30%"><stop offset="0%" stopColor="#4ade80"/><stop offset="100%" stopColor="#16a34a"/></radialGradient></defs></svg>,
};

const MODEL_OPTIONS = [
  { id: 'gemini', label: 'Gemini 2.5 Flash' },
  { id: 'gemma', label: 'Gemma 4 26B A4B IT' },
  { id: 'glm', label: 'GLM 5' },
  { id: 'kimi', label: 'Kimi K2 Thinking' },
  { id: 'gpt', label: 'GPT OSS 20B' },
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

function ScoreBadge({ label, value }) {
  const pct = Math.round(value * 100);
  const color = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 68 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color }}>{pct}%</span>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
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
          marginTop: 6, padding: '3px 8px', fontSize: 10, fontWeight: 600,
          background: 'transparent', border: '1px solid var(--border-strong)',
          borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)',
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
    return <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Evaluating…</div>;
  }

  if (state === 'error') {
    return <div style={{ marginTop: 6, fontSize: 10, color: '#f87171' }}>Eval failed: {error}</div>;
  }

  return (
    <div style={{
      marginTop: 8, padding: '8px 10px',
      background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 8, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        RAG Eval
      </span>
      <ScoreBadge label="Context Precision" value={scores.contextPrecision} />
      <ScoreBadge label="Faithfulness" value={scores.faithfulness} />
      <ScoreBadge label="Response Relevance" value={scores.responseRelevance} />
    </div>
  );
}

function AvgScoresBar({ summary }) {
  if (!summary || summary.total_count === 0) return null;
  const fmt = (v) => `${Math.round(v * 100)}%`;
  const color = (v) => v >= 0.75 ? '#22c55e' : v >= 0.50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{
      padding: '8px 16px',
      borderBottom: '1px solid var(--border)',
      background: 'rgba(99,102,241,0.04)',
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 4 }}>
        Avg Scores
      </span>
      {[
        { label: 'Context Precision', val: summary.avg_context_precision },
        { label: 'Faithfulness', val: summary.avg_faithfulness },
        { label: 'Response Relevance', val: summary.avg_response_relevance },
      ].map(({ label, val }) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          <span style={{ color: 'var(--text-muted)' }}>{label}</span>
          <span style={{ fontWeight: 700, color: color(val) }}>{fmt(val)}</span>
        </span>
      ))}
      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
        {summary.total_count} eval{summary.total_count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

export default function ChatFAB({ activePart, activeUserId, activeUser }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinkingType, setThinkingType] = useState(null);
  const [chatModel, setChatModel] = useState('gemini');
  const [showModels, setShowModels] = useState(false);
  const [includeChatroom, setIncludeChatroom] = useState(false);
  const [evalSummary, setEvalSummary] = useState(null);
  const scrollRef = useRef(null);
  const modelRef = useRef(null);

  const isExec = activeUser?.role === 'MD' || activeUser?.role === 'PartHead';
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

  // Fetch avg eval scores whenever the panel opens
  useEffect(() => {
    if (!open) return;
    fetch('/api/chat/eval-summary')
      .then((r) => r.json())
      .then((data) => setEvalSummary(data))
      .catch(() => {});
  }, [open]);

  const send = async (e) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q || sending || !activeUserId) return;
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput(''); setSending(true); setThinkingType(null);
    try {
      // Fire route lookup in parallel so we can update the thinking bubble early
      fetch('/api/chat/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, user_id: activeUserId }) })
        .then((r) => r.json()).then((j) => setThinkingType(j.search_type || null)).catch(() => {});

      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, user_id: activeUserId, conversation_history: history, chat_model: chatModel, include_chatroom: includeChatroom && isExec }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setMessages((m) => [...m, { role: 'assistant', content: json.answer, sources: json.sources || [], evalChunks: json.eval_chunks || [], query: q, searchType: json.search_type || null }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong. (${err.message})`, error: true }]);
    } finally { setSending(false); setThinkingType(null); }
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

        {/* Average eval scores — fetched on open, hidden until there's at least 1 eval */}
        <AvgScoresBar summary={evalSummary} />

        {isExec && (
          <button
            onClick={() => { setIncludeChatroom((v) => !v); setMessages([]); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              width: '100%', padding: '6px 12px',
              background: includeChatroom ? 'rgba(99,102,241,0.12)' : 'transparent',
              border: 'none', borderBottom: '1px solid var(--border-strong)',
              cursor: 'pointer', color: includeChatroom ? '#a5b4fc' : 'var(--text-muted)',
              fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
              transition: 'background .15s, color .15s',
            }}
          >
            <span style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              background: includeChatroom ? '#6366f1' : 'var(--surface-3)',
              border: '1px solid',
              borderColor: includeChatroom ? '#6366f1' : 'var(--border-strong)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {includeChatroom && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            Include Exec Chatroom as source
          </button>
        )}

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
                <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{m.content}</ReactMarkdown></div>
              ) : m.content}
              {m.role === 'assistant' && <SearchBadge searchType={m.searchType} />}
              {m.role === 'assistant' && <SourcesList sources={m.sources} />}
              {m.role === 'assistant' && !m.error && (
                <EvalPanel query={m.query} answer={m.content} evalChunks={m.evalChunks} />
              )}
            </div>
          ))}
          {sending && <ThinkingBubble searchType={thinkingType} />}
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
