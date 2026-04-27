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

export default function FeedTab() {
  const [data, setData] = useState(null);
  const [loadingCache, setLoadingCache] = useState(true); // initial fetch of cached
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Load cached feed on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/feed');
        const json = await res.json();
        if (cancelled) return;
        if (json && json.generatedAt) setData(json);
      } catch {
        /* silent — user will see idle state */
      } finally {
        if (!cancelled) setLoadingCache(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/feed/refresh', { method: 'POST' });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Server returned ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message || 'Failed to refresh feed');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const hasData = data && data.generatedAt;
  const sources = data?.sources ?? {};
  const total = data?.count ?? 0;

  const buttonLabel = refreshing
    ? 'Running…'
    : hasData
      ? 'Refresh Feed'
      : 'Run Feed';

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Tech Sensing Feed</h1>
          <div className="sub">
            {hasData
              ? `Last run: ${formatDate(data.generatedAt)} · ${total} item${total === 1 ? '' : 's'}`
              : 'Click below to scrape today’s tech news from 13 sources.'}
          </div>
        </div>
        <button className="primary-btn" onClick={refresh} disabled={refreshing || loadingCache}>
          {buttonLabel}
        </button>
      </div>

      {loadingCache && (
        <div className="state"><div className="spinner" /></div>
      )}

      {!loadingCache && !hasData && !refreshing && !error && (
        <div className="state">
          <div className="state-text">
            The feed is not auto-refreshed. Click <strong>Run Feed</strong> to start the pipeline —
            it scrapes 13 sources, scores items with Gemini Flash, then summarises the top picks.
            Takes 1–3 minutes per run. The result is saved and shown next time you visit.
          </div>
        </div>
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
        <div className="state">
          <div className="state-text">
            No items passed the relevance threshold. Try refreshing later.
          </div>
        </div>
      )}

      {!refreshing && hasData &&
        Object.entries(sources).map(([name, items]) => (
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
