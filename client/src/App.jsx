import { useEffect, useMemo, useState } from 'react';
import FeedTab, { feedTabLabel } from './tabs/FeedTab.jsx';
import RetrievalTab from './tabs/RetrievalTab.jsx';
import LibraryTab from './tabs/LibraryTab.jsx';
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
  { id: 'library',  label: 'Library' },
  { id: 'chat',     label: 'Insights Chat' },
  { id: 'actions',  label: 'Action Items' },
  { id: 'taskforce',label: 'Task Force' },
  { id: 'minutes',  label: 'MoM' },
  { id: 'reports',  label: 'Report Generator' },
  { id: 'quizzes',  label: 'AI Quizzes' },
];

function dueBucket(due_date) {
  if (!due_date) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due_date); d.setHours(0,0,0,0);
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays < 0) return { kind: 'overdue', label: `Overdue by ${Math.abs(diffDays)}d`, color: '#dc2626' };
  if (diffDays === 0) return { kind: 'today', label: 'Due today', color: '#dc2626' };
  if (diffDays === 1) return { kind: 'tomorrow', label: 'Due tomorrow', color: '#d97706' };
  return null;
}

function NotificationBell({ activeUserId, onJump }) {
  const [notifs, setNotifs] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!activeUserId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/action-items?user_id=${encodeURIComponent(activeUserId)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const out = [];
        for (const card of (json.cards || [])) {
          for (const it of (card.items || [])) {
            if (it.completed) continue;
            const assignees = Array.isArray(it.assignees) ? it.assignees : [];
            if (!assignees.includes(activeUserId)) continue;
            const bucket = dueBucket(it.due_date);
            if (!bucket) continue;
            out.push({
              key: `${card.id}:${it.id}`,
              cardName: card.filename,
              text: it.text,
              bucket,
              due_date: it.due_date,
            });
          }
        }
        out.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
        setNotifs(out);
      } catch {}
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [activeUserId]);

  const count = notifs.length;
  const hasOverdue = notifs.some((n) => n.bucket.kind === 'overdue' || n.bucket.kind === 'today');

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={count ? `${count} action item${count === 1 ? '' : 's'} need attention` : 'No notifications'}
        style={{
          position: 'relative', background: 'transparent', border: '1px solid #e5e7eb',
          borderRadius: 8, padding: '6px 8px', cursor: 'pointer', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
        }}
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 999, background: hasOverdue ? '#dc2626' : '#d97706', color: 'white',
            fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{count}</span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 340, maxHeight: 420,
            overflowY: 'auto', background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.12)', zIndex: 51, padding: 8,
          }}>
            <div style={{ padding: '6px 10px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>
              Action item alerts
            </div>
            {count === 0 && (
              <div style={{ padding: 16, fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
                No items due within a day or past deadline.
              </div>
            )}
            {notifs.map((n) => (
              <button
                key={n.key}
                onClick={() => { setOpen(false); onJump?.(); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                  border: 'none', padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: 12, color: n.bucket.color, fontWeight: 700 }}>{n.bucket.label}</div>
                <div style={{ fontSize: 13, color: '#111827', marginTop: 2 }}>{n.text}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{n.cardName}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PrismStatsBar() {
  // Mock counts — replace with live data when worklet tracking lands.
  const stats = [
    { label: 'Total', value: 47 },
    { label: 'Ongoing', value: 12 },
    { label: 'Completed', value: 35 },
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
  const activeUserRole = activeUser?.role;

  const tabs = useMemo(
    () => TABS
      .filter((t) => {
        if (t.id === 'taskforce') {
          return activeUserRole === 'MD' || activePart === 'Tech Management';
        }
        return true;
      })
      .map((t) => t.id === 'feed' ? { ...t, label: feedTabLabel(activePart, activeUserRole) } : t),
    [activePart, activeUserRole]
  );

  return (
    <div className="app-shell">
      <nav className="tabs">
        <div className="tabs-inner">
          <div className="brand-row">
            <div className="brand">Kernel</div>
            <div className="nav-right">
              <NotificationBell activeUserId={activeUserId} onJump={() => setActive('actions')} />
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
        {active === 'home'    && <HomeTab users={users} activeUserId={activeUserId} activePart={activePart} activeUserRole={activeUserRole} onNavigate={setActive} />}
        {active === 'feed'    && <FeedTab activePart={activePart} activeUserRole={activeUserRole} />}
        {active === 'files'   && <RetrievalTab parts={parts} activePart={activePart} users={users} activeUserId={activeUserId} />}
        {active === 'library' && <LibraryTab users={users} activeUserId={activeUserId} />}
        {active === 'chat'    && <ChatTab activePart={activePart} activeUserId={activeUserId} activeUser={activeUser} />}
        {active === 'actions' && <ActionItemsTab users={users} activeUserId={activeUserId} />}
        {active === 'minutes' && <MinutesTab parts={parts} users={users} activeUserId={activeUserId} />}
        {active === 'reports' && <ReportGeneratorTab activePart={activePart} activeUserId={activeUserId} />}
        {active === 'quizzes' && <AIQuizzesTab activePart={activePart} activeUserId={activeUserId} users={users} />}
        {active === 'taskforce' && <TaskForceTab users={users} activeUserId={activeUserId} />}
      </main>
    </div>
  );
}
