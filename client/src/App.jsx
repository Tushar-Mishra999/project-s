import { useEffect, useMemo, useState } from 'react';
import FeedTab from './tabs/FeedTab.jsx';
import RetrievalTab from './tabs/RetrievalTab.jsx';
import ChatTab from './tabs/ChatTab.jsx';
import ActionItemsTab from './tabs/ActionItemsTab.jsx';
import ReportGeneratorTab from './tabs/ReportGeneratorTab.jsx';
import AIQuizzesTab from './tabs/AIQuizzesTab.jsx';
import TaskForceTab, { USERS } from './tabs/TaskForceTab.jsx';
import HomeTab from './tabs/HomeTab.jsx';
import MinutesTab from './tabs/MinutesTab.jsx';

const TABS = [
  { id: 'home',     label: 'Home' },
  { id: 'feed',     label: 'Tech Sensing' },
  { id: 'files',    label: 'Knowledge Hub' },
  { id: 'chat',     label: 'Insights Chat' },
  { id: 'actions',  label: 'Action Items' },
  { id: 'taskforce',label: 'Task Force' },
  { id: 'minutes',  label: 'MoM' },
  { id: 'reports',  label: 'Report Generator' },
  { id: 'quizzes',  label: 'AI Quizzes' },
];

const TECH_AREAS = [
  'Edge AI / Inference',
  'Generative AI / LLMs',
  'Retrieval & RAG',
  'Computer Vision',
  'Synthetic Data',
  'MLOps & Infra',
  'Security & Privacy',
  'Hardware / Silicon',
  'Other',
];

function IdeaModal({ open, onClose, activeUser }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [techArea, setTechArea] = useState(TECH_AREAS[0]);
  const [submitted, setSubmitted] = useState(false);

  if (!open) return null;

  const submittingFrom = activeUser
    ? `${activeUser.name} — ${activeUser.label}`
    : '—';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    // Mock submission — just log and confirm.
    console.log('[worklet idea]', { title, description, techArea, submittingFrom });
    setSubmitted(true);
    setTimeout(() => {
      onClose();
      setTitle(''); setDescription(''); setTechArea(TECH_AREAS[0]); setSubmitted(false);
    }, 1100);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Submit Worklet Idea</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {submitted ? (
          <div className="modal-success">
            <div className="modal-success-icon">✓</div>
            <div>Thanks — your worklet idea has been submitted for review.</div>
          </div>
        ) : (
          <form className="upload-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <label>Title</label>
              <input
                type="text"
                placeholder="e.g. Quantising Whisper for on-device meeting transcription"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label>Description</label>
              <textarea
                className="modal-textarea"
                placeholder="A short description — what problem this addresses, the rough approach, and why it's worth doing now."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                required
              />
            </div>
            <div className="form-row">
              <label>Relevant Tech Area</label>
              <select value={techArea} onChange={(e) => setTechArea(e.target.value)}>
                {TECH_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Submitting Part / Team</label>
              <input type="text" value={submittingFrom} disabled />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="primary-btn">Submit Idea</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState('home');
  const [parts, setParts] = useState([]);
  const [activeUserId, setActiveUserId] = useState('u_md');
  const [ideaOpen, setIdeaOpen] = useState(false);

  const activeUser = USERS.find((u) => u.id === activeUserId);

  useEffect(() => {
    fetch('/api/parts')
      .then((r) => r.json())
      .then((d) => setParts(d.parts || []))
      .catch(() => setParts([]));
  }, []);

  // Derive the active "part" from the selected user. If the user's label
  // matches a known part (e.g. PRISM, PMO, Data Management, Tech Management),
  // use it; otherwise fall back to the first available part so the rest of
  // the app keeps working for MD / Member roles.
  const activePart = useMemo(() => {
    const u = USERS.find((x) => x.id === activeUserId);
    if (u && parts.includes(u.label)) return u.label;
    if (u && u.role === 'TechMgmt' && parts.includes('Tech Management')) return 'Tech Management';
    return parts[0] || '';
  }, [activeUserId, parts]);

  return (
    <div className="app-shell">
      <nav className="tabs">
        <div className="tabs-inner">
          <div className="brand-row">
            <div className="brand">Kernel</div>
            <div className="nav-right">
              <button
                className="idea-btn"
                onClick={() => setIdeaOpen(true)}
                title="Submit Worklet Idea"
              >
                <span className="idea-btn-plus">+</span>
                <span className="idea-btn-label">Idea</span>
              </button>
              <div className="part-switcher">
                <span className="part-switcher-label">Viewing as</span>
                <select
                  value={activeUserId}
                  onChange={(e) => setActiveUserId(e.target.value)}
                  className="part-select"
                >
                  {USERS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="tab-buttons">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab-btn ${active === t.id ? 'active' : ''}`}
                onClick={() => setActive(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main>
        {active === 'home'    && <HomeTab activeUserId={activeUserId} onNavigate={setActive} />}
        {active === 'feed'    && <FeedTab activePart={activePart} />}
        {active === 'files'   && <RetrievalTab parts={parts} activePart={activePart} />}
        {active === 'chat'    && <ChatTab activePart={activePart} />}
        {active === 'actions' && <ActionItemsTab activePart={activePart} />}
        {active === 'minutes' && <MinutesTab />}
        {active === 'reports' && <ReportGeneratorTab activePart={activePart} />}
        {active === 'quizzes' && <AIQuizzesTab activePart={activePart} />}
        {active === 'taskforce' && <TaskForceTab activeUserId={activeUserId} />}
      </main>

      <IdeaModal open={ideaOpen} onClose={() => setIdeaOpen(false)} activeUser={activeUser} />
    </div>
  );
}
