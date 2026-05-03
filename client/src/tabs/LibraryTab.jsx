import { useCallback, useEffect, useState } from 'react';

function FileIcon({ ext }) {
  const e = (ext || '').toUpperCase();
  return (
    <div className="file-icon">
      <div className="file-icon-doc" />
      <div className="file-icon-label">{e || 'DOC'}</div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatLockDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---------- SVG icons ----------
const IconDownload = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconSparkle = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
);
const IconTrash = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);
const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const IconUnlock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.9-1" />
  </svg>
);

function IconBtn({ title, onClick, disabled, danger, active, children, as = 'button', href, download }) {
  const cls = `icon-btn${danger ? ' icon-btn-danger' : ''}${active ? ' icon-btn-active' : ''}`;
  if (as === 'a') {
    return (
      <a className={cls} href={href} download={download} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} onClick={onClick} disabled={disabled} title={title} aria-label={title}>
      {children}
    </button>
  );
}

function LibraryRow({ file, activeUserId, onDeleted, onExtracted, onLockChange }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [extractMsg, setExtractMsg] = useState(null);
  const [err, setErr] = useState(null);
  const ext = (file.filetype || '').toLowerCase();

  const lockedByMe = file.locked_by_id && file.locked_by_id === activeUserId;
  const lockedByOther = file.locked_by_id && file.locked_by_id !== activeUserId;
  const lockDisabled = lockedByOther || locking;

  const handleDelete = async () => {
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Delete failed (${res.status})`);
      onDeleted(file.id);
    } catch (e) {
      setErr(e.message);
      setDeleting(false);
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    setExtractMsg(null);
    try {
      const res = await fetch(`/api/action-items/extract/${file.id}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Extraction failed (${res.status})`);
      const n = (json.items || []).length;
      if (n === 0) {
        setExtractMsg({ type: 'info', text: 'No action items found in this document.' });
      } else {
        onExtracted?.(json);
      }
    } catch (e) {
      setExtractMsg({ type: 'error', text: e.message });
    } finally {
      setExtracting(false);
    }
  };

  const handleDownloadAndLock = async (e) => {
    if (lockedByOther) { e.preventDefault(); return; }
    setLocking(true);
    setErr(null);
    try {
      const res = await fetch(`/api/files/${file.id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUserId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Lock failed (${res.status})`);
      onLockChange?.(json.file);
      // Trigger download in a new tab/window. The <a> is already wired for direct link.
      window.open(file.file_url, '_blank', 'noopener,noreferrer');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLocking(false);
    }
  };

  const handleReleaseLock = async () => {
    setLocking(true);
    setErr(null);
    try {
      const res = await fetch(`/api/files/${file.id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUserId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Unlock failed (${res.status})`);
      onLockChange?.(json.file);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="library-row">
      <div className="library-row-icon">
        <FileIcon ext={ext} />
      </div>
      <div className="library-row-main">
        <div className="library-row-title">{file.filename}</div>
        <div className="library-row-meta">
          <span>Uploaded by <strong>{file.uploaded_by}</strong></span>
          <span>·</span>
          <span>{formatDate(file.uploaded_at)}</span>
        </div>
        <div className="library-row-access">
          {(file.accessible_to || []).map((p) => (
            <span key={p} className="access-chip">{p}</span>
          ))}
        </div>
        {file.locked_by_id && (
          <div className={`lock-indicator${lockedByMe ? ' lock-indicator-self' : ''}`}>
            <IconLock />
            <span>
              Being edited by <strong>{lockedByMe ? 'you' : file.locked_by_name}</strong>
              {file.locked_at ? <> since {formatLockDate(file.locked_at)}</> : null}
            </span>
          </div>
        )}
        {err && <div className="inline-msg error" style={{ marginTop: 8 }}>{err}</div>}
        {extractMsg && (
          <div className={`inline-msg ${extractMsg.type}`} style={{ marginTop: 8 }}>
            {extractMsg.text}
          </div>
        )}
      </div>
      <div className="library-row-actions library-row-actions-icons">
        <IconBtn
          as="a"
          title="Download"
          href={file.file_url}
          download
        >
          <IconDownload />
        </IconBtn>

        {lockedByMe ? (
          <IconBtn
            title="Release lock"
            onClick={handleReleaseLock}
            disabled={locking}
            active
          >
            <IconUnlock />
          </IconBtn>
        ) : (
          <IconBtn
            title={lockedByOther ? `Locked by ${file.locked_by_name}` : 'Download & Edit (lock)'}
            onClick={handleDownloadAndLock}
            disabled={lockDisabled}
          >
            <IconLock />
          </IconBtn>
        )}

        <IconBtn
          title="Extract Action Items"
          onClick={handleExtract}
          disabled={extracting}
        >
          <IconSparkle />
        </IconBtn>

        {confirming ? (
          <>
            <button className="ghost-btn small danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Confirm'}
            </button>
            <button className="ghost-btn small" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </button>
          </>
        ) : (
          <IconBtn
            title="Delete"
            onClick={() => setConfirming(true)}
            danger
          >
            <IconTrash />
          </IconBtn>
        )}
      </div>
    </div>
  );
}

function ActionItemReviewModal({ pending, users, activeUserId, onClose, onSaved }) {
  const [items, setItems] = useState(() =>
    (pending.items || []).map((it) => ({
      id: it.id,
      text: it.text,
      assignees: Array.isArray(it.assignees) && it.assignees.length ? it.assignees : [activeUserId].filter(Boolean),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function toggleAssignee(itemIdx, userId) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== itemIdx) return it;
      const has = it.assignees.includes(userId);
      return { ...it, assignees: has ? it.assignees.filter((u) => u !== userId) : [...it.assignees, userId] };
    }));
  }

  function setItemText(itemIdx, text) {
    setItems((prev) => prev.map((it, i) => (i === itemIdx ? { ...it, text } : it)));
  }

  function removeItem(itemIdx) {
    setItems((prev) => prev.filter((_, i) => i !== itemIdx));
  }

  async function save() {
    if (items.length === 0) {
      setErr('Add at least one action item before saving.');
      return;
    }
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
          file_id: pending.file_id,
          filename: pending.filename,
          accessible_to: pending.accessible_to,
          assigned_by: activeUserId,
          items,
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
          <h2 className="modal-title">Review extracted action items</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="sub" style={{ marginBottom: 12 }}>
          {items.length} item{items.length === 1 ? '' : 's'} extracted from <strong>{pending.filename}</strong>.
          Assign each item to one or more people, then save.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '50vh', overflowY: 'auto' }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <textarea
                  rows={2}
                  value={it.text}
                  onChange={(e) => setItemText(idx, e.target.value)}
                  style={{ flex: 1, fontSize: 14 }}
                />
                <button className="ghost-btn small danger" onClick={() => removeItem(idx)} title="Remove">×</button>
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
          {items.length === 0 && (
            <div className="state-text" style={{ padding: 20, textAlign: 'center' }}>All items removed.</div>
          )}
        </div>
        {err && <div className="inline-msg error" style={{ marginTop: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="ghost-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : `Save ${items.length} action item${items.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryTab({ users = [], activeUserId }) {
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryErr, setLibraryErr] = useState(null);
  const [pendingItems, setPendingItems] = useState(null);

  const loadLibrary = useCallback(async () => {
    if (!activeUserId) return;
    setLibraryLoading(true);
    setLibraryErr(null);
    try {
      const res = await fetch(`/api/files?user_id=${encodeURIComponent(activeUserId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setLibrary(json.files || []);
    } catch (err) {
      setLibraryErr(err.message);
    } finally {
      setLibraryLoading(false);
    }
  }, [activeUserId]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Library</h1>
          <div className="sub">All documents in your scope. Lock a file to claim it for editing.</div>
        </div>
        <button className="ghost-btn" onClick={loadLibrary} disabled={libraryLoading}>
          {libraryLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">{library.length} document{library.length === 1 ? '' : 's'}</h2>
        </div>
        {libraryLoading && <div className="state"><div className="spinner" /></div>}
        {libraryErr && <div className="inline-msg error">{libraryErr}</div>}
        {!libraryLoading && !libraryErr && library.length === 0 && (
          <div className="state-text" style={{ marginTop: 8 }}>No documents uploaded yet.</div>
        )}
        {!libraryLoading && library.length > 0 && (
          <div className="library-list">
            {library.map((f) => (
              <LibraryRow
                key={f.id}
                file={f}
                activeUserId={activeUserId}
                onDeleted={(id) => setLibrary((curr) => curr.filter((x) => x.id !== id))}
                onExtracted={(payload) => setPendingItems(payload)}
                onLockChange={(updated) =>
                  setLibrary((curr) => curr.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
                }
              />
            ))}
          </div>
        )}
      </section>

      {pendingItems && (
        <ActionItemReviewModal
          pending={pendingItems}
          users={users}
          activeUserId={activeUserId}
          onClose={() => setPendingItems(null)}
          onSaved={() => setPendingItems(null)}
        />
      )}
    </div>
  );
}
