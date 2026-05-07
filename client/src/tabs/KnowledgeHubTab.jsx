import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { renderPdfThumbnail } from '../lib/pdfPreview.js';

// ── Typewriter effect ────────────────────────────────────
const TYPEWRITER_LINES = [
  'Search across all your team documents instantly',
  'Generate polished reports from your knowledge base',
  'Extract action items from emails and uploads',
  'Get quick insights with AI-powered chat',
  'Keep your team aligned with a shared library',
];

function Typewriter() {
  const [lineIdx, setLineIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const line = TYPEWRITER_LINES[lineIdx];
    if (!deleting && charIdx < line.length) {
      const t = setTimeout(() => setCharIdx((c) => c + 1), 38);
      return () => clearTimeout(t);
    }
    if (!deleting && charIdx === line.length) {
      const t = setTimeout(() => setDeleting(true), 2200);
      return () => clearTimeout(t);
    }
    if (deleting && charIdx > 0) {
      const t = setTimeout(() => setCharIdx((c) => c - 1), 22);
      return () => clearTimeout(t);
    }
    if (deleting && charIdx === 0) {
      setDeleting(false);
      setLineIdx((i) => (i + 1) % TYPEWRITER_LINES.length);
    }
  }, [charIdx, deleting, lineIdx]);

  return (
    <div className="hub-typewriter">
      <span>{TYPEWRITER_LINES[lineIdx].slice(0, charIdx)}</span>
      <span className="hub-typewriter-cursor">|</span>
    </div>
  );
}

// ── SVG icons ──────────────────────────────────────────
const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconUpload = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const IconFolder = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);
const IconReport = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);
const IconDownload = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconSparkle = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
);
const IconTrash = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);
const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const IconUnlock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.9-1" />
  </svg>
);
const IconUploadSmall = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
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

// ── Searchable parent-item picker ────────────────────────
function ParentPicker({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function onOut(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  const filtered = search.trim()
    ? options.filter((o) => o.text.toLowerCase().includes(search.toLowerCase()))
    : options;

  const selected = options.find((o) => o.id === value);

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
        style={{
          width: '100%', textAlign: 'left', padding: '5px 10px',
          background: 'var(--surface-3)', border: '1px solid var(--border-strong)',
          borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selected
            ? (selected.text.length > 55 ? selected.text.slice(0, 55) + '…' : selected.text)
            : <span style={{ color: 'var(--text-muted)' }}>None (top-level)</span>}
        </span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: 320,
          background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
          borderRadius: 8, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 200,
          maxHeight: 300, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid var(--border)' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action items…"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 8px',
                background: 'var(--surface-3)', border: '1px solid var(--border-strong)',
                borderRadius: 5, color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <button type="button"
              onClick={() => { onChange(null); setOpen(false); setSearch(''); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                border: 'none', borderBottom: '1px solid var(--border)',
                background: !value ? 'rgba(59,130,246,.08)' : 'transparent',
                color: !value ? 'var(--blue)' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: 12, fontStyle: 'italic', fontFamily: 'inherit',
              }}>
              None (top-level)
            </button>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                No items match "{search}"
              </div>
            )}
            {filtered.map((opt) => (
              <button key={opt.id} type="button"
                onClick={() => { onChange(opt.id); setOpen(false); setSearch(''); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--border)',
                  background: value === opt.id ? 'rgba(59,130,246,.08)' : 'transparent',
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { if (value !== opt.id) e.currentTarget.style.background = 'rgba(255,255,255,.04)'; }}
                onMouseLeave={(e) => { if (value !== opt.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ fontSize: 12, color: value === opt.id ? 'var(--blue)' : 'var(--text)', lineHeight: 1.4 }}>
                  {opt.text.length > 72 ? opt.text.slice(0, 72) + '…' : opt.text}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.source}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared action-item review modal ──────────────────────
function ActionItemReviewModal({ pending, users, activeUserId, onClose, onSaved }) {
  const [items, setItems] = useState(() =>
    (pending.items || []).map((it) => ({
      id: it.id,
      text: it.text,
      assignees: Array.isArray(it.assignees) && it.assignees.length ? it.assignees : [activeUserId].filter(Boolean),
      parent_item_id: null,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [existingItems, setExistingItems] = useState([]);

  useEffect(() => {
    if (!activeUserId) return;
    fetch(`/api/action-items?user_id=${encodeURIComponent(activeUserId)}`)
      .then((r) => r.json())
      .then((json) => {
        const flat = [];
        for (const card of (json.cards || [])) {
          for (const it of (card.items || [])) {
            flat.push({ id: it.id, text: it.text, source: card.filename });
          }
        }
        setExistingItems(flat);
      })
      .catch(() => {});
  }, [activeUserId]);

  function parentOptionsFor(itemIdx) {
    const batchIds = new Set(items.map((it) => it.id));
    const batchOpts = items
      .filter((_, i) => i !== itemIdx)
      .map((it) => ({ id: it.id, text: it.text, source: 'This document (batch)' }));
    const dbOpts = existingItems.filter((it) => !batchIds.has(it.id));
    return [...batchOpts, ...dbOpts];
  }

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
  function setItemParent(itemIdx, parentId) {
    setItems((prev) => prev.map((it, i) => (i === itemIdx ? { ...it, parent_item_id: parentId || null } : it)));
  }
  function removeItem(itemIdx) {
    setItems((prev) => prev.filter((_, i) => i !== itemIdx));
  }

  async function save() {
    if (items.length === 0) return setErr('Add at least one action item before saving.');
    if (items.some((it) => it.assignees.length === 0)) return setErr('Each action item needs at least one assignee.');
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/action-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: pending.file_id, filename: pending.filename, accessible_to: pending.accessible_to, assigned_by: activeUserId, items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      onSaved(json.card);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2 className="modal-title">Review extracted action items</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="sub" style={{ marginBottom: 12 }}>
          {items.length} item{items.length === 1 ? '' : 's'} extracted from <strong>{pending.filename}</strong>. Assign each item then save.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '50vh', overflowY: 'auto' }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <textarea rows={2} value={it.text} onChange={(e) => setItemText(idx, e.target.value)} style={{ flex: 1, fontSize: 14 }} />
                <button className="ghost-btn small danger" onClick={() => removeItem(idx)} title="Remove">×</button>
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ whiteSpace: 'nowrap' }}>Parent:</span>
                <ParentPicker
                  value={it.parent_item_id}
                  onChange={(id) => setItemParent(idx, id)}
                  options={parentOptionsFor(idx)}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Assignees ({it.assignees.length}):</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {users.map((u) => {
                  const checked = it.assignees.includes(u.id);
                  return (
                    <label key={u.id} className="checkbox-pill" style={{ background: checked ? 'var(--blue-soft-2)' : 'var(--surface-3)', cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAssignee(idx, u.id)} />
                      <span>{u.name}{u.id === activeUserId ? ' (you)' : ''}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="state-text" style={{ padding: 20, textAlign: 'center' }}>All items removed.</div>}
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

// ── Gmail inbox ──────────────────────────────────────────
function GmailEmailCard({ email, activeUserId, onExtract, onAttachmentUploaded }) {
  const [uploading, setUploading] = useState({});
  const [uploadMsg, setUploadMsg] = useState({});
  const [extracting, setExtracting] = useState(false);

  const senderName = email.from.replace(/<.*>/, '').trim() || email.from;
  const avatar = (senderName[0] || '?').toUpperCase();

  const handleUploadAttachment = async (att) => {
    setUploading((s) => ({ ...s, [att.attachmentId]: true }));
    setUploadMsg((s) => ({ ...s, [att.attachmentId]: null }));
    try {
      const res = await fetch('/api/email/upload-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: email.id, attachmentId: att.attachmentId, filename: att.filename, mimeType: att.mimeType, user_id: activeUserId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setUploadMsg((s) => ({ ...s, [att.attachmentId]: 'Added to Hub' }));
      onAttachmentUploaded?.();
    } catch (e) {
      setUploadMsg((s) => ({ ...s, [att.attachmentId]: e.message }));
    } finally {
      setUploading((s) => ({ ...s, [att.attachmentId]: false }));
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const res = await fetch('/api/email/extract-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: email.subject, body: email.body || email.snippet, user_id: activeUserId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Extraction failed');
      if (json.items?.length) {
        onExtract({ file_id: null, filename: email.subject || 'Email', accessible_to: [], items: json.items });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="hub-email-card">
      <div className="hub-email-sender">
        <span className="hub-email-avatar">{avatar}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{senderName}</span>
        {email.date && <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 6 }}>{new Date(email.date).toLocaleDateString()}</span>}
      </div>
      <div className="hub-email-subject">{email.subject}</div>
      <p className="hub-email-preview">{email.snippet || (email.body || '').slice(0, 200)}</p>
      {email.attachments?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {email.attachments.map((att) => (
            <div key={att.attachmentId} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-3)', borderRadius: 6, padding: '3px 8px', fontSize: 12 }}>
              <span>📎 {att.filename}</span>
              <button
                className="ghost-btn small"
                style={{ padding: '1px 6px', fontSize: 11 }}
                onClick={() => handleUploadAttachment(att)}
                disabled={uploading[att.attachmentId] || uploadMsg[att.attachmentId] === 'Added to Hub'}
              >
                {uploading[att.attachmentId] ? '…' : uploadMsg[att.attachmentId] || 'Upload to Hub'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="hub-email-actions">
        <button className="ghost-btn small" onClick={handleExtract} disabled={extracting}>
          {extracting ? 'Extracting…' : 'Extract Actions'}
        </button>
      </div>
    </div>
  );
}

function GmailInbox({ activeUserId, onExtract, onAttachmentUploaded }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'disconnected' | 'connected'
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsErr, setEmailsErr] = useState(null);

  useEffect(() => {
    // Handle OAuth redirect param
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'connected') {
      const url = new URL(window.location.href);
      url.searchParams.delete('gmail');
      window.history.replaceState({}, '', url.toString());
    }

    fetch('/api/email/status')
      .then((r) => r.json())
      .then((json) => setStatus(json.connected ? 'connected' : 'disconnected'))
      .catch(() => setStatus('disconnected'));
  }, []);

  useEffect(() => {
    if (status !== 'connected') return;
    setEmailsLoading(true);
    setEmailsErr(null);
    fetch('/api/email/messages?max=10')
      .then((r) => r.json())
      .then((json) => setEmails(json.emails || []))
      .catch((e) => setEmailsErr(e.message))
      .finally(() => setEmailsLoading(false));
  }, [status]);

  if (status === 'loading') return <div className="state"><div className="spinner" /></div>;

  if (status === 'disconnected') {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 14 }}>
          Connect your Gmail account to read emails and extract action items directly in the Hub.
        </div>
        <a href="/api/email/auth" className="primary-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
          Connect Gmail
        </a>
      </div>
    );
  }

  return (
    <>
      {emailsLoading && <div className="state"><div className="spinner" /></div>}
      {emailsErr && <div className="inline-msg error">{emailsErr}</div>}
      {!emailsLoading && emails.length === 0 && !emailsErr && (
        <div className="state-text">Inbox is empty or no recent emails.</div>
      )}
      <div className="hub-email-strip">
        {emails.map((em) => (
          <GmailEmailCard
            key={em.id}
            email={em}
            activeUserId={activeUserId}
            onExtract={onExtract}
            onAttachmentUploaded={onAttachmentUploaded}
          />
        ))}
      </div>
    </>
  );
}

// ── Library row (reused from LibraryTab) ─────────────────
function LibraryRow({ file, activeUserId, onDeleted, onExtracted, onLockChange, onReplaced }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [extractMsg, setExtractMsg] = useState(null);
  const [err, setErr] = useState(null);
  const replaceInputRef = useRef(null);
  const ext = (file.filetype || '').toLowerCase();

  const lockedByMe = file.locked_by_id && file.locked_by_id === activeUserId;
  const lockedByOther = file.locked_by_id && file.locked_by_id !== activeUserId;

  const handleDelete = async () => {
    setDeleting(true); setErr(null);
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      onDeleted(file.id);
    } catch (e) { setErr(e.message); setDeleting(false); }
  };
  const handleExtract = async () => {
    setExtracting(true); setExtractMsg(null);
    try {
      const res = await fetch(`/api/action-items/extract/${file.id}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Extraction failed');
      const n = (json.items || []).length;
      if (n === 0) setExtractMsg({ type: 'info', text: 'No action items found.' });
      else onExtracted?.(json);
    } catch (e) { setExtractMsg({ type: 'error', text: e.message }); }
    finally { setExtracting(false); }
  };
  const handleDownloadAndLock = async (e) => {
    if (lockedByOther) { e.preventDefault(); return; }
    setLocking(true); setErr(null);
    try {
      const res = await fetch(`/api/files/${file.id}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: activeUserId }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Lock failed');
      onLockChange?.(json.file);
      window.open(file.file_url, '_blank', 'noopener,noreferrer');
    } catch (ex) { setErr(ex.message); }
    finally { setLocking(false); }
  };
  const handleReplace = async (e) => {
    const newFile = e.target.files?.[0]; e.target.value = '';
    if (!newFile) return;
    setReplacing(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('file', newFile); fd.append('user_id', activeUserId);
      const res = await fetch(`/api/files/${file.id}/replace`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Replace failed');
      onReplaced?.(json.file);
    } catch (ex) { setErr(ex.message); }
    finally { setReplacing(false); }
  };
  const handleReleaseLock = async () => {
    setLocking(true); setErr(null);
    try {
      const res = await fetch(`/api/files/${file.id}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: activeUserId }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unlock failed');
      onLockChange?.(json.file);
    } catch (ex) { setErr(ex.message); }
    finally { setLocking(false); }
  };

  return (
    <div className="library-row">
      <div className="library-row-icon"><FileIcon ext={ext} /></div>
      <div className="library-row-main">
        <div className="library-row-title">{file.filename}</div>
        <div className="library-row-meta">
          <span>By <strong>{file.uploaded_by}</strong></span><span>·</span><span>{formatDate(file.uploaded_at)}</span>
          {file.version > 1 && <><span>·</span><span>v{file.version}{file.updated_by ? ` by ${file.updated_by}` : ''}</span></>}
        </div>
        <div className="library-row-access">
          {(file.accessible_to || []).map((p) => <span key={p} className="access-chip">{p}</span>)}
        </div>
        {file.locked_by_id && (
          <div className={`lock-indicator${lockedByMe ? ' lock-indicator-self' : ''}`}>
            <IconLock />
            <span>Being edited by <strong>{lockedByMe ? 'you' : file.locked_by_name}</strong>{file.locked_at ? <> since {formatLockDate(file.locked_at)}</> : null}</span>
          </div>
        )}
        {err && <div className="inline-msg error" style={{ marginTop: 8 }}>{err}</div>}
        {extractMsg && <div className={`inline-msg ${extractMsg.type}`} style={{ marginTop: 8 }}>{extractMsg.text}</div>}
      </div>
      <div className="library-row-actions library-row-actions-icons">
        <IconBtn as="a" title="Download" href={file.file_url} download><IconDownload /></IconBtn>
        {lockedByMe ? (
          <>
            <input ref={replaceInputRef} type="file" accept=".pdf,.docx,.pptx,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }} onChange={handleReplace} />
            <IconBtn title={replacing ? 'Uploading…' : 'Upload new version'} onClick={() => replaceInputRef.current?.click()} disabled={replacing} active><IconUploadSmall /></IconBtn>
            <IconBtn title="Release lock" onClick={handleReleaseLock} disabled={locking || replacing} active><IconUnlock /></IconBtn>
          </>
        ) : (
          <IconBtn title={lockedByOther ? `Locked by ${file.locked_by_name}` : 'Download & Edit (lock)'} onClick={handleDownloadAndLock} disabled={lockedByOther || locking}><IconLock /></IconBtn>
        )}
        <IconBtn title="Extract Action Items" onClick={handleExtract} disabled={extracting}><IconSparkle /></IconBtn>
        {confirming ? (
          <>
            <button className="ghost-btn small danger" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Confirm'}</button>
            <button className="ghost-btn small" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
          </>
        ) : (
          <IconBtn title="Delete" onClick={() => setConfirming(true)} danger><IconTrash /></IconBtn>
        )}
      </div>
    </div>
  );
}

// ── Search result card ───────────────────────────────────
function PdfThumb({ url }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    renderPdfThumbnail(url, 220).then((d) => { if (!cancelled) setSrc(d); }).catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [url]);
  if (err) return <FileIcon ext="PDF" />;
  if (!src) return <div className="file-thumb-placeholder">Loading preview…</div>;
  return <img className="file-thumb" src={src} alt="PDF preview" />;
}

function SearchResultCard({ result }) {
  const ext = (result.filetype || '').toLowerCase();
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const handleSummarize = () => { setSummaryLoading(true); setTimeout(() => { setShowSummary(true); setSummaryLoading(false); }, 600); };
  const fullSummary = result.chunk_summary || (result.chunk_text || '').slice(0, 600);

  return (
    <article className="file-card file-card-result">
      <div className="file-card-preview">{ext.includes('pdf') ? <PdfThumb url={result.file_url} /> : <FileIcon ext={ext} />}</div>
      <div className="file-card-body">
        <div className="meta">{result.uploaded_by} · Chunk #{result.chunk_index}</div>
        <div className="file-card-title">{result.filename}</div>
        <p className="summary">{result.chunk_summary || (result.chunk_text || '').slice(0, 240) + '…'}</p>
        {showSummary && <div className="ai-summary-panel"><div className="ai-summary-label">AI Summary</div><p>{fullSummary}</p></div>}
        <div className="file-card-actions">
          <a className="more" href={result.file_url} target="_blank" rel="noopener noreferrer" download>Download ↓</a>
          <button className="ghost-btn small" onClick={handleSummarize} disabled={summaryLoading || showSummary}>
            {summaryLoading ? 'Summarising…' : showSummary ? 'Summary shown' : 'Get summary'}
          </button>
        </div>
      </div>
    </article>
  );
}

function dedupeByFile(chunks) {
  const seen = new Map();
  for (const c of chunks) { if (!seen.has(c.file_id)) seen.set(c.file_id, c); }
  return Array.from(seen.values());
}

// ── Report generator model dropdown ──────────────────────
const MODEL_ICONS = {
  gemini: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#rgi2)"/><defs><radialGradient id="rgi2" cx="30%" cy="30%"><stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#3b82f6"/></radialGradient></defs></svg>,
  gemma: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2L4 7v10l8 5 8-5V7z" fill="url(#rgma2)"/><defs><radialGradient id="rgma2" cx="30%" cy="30%"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></radialGradient></defs></svg>,
  glm: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><rect x="3" y="3" width="18" height="18" rx="4" fill="url(#rglm2)"/><defs><radialGradient id="rglm2" cx="30%" cy="30%"><stop offset="0%" stopColor="#f472b6"/><stop offset="100%" stopColor="#9333ea"/></radialGradient></defs></svg>,
  kimi: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4l2 4h4l-3 3 1 4-4-2.5L8 17l1-4-3-3h4z" fill="url(#rkimi2)"/><defs><radialGradient id="rkimi2" cx="30%" cy="30%"><stop offset="0%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#f59e0b"/></radialGradient></defs></svg>,
};
const MODEL_OPTIONS = [
  { id: 'gemini', label: 'Gemini 2.5 Flash' },
  { id: 'gemma', label: 'Gemma 4 26B A4B IT' },
  { id: 'glm', label: 'GLM 5' },
  { id: 'kimi', label: 'Kimi K2 Thinking' },
];

function ModelDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = MODEL_OPTIONS.find((o) => o.id === value) || MODEL_OPTIONS[0];
  useEffect(() => {
    function onClick(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', color: 'var(--text)', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', minWidth: 200 }}>
        {MODEL_ICONS[selected.id]}
        <span style={{ flex: 1, textAlign: 'left' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, display: 'block', lineHeight: 1.2 }}>Model</span>
          <span>{selected.label}</span>
        </span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 12, overflow: 'hidden', zIndex: 50, minWidth: 260, boxShadow: '0 8px 32px rgba(0,0,0,.45)' }}>
          {MODEL_OPTIONS.map((opt) => {
            const active = opt.id === value;
            return (
              <button key={opt.id} onClick={() => { onChange(opt.id); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', border: 'none', background: active ? 'rgba(59,130,246,.12)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', borderLeft: active ? '2px solid #3b82f6' : '2px solid transparent' }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: active ? 'rgba(59,130,246,.18)' : 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{MODEL_ICONS[opt.id]}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#93c5fd' : 'var(--text)' }}>{opt.label}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────
function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadText(filename, text) {
  triggerDownload(filename, new Blob([text], { type: 'text/html;charset=utf-8' }));
}

async function downloadDocx(filename, html) {
  const res = await fetch('/api/render-docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html, filename }) });
  if (!res.ok) { let msg = `Server returned ${res.status}`; try { msg = (await res.json()).error || msg; } catch {} throw new Error(msg); }
  const blob = await res.blob();
  triggerDownload(filename, blob);
}

// ════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ════════════════════════════════════════════════════════
export default function KnowledgeHubTab({ parts, activePart, users = [], activeUserId }) {
  const activeUser = users.find((u) => u.id === activeUserId);
  const isMD = activeUser?.role === 'MD';
  const userScope = activeUser?.part || activeUser?.team || null;

  // Sub-section: 'browse' | 'library' | 'reports'
  const [section, setSection] = useState('browse');

  // ── Search state ───────────────────────────────────────
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [searchErr, setSearchErr] = useState(null);

  // ── Upload state ───────────────────────────────────────
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState(null);
  const [accessibleTo, setAccessibleTo] = useState([]);
  const [extractActions, setExtractActions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const fileInputRef = useRef(null);
  const [pendingItems, setPendingItems] = useState(null);

  // ── Library state ──────────────────────────────────────
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryErr, setLibraryErr] = useState(null);

  // ── Reports state ──────────────────────────────────────
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [reportModel, setReportModel] = useState('gemini');
  const [instruction, setInstruction] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchAll, setMatchAll] = useState([]);
  const [matchPicked, setMatchPicked] = useState(new Set());
  const [matchRationale, setMatchRationale] = useState('');
  const [matchActive, setMatchActive] = useState(false);
  const [inputData, setInputData] = useState('');
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);
  const [generateErr, setGenerateErr] = useState(null);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadErr, setDownloadErr] = useState(null);
  const [matchErr, setMatchErr] = useState(null);

  // Upload template state
  const [showTemplateUpload, setShowTemplateUpload] = useState(false);
  const [templateFile, setTemplateFile] = useState(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [templateUploadMsg, setTemplateUploadMsg] = useState(null);
  const templateFileRef = useRef(null);

  const toggleAccessible = (p) => setAccessibleTo((curr) => curr.includes(p) ? curr.filter((x) => x !== p) : [...curr, p]);

  // ── Load library ───────────────────────────────────────
  const loadLibrary = useCallback(async () => {
    if (!activeUserId) return;
    setLibraryLoading(true); setLibraryErr(null);
    try {
      const res = await fetch(`/api/files?user_id=${encodeURIComponent(activeUserId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setLibrary(json.files || []);
    } catch (err) { setLibraryErr(err.message); }
    finally { setLibraryLoading(false); }
  }, [activeUserId]);

  // ── Load templates ─────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch('/api/report-templates');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setTemplates(json.templates || []);
    } catch {} finally { setLoadingTemplates(false); }
  }, []);

  useEffect(() => { loadLibrary(); loadTemplates(); }, [loadLibrary, loadTemplates]);

  // ── Search handler ─────────────────────────────────────
  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    if (!activeUserId) return setSearchErr('No active user.');
    setSearching(true); setSearchErr(null); setResults(null);
    try {
      const res = await fetch('/api/retrieve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, user_id: activeUserId, mode: 'files' }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.chunks || []);
    } catch (err) { setSearchErr(err.message); }
    finally { setSearching(false); }
  };

  // ── Upload handler ─────────────────────────────────────
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return setUploadMsg({ type: 'error', text: 'Choose a file first.' });
    if (!activeUserId) return setUploadMsg({ type: 'error', text: 'No active user.' });
    if (isMD && accessibleTo.length === 0) return setUploadMsg({ type: 'error', text: 'Pick at least one Part/Team.' });
    setUploading(true); setUploadMsg({ type: 'info', text: 'Uploading and processing…' });
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('user_id', activeUserId);
      if (isMD) fd.append('accessible_to', JSON.stringify(accessibleTo));
      fd.append('extract_action_items', String(extractActions));
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setUploadMsg({ type: 'success', text: `Uploaded "${file.name}" — ${json.chunk_count} chunks indexed.` });
      setFile(null); if (fileInputRef.current) fileInputRef.current.value = '';
      if (json.pending_action_items?.items?.length > 0) setPendingItems(json.pending_action_items);
      loadLibrary();
    } catch (err) { setUploadMsg({ type: 'error', text: err.message }); }
    finally { setUploading(false); }
  };

  // ── Report: find files ─────────────────────────────────
  const handleFindFiles = async (e) => {
    e?.preventDefault();
    if (!instruction.trim()) return setMatchErr('Type an instruction first.');
    setMatching(true); setMatchErr(null);
    try {
      const res = await fetch('/api/files/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction, user_id: activeUserId }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Match failed');
      setMatchAll(json.all || []); setMatchPicked(new Set((json.matched || []).map((f) => f.id)));
      setMatchRationale(json.rationale || ''); setMatchActive(true);
    } catch (err) { setMatchErr(err.message); }
    finally { setMatching(false); }
  };

  const handleConfirmAndGenerate = async () => {
    if (!selectedTemplateId) return setGenerateErr('Select a template first.');
    if (matchPicked.size === 0) return setGenerateErr('Pick at least one source file.');
    setGenerating(true); setGenerateErr(null); setReport(null);
    try {
      const res = await fetch(`/api/report-templates/${selectedTemplateId}/generate-from-files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction, file_ids: Array.from(matchPicked), report_model: reportModel }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setReport({ text: json.report, templateName: json.template_filename, usedFiles: json.used_files });
    } catch (err) { setGenerateErr(err.message); }
    finally { setGenerating(false); }
  };

  const handleGenerate = async (e) => {
    e?.preventDefault();
    if (!selectedTemplateId) return setGenerateErr('Select a template first.');
    if (!inputData.trim()) return setGenerateErr('Provide some input data.');
    setGenerating(true); setGenerateErr(null); setReport(null);
    try {
      const res = await fetch(`/api/report-templates/${selectedTemplateId}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input_data: inputData, report_model: reportModel }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      setReport({ text: json.report, templateName: json.template_filename });
    } catch (err) { setGenerateErr(err.message); }
    finally { setGenerating(false); }
  };

  const handleTemplateUpload = async (e) => {
    e.preventDefault();
    if (!templateFile) return setTemplateUploadMsg({ type: 'error', text: 'Choose a file first.' });
    setUploadingTemplate(true); setTemplateUploadMsg(null);
    try {
      const fd = new FormData(); fd.append('file', templateFile); fd.append('uploaded_by', activePart || 'Unknown');
      const res = await fetch('/api/report-templates', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setTemplateUploadMsg({ type: 'success', text: `Uploaded "${templateFile.name}".` });
      setTemplateFile(null); if (templateFileRef.current) templateFileRef.current.value = '';
      setShowTemplateUpload(false); loadTemplates();
    } catch (err) { setTemplateUploadMsg({ type: 'error', text: err.message }); }
    finally { setUploadingTemplate(false); }
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const togglePick = (id) => setMatchPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div className="wrap hub-wrap">
      {/* ── Hero search bar ──────────────────────────────── */}
      <div className="hub-hero">
        <h1 className="hub-title">Knowledge Hub</h1>
        <Typewriter />
        <form className="hub-search-bar" onSubmit={handleSearch}>
          <div className="hub-search-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </div>
          <input type="text" placeholder='Search documents… e.g. "action items from last sprint review"' value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="hub-upload-btn" type="button" title="Upload a document" onClick={() => setShowUpload(true)}>
            <IconUpload />
          </button>
          <button className="primary-btn hub-search-submit" type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
        </form>
      </div>

      {/* ── Sub-nav pills ────────────────────────────────── */}
      <div className="hub-subnav">
        <button className={`hub-subnav-btn${section === 'browse' ? ' active' : ''}`} onClick={() => setSection('browse')}>
          <IconSearch /> Browse
        </button>
        <button className={`hub-subnav-btn${section === 'library' ? ' active' : ''}`} onClick={() => setSection('library')}>
          <IconFolder /> All Files
          <span className="hub-subnav-count">{library.length}</span>
        </button>
        <button className={`hub-subnav-btn${section === 'reports' ? ' active' : ''}`} onClick={() => setSection('reports')}>
          <IconReport /> Reports
        </button>
      </div>

      {/* ════ BROWSE section ════════════════════════════════ */}
      {section === 'browse' && (
        <>
          {/* Search results */}
          {searching && <div className="state"><div className="spinner" /></div>}
          {searchErr && <div className="inline-msg error">{searchErr}</div>}
          {!searching && results && results.length === 0 && <div className="state-text" style={{ marginTop: 16 }}>No relevant documents found.</div>}
          {!searching && results && results.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">Search Results</h2>
              <div className="file-grid">{dedupeByFile(results).map((r) => <SearchResultCard key={r.id} result={r} />)}</div>
            </section>
          )}

          {/* Email inbox */}
          <section className="panel">
            <div className="panel-title-row">
              <h2 className="panel-title">Recent Emails</h2>
            </div>
            <GmailInbox
              activeUserId={activeUserId}
              onExtract={(p) => setPendingItems(p)}
              onAttachmentUploaded={loadLibrary}
            />
          </section>

          {/* Recent files */}
          {library.length > 0 && (
            <section className="panel">
              <div className="panel-title-row">
                <h2 className="panel-title">Recent Documents</h2>
                <button className="ghost-btn small" onClick={() => setSection('library')}>View all →</button>
              </div>
              <div className="library-list">
                {library.slice(0, 5).map((f) => (
                  <LibraryRow key={f.id} file={f} activeUserId={activeUserId}
                    onDeleted={(id) => setLibrary((c) => c.filter((x) => x.id !== id))}
                    onExtracted={(p) => setPendingItems(p)}
                    onLockChange={(u) => setLibrary((c) => c.map((x) => x.id === u.id ? { ...x, ...u } : x))}
                    onReplaced={(u) => setLibrary((c) => c.map((x) => x.id === u.id ? { ...x, ...u } : x))}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ════ LIBRARY section ═══════════════════════════════ */}
      {section === 'library' && (
        <section className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">{library.length} document{library.length === 1 ? '' : 's'}</h2>
            <button className="ghost-btn" onClick={loadLibrary} disabled={libraryLoading}>{libraryLoading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
          {libraryLoading && <div className="state"><div className="spinner" /></div>}
          {libraryErr && <div className="inline-msg error">{libraryErr}</div>}
          {!libraryLoading && !libraryErr && library.length === 0 && <div className="state-text" style={{ marginTop: 8 }}>No documents uploaded yet.</div>}
          {!libraryLoading && library.length > 0 && (
            <div className="library-list">
              {library.map((f) => (
                <LibraryRow key={f.id} file={f} activeUserId={activeUserId}
                  onDeleted={(id) => setLibrary((c) => c.filter((x) => x.id !== id))}
                  onExtracted={(p) => setPendingItems(p)}
                  onLockChange={(u) => setLibrary((c) => c.map((x) => x.id === u.id ? { ...x, ...u } : x))}
                  onReplaced={(u) => setLibrary((c) => c.map((x) => x.id === u.id ? { ...x, ...u } : x))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ════ REPORTS section ═══════════════════════════════ */}
      {section === 'reports' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <ModelDropdown value={reportModel} onChange={setReportModel} />
          </div>

          {/* Templates */}
          <section className="panel">
            <div className="panel-title-row">
              <h2 className="panel-title">Templates · {templates.length}</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ghost-btn small" onClick={() => setShowTemplateUpload((v) => !v)}>{showTemplateUpload ? 'Cancel' : 'Upload Template'}</button>
                <button className="ghost-btn small" onClick={loadTemplates} disabled={loadingTemplates}>{loadingTemplates ? 'Loading…' : 'Refresh'}</button>
              </div>
            </div>
            {showTemplateUpload && (
              <form className="upload-form" onSubmit={handleTemplateUpload} style={{ marginBottom: 12 }}>
                <div className="form-row"><label>Template file</label><input ref={templateFileRef} type="file" accept=".pdf,.docx,.pptx,.txt,.md" onChange={(e) => setTemplateFile(e.target.files?.[0] || null)} /></div>
                <button className="primary-btn" disabled={uploadingTemplate} type="submit">{uploadingTemplate ? 'Uploading…' : 'Upload'}</button>
                {templateUploadMsg && <div className={`inline-msg ${templateUploadMsg.type}`}>{templateUploadMsg.text}</div>}
              </form>
            )}
            {templates.length > 0 && (
              <div className="library-list">
                {templates.map((t) => (
                  <div key={t.id} className={`library-row ${selectedTemplateId === t.id ? 'selected' : ''}`}>
                    <div className="library-row-icon"><FileIcon ext={t.filetype} /></div>
                    <div className="library-row-main">
                      <div className="library-row-title">{t.filename}</div>
                      <div className="library-row-meta"><span>By <strong>{t.uploaded_by}</strong></span><span>·</span><span>{formatDate(t.uploaded_at)}</span></div>
                    </div>
                    <button className={selectedTemplateId === t.id ? 'primary-btn' : 'ghost-btn'} onClick={() => { setSelectedTemplateId(t.id); setReport(null); setGenerateErr(null); }}>
                      {selectedTemplateId === t.id ? 'Selected' : 'Use this'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Generate from files */}
          <section className="panel">
            <h2 className="panel-title">Generate Report {selectedTemplate ? `· ${selectedTemplate.filename}` : ''}</h2>
            {!selectedTemplateId && <div className="state-text" style={{ marginBottom: 12 }}>Pick a template above first.</div>}

            <form className="upload-form" onSubmit={handleFindFiles} style={{ marginBottom: 18 }}>
              <div className="form-row">
                <label>Describe your report — Kernel will pick matching files</label>
                <textarea className="search-input" style={{ minHeight: 70, resize: 'vertical', padding: 12 }} placeholder='e.g. "Make a Q1 summary from Vision CoE monthly reports"' value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={matching} />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="primary-btn" type="submit" disabled={matching || !instruction.trim()}>{matching ? 'Finding files…' : 'Find matching files'}</button>
                {matchActive && <button type="button" className="ghost-btn" onClick={() => { setMatchActive(false); setMatchPicked(new Set()); setMatchAll([]); setMatchRationale(''); }}>Clear match</button>}
              </div>
              {matchErr && <div className="inline-msg error">{matchErr}</div>}
            </form>

            {matchActive && (
              <div className="panel" style={{ marginBottom: 18, padding: 14, background: 'var(--surface-2)' }}>
                <h3 className="panel-title" style={{ fontSize: 14 }}>{matchPicked.size} of {matchAll.length} file{matchAll.length === 1 ? '' : 's'} selected</h3>
                {matchRationale && <div className="sub" style={{ fontSize: 12, marginBottom: 10 }}><em>{matchRationale}</em></div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                  {matchAll.map((f) => {
                    const checked = matchPicked.has(f.id);
                    return (
                      <label key={f.id} className="checkbox-pill" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: checked ? 'var(--blue-soft-2)' : 'var(--surface)', border: `1px solid ${checked ? 'rgba(59,130,246,.45)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={checked} onChange={() => togglePick(f.id)} style={{ marginTop: 3 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>{f.filename}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{f.uploaded_by} · {formatDate(f.uploaded_at)}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="primary-btn" onClick={handleConfirmAndGenerate} disabled={!selectedTemplateId || matchPicked.size === 0 || generating}>
                    {generating ? 'Generating…' : `Generate from ${matchPicked.size} file${matchPicked.size === 1 ? '' : 's'}`}
                  </button>
                  <button type="button" className="ghost-btn small" onClick={() => setMatchPicked(new Set(matchAll.map((f) => f.id)))}>Select all</button>
                  <button type="button" className="ghost-btn small" onClick={() => setMatchPicked(new Set())}>Clear</button>
                </div>
              </div>
            )}

            <div className="sub" style={{ fontSize: 12, marginBottom: 6 }}>Or paste your own input below:</div>
            <form className="upload-form" onSubmit={handleGenerate}>
              <div className="form-row">
                <label>Input data</label>
                <textarea className="search-input" style={{ minHeight: 120, resize: 'vertical', padding: 12 }} placeholder="Paste facts, notes, or context…" value={inputData} onChange={(e) => setInputData(e.target.value)} disabled={!selectedTemplateId || generating} />
              </div>
              <button className="primary-btn" type="submit" disabled={!selectedTemplateId || generating}>{generating ? 'Generating…' : 'Generate report'}</button>
              {generateErr && <div className="inline-msg error">{generateErr}</div>}
            </form>

            {generating && <div className="state"><div className="spinner" /></div>}
            {report && (
              <div className="report-output">
                {report.usedFiles?.length > 0 && <div className="sub" style={{ marginTop: 16, fontSize: 12 }}>Built from {report.usedFiles.length} file{report.usedFiles.length === 1 ? '' : 's'}: {report.usedFiles.map((f) => f.filename).join(', ')}</div>}
                <div className="panel-title-row" style={{ marginTop: 8 }}>
                  <h3 className="panel-title">Generated report</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="ghost-btn" onClick={() => navigator.clipboard.writeText(report.text)}>Copy HTML</button>
                    <button className="ghost-btn" onClick={() => window.print()}>Print</button>
                    <button className="ghost-btn" onClick={() => { const base = report.templateName.replace(/\.[^.]+$/, ''); downloadText(`${base}-${new Date().toISOString().slice(0, 10)}.html`, report.text); }}>Download .html</button>
                    <button className="primary-btn" disabled={downloadingDocx} onClick={async () => {
                      setDownloadingDocx(true); setDownloadErr(null);
                      try { await downloadDocx(`${report.templateName.replace(/\.[^.]+$/, '')}-${new Date().toISOString().slice(0, 10)}.docx`, report.text); }
                      catch (e) { setDownloadErr(e.message); }
                      finally { setDownloadingDocx(false); }
                    }}>{downloadingDocx ? 'Preparing…' : 'Download .docx'}</button>
                  </div>
                </div>
                {downloadErr && <div className="inline-msg error" style={{ marginTop: 8 }}>{downloadErr}</div>}
                <div className="report-preview md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(report.text) }} />
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Upload modal overlay ──────────────────────────── */}
      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2 className="modal-title">Upload Document</h2>
              <button className="modal-close" onClick={() => { setShowUpload(false); setUploadMsg(null); }}>×</button>
            </div>
            <form className="upload-form" onSubmit={handleUpload}>
              <div className="form-row"><label>File</label><input ref={fileInputRef} type="file" accept=".pdf,.docx,.pptx,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
              {isMD ? (
                <div className="form-row"><label>Accessible to</label>
                  <div className="checkbox-row">
                    {[...parts, 'Team 1', 'Team 2', 'Team 3'].map((p) => (
                      <label key={p} className="checkbox-pill"><input type="checkbox" checked={accessibleTo.includes(p)} onChange={() => toggleAccessible(p)} /><span>{p}</span></label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="form-row"><label>Visibility</label><div className="sub" style={{ fontSize: 13 }}>Visible to <strong>{userScope || 'your scope'}</strong>.</div></div>
              )}
              <div className="form-row">
                <label className="checkbox-pill" style={{ alignSelf: 'flex-start' }}>
                  <input type="checkbox" checked={extractActions} onChange={(e) => setExtractActions(e.target.checked)} />
                  <span>Extract action items from this document</span>
                </label>
              </div>
              <button className="primary-btn" disabled={uploading} type="submit">{uploading ? 'Uploading…' : 'Upload & Index'}</button>
              {uploadMsg && <div className={`inline-msg ${uploadMsg.type}`}>{uploadMsg.text}</div>}
            </form>
          </div>
        </div>
      )}

      {/* Action item review modal */}
      {pendingItems && (
        <ActionItemReviewModal pending={pendingItems} users={users} activeUserId={activeUserId}
          onClose={() => setPendingItems(null)}
          onSaved={() => { setPendingItems(null); setUploadMsg({ type: 'success', text: 'Action items saved.' }); }}
        />
      )}
    </div>
  );
}
