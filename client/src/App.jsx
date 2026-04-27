import { useEffect, useState } from 'react';
import FeedTab from './tabs/FeedTab.jsx';
import RetrievalTab from './tabs/RetrievalTab.jsx';
import ChatTab from './tabs/ChatTab.jsx';
import ActionItemsTab from './tabs/ActionItemsTab.jsx';
import ReportGeneratorTab from './tabs/ReportGeneratorTab.jsx';
import AIQuizzesTab from './tabs/AIQuizzesTab.jsx';

const TABS = [
  { id: 'feed',     label: 'Tech Sensing' },
  { id: 'files',    label: 'Smart Retrieval' },
  { id: 'chat',     label: 'Insights Chat' },
  { id: 'actions',  label: 'Action Items' },
  { id: 'reports',  label: 'Report Generator' },
  { id: 'quizzes',  label: 'AI Quizzes' },
];

export default function App() {
  const [active, setActive] = useState('feed');
  const [parts, setParts] = useState([]);
  const [activePart, setActivePart] = useState('');

  useEffect(() => {
    fetch('/api/parts')
      .then((r) => r.json())
      .then((d) => {
        const list = d.parts || [];
        setParts(list);
        if (list.length) setActivePart((p) => p || list[0]);
      })
      .catch(() => setParts([]));
  }, []);

  return (
    <div className="app-shell">
      <nav className="tabs">
        <div className="tabs-inner">
          <div className="brand-row">
            <div className="brand">Knowledge Hub</div>
            <div className="part-switcher">
              <span className="part-switcher-label">Viewing as</span>
              <select
                value={activePart}
                onChange={(e) => setActivePart(e.target.value)}
                className="part-select"
                disabled={parts.length === 0}
              >
                {parts.length === 0 && <option>Loading…</option>}
                {parts.map((p) => <option key={p} value={p}>{p}</option>)}
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
      </main>
    </div>
  );
}
