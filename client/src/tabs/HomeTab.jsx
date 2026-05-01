import { useEffect, useMemo, useState } from 'react';
import { userLabel } from './TaskForceTab.jsx';

// ----- Mock content -----
const MOCK_NEWS = [
  {
    source: 'MIT Technology Review',
    date: '2026-04-28',
    title: 'Inside the new wave of small reasoning models beating frontier giants',
    snippet: 'Distilled 7B-class models are matching GPT-class performance on math and code benchmarks at a fraction of the cost.',
  },
  {
    source: 'arXiv (cs.LG)',
    date: '2026-04-26',
    title: 'Sparse Mixture-of-Experts Routing with Hardware-Aware Constraints',
    snippet: 'A new routing scheme reduces all-to-all communication overhead by 38%, enabling MoE training on commodity clusters.',
  },
  {
    source: 'Hacker News',
    date: '2026-04-25',
    title: 'Show HN: A 200-line on-device retriever that beats vector DBs for small corpora',
    snippet: 'Author argues that for under 50k chunks, BM25 + a learned reranker outperforms managed vector stores on relevance.',
  },
];

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ActionItemsWidget({ activeUser, onClick }) {
  const [partItems, setPartItems] = useState([]);
  const [tfItems, setTfItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Pull action items assigned to this user (same source as Action Items tab).
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

  // TF action items assigned to this user — pulled from the same API the TF tab uses.
  useEffect(() => {
    if (!activeUser?.id) { setTfItems([]); setLoading(false); return; }
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
  }, [activeUser?.id]);

  return (
    <div className="home-card home-card-clickable home-card-wide" onClick={onClick} role="button" tabIndex={0}
         onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className="home-card-header">
        <h3 className="home-card-title">Action Items</h3>
        <span className="home-card-link">Open →</span>
      </div>
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
    </div>
  );
}

function TechSensingWidget({ onClick }) {
  return (
    <div className="home-card home-card-clickable" onClick={onClick} role="button" tabIndex={0}
         onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <div className="home-card-header">
        <h3 className="home-card-title">Tech Sensing</h3>
        <span className="home-card-link">Open feed →</span>
      </div>
      <div className="home-news-list">
        {MOCK_NEWS.map((n, i) => (
          <div key={i} className="home-news-item">
            <div className="home-news-meta">
              <span className="home-news-source">{n.source}</span>
              <span className="tf-muted">· {n.date}</span>
            </div>
            <div className="home-news-title">{n.title}</div>
            <div className="home-news-snippet">{n.snippet}</div>
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

export default function HomeTab({ users = [], activeUserId, onNavigate }) {
  const activeUser = users.find((u) => u.id === activeUserId);

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
        <ActionItemsWidget activeUser={activeUser} onClick={() => onNavigate('actions')} />

        <TechSensingWidget onClick={() => onNavigate('feed')} />

        <RecentDocsWidget activeUser={activeUser} onClick={() => onNavigate('files')} />

        <CtaCard
          eyebrow="Weekly AI Quiz"
          title="This week's AI quiz is live — test your knowledge"
          body="A fresh 5-question challenge drawn from the latest research and your team's recent uploads."
          ctaLabel="Take the Quiz →"
          onClick={() => onNavigate('quizzes')}
          accent="violet"
        />

        <CtaCard
          eyebrow="Insights Chat"
          title="Have a question about a report, trend, or tech area?"
          body="Ask the assistant — it has access to every document and feed item indexed for your part."
          ctaLabel="Ask Now →"
          onClick={() => onNavigate('chat')}
          accent="blue"
        />
      </div>
    </div>
  );
}
