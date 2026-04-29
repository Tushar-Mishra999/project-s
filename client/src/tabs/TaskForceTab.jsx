import { useMemo, useState } from 'react';

const PARTS = ['Tech Management', 'PRISM', 'PMO', 'Data Management'];
const TEAMS = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5'];

const USERS = [
  { id: 'u_md',     name: 'Priya Rao',      role: 'MD' },
  { id: 'u_tm',     name: 'Arjun Sethi',    role: 'TechMgmt' },
  { id: 'u_poc1',   name: 'Maya Iyer',      role: 'POC' },
  { id: 'u_poc2',   name: 'Karan Doshi',    role: 'POC' },
  { id: 'u_poc3',   name: 'Lena Park',      role: 'POC' },
  { id: 'u_mem1',   name: 'Sam Patel',      role: 'Member' },
  { id: 'u_mem2',   name: 'Nadia Verma',    role: 'Member' },
  { id: 'u_mem3',   name: 'Diego Alvarez',  role: 'Member' },
  { id: 'u_mem4',   name: 'Ifeoma Okeke',   role: 'Member' },
];

function userName(id) {
  return USERS.find((u) => u.id === id)?.name || id;
}

const INITIAL_TFS = [
  {
    id: 'tf_edge',
    name: 'Edge AI Acceleration',
    status: 'Active',
    parts: ['Tech Management', 'PRISM'],
    teams: ['Team 1', 'Team 3'],
    owners: ['u_poc1', 'u_poc2'],
    members: ['u_mem1', 'u_mem2', 'u_mem3'],
    updates: [
      { id: 'up1', date: '2026-04-22', type: 'Milestone', author: 'u_poc1',
        content: 'Completed benchmarking of 4 candidate inference runtimes; ONNX Runtime + TensorRT lead on latency.' },
      { id: 'up2', date: '2026-04-15', type: 'Risk', author: 'u_poc2',
        content: 'Hardware delivery slipped by 2 weeks — escalated to procurement.' },
      { id: 'up3', date: '2026-04-08', type: 'Status', author: 'u_poc1',
        content: 'Kickoff complete. Scope locked at Tier-1 use cases for Q2.' },
    ],
    actionItems: [
      { id: 'a1', text: 'Draft architecture brief for review', assignee: 'u_mem1', due: '2026-05-05', done: false },
      { id: 'a2', text: 'Run latency benchmark on Jetson AGX', assignee: 'u_mem2', due: '2026-05-02', done: false },
      { id: 'a3', text: 'Procure dev kits (x4)', assignee: 'u_poc2', due: '2026-04-30', done: true },
      { id: 'a4', text: 'Compile vendor shortlist', assignee: 'u_mem3', due: '2026-05-10', done: false },
    ],
  },
  {
    id: 'tf_data',
    name: 'Synthetic Data Pipeline',
    status: 'On Hold',
    parts: ['Data Management', 'PMO'],
    teams: ['Team 2', 'Team 4'],
    owners: ['u_poc3'],
    members: ['u_mem2', 'u_mem4'],
    updates: [
      { id: 'up1', date: '2026-04-18', type: 'Status', author: 'u_poc3',
        content: 'Paused pending legal review of generation framework licensing.' },
      { id: 'up2', date: '2026-03-30', type: 'Decision', author: 'u_poc3',
        content: 'Selected Gretel + in-house augmentation as the dual-track approach.' },
    ],
    actionItems: [
      { id: 'a1', text: 'Send licensing questions to legal', assignee: 'u_poc3', due: '2026-04-25', done: true },
      { id: 'a2', text: 'Document privacy budget assumptions', assignee: 'u_mem4', due: '2026-05-12', done: false },
    ],
  },
  {
    id: 'tf_ops',
    name: 'Ops Telemetry Consolidation',
    status: 'Closed',
    parts: ['PMO', 'Tech Management', 'Data Management'],
    teams: ['Team 5'],
    owners: ['u_poc2'],
    members: ['u_mem1', 'u_mem4'],
    updates: [
      { id: 'up1', date: '2026-03-12', type: 'Milestone', author: 'u_poc2',
        content: 'Final dashboards rolled out to all parts. TF closed.' },
      { id: 'up2', date: '2026-02-28', type: 'Status', author: 'u_poc2',
        content: 'Migration of legacy metrics complete; deprecation notices sent.' },
    ],
    actionItems: [
      { id: 'a1', text: 'Archive legacy collectors', assignee: 'u_mem1', due: '2026-03-10', done: true },
      { id: 'a2', text: 'Publish runbook for new pipeline', assignee: 'u_mem4', due: '2026-03-08', done: true },
    ],
  },
];

function StatusBadge({ status }) {
  const cls = status === 'Active' ? 'green' : status === 'On Hold' ? 'amber' : 'grey';
  return <span className={`tf-status tf-status-${cls}`}>{status}</span>;
}

function lastUpdateOf(tf) {
  return [...tf.updates].sort((a, b) => b.date.localeCompare(a.date))[0];
}
function openCountOf(tf) {
  return tf.actionItems.filter((a) => !a.done).length;
}

export default function TaskForceTab() {
  const [taskForces, setTaskForces] = useState(INITIAL_TFS);
  const [activeUserId, setActiveUserId] = useState('u_md');
  const [selectedTfId, setSelectedTfId] = useState(null);

  const activeUser = USERS.find((u) => u.id === activeUserId);
  const role = activeUser.role;
  const isMD = role === 'MD' || role === 'TechMgmt';
  const isPOC = role === 'POC';
  const isMember = role === 'Member';

  const visibleTfs = useMemo(() => {
    if (isMD) return taskForces;
    if (isPOC) return taskForces.filter((tf) => tf.owners.includes(activeUserId));
    return taskForces.filter(
      (tf) => tf.members.includes(activeUserId) || tf.owners.includes(activeUserId)
    );
  }, [taskForces, activeUserId, isMD, isPOC]);

  const selectedTf = taskForces.find((t) => t.id === selectedTfId) || null;
  const canEditSelected = selectedTf && selectedTf.owners.includes(activeUserId);

  function updateTf(id, mutator) {
    setTaskForces((prev) => prev.map((tf) => (tf.id === id ? mutator(tf) : tf)));
  }

  function exportExcel() {
    if (!window.XLSX) {
      alert('Excel export library is still loading. Please try again in a moment.');
      return;
    }
    const XLSX = window.XLSX;

    const overviewRows = taskForces.map((tf) => {
      const last = lastUpdateOf(tf);
      return {
        'TF Name': tf.name,
        Status: tf.status,
        Parts: tf.parts.join(', '),
        Teams: tf.teams.join(', '),
        Owners: tf.owners.map(userName).join(', '),
        'Last Update Date': last?.date || '',
        'Last Update': last?.content || '',
        'Open Action Items': openCountOf(tf),
      };
    });

    const actionRows = taskForces.flatMap((tf) =>
      tf.actionItems.map((a) => ({
        'TF Name': tf.name,
        'Action Item': a.text,
        Assignee: userName(a.assignee),
        Due: a.due,
        Status: a.done ? 'Done' : 'Open',
      }))
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), 'Task Forces');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(actionRows), 'Action Items');
    XLSX.writeFile(wb, 'task-forces.xlsx');
  }

  return (
    <div className="wrap tf-wrap">
      <div className="header">
        <div>
          <h1>Task Force</h1>
          <div className="sub">
            Track active task forces, log updates, and assign action items across parts and teams.
          </div>
        </div>
        <div className="tf-role-switcher">
          <span className="part-switcher-label">Simulating</span>
          <select
            className="part-select"
            value={activeUserId}
            onChange={(e) => { setActiveUserId(e.target.value); setSelectedTfId(null); }}
          >
            {USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.role}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedTf && isMD && (
        <OverviewView
          taskForces={taskForces}
          onSelect={setSelectedTfId}
          onExport={exportExcel}
        />
      )}

      {!selectedTf && isPOC && (
        <PocListView taskForces={visibleTfs} onSelect={setSelectedTfId} />
      )}

      {!selectedTf && isMember && (
        <MemberView
          taskForces={visibleTfs}
          activeUserId={activeUserId}
          onSelect={setSelectedTfId}
        />
      )}

      {selectedTf && (
        <DetailView
          tf={selectedTf}
          activeUserId={activeUserId}
          canEdit={canEditSelected}
          isMember={isMember}
          onBack={() => setSelectedTfId(null)}
          onMutate={(m) => updateTf(selectedTf.id, m)}
        />
      )}
    </div>
  );
}

function OverviewView({ taskForces, onSelect, onExport }) {
  return (
    <>
      <div className="tf-toolbar">
        <div className="tf-toolbar-info">
          {taskForces.length} task forces ·{' '}
          {taskForces.filter((t) => t.status === 'Active').length} active
        </div>
        <button className="primary-btn" onClick={onExport}>Download Excel</button>
      </div>
      <div className="tf-table-scroll">
        <table className="tf-table">
          <thead>
            <tr>
              <th>TF Name</th>
              <th>Status</th>
              <th>Parts &amp; Teams</th>
              <th>Owners</th>
              <th>Last Update</th>
              <th>Open Action Items</th>
            </tr>
          </thead>
          <tbody>
            {taskForces.map((tf) => {
              const last = lastUpdateOf(tf);
              return (
                <tr key={tf.id} onClick={() => onSelect(tf.id)} className="tf-row">
                  <td className="tf-cell-name">{tf.name}</td>
                  <td><StatusBadge status={tf.status} /></td>
                  <td>
                    <div className="tf-chip-row">
                      {tf.parts.map((p) => <span key={p} className="tf-chip part">{p}</span>)}
                      {tf.teams.map((t) => <span key={t} className="tf-chip team">{t}</span>)}
                    </div>
                  </td>
                  <td>{tf.owners.map(userName).join(', ')}</td>
                  <td className="tf-cell-update">
                    {last ? (
                      <>
                        <div className="tf-update-date">{last.date}</div>
                        <div className="tf-update-snippet">{last.content}</div>
                      </>
                    ) : <span className="tf-muted">—</span>}
                  </td>
                  <td>
                    <span className={`tf-open-count ${openCountOf(tf) > 0 ? 'has-open' : ''}`}>
                      {openCountOf(tf)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PocListView({ taskForces, onSelect }) {
  if (taskForces.length === 0) {
    return <div className="placeholder-panel"><p>You don't own any task forces yet.</p></div>;
  }
  return (
    <div className="tf-card-grid">
      {taskForces.map((tf) => {
        const last = lastUpdateOf(tf);
        return (
          <button key={tf.id} className="tf-card" onClick={() => onSelect(tf.id)}>
            <div className="tf-card-top">
              <div className="tf-card-title">{tf.name}</div>
              <StatusBadge status={tf.status} />
            </div>
            <div className="tf-chip-row">
              {tf.parts.map((p) => <span key={p} className="tf-chip part">{p}</span>)}
              {tf.teams.map((t) => <span key={t} className="tf-chip team">{t}</span>)}
            </div>
            <div className="tf-card-meta">
              <span><strong>{openCountOf(tf)}</strong> open action items</span>
              {last && <span>· last update {last.date}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MemberView({ taskForces, activeUserId, onSelect }) {
  if (taskForces.length === 0) {
    return <div className="placeholder-panel"><p>You're not part of any task force yet.</p></div>;
  }
  return (
    <>
      <h3 className="tf-section-title">My Task Forces</h3>
      <div className="tf-card-grid">
        {taskForces.map((tf) => {
          const last = lastUpdateOf(tf);
          const myOpen = tf.actionItems.filter(
            (a) => a.assignee === activeUserId && !a.done
          ).length;
          return (
            <button key={tf.id} className="tf-card" onClick={() => onSelect(tf.id)}>
              <div className="tf-card-top">
                <div className="tf-card-title">{tf.name}</div>
                <StatusBadge status={tf.status} />
              </div>
              {last && (
                <div className="tf-card-update">
                  <div className="tf-card-update-meta">
                    {last.date} · {last.type}
                  </div>
                  <div className="tf-card-update-text">{last.content}</div>
                </div>
              )}
              <div className="tf-card-meta">
                <span className={myOpen > 0 ? 'tf-mine-open' : ''}>
                  <strong>{myOpen}</strong> assigned to me
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function DetailView({ tf, activeUserId, canEdit, isMember, onBack, onMutate }) {
  const [newUpdate, setNewUpdate] = useState({ type: 'Status', content: '' });
  const [newAction, setNewAction] = useState({ text: '', assignee: tf.members[0] || tf.owners[0], due: '' });

  function logUpdate() {
    if (!newUpdate.content.trim()) return;
    const u = {
      id: `up_${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      type: newUpdate.type,
      author: activeUserId,
      content: newUpdate.content.trim(),
    };
    onMutate((cur) => ({ ...cur, updates: [u, ...cur.updates] }));
    setNewUpdate({ type: 'Status', content: '' });
  }

  function addAction() {
    if (!newAction.text.trim()) return;
    const a = {
      id: `a_${Date.now()}`,
      text: newAction.text.trim(),
      assignee: newAction.assignee,
      due: newAction.due || '',
      done: false,
    };
    onMutate((cur) => ({ ...cur, actionItems: [...cur.actionItems, a] }));
    setNewAction({ text: '', assignee: tf.members[0] || tf.owners[0], due: '' });
  }

  function toggleDone(actionId) {
    onMutate((cur) => ({
      ...cur,
      actionItems: cur.actionItems.map((a) =>
        a.id === actionId ? { ...a, done: !a.done } : a
      ),
    }));
  }

  const updates = [...tf.updates].sort((a, b) => b.date.localeCompare(a.date));
  const visibleActions = isMember
    ? tf.actionItems.filter((a) => a.assignee === activeUserId)
    : tf.actionItems;

  const memberPool = Array.from(new Set([...tf.owners, ...tf.members]));

  return (
    <>
      <button className="ghost-btn small" onClick={onBack}>← Back</button>

      <div className="tf-detail-header">
        <div>
          <div className="tf-detail-title-row">
            <h2 className="tf-detail-title">{tf.name}</h2>
            <StatusBadge status={tf.status} />
          </div>
          <div className="tf-chip-row" style={{ marginTop: 10 }}>
            {tf.parts.map((p) => <span key={p} className="tf-chip part">{p}</span>)}
            {tf.teams.map((t) => <span key={t} className="tf-chip team">{t}</span>)}
          </div>
          <div className="tf-detail-owners">
            <span className="tf-muted">Owners: </span>
            {tf.owners.map(userName).join(', ')}
          </div>
        </div>
      </div>

      <div className="tf-detail-grid">
        <section className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">Updates</h3>
            <span className="tf-muted" style={{ fontSize: 12 }}>{updates.length} total</span>
          </div>

          {canEdit && (
            <div className="tf-update-form">
              <div className="form-row" style={{ flexDirection: 'row', gap: 10 }}>
                <select
                  value={newUpdate.type}
                  onChange={(e) => setNewUpdate({ ...newUpdate, type: e.target.value })}
                >
                  <option>Status</option>
                  <option>Milestone</option>
                  <option>Risk</option>
                  <option>Decision</option>
                </select>
                <input
                  type="text"
                  placeholder="Log a new update…"
                  value={newUpdate.content}
                  onChange={(e) => setNewUpdate({ ...newUpdate, content: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button className="primary-btn" onClick={logUpdate}>Log</button>
              </div>
            </div>
          )}

          <div className="tf-updates-feed">
            {updates.map((u) => (
              <div key={u.id} className="tf-update-card">
                <div className="tf-update-card-meta">
                  <span className={`tf-update-type tf-update-type-${u.type.toLowerCase()}`}>
                    {u.type}
                  </span>
                  <span className="tf-muted">{u.date}</span>
                  <span className="tf-muted">· {userName(u.author)}</span>
                </div>
                <div className="tf-update-card-body">{u.content}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">Action Items</h3>
            <span className="tf-muted" style={{ fontSize: 12 }}>
              {visibleActions.filter((a) => !a.done).length} open
            </span>
          </div>

          {canEdit && (
            <div className="tf-action-form">
              <input
                type="text"
                placeholder="New action item…"
                value={newAction.text}
                onChange={(e) => setNewAction({ ...newAction, text: e.target.value })}
              />
              <select
                value={newAction.assignee}
                onChange={(e) => setNewAction({ ...newAction, assignee: e.target.value })}
              >
                {memberPool.map((id) => (
                  <option key={id} value={id}>{userName(id)}</option>
                ))}
              </select>
              <input
                type="date"
                value={newAction.due}
                onChange={(e) => setNewAction({ ...newAction, due: e.target.value })}
              />
              <button className="primary-btn" onClick={addAction}>Add</button>
            </div>
          )}

          <div className="tf-table-scroll">
            <table className="tf-table tf-action-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Item</th>
                  <th>Assignee</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {visibleActions.map((a) => {
                  const mine = a.assignee === activeUserId;
                  const canToggle = canEdit || mine;
                  return (
                    <tr
                      key={a.id}
                      className={`${a.done ? 'tf-action-done' : ''} ${mine ? 'tf-action-mine' : ''}`}
                    >
                      <td>
                        <button
                          className={`action-checkbox ${a.done ? 'checked' : ''}`}
                          disabled={!canToggle}
                          onClick={() => toggleDone(a.id)}
                          aria-label="toggle done"
                        >
                          {a.done && (
                            <svg width="11" height="11" viewBox="0 0 12 12">
                              <path fill="none" stroke="white" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
                                d="M2 6.5l2.5 2.5L10 3.5"/>
                            </svg>
                          )}
                        </button>
                      </td>
                      <td>{a.text}</td>
                      <td>{userName(a.assignee)}</td>
                      <td>{a.due || <span className="tf-muted">—</span>}</td>
                    </tr>
                  );
                })}
                {visibleActions.length === 0 && (
                  <tr><td colSpan={4} className="tf-muted" style={{ textAlign: 'center', padding: 20 }}>
                    No action items {isMember ? 'assigned to you' : 'yet'}.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
