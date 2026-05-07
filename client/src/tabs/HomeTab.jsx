import { useEffect, useState } from 'react';

const PRISM_STATS = [
  { label: 'Total', value: 47, accent: 'blue' },
  { label: 'Ongoing', value: 12, accent: 'amber' },
  { label: 'Completed', value: 35, accent: 'green' },
  { label: 'Excellent', value: 18, accent: 'violet' },
];

const TOP_CONTRIBUTORS = [
  { name: 'Ananya Sharma', count: 9 },
  { name: 'Rohan Mehta', count: 7 },
  { name: 'Priya Nair', count: 6 },
];

// Maps a user's part/role to the feed API part and display label
const FEED_PART_INFO = {
  'MD':               { feedPart: 'MD',               label: 'Market Intelligence' },
  'Tech Management':  { feedPart: 'Tech Management',  label: 'Tech Sensing' },
  'PRISM':            { feedPart: 'PRISM',             label: 'Worklet Radar' },
  'PMO':              { feedPart: 'PMO',               label: 'PM Intelligence' },
  'Data Management':  { feedPart: 'Data Management',  label: 'Data Intelligence' },
};

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---- MD-specific cards ----

function MDTaskForcesWidget({ activeUser, onClick }) {
  const [taskForces, setTaskForces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeUser?.id) { setTaskForces([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/task-forces?user_id=${encodeURIComponent(activeUser.id)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setTaskForces(data.task_forces || []); })
      .catch(() => setTaskForces([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeUser?.id]);

  return (
    <div className="home-card home-card-clickable" onClick={onClick} role="button" tabIndex={0}
         onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className="home-card-header">
        <h3 className="home-card-title">Task Forces</h3>
        <span className="home-card-link">Open →</span>
      </div>
      {loading && <div className="home-empty">Loading…</div>}
      {!loading && taskForces.length === 0 && (
        <div className="home-empty">No task forces found.</div>
      )}
      {!loading && taskForces.length > 0 && (
        <div className="home-tf-list">
          {taskForces.map((tf) => {
            const statusCls =
              tf.status === 'Active' ? 'green' :
              tf.status === 'On Hold' ? 'amber' : 'grey';
            return (
              <div key={tf.id} className="home-tf-item">
                <span className="home-tf-name">{tf.name}</span>
                <span className={`home-tf-status home-tf-status-${statusCls}`}>{tf.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkletStatsWidget() {
  return (
    <div className="home-card home-prism-stats-card">
      <div className="home-card-header">
        <h3 className="home-card-title">Worklet Radar</h3>
        <a
          className="home-card-link"
          href="https://samsungprism.com/login"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          View on PRISM →
        </a>
      </div>
      <div className="home-prism-stat-tiles">
        {PRISM_STATS.map((s) => (
          <div key={s.label} className={`home-prism-stat-tile home-prism-stat-tile-${s.accent}`}>
            <span className="home-prism-stat-tile-value">{s.value}</span>
            <span className="home-prism-stat-tile-label">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="home-worklet-contributors">
        <div className="home-worklet-contributors-title">Top Contributors</div>
        <div className="home-worklet-contributors-list">
          {TOP_CONTRIBUTORS.map((c, i) => (
            <div key={c.name} className="home-worklet-contributor-row">
              <span className={`home-worklet-rank home-worklet-rank-${i + 1}`}>{i + 1}</span>
              <span className="home-worklet-contributor-name">{c.name}</span>
              <span className="home-worklet-contributor-count">{c.count} worklets</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Shared cards ----

function ActionItemsWidget({ activeUser, isPrism, onClick }) {
  const [partItems, setPartItems] = useState([]);
  const [tfItems, setTfItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeUser?.id) { setPartItems([]); return; }
    let cancelled = false;
    fetch(`/api/action-items?user_id=${encodeURIComponent(activeUser.id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const cards = data.cards || [];
        const flat = cards.flatMap((c) =>
          (c.items || [])
            .filter((it) => it.editable && !it.completed)
            .map((it) => ({ id: `${c.id}-${it.id}`, text: it.text, source: c.filename || 'Document' }))
        );
        setPartItems(flat.slice(0, 5));
      })
      .catch(() => setPartItems([]));
    return () => { cancelled = true; };
  }, [activeUser?.id]);

  useEffect(() => {
    if (isPrism || !activeUser?.id) { setTfItems([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/task-forces?user_id=${encodeURIComponent(activeUser.id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const tfs = data.task_forces || [];
        const out = [];
        for (const tf of tfs) {
          for (const a of tf.actionItems || []) {
            if (a.assignee === activeUser.id && !a.done) {
              out.push({ id: `${tf.id}-${a.id}`, text: a.text, source: tf.name, due: a.due });
            }
          }
        }
        setTfItems(out.slice(0, 5));
      })
      .catch(() => setTfItems([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeUser?.id, isPrism]);

  const cardClass = `home-card home-card-clickable${isPrism ? '' : ' home-card-wide'}`;

  return (
    <div className={cardClass} onClick={onClick} role="button" tabIndex={0}
         onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className="home-card-header">
        <h3 className="home-card-title">Action Items</h3>
        <span className="home-card-link">Open →</span>
      </div>
      {isPrism ? (
        <div className="home-actions-col" style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <div className="home-actions-subtitle">
            My Open Action Items
            <span className="home-pill">{loading ? '…' : partItems.length}</span>
          </div>
          {loading && <div className="home-empty">Loading…</div>}
          {!loading && partItems.length === 0 && (
            <div className="home-empty">No open action items assigned to you.</div>
          )}
          <ul className="home-action-list">
            {partItems.map((it) => (
              <li key={it.id}>
                <span className="home-action-text">{it.text}</span>
                <span className="home-action-source">{it.source}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="home-actions-grid">
          <div className="home-actions-col">
            <div className="home-actions-subtitle">
              My Action Items (from documents)
              <span className="home-pill">{loading ? '…' : partItems.length}</span>
            </div>
            {loading && <div className="home-empty">Loading…</div>}
            {!loading && partItems.length === 0 && (
              <div className="home-empty">No open document action items assigned to you.</div>
            )}
            <ul className="home-action-list">
              {partItems.map((it) => (
                <li key={it.id}>
                  <span className="home-action-text">{it.text}</span>
                  <span className="home-action-source">{it.source}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="home-actions-col">
            <div className="home-actions-subtitle">
              My Task Force Action Items
              <span className="home-pill">{tfItems.length}</span>
            </div>
            {tfItems.length === 0 && (
              <div className="home-empty">No open TF items assigned to you.</div>
            )}
            <ul className="home-action-list">
              {tfItems.map((it) => (
                <li key={it.id}>
                  <span className="home-action-text">{it.text}</span>
                  <span className="home-action-source">
                    {it.source}{it.due ? ` · due ${it.due}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedWidget({ activePart, activeUserRole, onClick }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  const key = activeUserRole === 'MD' ? 'MD' : (activePart || 'Tech Management');
  const { feedPart, label } = FEED_PART_INFO[key] || FEED_PART_INFO['Tech Management'];
  const isPrismFeed = feedPart === 'PRISM';
  const isDataFeed = feedPart === 'Data Management';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/feed?part=${encodeURIComponent(feedPart)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const all = Object.values(data.sources || {}).flat();
        setArticles(all.slice(0, 3));
      })
      .catch(() => { if (!cancelled) setArticles([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [feedPart]);

  return (
    <div className="home-card home-card-clickable" onClick={onClick} role="button" tabIndex={0}
         onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className="home-card-header">
        <div>
          <h3 className="home-card-title">Feed</h3>
          <span className="home-card-subtitle">{label}</span>
        </div>
        <span className="home-card-link">Open feed →</span>
      </div>

      {isPrismFeed && (
        <div className="home-feed-ext-links" onClick={(e) => e.stopPropagation()}>
          <a href="https://oneprism.com" target="_blank" rel="noopener noreferrer" className="home-feed-ext-link">
            Visit OnePrism ↗
          </a>
        </div>
      )}

      {isDataFeed && (
        <div className="home-feed-ext-links" onClick={(e) => e.stopPropagation()}>
          <a href="https://dataflo.io" target="_blank" rel="noopener noreferrer" className="home-feed-ext-link">
            Dataflo ↗
          </a>
          <a href="https://datavault.io" target="_blank" rel="noopener noreferrer" className="home-feed-ext-link">
            DataVault ↗
          </a>
        </div>
      )}

      <div className="home-news-list">
        {loading && <div className="home-empty">Loading…</div>}
        {!loading && articles.length === 0 && (
          <div className="home-empty">No recent articles — refresh the feed to populate.</div>
        )}
        {!loading && articles.map((a, i) => (
          <div key={i} className="home-news-item">
            <div className="home-news-meta">
              <span className="home-news-source">{a.source}</span>
              {a.date && <span className="tf-muted">· {a.date}</span>}
            </div>
            <div className="home-news-title">{a.title}</div>
            {a.summary && <div className="home-news-snippet">{a.summary}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentDocsWidget({ activeUser, onClick }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeUser?.id) { setDocs([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/files?user_id=${encodeURIComponent(activeUser.id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDocs((data.files || []).slice(0, 5));
      })
      .catch(() => setDocs([]))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeUser?.id]);

  return (
    <div className="home-card home-card-clickable" onClick={onClick} role="button" tabIndex={0}
         onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className="home-card-header">
        <h3 className="home-card-title">Recent Documents</h3>
        <span className="home-card-link">Browse library →</span>
      </div>
      {loading && <div className="home-empty">Loading…</div>}
      {!loading && docs.length === 0 && (
        <div className="home-empty">No documents visible to you yet.</div>
      )}
      {!loading && docs.length > 0 && (
        <div className="home-docs-list">
          {docs.map((d) => (
            <div key={d.id} className="home-doc-item">
              <div className="file-icon-doc" aria-hidden="true" />
              <div className="home-doc-body">
                <div className="home-doc-title">{d.filename}</div>
                <div className="home-doc-summary">
                  {(d.accessible_to || []).join(', ') || '—'} · {formatDate(d.uploaded_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CtaCard({ eyebrow, title, body, ctaLabel, onClick, accent = 'blue' }) {
  return (
    <div className={`home-card home-cta home-cta-${accent}`}>
      <div className="home-cta-eyebrow">{eyebrow}</div>
      <h3 className="home-cta-title">{title}</h3>
      <p className="home-cta-body">{body}</p>
      <button className="primary-btn" onClick={onClick}>{ctaLabel}</button>
    </div>
  );
}

export default function HomeTab({ users = [], activeUserId, activePart, activeUserRole, onNavigate }) {
  const activeUser = users.find((u) => u.id === activeUserId);
  const isPrism = activePart === 'PRISM';
  const isMD = activeUserRole === 'MD';

  if (!activeUser) {
    return <div className="wrap home-wrap"><div className="placeholder-panel"><p>Loading…</p></div></div>;
  }

  return (
    <div className="wrap home-wrap">
      <div className="header">
        <div>
          <h1>Welcome, {activeUser.name}</h1>
          <div className="sub">
            Here's what needs attention across your part, your task forces, and the wider tech landscape.
          </div>
        </div>
      </div>

      <div className="home-grid">
        {isMD ? (
          <>
            <MDTaskForcesWidget activeUser={activeUser} onClick={() => onNavigate('taskforce')} />
            <WorkletStatsWidget />
          </>
        ) : (
          <ActionItemsWidget activeUser={activeUser} isPrism={isPrism} onClick={() => onNavigate('actions')} />
        )}

        {isPrism && !isMD && <WorkletStatsWidget />}

        <FeedWidget activePart={activePart} activeUserRole={activeUserRole} onClick={() => onNavigate('feed')} />

        <RecentDocsWidget activeUser={activeUser} onClick={() => onNavigate('hub')} />

        <CtaCard
          eyebrow="Weekly AI Quiz"
          title="This week's AI quiz is live — test your knowledge"
          body="A fresh 5-question challenge drawn from the latest research and your team's recent uploads."
          ctaLabel="Take the Quiz →"
          onClick={() => onNavigate('quizzes')}
          accent="violet"
        />

        <CtaCard
          eyebrow="Chat with Pluto"
          title="Have a question about a report, trend, or tech area?"
          body="Click the floating chat button to ask Pluto — it has access to every document and feed item indexed for your part."
          ctaLabel="Open Knowledge Hub →"
          onClick={() => onNavigate('hub')}
          accent="blue"
        />
      </div>
    </div>
  );
}
