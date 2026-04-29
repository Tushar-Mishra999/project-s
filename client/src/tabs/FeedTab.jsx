import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function WorkletPanel({ open, loading, error, content, onRetry }) {
  if (!open) return null;
  return (
    <div className="worklet-panel">
      {loading && (
        <div className="worklet-loading">
          <div className="spinner small" />
          <span>Drafting a worklet idea…</span>
        </div>
      )}
      {!loading && error && (
        <div className="inline-msg error">
          {error} <button className="ghost-btn" onClick={onRetry}>Retry</button>
        </div>
      )}
      {!loading && !error && content && (
        <div className="md worklet-content">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function Card({ item }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/worklet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          summary: item.summary,
          source: item.source,
          url: item.url,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setContent(json.worklet);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [item]);

  const handleClick = () => {
    if (!open) {
      setOpen(true);
      if (!content && !loading) generate();
    } else {
      setOpen(false);
    }
  };

  return (
    <article className="card">
      {item.date ? <div className="meta">{item.date}</div> : null}
      <a className="title" href={item.url} target="_blank" rel="noopener noreferrer">
        {item.title}
      </a>
      <p className="summary">{item.summary}</p>
      <div className="card-actions">
        <button className="link-btn" onClick={handleClick}>
          {open ? 'Hide worklet' : '＋ Create a worklet'}
        </button>
        <a className="more" href={item.url} target="_blank" rel="noopener noreferrer">
          Read more →
        </a>
      </div>
      <WorkletPanel
        open={open}
        loading={loading}
        error={error}
        content={content}
        onRetry={generate}
      />
    </article>
  );
}

function AddSourcePanel({ onAdded, onClose }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/feed/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      setSuccess(true);
      onAdded(json.sources);
      setTimeout(() => { setSuccess(false); onClose(); }, 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-source-panel">
      <div className="add-source-header">
        <span className="add-source-title">Add a new source</span>
        <button className="add-source-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {success ? (
        <div className="inline-msg success">Source added! It will appear in the next feed refresh.</div>
      ) : (
        <form className="add-source-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label htmlFor="src-name">Display name</label>
            <input
              id="src-name"
              type="text"
              placeholder="e.g. MIT Technology Review"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-row">
            <label htmlFor="src-url">URL (homepage or RSS feed)</label>
            <input
              id="src-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              required
            />
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

export default function FeedTab() {
  const [data, setData] = useState(null);
  const [loadingCache, setLoadingCache] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [configSources, setConfigSources] = useState([]);
  const [sourceFilter, setSourceFilter] = useState('All');
  const [showAddSource, setShowAddSource] = useState(false);

  // Fetch configured sources for filter bar
  useEffect(() => {
    fetch('/api/feed/sources')
      .then(r => r.json())
      .then(({ sources }) => setConfigSources(sources || []))
      .catch(() => {});
  }, []);

  const startPolling = useCallback(async (prevGeneratedAt, isCancelled = () => false) => {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 3000));
      if (isCancelled()) return;
      try {
        const pollRes = await fetch('/api/feed');
        if (pollRes.ok) {
          const json = await pollRes.json();
          if (!json.pipelineRunning && json.generatedAt && json.generatedAt !== prevGeneratedAt) {
            setData(json);
            setRefreshing(false);
            return;
          }
        }
      } catch { /* keep polling */ }
    }
    setError('Feed pipeline is taking longer than expected. Reload the page to check results.');
    setRefreshing(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/feed');
        const json = await res.json();
        if (cancelled) return;
        if (json?.generatedAt) setData(json);
        setLoadingCache(false);
        if (json.pipelineRunning) {
          setRefreshing(true);
          await startPolling(json.generatedAt, () => cancelled);
        }
      } catch {
        if (!cancelled) setLoadingCache(false);
      }
    })();
    return () => { cancelled = true; };
  }, [startPolling]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    const prevGeneratedAt = data?.generatedAt ?? null;
    try {
      const triggerRes = await fetch('/api/feed/refresh', { method: 'POST' });
      if (!triggerRes.ok) {
        const body = await triggerRes.text();
        throw new Error(`Server returned ${triggerRes.status}: ${body.slice(0, 200)}`);
      }
      await startPolling(prevGeneratedAt);
    } catch (err) {
      setError(err.message || 'Failed to refresh feed');
      setRefreshing(false);
    }
  }, [data, startPolling]);

  const hasData = data && data.generatedAt;
  const sources = data?.sources ?? {};
  const total = data?.count ?? 0;

  // Filter pills: use configSources names; fall back to data source names if config not loaded yet
  const filterOptions = configSources.length > 0
    ? configSources.map(s => s.name)
    : Object.keys(sources);

  // Articles to display based on active filter
  const visibleSources = sourceFilter === 'All'
    ? sources
    : Object.fromEntries(Object.entries(sources).filter(([name]) => name === sourceFilter));

  const buttonLabel = refreshing ? 'Running…' : hasData ? 'Refresh Feed' : 'Run Feed';

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Tech Sensing Feed</h1>
          <div className="sub">
            {hasData
              ? `Last run: ${formatDate(data.generatedAt)} · ${total} item${total === 1 ? '' : 's'}`
              : `Click below to scrape today's tech news from ${configSources.length || 13} sources.`}
          </div>
        </div>
        <button className="primary-btn" onClick={refresh} disabled={refreshing || loadingCache}>
          {buttonLabel}
        </button>
      </div>

      {/* Source filter bar */}
      {(filterOptions.length > 0 || !loadingCache) && (
        <div className="source-toolbar">
          <div className="source-filter">
            <button
              className={`filter-pill${sourceFilter === 'All' ? ' active' : ''}`}
              onClick={() => setSourceFilter('All')}
            >
              All
            </button>
            {filterOptions.map(name => (
              <button
                key={name}
                className={`filter-pill${sourceFilter === name ? ' active' : ''}`}
                onClick={() => setSourceFilter(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <button
            className="add-source-btn"
            onClick={() => setShowAddSource(v => !v)}
          >
            {showAddSource ? '✕ Cancel' : '＋ Add source'}
          </button>
        </div>
      )}

      {showAddSource && (
        <AddSourcePanel
          onAdded={(updated) => { setConfigSources(updated); }}
          onClose={() => setShowAddSource(false)}
        />
      )}

      {loadingCache && (
        <div className="state"><div className="spinner" /></div>
      )}

      {!loadingCache && !hasData && !refreshing && !error && (
        <div className="state" />
      )}

      {refreshing && (
        <div className="state">
          <div className="spinner" />
          <div className="state-text">
            Running the pipeline — scraping, scoring &amp; summarising. This typically takes 1–3 minutes.
          </div>
        </div>
      )}

      {!refreshing && error && (
        <div className="state">
          <div className="error-box">
            <h3>Couldn't refresh the feed</h3>
            <p>{error}</p>
            <button className="primary-btn" onClick={refresh}>Retry</button>
          </div>
        </div>
      )}

      {!refreshing && hasData && Object.keys(sources).length === 0 && (
        (data.errors && data.errors.length > 0) ? (
          <div className="state">
            <div className="error-box" style={{ maxWidth: 640 }}>
              <h3>The pipeline ran but couldn't fetch any sources</h3>
              <p>
                {data.errors[0].message?.toLowerCase().includes('insufficient credits') ? (
                  <>Firecrawl is out of free credits. Top up at <a href="https://www.firecrawl.dev/pricing" target="_blank" rel="noopener">firecrawl.dev/pricing</a> or generate a new free key.</>
                ) : (
                  <>{data.errors.length} source{data.errors.length === 1 ? '' : 's'} failed. First error: <code>{data.errors[0].message}</code></>
                )}
              </p>
              <button className="primary-btn" onClick={refresh}>Retry</button>
            </div>
          </div>
        ) : (
          <div className="state">
            <div className="state-text">
              No items passed the relevance threshold. Try refreshing later.
            </div>
          </div>
        )
      )}

      {!refreshing && hasData && Object.keys(visibleSources).length === 0 && Object.keys(sources).length > 0 && (
        <div className="state">
          <div className="state-text">
            No articles from <strong>{sourceFilter}</strong> in this run. Try refreshing the feed or select a different source.
          </div>
        </div>
      )}

      {!refreshing && hasData &&
        Object.entries(visibleSources).map(([name, items]) => (
          <section className="source-section" key={name}>
            <h2 className="source-header">{name}</h2>
            <div className="cards">
              {items.map((it, i) => <Card key={`${name}-${i}`} item={it} />)}
            </div>
          </section>
        ))}
    </div>
  );
}
