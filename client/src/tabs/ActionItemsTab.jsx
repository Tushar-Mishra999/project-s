import { useCallback, useEffect, useMemo, useState } from 'react';

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function nameById(users, id) {
  return users.find((u) => u.id === id)?.name || id;
}

function ActionCard({ card, users, activeUserId, onChanged, onDelete }) {
  const [items, setItems] = useState(card.items || []);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => { setItems(card.items || []); }, [card.items]);

  const isAssigner = card.assigned_by === activeUserId;
  // viewer_role from server: 'assigner' or 'assignee'. assigner cards are view-only.

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
      const newItems = (json.card.items || []).map((it) => ({
        ...it,
        editable: Array.isArray(it.assignees) && it.assignees.includes(activeUserId),
      }));
      setItems(newItems);
      onChanged({ ...card, items: newItems });
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }, [card, activeUserId, onChanged]);

  const toggleItem = (item) => {
    if (!item.editable) return;
    patchItem(item.id, { completed: !item.completed });
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

  const completed = items.filter((it) => it.completed).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

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
        {items.map((item) => {
          const editable = item.editable;
          return (
            <li key={item.id} className={`action-item${item.completed ? ' done' : ''}`}>
              <button
                className={`action-checkbox${item.completed ? ' checked' : ''}`}
                onClick={() => toggleItem(item)}
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
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      autoFocus
                    />
                    <button className="ghost-btn small" onClick={commitEdit} disabled={!editText.trim()}>Save</button>
                    <button className="ghost-btn small" onClick={cancelEdit}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <span className="action-text">{item.text}</span>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      Assigned to: {(item.assignees || []).map((id) => nameById(users, id)).join(', ') || '—'}
                    </div>
                  </>
                )}
              </div>

              {editingId !== item.id && editable && (
                <div className="action-item-actions">
                  <button
                    className="action-icon-btn"
                    onClick={() => startEdit(item)}
                    title="Edit"
                    disabled={saving}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M11.5 2.5a1.414 1.414 0 012 2L5 13H3v-2L11.5 2.5z"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ActionItemsTab({ users = [], activeUserId }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('mine'); // 'mine' | 'assigned'

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

  // Split into "assigned to me" (has at least one item I can edit) vs "assigned by me".
  const { mine, assigned } = useMemo(() => {
    const mine = [];
    const assigned = [];
    for (const c of cards) {
      const editableItems = (c.items || []).filter((it) => it.editable);
      const assignedByMe = c.assigned_by === activeUserId;
      // A card can have both — show the editable subset under "Mine", the full
      // card under "Assigned by me" (view-only).
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
        <button className="ghost-btn" onClick={loadCards} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

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
                ? 'Items will appear here when someone assigns an action item to you from an uploaded document.'
                : 'Upload a document in Knowledge Hub with "Extract action items" enabled, then review and assign them.'}
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
