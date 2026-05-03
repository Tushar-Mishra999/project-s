import { useEffect, useMemo, useState } from 'react';
import FeedTab, { feedTabLabel } from './tabs/FeedTab.jsx';
import RetrievalTab from './tabs/RetrievalTab.jsx';
import ChatTab from './tabs/ChatTab.jsx';
import ActionItemsTab from './tabs/ActionItemsTab.jsx';
import ReportGeneratorTab from './tabs/ReportGeneratorTab.jsx';
import AIQuizzesTab from './tabs/AIQuizzesTab.jsx';
import TaskForceTab, { userLabel } from './tabs/TaskForceTab.jsx';
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

function PrismStatsBar() {
  // Placeholder counts — replace with live data when worklet tracking lands.
  const stats = [
    { label: 'Total', value: 0 },
    { label: 'Ongoing', value: 0 },
    { label: 'Completed', value: 0 },
  ];
  return (
    <div className="prism-stats">
      {stats.map((s) => (
        <div key={s.label} className="prism-stat">
          <span className="prism-stat-value">{s.value}</span>
          <span className="prism-stat-label">{s.label}</span>
        </div>
      ))}
      <a
        className="prism-stat-link"
        href="https://samsungprism.com/login"
        target="_blank"
        rel="noopener noreferrer"
      >
        More info →
      </a>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState('home');
  const [parts, setParts] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeUserId, setActiveUserId] = useState('u_md');

  const activeUser = useMemo(() => {
    const u = users.find((x) => x.id === activeUserId);
    return u ? { ...u, label: userLabel(u) } : null;
  }, [users, activeUserId]);

  useEffect(() => {
    fetch('/api/parts')
      .then((r) => r.json())
      .then((d) => setParts(d.parts || []))
      .catch(() => setParts([]));
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []))
      .catch(() => setUsers([]));
  }, []);

  // Derive the active "part" from the selected user. Internal users have a
  // `part` directly; external team users / MD fall back to the first available
  // part so the rest of the app (which is part-scoped) keeps working.
  const activePart = useMemo(() => {
    const u = users.find((x) => x.id === activeUserId);
    if (u?.part && parts.includes(u.part)) return u.part;
    return parts[0] || '';
  }, [activeUserId, users, parts]);

  const isPrism = activePart === 'PRISM';

  const tabs = useMemo(
    () => TABS.map((t) => t.id === 'feed' ? { ...t, label: feedTabLabel(activePart) } : t),
    [activePart]
  );

  return (
    <div className="app-shell">
      <nav className="tabs">
        <div className="tabs-inner">
          <div className="brand-row">
            <div className="brand">Kernel</div>
            <div className="nav-right">
              {isPrism && <PrismStatsBar />}
              <div className="part-switcher">
                <span className="part-switcher-label">Viewing as</span>
                <select
                  value={activeUserId}
                  onChange={(e) => setActiveUserId(e.target.value)}
                  className="part-select"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {userLabel(u)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="tab-buttons">
            {tabs.map((t) => (
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
        {active === 'home'    && <HomeTab users={users} activeUserId={activeUserId} onNavigate={setActive} />}
        {active === 'feed'    && <FeedTab activePart={activePart} />}
        {active === 'files'   && <RetrievalTab parts={parts} activePart={activePart} users={users} activeUserId={activeUserId} />}
        {active === 'chat'    && <ChatTab activePart={activePart} activeUserId={activeUserId} activeUser={activeUser} />}
        {active === 'actions' && <ActionItemsTab users={users} activeUserId={activeUserId} />}
        {active === 'minutes' && <MinutesTab />}
        {active === 'reports' && <ReportGeneratorTab activePart={activePart} />}
        {active === 'quizzes' && <AIQuizzesTab activePart={activePart} />}
        {active === 'taskforce' && <TaskForceTab users={users} activeUserId={activeUserId} />}
      </main>
    </div>
  );
}
