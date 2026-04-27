import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [loadingCache, setLoadingCache] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const cancelPollRef = useRef(false);

  // Poll /api/feed every 3 s until pipelineRunning becomes false and generatedAt changes.
  const startPolling = useCallback(async (prevGeneratedAt) => {
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 3000));
      if (cancelPollRef.current) return;
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

  // Load cached feed on mount; auto-poll if a pipeline is already running.
  useEffect(() => {
    let cancelled = false;
    cancelPollRef.current = false;
    (async () => {
      try {
        const res = await fetch('/api/feed');
        const json = await res.json();
        if (cancelled) return;
        if (json && json.generatedAt) setData(json);
        if (json.pipelineRunning) {
          setRefreshing(true);
          startPolling(json.generatedAt);
        }
      } catch {
        /* silent — user will see idle state */
      } finally {
        if (!cancelled) setLoadingCache(false);
      }
    })();
    return () => { cancelled = true; cancelPollRef.current = true; };
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
