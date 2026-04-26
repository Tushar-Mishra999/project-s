import { useEffect, useState } from 'react';
import FeedTab from './tabs/FeedTab.jsx';
import RetrievalTab from './tabs/RetrievalTab.jsx';
import ChatTab from './tabs/ChatTab.jsx';

const TABS = [
  { id: 'feed', label: 'Tech Sensing Feed' },
  { id: 'files', label: 'Smart File Retrieval' },
  { id: 'chat', label: 'Insights Chatbot' },
];

export default function App() {
  const [active, setActive] = useState('feed');
  const [parts, setParts] = useState([]);

  useEffect(() => {
    fetch('/api/parts')
      .then((r) => r.json())
      .then((d) => setParts(d.parts || []))
      .catch(() => setParts([]));
  }, []);

  return (
    <div className="app-shell">
      <nav className="tabs">
        <div className="tabs-inner">
          <div className="brand">Knowledge Hub</div>
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
        {active === 'feed' && <FeedTab />}
        {active === 'files' && <RetrievalTab parts={parts} />}
        {active === 'chat' && <ChatTab parts={parts} />}
      </main>
    </div>
  );
}
