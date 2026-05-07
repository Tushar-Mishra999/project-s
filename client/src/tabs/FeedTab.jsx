import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';

// All feed categories visible to everyone
const FEED_CATEGORIES = [
  { id: 'leaderboard', label: 'Open Source Leaderboard', icon: '🏆', part: null },
  { id: 'md', label: 'Market Intelligence', icon: '📊', part: 'MD' },
  { id: 'tech', label: 'Tech Sensing', icon: '🔬', part: 'Tech Management' },
  { id: 'prism', label: 'Worklet Radar', icon: '💡', part: 'PRISM' },
  { id: 'pmo', label: 'PM Intelligence', icon: '📋', part: 'PMO' },
  { id: 'data', label: 'Data Intelligence', icon: '🗂️', part: 'Data Management' },
];

export function feedTabLabel() {
  return 'Feed';
}

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function relevanceBucket(label) {
  if (!label) return null;
  if (label === 'High') return { label: 'High', cls: 'high' };
  if (label === 'Medium') return { label: 'Medium', cls: 'medium' };
  if (label === 'Low') return { label: 'Low', cls: 'low' };
  return null;
}

// ── Worklet panel ──
function WorkletPanel({ open, loading, error, content, onRetry }) {
  if (!open) return null;
  return (
    <div className="worklet-panel">
      {loading && (
        <div className="worklet-loading">
          <div className="spinner small" /><span>Drafting a worklet idea…</span>
        </div>
      )}
      {!loading && error && (
        <div className="inline-msg error">{error} <button className="ghost-btn" onClick={onRetry}>Retry</button></div>
      )}
      {!loading && !error && content && (
        <div className="md worklet-content"><ReactMarkdown>{content}</ReactMarkdown></div>
      )}
    </div>
  );
}

// ── Feed card ──
function Card({ item, isPrism }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/worklet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.title, summary: item.summary, source: item.source, url: item.url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setContent(json.worklet);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [item]);

  const handleClick = () => {
    if (!open) { setOpen(true); if (!content && !loading) generate(); }
    else { setOpen(false); }
  };

  const bucket = isPrism ? relevanceBucket(item.workletRelevance) : null;

  return (
    <article className="card">
      <div className="card-top-row">
        {item.date ? <div className="meta">{item.date}</div> : <div className="meta" />}
        {bucket && (
          <span className={`relevance-badge relevance-${bucket.cls}`} title="AI-scored relevance for worklet creation">
            {bucket.label} relevance
          </span>
        )}
      </div>
      <a className="title" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
      {summaryOpen && item.summary && <p className="summary">{item.summary}</p>}
      <div className="card-actions">
        <div className="card-actions-left">
          {item.summary && (
            <button className="link-btn" onClick={() => setSummaryOpen((v) => !v)}>
              {summaryOpen ? 'Hide summary' : 'View summary'}
            </button>
          )}
          {isPrism && (
            <button className="link-btn" onClick={handleClick}>
              {open ? 'Hide worklet' : '＋ Create Worklet'}
            </button>
          )}
        </div>
        <a className="more" href={item.url} target="_blank" rel="noopener noreferrer">Read more →</a>
      </div>
      <WorkletPanel open={open} loading={loading} error={error} content={content} onRetry={generate} />
    </article>
  );
}

// ── Add source panel ──
function AddSourcePanel({ activePart, onAdded, onClose }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const res = await fetch('/api/feed/sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), parts: activePart ? [activePart] : undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      setSuccess(true); onAdded(json.sources);
      setTimeout(() => { setSuccess(false); onClose(); }, 1800);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="add-source-panel">
      <div className="add-source-header">
        <span className="add-source-title">Add a new source{activePart ? ` for ${activePart}` : ''}</span>
        <button className="add-source-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {success ? (
        <div className="inline-msg success">Source added! It will appear in the next feed refresh.</div>
      ) : (
        <form className="add-source-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label htmlFor="src-name">Display name</label>
            <input id="src-name" type="text" placeholder="e.g. MIT Technology Review" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="form-row">
            <label htmlFor="src-url">URL (homepage or RSS feed)</label>
            <input id="src-url" type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} required />
          </div>
          {error && <div className="inline-msg error">{error}</div>}
          <div className="add-source-actions">
            <button type="button" className="ghost-btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={saving || !name.trim() || !url.trim()}>
              {saving ? 'Adding…' : 'Add source'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Leaderboard view ──
function LeaderboardView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/leaderboard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setData(json);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="feed-content-area">
      <div className="feed-content-header">
        <div>
          <h2 className="feed-content-title">Open Source Leaderboard</h2>
          <p className="feed-content-sub">Top 10 open-source models from the Open LLM Leaderboard, refreshed via Gemini Search.</p>
        </div>
        <button className="primary-btn" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="state"><div className="spinner" /><div className="state-text">Fetching leaderboard via Gemini…</div></div>
      )}

      {!loading && error && (
        <div className="state">
          <div className="error-box"><h3>Error</h3><p>{error}</p><button className="primary-btn" onClick={load}>Retry</button></div>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.fetchedAt && (
            <div className="feed-meta">Last fetched: {formatDate(data.fetchedAt)}</div>
          )}
          <div className="leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Model</th>
                  <th>Organization</th>
                  <th>Average</th>
                  <th>ARC</th>
                  <th>HellaSwag</th>
                  <th>MMLU</th>
                  <th>TruthfulQA</th>
                </tr>
              </thead>
              <tbody>
                {(data.models || []).map((m, i) => (
                  <tr key={i}>
                    <td className="leaderboard-rank">{m.rank || i + 1}</td>
                    <td className="leaderboard-model">{m.model}</td>
                    <td>{m.organization || '—'}</td>
                    <td className="leaderboard-score">{m.average || '—'}</td>
                    <td>{m.arc || '—'}</td>
                    <td>{m.hellaswag || '—'}</td>
                    <td>{m.mmlu || '—'}</td>
                    <td>{m.truthfulqa || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="leaderboard-source">
            Source: <a href="https://llm-stats.com/leaderboards/open-llm-leaderboard" target="_blank" rel="noopener noreferrer">llm-stats.com/leaderboards/open-llm-leaderboard</a>
          </div>
        </>
      )}
    </div>
  );
}

// ── Standard feed view ──
function FeedView({ part, isPrism }) {
  const [data, setData] = useState(null);
  const [loadingCache, setLoadingCache] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [configSources, setConfigSources] = useState([]);
  const [sourceFilter, setSourceFilter] = useState('All');
  const [showAddSource, setShowAddSource] = useState(false);

  const partQs = `?part=${encodeURIComponent(part)}`;

  useEffect(() => {
    fetch(`/api/feed/sources${partQs}`)
      .then(r => r.json())
      .then(({ sources }) => setConfigSources(sources || []))
      .catch(() => {});
    setSourceFilter('All');
  }, [part]);

  const startPolling = useCallback(async (prevGeneratedAt, isCancelled = () => false) => {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 3000));
      if (isCancelled()) return;
      try {
        const pollRes = await fetch(`/api/feed${partQs}`);
        if (pollRes.ok) {
          const json = await pollRes.json();
          if (!json.pipelineRunning && json.generatedAt && json.generatedAt !== prevGeneratedAt) {
            setData(json); setRefreshing(false); return;
          }
        }
      } catch {}
    }
    setError('Feed pipeline is taking longer than expected.');
    setRefreshing(false);
  }, [partQs]);

  useEffect(() => {
    let cancelled = false;
    setData(null); setLoadingCache(true); setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/feed${partQs}`);
        const json = await res.json();
        if (cancelled) return;
        if (json?.generatedAt) setData(json);
        setLoadingCache(false);
        if (json.pipelineRunning) { setRefreshing(true); await startPolling(json.generatedAt, () => cancelled); }
      } catch { if (!cancelled) setLoadingCache(false); }
    })();
    return () => { cancelled = true; };
  }, [startPolling, partQs]);

  const refresh = useCallback(async () => {
    setRefreshing(true); setError(null);
    const prevGeneratedAt = data?.generatedAt ?? null;
    try {
      const triggerRes = await fetch('/api/feed/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ part }),
      });
      if (!triggerRes.ok) { const body = await triggerRes.text(); throw new Error(`Server returned ${triggerRes.status}: ${body.slice(0, 200)}`); }
      await startPolling(prevGeneratedAt);
    } catch (err) { setError(err.message || 'Failed to refresh feed'); setRefreshing(false); }
  }, [data, startPolling, part]);

  const partSourceNames = useMemo(() => new Set(configSources.map(s => s.name)), [configSources]);
  const hasData = data && data.generatedAt;
  const allSources = data?.sources ?? {};
  const sources = useMemo(() => {
    if (!partSourceNames.size) return {};
    return Object.fromEntries(Object.entries(allSources).filter(([name]) => partSourceNames.has(name)));
  }, [allSources, partSourceNames]);
  const total = useMemo(() => Object.values(sources).reduce((n, items) => n + (items?.length || 0), 0), [sources]);
  const filterOptions = configSources.map(s => s.name);
  const visibleSources = sourceFilter === 'All' ? sources : Object.fromEntries(Object.entries(sources).filter(([name]) => name === sourceFilter));
  const buttonLabel = refreshing ? 'Running…' : hasData ? 'Refresh Feed' : 'Run Feed';
  const catLabel = FEED_CATEGORIES.find(c => c.part === part)?.label || part;

  return (
    <div className="feed-content-area">
      <div className="feed-content-header">
        <div>
          <h2 className="feed-content-title">{catLabel}</h2>
          <p className="feed-content-sub">
            {hasData
              ? `Last run: ${formatDate(data.generatedAt)} · ${total} item${total === 1 ? '' : 's'}`
              : `Click below to scrape today's news from ${configSources.length || 0} source${(configSources.length || 0) === 1 ? '' : 's'}.`}
          </p>
        </div>
        <button className="primary-btn" onClick={refresh} disabled={refreshing || loadingCache}>{buttonLabel}</button>
      </div>

      {(filterOptions.length > 0 || !loadingCache) && (
        <div className="source-toolbar">
          <div className="source-filter">
            <button className={`filter-pill${sourceFilter === 'All' ? ' active' : ''}`} onClick={() => setSourceFilter('All')}>All</button>
            {filterOptions.map(name => (
              <button key={name} className={`filter-pill${sourceFilter === name ? ' active' : ''}`} onClick={() => setSourceFilter(name)}>{name}</button>
            ))}
          </div>
          <button className="add-source-btn" onClick={() => setShowAddSource(v => !v)}>
            {showAddSource ? '✕ Cancel' : '＋ Add source'}
          </button>
        </div>
      )}

      {showAddSource && (
        <AddSourcePanel
          activePart={part}
          onAdded={(updated) => {
            const filtered = (updated || []).filter((s) =>
              Array.isArray(s.parts) ? s.parts.includes(part) : part === 'Tech Management'
            );
            setConfigSources(filtered);
          }}
          onClose={() => setShowAddSource(false)}
        />
      )}

      {loadingCache && <div className="state"><div className="spinner" /></div>}

      {refreshing && (
        <div className="state">
          <div className="spinner" />
          <div className="state-text">Running the pipeline — scraping, scoring &amp; summarising. This typically takes 1–3 minutes.</div>
        </div>
      )}

      {!refreshing && error && (
        <div className="state"><div className="error-box"><h3>Couldn't refresh the feed</h3><p>{error}</p><button className="primary-btn" onClick={refresh}>Retry</button></div></div>
      )}

      {!refreshing && hasData && Object.keys(sources).length === 0 && (
        <div className="state"><div className="state-text">No items from this category's sources passed the relevance threshold. Try refreshing later.</div></div>
      )}

      {!refreshing && hasData && Object.keys(visibleSources).length === 0 && Object.keys(sources).length > 0 && (
        <div className="state"><div className="state-text">No articles from <strong>{sourceFilter}</strong> in this run.</div></div>
      )}

      {!refreshing && hasData &&
        Object.entries(visibleSources).map(([name, items]) => (
          <section className="source-section" key={name}>
            <h2 className="source-header">{name}</h2>
            <div className="cards">
              {items.map((it, i) => <Card key={`${name}-${i}`} item={it} isPrism={isPrism} />)}
            </div>
          </section>
        ))}
    </div>
  );
}

// ── Main FeedTab component ──
export default function FeedTab() {
  const [activeCategory, setActiveCategory] = useState('leaderboard');

  const activeCat = FEED_CATEGORIES.find(c => c.id === activeCategory);

  return (
    <div className="feed-layout">
      {/* Left sidebar */}
      <aside className="feed-sidebar">
        <div className="feed-sidebar-title">Feed Categories</div>
        <nav className="feed-sidebar-nav">
          {FEED_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`feed-sidebar-item${activeCategory === cat.id ? ' active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span className="feed-sidebar-icon">{cat.icon}</span>
              <span className="feed-sidebar-label">{cat.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Right content */}
      <div className="feed-main">
        {activeCategory === 'leaderboard' && <LeaderboardView />}
        {activeCategory !== 'leaderboard' && activeCat && (
          <FeedView part={activeCat.part} isPrism={activeCat.part === 'PRISM'} />
        )}
      </div>
    </div>
  );
}
