import { useEffect, useMemo, useState, useCallback } from 'react';

const PARTS = ['Tech Management', 'PRISM', 'Data Management', 'PMO'];
const TEAMS = ['Team 1', 'Team 2', 'Team 3'];

export function userLabel(user) {
  if (!user) return '';
  if (user.role === 'MD') return 'MD';
  if (user.role === 'PartHead') return `${user.part} Head`;
  if (user.role === 'TeamHead') return `${user.team} Head`;
  if (user.part) return user.part;
  if (user.team) return user.team;
  return user.role;
}

function nameById(users, id) {
  return users.find((u) => u.id === id)?.name || id;
}

function StatusBadge({ status }) {
  const cls = status === 'Active' ? 'green' : status === 'On Hold' ? 'amber' : 'grey';
  return <span className={`tf-status tf-status-${cls}`}>{status}</span>;
}

function lastUpdateOf(tf) {
  if (!tf.updates?.length) return null;
  return [...tf.updates].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  )[0];
}
function openCountOf(tf) {
  return (tf.actionItems || []).filter((a) => !a.done).length;
}
function shortDate(s) {
  if (!s) return '';
  return String(s).slice(0, 10);
}

export default function TaskForceTab({ users = [], activeUserId }) {
  const [taskForces, setTaskForces] = useState([]);
  const [selectedTfId, setSelectedTfId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const activeUser = users.find((u) => u.id === activeUserId);
  const role = activeUser?.role;
  const canSeeAll = role === 'MD' || (role === 'PartHead' && activeUser?.part === 'Tech Management');
  const canCreate = role === 'MD' || role === 'PartHead' || role === 'TeamHead';

  const loadTFs = useCallback(async () => {
    if (!activeUserId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/task-forces?user_id=${encodeURIComponent(activeUserId)}`);
      const d = await r.json();
      setTaskForces(d.task_forces || []);
    } catch {
      setTaskForces([]);
    } finally {
      setLoading(false);
    }
  }, [activeUserId]);

  useEffect(() => { loadTFs(); }, [loadTFs]);
  useEffect(() => { setSelectedTfId(null); }, [activeUserId]);

  const selectedTf = taskForces.find((t) => t.id === selectedTfId) || null;
  const canEditSelected = !!selectedTf && (
    role === 'MD' ||
    ((role === 'PartHead' || role === 'TeamHead') && selectedTf.owners?.includes(activeUserId))
  );

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
        Parts: (tf.parts || []).join(', '),
        Teams: (tf.teams || []).join(', '),
        Owners: (tf.owners || []).map((id) => nameById(users, id)).join(', '),
        'Last Update Date': last ? shortDate(last.created_at) : '',
        'Last Update': last?.content || '',
        'Open Action Items': openCountOf(tf),
      };
    });
    const actionRows = taskForces.flatMap((tf) =>
      (tf.actionItems || []).map((a) => ({
        'TF Name': tf.name,
        'Action Item': a.text,
        Assignee: nameById(users, a.assignee),
        Due: a.due || '',
        Status: a.done ? 'Done' : 'Open',
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), 'Task Forces');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(actionRows), 'Action Items');
    XLSX.writeFile(wb, 'task-forces.xlsx');
  }

  async function handleDelete(tfId) {
    if (!confirm('Delete this Task Force? This will remove all updates and action items.')) return;
    const r = await fetch(`/api/task-forces/${tfId}?user_id=${encodeURIComponent(activeUserId)}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || 'Delete failed');
      return;
    }
    setSelectedTfId(null);
    loadTFs();
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
      </div>

      {!selectedTf && (
        <div className="tf-toolbar">
          <div className="tf-toolbar-info">
            {loading ? 'Loading…' : `${taskForces.length} task force${taskForces.length === 1 ? '' : 's'} visible · ${taskForces.filter((t) => t.status === 'Active').length} active`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canCreate && (
              <button className="primary-btn" onClick={() => setShowCreate(true)}>+ New Task Force</button>
            )}
            {canSeeAll && (
              <button className="ghost-btn" onClick={exportExcel}>Download Excel</button>
            )}
          </div>
        </div>
      )}

      {!selectedTf && !loading && taskForces.length === 0 && (
        <div className="placeholder-panel">
          <p>{canSeeAll ? 'No task forces yet — create one to get started.' : 'No task forces visible to you yet.'}</p>
        </div>
      )}

      {!selectedTf && taskForces.length > 0 && (
        canSeeAll
          ? <OverviewView taskForces={taskForces} users={users} onSelect={setSelectedTfId} />
          : <CardListView taskForces={taskForces} users={users} activeUserId={activeUserId} onSelect={setSelectedTfId} />
      )}

      {selectedTf && (
        <DetailView
          tf={selectedTf}
          users={users}
          activeUser={activeUser}
          canEdit={canEditSelected}
          onBack={() => setSelectedTfId(null)}
          onChanged={loadTFs}
          onDelete={() => handleDelete(selectedTf.id)}
        />
      )}

      {showCreate && (
        <CreateTfModal
          users={users}
          activeUserId={activeUserId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadTFs(); }}
        />
      )}
    </div>
  );
}

function OverviewView({ taskForces, users, onSelect }) {
  return (
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
                    {(tf.parts || []).map((p) => <span key={p} className="tf-chip part">{p}</span>)}
                    {(tf.teams || []).map((t) => <span key={t} className="tf-chip team">{t}</span>)}
                  </div>
                </td>
                <td>{(tf.owners || []).map((id) => nameById(users, id)).join(', ')}</td>
                <td className="tf-cell-update">
                  {last ? (
                    <>
                      <div className="tf-update-date">{shortDate(last.created_at)}</div>
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
  );
}

function CardListView({ taskForces, users, activeUserId, onSelect }) {
  return (
    <div className="tf-card-grid">
      {taskForces.map((tf) => {
        const last = lastUpdateOf(tf);
        const myOpen = (tf.actionItems || []).filter(
          (a) => a.assignee === activeUserId && !a.done
        ).length;
        return (
          <button key={tf.id} className="tf-card" onClick={() => onSelect(tf.id)}>
            <div className="tf-card-top">
              <div className="tf-card-title">{tf.name}</div>
              <StatusBadge status={tf.status} />
            </div>
            <div className="tf-chip-row">
              {(tf.parts || []).map((p) => <span key={p} className="tf-chip part">{p}</span>)}
              {(tf.teams || []).map((t) => <span key={t} className="tf-chip team">{t}</span>)}
            </div>
            <div className="tf-card-meta">
              <span><strong>{openCountOf(tf)}</strong> open action items</span>
              {myOpen > 0 && <span className="tf-mine-open"> · <strong>{myOpen}</strong> mine</span>}
              {last && <span> · last update {shortDate(last.created_at)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DetailView({ tf, users, activeUser, canEdit, onBack, onChanged, onDelete }) {
  const [newUpdate, setNewUpdate] = useState({ type: 'Status', content: '' });
  const memberPool = Array.from(new Set([...(tf.owners || []), ...(tf.members || [])]));
  const [newAction, setNewAction] = useState({ text: '', assignee: memberPool[0] || '', due: '' });
  const [busy, setBusy] = useState(false);
  const [completeTarget, setCompleteTarget] = useState(null); // action item being completed
  const [completeComment, setCompleteComment] = useState('');

  const isMD = activeUser?.role === 'MD';
  const isMember = activeUser?.role === 'Member';
  const canDelete = isMD || (canEdit);

  async function logUpdate() {
    if (!newUpdate.content.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/task-forces/${tf.id}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUser.id, type: newUpdate.type, content: newUpdate.content.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Failed to log update');
        return;
      }
      setNewUpdate({ type: 'Status', content: '' });
      onChanged();
    } finally { setBusy(false); }
  }

  async function addAction() {
    if (!newAction.text.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/task-forces/${tf.id}/action-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: activeUser.id,
          text: newAction.text.trim(),
          assignee: newAction.assignee || null,
          due: newAction.due || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Failed to add action item');
        return;
      }
      setNewAction({ text: '', assignee: memberPool[0] || '', due: '' });
      onChanged();
    } finally { setBusy(false); }
  }

  async function patchAction(actionId, body) {
    setBusy(true);
    try {
      const r = await fetch(`/api/task-forces/${tf.id}/action-items/${actionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUser.id, ...body }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Failed to update action item');
        return false;
      }
      onChanged();
      return true;
    } finally { setBusy(false); }
  }

  function onCheckbox(item) {
    if (item.done) {
      // un-complete: no comment needed
      patchAction(item.id, { done: false });
    } else {
      setCompleteTarget(item);
      setCompleteComment('');
    }
  }

  async function confirmComplete() {
    const ok = await patchAction(completeTarget.id, { done: true, comment: completeComment });
    if (ok) {
      setCompleteTarget(null);
      setCompleteComment('');
    }
  }

  const updates = [...(tf.updates || [])].sort(
    (a, b) => (b.created_at || '').localeCompare(a.created_at || '')
  );
  const visibleActions = isMember
    ? (tf.actionItems || []).filter((a) => a.assignee === activeUser.id)
    : (tf.actionItems || []);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="ghost-btn small" onClick={onBack}>← Back</button>
        {canDelete && (
          <button className="ghost-btn small" onClick={onDelete} style={{ color: '#c0392b' }}>
            Delete TF
          </button>
        )}
      </div>

      <div className="tf-detail-header">
        <div>
          <div className="tf-detail-title-row">
            <h2 className="tf-detail-title">{tf.name}</h2>
            <StatusBadge status={tf.status} />
          </div>
          <div className="tf-chip-row" style={{ marginTop: 10 }}>
            {(tf.parts || []).map((p) => <span key={p} className="tf-chip part">{p}</span>)}
            {(tf.teams || []).map((t) => <span key={t} className="tf-chip team">{t}</span>)}
          </div>
          <div className="tf-detail-owners">
            <span className="tf-muted">Owners: </span>
            {(tf.owners || []).map((id) => nameById(users, id)).join(', ') || <span className="tf-muted">—</span>}
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
                <button className="primary-btn" onClick={logUpdate} disabled={busy}>Log</button>
              </div>
            </div>
          )}

          <div className="tf-updates-feed">
            {updates.map((u) => (
              <div key={u.id} className="tf-update-card">
                <div className="tf-update-card-meta">
                  <span className={`tf-update-type tf-update-type-${(u.type || '').toLowerCase().replace('_','-')}`}>
                    {u.type === 'ACTION_ITEM' ? 'Action Item' : u.type}
                  </span>
                  <span className="tf-muted">{shortDate(u.created_at)}</span>
                  <span className="tf-muted">· {nameById(users, u.author)}</span>
                </div>
                <div className="tf-update-card-body">{u.content}</div>
              </div>
            ))}
            {updates.length === 0 && (
              <div className="tf-muted" style={{ padding: 12 }}>No updates yet.</div>
            )}
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
                <option value="">— Assignee —</option>
                {memberPool.map((id) => (
                  <option key={id} value={id}>{nameById(users, id)}</option>
                ))}
              </select>
              <input
                type="date"
                value={newAction.due}
                onChange={(e) => setNewAction({ ...newAction, due: e.target.value })}
              />
              <button className="primary-btn" onClick={addAction} disabled={busy}>Add</button>
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
                  const mine = a.assignee === activeUser.id;
                  const canToggle = isMD || canEdit || mine;
                  return (
                    <tr
                      key={a.id}
                      className={`${a.done ? 'tf-action-done' : ''} ${mine ? 'tf-action-mine' : ''}`}
                    >
                      <td>
                        <button
                          className={`action-checkbox ${a.done ? 'checked' : ''}`}
                          disabled={!canToggle || busy}
                          onClick={() => onCheckbox(a)}
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
                      <td>{nameById(users, a.assignee)}</td>
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

      {completeTarget && (
        <div className="modal-backdrop" onClick={() => setCompleteTarget(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Complete action item</h2>
              <button className="modal-close" onClick={() => setCompleteTarget(null)}>×</button>
            </div>
            <div className="form-row">
              <label>Item</label>
              <input type="text" value={completeTarget.text} disabled />
            </div>
            <div className="form-row">
              <label>Comment (will be logged in the TF feed)</label>
              <textarea
                rows={4}
                value={completeComment}
                onChange={(e) => setCompleteComment(e.target.value)}
                placeholder="What was done, links, results, anything worth noting…"
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="ghost-btn" onClick={() => setCompleteTarget(null)}>Cancel</button>
              <button className="primary-btn" onClick={confirmComplete} disabled={busy}>
                Mark complete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CreateTfModal({ users, activeUserId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('Active');
  const [parts, setParts] = useState([]);
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);

  function toggle(arr, val, set) {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  }

  // Suggest auto co-owners (heads of selected parts/teams) for transparency.
  const autoOwners = useMemo(() => {
    const ids = new Set();
    for (const p of parts) {
      const head = users.find((u) => u.role === 'PartHead' && u.part === p);
      if (head) ids.add(head.id);
    }
    for (const t of teams) {
      const head = users.find((u) => u.role === 'TeamHead' && u.team === t);
      if (head) ids.add(head.id);
    }
    ids.add(activeUserId);
    return Array.from(ids);
  }, [parts, teams, users, activeUserId]);

  // Eligible members: anyone in the selected parts/teams who is a Member.
  const eligibleMembers = useMemo(() => {
    return users.filter((u) =>
      u.role === 'Member' && (
        (u.part && parts.includes(u.part)) ||
        (u.team && teams.includes(u.team))
      )
    );
  }, [users, parts, teams]);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/task-forces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: activeUserId,
          name: name.trim(),
          status,
          parts, teams, members,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || 'Failed to create');
        return;
      }
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">New Task Force</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="upload-form" onSubmit={submit}>
          <div className="form-row">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>Active</option>
              <option>On Hold</option>
              <option>Closed</option>
            </select>
          </div>
          <div className="form-row">
            <label>Parts involved</label>
            <div className="tf-chip-row">
              {PARTS.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`tf-chip part ${parts.includes(p) ? '' : 'tf-chip-off'}`}
                  onClick={() => toggle(parts, p, setParts)}
                  style={{ opacity: parts.includes(p) ? 1 : 0.45, cursor: 'pointer', border: 'none' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>External teams involved</label>
            <div className="tf-chip-row">
              {TEAMS.map((t) => (
                <button
                  type="button"
                  key={t}
                  className={`tf-chip team ${teams.includes(t) ? '' : 'tf-chip-off'}`}
                  onClick={() => toggle(teams, t, setTeams)}
                  style={{ opacity: teams.includes(t) ? 1 : 0.45, cursor: 'pointer', border: 'none' }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>Members</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {eligibleMembers.length === 0 && (
                <span className="tf-muted" style={{ fontSize: 13 }}>
                  Select parts/teams above to choose members.
                </span>
              )}
              {eligibleMembers.map((u) => (
                <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={members.includes(u.id)}
                    onChange={() => toggle(members, u.id, setMembers)}
                  />
                  {u.name} <span className="tf-muted">· {u.part || u.team}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-row">
            <label>Owners (auto)</label>
            <div className="tf-muted" style={{ fontSize: 13 }}>
              {autoOwners.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(', ') || '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? 'Creating…' : 'Create Task Force'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
