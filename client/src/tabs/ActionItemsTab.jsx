import { useCallback, useEffect, useState } from 'react';

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ActionCard({ card, onUpdate, onDelete }) {
  const [items, setItems] = useState(card.items);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Keep local items in sync if the parent card prop changes (e.g. after reload).
  useEffect(() => { setItems(card.items); }, [card.items]);

  const persist = useCallback(async (newItems) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/action-items/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: newItems }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setItems(newItems);
      onUpdate({ ...card, items: newItems });
    } catch (err) {
      console.error('[action-items] persist failed:', err.message);
    } finally {
      setSaving(false);
    }
  }, [card, onUpdate]);

  const toggleItem = (id) => {
    const next = items.map((it) => it.id === id ? { ...it, completed: !it.completed } : it);
    persist(next);
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditText(item.text);
  };

  const commitEdit = () => {
    if (!editText.trim()) return;
    const next = items.map((it) => it.id === editingId ? { ...it, text: editText.trim() } : it);
    setEditingId(null);
    persist(next);
  };

  const cancelEdit = () => { setEditingId(null); setEditText(''); };

  const deleteItem = async (id) => {
    const next = items.filter((it) => it.id !== id);
    if (next.length === 0) {
      // Last item removed — delete the whole card.
      await handleDeleteCard();
    } else {
      persist(next);
    }
  };

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
            {(card.accessible_to || []).map((p) => (
              <span key={p} className="access-chip">{p}</span>
            ))}
          </div>
        </div>
        <div className="action-card-controls">
          {deleteConfirm ? (
            <>
              <span className="action-confirm-label">Delete this card?</span>
              <button className="ghost-btn small danger" onClick={handleDeleteCard}>Yes, delete</button>
              <button className="ghost-btn small" onClick={() => setDeleteConfirm(false)}>Cancel</button>
            </>
          ) : (
            <button className="ghost-btn small danger" onClick={() => setDeleteConfirm(true)}>
              Delete card
            </button>
          )}
        </div>
      </div>

      <div className="action-progress-wrap">
        <div className="action-progress-bar" style={{ width: `${pct}%` }} />
      </div>

      <ul className="action-list">
        {items.map((item) => (
          <li key={item.id} className={`action-item${item.completed ? ' done' : ''}`}>
            <button
              className={`action-checkbox${item.completed ? ' checked' : ''}`}
              onClick={() => toggleItem(item.id)}
              disabled={saving}
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
                  <button className="ghost-btn small" onClick={commitEdit} disabled={!editText.trim()}>
                    Save
                  </button>
                  <button className="ghost-btn small" onClick={cancelEdit}>Cancel</button>
                </div>
              ) : (
                <span className="action-text">{item.text}</span>
              )}
            </div>

            {editingId !== item.id && (
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
                <button
                  className="action-icon-btn danger"
                  onClick={() => deleteItem(item.id)}
                  title="Delete item"
                  disabled={saving}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M3 3l10 10M13 3L3 13"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ActionItemsTab({ activePart }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCards = useCallback(async () => {
    if (!activePart) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/action-items?part=${encodeURIComponent(activePart)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setCards(json.cards || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activePart]);

  useEffect(() => { loadCards(); }, [loadCards]);

  const handleUpdate = useCallback((updatedCard) => {
    setCards((prev) => prev.map((c) => c.id === updatedCard.id ? updatedCard : c));
  }, []);

  const handleDelete = useCallback((id) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const totalOpen = cards.reduce((sum, c) => sum + c.items.filter((it) => !it.completed).length, 0);
  const totalDone = cards.reduce((sum, c) => sum + c.items.filter((it) => it.completed).length, 0);

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Action Items</h1>
          <div className="sub">
            {cards.length > 0
              ? `${totalOpen} open · ${totalDone} completed across ${cards.length} document${cards.length === 1 ? '' : 's'} — ${activePart}`
              : `Action items auto-extracted from documents uploaded for ${activePart || 'your part'}.`}
          </div>
        </div>
        <button className="ghost-btn" onClick={loadCards} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

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

      {!loading && !error && cards.length === 0 && (
        <div className="state">
          <div className="placeholder-panel" style={{ width: '100%' }}>
            <div className="placeholder-icon">📋</div>
            <h2>No action items yet</h2>
            <p>
              Upload documents in <strong>Smart Retrieval</strong> — action items are automatically
              detected and will appear here for <strong>{activePart || 'your part'}</strong>.
            </p>
          </div>
        </div>
      )}

      {!loading && !error && cards.length > 0 && (
        <div className="action-cards-list">
          {cards.map((card) => (
            <ActionCard
              key={card.id}
              card={card}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
