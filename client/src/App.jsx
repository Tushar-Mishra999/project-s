import { useEffect, useMemo, useRef, useState } from 'react';
import FeedTab, { feedTabLabel } from './tabs/FeedTab.jsx';
import KnowledgeHubTab from './tabs/KnowledgeHubTab.jsx';
import ActionItemsTab from './tabs/ActionItemsTab.jsx';
import AIQuizzesTab from './tabs/AIQuizzesTab.jsx';
import TaskForceTab, { userLabel } from './tabs/TaskForceTab.jsx';
import HomeTab from './tabs/HomeTab.jsx';
import MinutesTab from './tabs/MinutesTab.jsx';
import ChatFAB from './components/ChatFAB.jsx';

const PRIMARY_TABS = [
  { id: 'home',     label: 'Home' },
  { id: 'hub',      label: 'Knowledge Hub' },
  { id: 'feed',     label: 'Tech Sensing' },
];

const TOOLS_TABS = [
  { id: 'actions',  label: 'Action Items' },
  { id: 'minutes',  label: 'MoM' },
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
            out.push({ key: `${card.id}:${it.id}`, cardName: card.filename, text: it.text, bucket, due_date: it.due_date });
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
          position: 'relative', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, padding: '7px 9px', cursor: 'pointer', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', color: '#e2e8f0',
          transition: 'background 0.2s, border-color 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px',
            borderRadius: 999, background: hasOverdue ? '#ef4444' : '#f59e0b', color: 'white',
            fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: hasOverdue ? '0 0 8px rgba(239,68,68,0.5)' : '0 0 8px rgba(245,158,11,0.4)',
            border: '2px solid #1e293b',
          }}>{count}</span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 360, maxHeight: 440,
            overflowY: 'auto', background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14,
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)', zIndex: 51, padding: 6,
          }}>
            <div style={{
              padding: '10px 14px', fontWeight: 600, fontSize: 13, color: '#e2e8f0',
              borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              Action item alerts
              {count > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', fontWeight: 400 }}>{count} pending</span>}
            </div>
            {count === 0 && <div style={{ padding: 24, fontSize: 13, color: '#64748b', textAlign: 'center' }}>No items due within a day or past deadline.</div>}
            {notifs.map((n) => {
              const isOverdue = n.bucket.kind === 'overdue' || n.bucket.kind === 'today';
              return (
                <button key={n.key} onClick={() => { setOpen(false); onJump?.(); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'inline-block', fontSize: 11, color: isOverdue ? '#f87171' : '#fbbf24', fontWeight: 600, background: isOverdue ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', padding: '2px 8px', borderRadius: 4 }}>{n.bucket.label}</div>
                  <div style={{ fontSize: 13, color: '#f1f5f9', marginTop: 5, lineHeight: 1.4 }}>{n.text}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{n.cardName}</div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ToolsDropdown({ tabs, active, setActive }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isToolActive = tabs.some((t) => t.id === active);

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={`tab-btn${isToolActive ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        Tools
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 12,
          overflow: 'hidden', zIndex: 50, minWidth: 180, boxShadow: '0 12px 40px rgba(0,0,0,.5)',
        }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setActive(t.id); setOpen(false); }}
              style={{
                display: 'block', width: '100%', padding: '10px 16px', border: 'none',
                background: active === t.id ? 'rgba(59,130,246,.12)' : 'transparent',
                color: active === t.id ? '#93c5fd' : 'var(--text)', cursor: 'pointer',
                textAlign: 'left', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                borderLeft: active === t.id ? '2px solid #3b82f6' : '2px solid transparent',
                transition: 'background .12s',
              }}
              onMouseEnter={(e) => { if (active !== t.id) e.currentTarget.style.background = 'rgba(255,255,255,.04)'; }}
              onMouseLeave={(e) => { if (active !== t.id) e.currentTarget.style.background = 'transparent'; }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
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
    fetch('/api/parts').then((r) => r.json()).then((d) => setParts(d.parts || [])).catch(() => setParts([]));
    fetch('/api/users').then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => setUsers([]));
  }, []);

  const activePart = useMemo(() => {
    const u = users.find((x) => x.id === activeUserId);
    if (u?.part && parts.includes(u.part)) return u.part;
    return parts[0] || '';
  }, [activeUserId, users, parts]);

  const activeUserRole = activeUser?.role;

  const showTaskForce = activeUserRole === 'MD' || activePart === 'Tech Management';

  const primaryTabs = useMemo(
    () => PRIMARY_TABS.map((t) => t.id === 'feed' ? { ...t, label: feedTabLabel() } : t),
    []
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
                <select value={activeUserId} onChange={(e) => setActiveUserId(e.target.value)} className="part-select">
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {userLabel(u)}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="tab-buttons">
            {primaryTabs.map((t) => (
              <button key={t.id} className={`tab-btn ${active === t.id ? 'active' : ''}`} onClick={() => setActive(t.id)}>
                {t.label}
              </button>
            ))}
            <ToolsDropdown tabs={TOOLS_TABS} active={active} setActive={setActive} />
            {showTaskForce && (
              <button className={`tab-btn ${active === 'taskforce' ? 'active' : ''}`} onClick={() => setActive('taskforce')}>
                Task Force
              </button>
            )}
          </div>
        </div>
      </nav>

      <main>
        {active === 'home'      && <HomeTab users={users} activeUserId={activeUserId} activePart={activePart} activeUserRole={activeUserRole} onNavigate={setActive} />}
        {active === 'hub'       && <KnowledgeHubTab parts={parts} activePart={activePart} users={users} activeUserId={activeUserId} />}
        {active === 'feed'      && <FeedTab />}
        {active === 'actions'   && <ActionItemsTab users={users} activeUserId={activeUserId} />}
        {active === 'minutes'   && <MinutesTab parts={parts} users={users} activeUserId={activeUserId} />}
        {active === 'quizzes'   && <AIQuizzesTab activePart={activePart} activeUserId={activeUserId} users={users} />}
        {active === 'taskforce' && <TaskForceTab users={users} activeUserId={activeUserId} />}
      </main>

      <ChatFAB activePart={activePart} activeUserId={activeUserId} activeUser={activeUser} />
    </div>
  );
}
