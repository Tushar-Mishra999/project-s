import { useCallback, useEffect, useState } from 'react';

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function Card({ item }) {
  return (
    <article className="card">
      {item.date ? <div className="meta">{item.date}</div> : null}
      <a className="title" href={item.url} target="_blank" rel="noopener noreferrer">
        {item.title}
      </a>
      <p className="summary">{item.summary}</p>
      <a className="more" href={item.url} target="_blank" rel="noopener noreferrer">
        Read more →
      </a>
    </article>
  );
}

export default function FeedTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/feed');
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Server returned ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message || 'Failed to load feed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = formatDate(data?.generatedAt || Date.now());
  const total = data?.count ?? 0;
  const sources = data?.sources ?? {};

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Tech Sensing Feed</h1>
          <div className="sub">
            {today}
            {!loading && !error ? ` · ${total} item${total === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <button className="primary-btn" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh Feed'}
        </button>
      </div>

      {loading && (
        <div className="state">
          <div className="spinner" />
          <div className="state-text">
            Running the pipeline — scraping 13 sources, scoring with Haiku, summarising with Sonnet.
            This typically takes 1–3 minutes.
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="state">
          <div className="error-box">
            <h3>Couldn't load the feed</h3>
            <p>{error}</p>
            <button className="primary-btn" onClick={load}>Retry</button>
          </div>
        </div>
      )}

      {!loading && !error && Object.keys(sources).length === 0 && (
        <div className="state">
          <div className="state-text">
            No items passed the relevance threshold. Try refreshing later.
          </div>
        </div>
      )}

      {!loading && !error &&
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
