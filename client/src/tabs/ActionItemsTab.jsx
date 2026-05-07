import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function nameById(users, id) {
  return users.find((u) => u.id === id)?.name || id;
}

function dueStatus(due_date, completed) {
  if (!due_date || completed) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due_date); d.setHours(0,0,0,0);
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays < 0) return { kind: 'overdue', label: `Overdue by ${Math.abs(diffDays)}d`, color: '#dc2626' };
  if (diffDays === 0) return { kind: 'today', label: 'Due today', color: '#dc2626' };
  if (diffDays === 1) return { kind: 'tomorrow', label: 'Due tomorrow', color: '#d97706' };
  return { kind: 'future', label: `Due ${formatDate(due_date)}`, color: '#6b7280' };
}

function buildItemTree(flatItems) {
  const byId = {};
  for (const it of flatItems) byId[it.id] = { ...it, children: [] };
  const roots = [];
  for (const it of flatItems) {
    if (it.parent_item_id && byId[it.parent_item_id]) {
      byId[it.parent_item_id].children.push(byId[it.id]);
    } else {
      roots.push(byId[it.id]);
    }
  }
  return roots;
}

function ActionItemNode({
  item, depth, users, activeUserId, isAssigner, saving,
  editingId, editText, setEditText,
  onToggle, onStartEdit, onCommitEdit, onCancelEdit, onSetDueDate, onAddSub,
}) {
  const [showSubForm, setShowSubForm] = useState(false);
  const [subText, setSubText] = useState('');
  const [subAssignees, setSubAssignees] = useState([activeUserId].filter(Boolean));

  const editable = item.editable;

  const submitSub = () => {
    if (!subText.trim() || subAssignees.length === 0) return;
    onAddSub(item.id, subText.trim(), subAssignees);
    setShowSubForm(false);
    setSubText('');
    setSubAssignees([activeUserId].filter(Boolean));
  };

  const toggleSubAssignee = (userId) => {
    setSubAssignees((prev) =>
      prev.includes(userId) ? prev.filter((u) => u !== userId) : [...prev, userId]
    );
  };

  return (
    <li className={`action-item${item.completed ? ' done' : ''}${depth > 0 ? ' action-sub-item' : ''}`}>
      <div className="action-item-row">
        <button
          className={`action-checkbox${item.completed ? ' checked' : ''}`}
          onClick={() => onToggle(item)}
          disabled={saving || !editable}
          title={editable ? '' : 'Only assignees can change this'}
          aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {item.completed && (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5l2.5 2.5L10 3.5" stroke="white" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <div className="action-item-body">
          {editingId === item.id ? (
            <div className="action-edit-row">
              <input
                className="action-edit-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCommitEdit();
                  if (e.key === 'Escape') onCancelEdit();
                }}
                autoFocus
              />
              <button className="ghost-btn small" onClick={onCommitEdit} disabled={!editText.trim()}>Save</button>
              <button className="ghost-btn small" onClick={onCancelEdit}>Cancel</button>
            </div>
          ) : (
            <>
              <span className="action-text">{item.text}</span>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                Assigned to: {(item.assignees || []).map((id) => nameById(users, id)).join(', ') || '—'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11 }}>
                <span style={{ color: '#64748b' }}>Due:</span>
                {isAssigner ? (
                  <input
                    type="date"
                    value={item.due_date || ''}
                    onChange={(e) => onSetDueDate(item, e.target.value)}
                    disabled={saving}
                    style={{
                      fontSize: 11, padding: '3px 10px', background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0',
                      outline: 'none', cursor: 'pointer', colorScheme: 'dark',
                    }}
                  />
                ) : (
                  <span style={{ color: '#94a3b8' }}>{item.due_date ? formatDate(item.due_date) : '—'}</span>
                )}
                {(() => {
                  const s = dueStatus(item.due_date, item.completed);
                  return s && s.kind !== 'future' ? (
                    <span style={{
                      color: s.color, fontWeight: 600, fontSize: 10,
                      background: s.color + '1a', padding: '1px 7px', borderRadius: 4,
                    }}>{s.label}</span>
                  ) : null;
                })()}
              </div>
            </>
          )}
        </div>

        {editingId !== item.id && (
          <div className="action-item-actions">
            {editable && (
              <button
                className="action-icon-btn"
                onClick={() => onStartEdit(item)}
                title="Edit"
                disabled={saving}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 2.5a1.414 1.414 0 012 2L5 13H3v-2L11.5 2.5z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {isAssigner && (
              <button
                className="action-icon-btn"
                onClick={() => setShowSubForm((v) => !v)}
                title="Add sub-item"
                disabled={saving}
                style={{ color: showSubForm ? 'var(--blue)' : undefined }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="8" x2="12" y2="8" /><line x1="8" y1="4" x2="8" y2="12" />
                  <path d="M4 13h8" strokeDasharray="2 2" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {showSubForm && (
        <div className="action-sub-form">
          <input
            className="action-edit-input"
            value={subText}
            onChange={(e) => setSubText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSub();
              if (e.key === 'Escape') { setShowSubForm(false); setSubText(''); }
            }}
            placeholder="Sub-item text…"
            autoFocus
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '6px 0' }}>
            {users.map((u) => {
              const checked = subAssignees.includes(u.id);
              return (
                <label key={u.id} className="checkbox-pill"
                  style={{ background: checked ? 'var(--blue-soft-2)' : 'var(--surface-3)', cursor: 'pointer', fontSize: 11 }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleSubAssignee(u.id)} />
                  <span>{u.name}</span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ghost-btn small" onClick={submitSub}
              disabled={!subText.trim() || subAssignees.length === 0 || saving}>
              Add sub-item
            </button>
            <button className="ghost-btn small" onClick={() => { setShowSubForm(false); setSubText(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(item.children || []).length > 0 && (
        <ul className="action-list action-sublist">
          {item.children.map((child) => (
            <ActionItemNode key={child.id} item={child} depth={depth + 1}
              users={users} activeUserId={activeUserId} isAssigner={isAssigner} saving={saving}
              editingId={editingId} editText={editText} setEditText={setEditText}
              onToggle={onToggle} onStartEdit={onStartEdit} onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit} onSetDueDate={onSetDueDate} onAddSub={onAddSub}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ActionCard({ card, users, activeUserId, onChanged, onDelete }) {
  const [items, setItems] = useState(card.items || []);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => { setItems(card.items || []); }, [card.items]);

  const isAssigner = card.assigned_by === activeUserId;

  const refreshItems = useCallback((json) => {
    const newItems = (json.card.items || []).map((it) => ({
      ...it,
      editable: Array.isArray(it.assignees) && it.assignees.includes(activeUserId),
    }));
    setItems(newItems);
    onChanged({ ...card, items: newItems });
  }, [card, activeUserId, onChanged]);

  const patchItem = useCallback(async (itemId, patch) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/action-items/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUserId, item_id: itemId, ...patch }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      refreshItems(json);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }, [card, activeUserId, refreshItems]);

  const addSubItem = useCallback(async (parentItemId, text, assignees) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/action-items/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUserId, add_item: { text, assignees, parent_item_id: parentItemId } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      refreshItems(json);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }, [card, activeUserId, refreshItems]);

  const toggleItem = (item) => {
    if (!item.editable) return;
    patchItem(item.id, { completed: !item.completed });
  };

  const setDueDate = (item, value) => {
    if (!isAssigner) return;
    patchItem(item.id, { due_date: value || null });
  };

  const startEdit = (item) => {
    if (!item.editable) return;
    setEditingId(item.id);
    setEditText(item.text);
  };

  const commitEdit = () => {
    if (!editText.trim()) return;
    const id = editingId;
    setEditingId(null);
    patchItem(id, { text: editText.trim() });
  };

  const cancelEdit = () => { setEditingId(null); setEditText(''); };

  const handleDeleteCard = async () => {
    try {
      const res = await fetch(`/api/action-items/${card.id}`, { method: 'DELETE' });
      if (res.ok) onDelete(card.id);
    } catch (err) {
      console.error('[action-items] delete card failed:', err.message);
    }
  };

  const total = items.length;
  const completed = items.filter((it) => it.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const tree = buildItemTree(items);

  return (
    <div className="action-card">
      <div className="action-card-header">
        <div className="action-card-title-block">
          <span className="action-card-filename">{card.filename}</span>
          <div className="action-card-meta-row">
            <span className="action-card-meta">{completed}/{total} completed</span>
            {card.created_at && (
              <span className="action-card-meta">· {formatDate(card.created_at)}</span>
            )}
            <span
              className="access-chip"
              style={{ background: isAssigner ? '#fde68a' : '#bfdbfe' }}
            >
              {isAssigner ? `Assigned by you (view-only)` : `Assigned to you by ${nameById(users, card.assigned_by)}`}
            </span>
          </div>
        </div>
        <div className="action-card-controls">
          {isAssigner && (
            deleteConfirm ? (
              <>
                <span className="action-confirm-label">Delete this card?</span>
                <button className="ghost-btn small danger" onClick={handleDeleteCard}>Yes, delete</button>
                <button className="ghost-btn small" onClick={() => setDeleteConfirm(false)}>Cancel</button>
              </>
            ) : (
              <button className="ghost-btn small danger" onClick={() => setDeleteConfirm(true)}>
                Delete card
              </button>
            )
          )}
        </div>
      </div>

      <div className="action-progress-wrap">
        <div className="action-progress-bar" style={{ width: `${pct}%` }} />
      </div>

      <ul className="action-list">
        {tree.map((root) => (
          <ActionItemNode key={root.id} item={root} depth={0}
            users={users} activeUserId={activeUserId} isAssigner={isAssigner} saving={saving}
            editingId={editingId} editText={editText} setEditText={setEditText}
            onToggle={toggleItem} onStartEdit={startEdit} onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit} onSetDueDate={setDueDate} onAddSub={addSubItem}
          />
        ))}
      </ul>
    </div>
  );
}

function ManualCreateModal({ users, activeUserId, userScope, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [items, setItems] = useState([
    { id: crypto.randomUUID(), text: '', assignees: [activeUserId].filter(Boolean), due_date: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const listEndRef = useRef(null);

  function addItem() {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: '', assignees: [activeUserId].filter(Boolean), due_date: '' },
    ]);
    setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  function setItemDueDate(idx, due_date) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, due_date } : it)));
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function setItemText(idx, text) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, text } : it)));
  }

  function toggleAssignee(idx, userId) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const has = it.assignees.includes(userId);
      return { ...it, assignees: has ? it.assignees.filter((u) => u !== userId) : [...it.assignees, userId] };
    }));
  }

  async function save() {
    if (!title.trim()) { setErr('Please enter a title for this set of action items.'); return; }
    if (items.length === 0) { setErr('Add at least one action item.'); return; }
    if (items.some((it) => !it.text.trim())) { setErr('All items must have text before saving.'); return; }
    if (items.some((it) => it.assignees.length === 0)) {
      setErr('Each action item needs at least one assignee.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/action-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: title.trim(),
          accessible_to: userScope ? [userScope] : [],
          assigned_by: activeUserId,
          items,
          source_type: 'manual',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      onSaved(json.card);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2 className="modal-title">Create action items</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Title</label>
          <input
            type="text"
            placeholder="e.g. Sprint planning follow-ups"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', fontSize: 14, boxSizing: 'border-box' }}
            autoFocus
          />
        </div>

        <div className="sub" style={{ marginBottom: 10 }}>
          {items.length} item{items.length === 1 ? '' : 's'}. Assign each to one or more people, then save.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '45vh', overflowY: 'auto' }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <textarea
                  rows={2}
                  placeholder="Describe the action item…"
                  value={it.text}
                  onChange={(e) => setItemText(idx, e.target.value)}
                  style={{ flex: 1, fontSize: 14 }}
                />
                <button
                  className="ghost-btn small danger"
                  onClick={() => removeItem(idx)}
                  title="Remove this item"
                  disabled={items.length === 1}
                >×</button>
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#666' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Due date:
                  <input
                    type="date"
                    value={it.due_date || ''}
                    onChange={(e) => setItemDueDate(idx, e.target.value)}
                    style={{ fontSize: 12, padding: '2px 4px' }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#666', marginBottom: 4 }}>
                Assignees ({it.assignees.length}):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {users.map((u) => {
                  const checked = it.assignees.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className="checkbox-pill"
                      style={{ background: checked ? '#dbeafe' : '#f3f4f6', cursor: 'pointer', fontSize: 12 }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleAssignee(idx, u.id)} />
                      <span>{u.name}{u.id === activeUserId ? ' (you)' : ''}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div ref={listEndRef} />
        </div>

        <button className="ghost-btn" style={{ marginTop: 12 }} onClick={addItem}>
          + Add item
        </button>

        {err && <div className="inline-msg error" style={{ marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="ghost-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-btn" onClick={save} disabled={saving || items.length === 0}>
            {saving ? 'Saving…' : `Save ${items.length} action item${items.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ActionItemsTab({ users = [], activeUserId }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('mine'); // 'mine' | 'assigned'
  const [showCreate, setShowCreate] = useState(false);

  const activeUser = users.find((u) => u.id === activeUserId);
  const userScope = activeUser?.part || activeUser?.team || null;

  const handleCreated = useCallback((newCard) => {
    setCards((prev) => [newCard, ...prev]);
    setShowCreate(false);
    setTab('assigned');
  }, []);

  const loadCards = useCallback(async () => {
    if (!activeUserId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/action-items?user_id=${encodeURIComponent(activeUserId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setCards(json.cards || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeUserId]);

  useEffect(() => { loadCards(); }, [loadCards]);

  const handleChange = useCallback((updatedCard) => {
    setCards((prev) => prev.map((c) => c.id === updatedCard.id ? updatedCard : c));
  }, []);

  const handleDelete = useCallback((id) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const { mine, assigned } = useMemo(() => {
    const mine = [];
    const assigned = [];
    for (const c of cards) {
      const editableItems = (c.items || []).filter((it) => it.editable);
      const assignedByMe = c.assigned_by === activeUserId;
      if (editableItems.length > 0) {
        mine.push({ ...c, items: editableItems });
      }
      if (assignedByMe) {
        assigned.push(c);
      }
    }
    return { mine, assigned };
  }, [cards, activeUserId]);

  const visibleCards = tab === 'mine' ? mine : assigned;
  const totalOpen = visibleCards.reduce((sum, c) => sum + (c.items || []).filter((it) => !it.completed).length, 0);
  const totalDone = visibleCards.reduce((sum, c) => sum + (c.items || []).filter((it) => it.completed).length, 0);

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Action Items</h1>
          <div className="sub">
            Action items assigned to you or assigned by you. Items assigned to you are editable; items you've assigned to others are view-only.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary-btn" onClick={() => setShowCreate(true)}>
            + Create action item
          </button>
          <button className="ghost-btn" onClick={loadCards} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {showCreate && (
        <ManualCreateModal
          users={users}
          activeUserId={activeUserId}
          userScope={userScope}
          onClose={() => setShowCreate(false)}
          onSaved={handleCreated}
        />
      )}

      <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px' }}>
        <button
          className={`tab-btn ${tab === 'mine' ? 'active' : ''}`}
          onClick={() => setTab('mine')}
        >
          Assigned to me ({mine.length})
        </button>
        <button
          className={`tab-btn ${tab === 'assigned' ? 'active' : ''}`}
          onClick={() => setTab('assigned')}
        >
          Assigned by me ({assigned.length})
        </button>
      </div>

      {!loading && !error && visibleCards.length > 0 && (
        <div className="sub" style={{ marginBottom: 8 }}>
          {totalOpen} open · {totalDone} completed across {visibleCards.length} document{visibleCards.length === 1 ? '' : 's'}
        </div>
      )}

      {loading && <div className="state"><div className="spinner" /></div>}

      {!loading && error && (
        <div className="state">
          <div className="error-box">
            <h3>Couldn't load action items</h3>
            <p>{error}</p>
            <button className="primary-btn" onClick={loadCards}>Retry</button>
          </div>
        </div>
      )}

      {!loading && !error && visibleCards.length === 0 && (
        <div className="state">
          <div className="placeholder-panel" style={{ width: '100%' }}>
            <div className="placeholder-icon">📋</div>
            <h2>{tab === 'mine' ? 'Nothing assigned to you' : 'You haven\'t assigned anything yet'}</h2>
            <p>
              {tab === 'mine'
                ? 'Items will appear here when someone assigns an action item to you.'
                : 'Use "Create action item" above, or upload a document in Knowledge Hub with "Extract action items" enabled.'}
            </p>
          </div>
        </div>
      )}

      {!loading && !error && visibleCards.length > 0 && (
        <div className="action-cards-list">
          {visibleCards.map((card) => (
            <ActionCard
              key={card.id}
              card={card}
              users={users}
              activeUserId={activeUserId}
              onChanged={handleChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
