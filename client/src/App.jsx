import { useEffect, useMemo, useState } from 'react';
import FeedTab from './tabs/FeedTab.jsx';
import RetrievalTab from './tabs/RetrievalTab.jsx';
import ChatTab from './tabs/ChatTab.jsx';
import ActionItemsTab from './tabs/ActionItemsTab.jsx';
import ReportGeneratorTab from './tabs/ReportGeneratorTab.jsx';
import AIQuizzesTab from './tabs/AIQuizzesTab.jsx';
import TaskForceTab, { USERS } from './tabs/TaskForceTab.jsx';

const TABS = [
  { id: 'feed',     label: 'Tech Sensing' },
  { id: 'files',    label: 'Smart Retrieval' },
  { id: 'chat',     label: 'Insights Chat' },
  { id: 'actions',  label: 'Action Items' },
  { id: 'reports',  label: 'Report Generator' },
  { id: 'quizzes',  label: 'AI Quizzes' },
  { id: 'taskforce',label: 'Task Force' },
];

export default function App() {
  const [active, setActive] = useState('feed');
  const [parts, setParts] = useState([]);
  const [activeUserId, setActiveUserId] = useState('u_md');

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
        {active === 'feed'    && <FeedTab activePart={activePart} />}
        {active === 'files'   && <RetrievalTab parts={parts} activePart={activePart} />}
        {active === 'chat'    && <ChatTab activePart={activePart} />}
        {active === 'actions' && <ActionItemsTab activePart={activePart} />}
        {active === 'reports' && <ReportGeneratorTab activePart={activePart} />}
        {active === 'quizzes' && <AIQuizzesTab activePart={activePart} />}
        {active === 'taskforce' && <TaskForceTab activeUserId={activeUserId} />}
      </main>
    </div>
  );
}
