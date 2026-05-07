import { useEffect, useRef, useState } from 'react';
import { renderPdfThumbnail } from '../lib/pdfPreview.js';

function FileIcon({ ext }) {
  const e = (ext || '').toUpperCase();
  return (
    <div className="file-icon">
      <div className="file-icon-doc" />
      <div className="file-icon-label">{e || 'DOC'}</div>
    </div>
  );
}

function PdfThumb({ url }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    renderPdfThumbnail(url, 220)
      .then((d) => { if (!cancelled) setSrc(d); })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [url]);
  if (err) return <FileIcon ext="PDF" />;
  if (!src) return <div className="file-thumb-placeholder">Loading preview…</div>;
  return <img className="file-thumb" src={src} alt="PDF preview" />;
}

function FileCard({ result }) {
  const ext = (result.filetype || '').toLowerCase();
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const handleSummarize = () => {
    setSummaryLoading(true);
    // Simulate a brief processing delay so the UX feels real.
    setTimeout(() => {
      setShowSummary(true);
      setSummaryLoading(false);
    }, 600);
  };

  // Compose a slightly fuller "AI summary" from available fields.
  const fullSummary =
    result.chunk_summary ||
    (result.chunk_text || '').slice(0, 600);

  return (
    <article className="file-card file-card-result">
      <div className="file-card-preview">
        {ext.includes('pdf') ? <PdfThumb url={result.file_url} /> : <FileIcon ext={ext} />}
      </div>
      <div className="file-card-body">
        <div className="meta">
          {result.uploaded_by} · Chunk #{result.chunk_index}
        </div>
        <div className="file-card-title">{result.filename}</div>
        <p className="summary">
          {result.chunk_summary || (result.chunk_text || '').slice(0, 240) + '…'}
        </p>
        {showSummary && (
          <div className="ai-summary-panel">
            <div className="ai-summary-label">AI Summary</div>
            <p>{fullSummary}</p>
          </div>
        )}
        <div className="file-card-actions">
          <a className="more" href={result.file_url} target="_blank" rel="noopener noreferrer" download>
            Download ↓
          </a>
          <button
            className="ghost-btn small"
            onClick={handleSummarize}
            disabled={summaryLoading || showSummary}
          >
            {summaryLoading ? 'Summarising…' : showSummary ? 'Summary shown' : 'Get summary'}
          </button>
        </div>
      </div>
    </article>
  );
}

// ---------- Inbox (mock) ----------
const MOCK_EMAILS = [
  {
    id: 'em1',
    sender: 'priya.rao@company.com',
    subject: 'Q2 Tech Roadmap Sync — notes & next steps',
    preview:
      'Thanks all for the call. Action items: (1) Arjun to circulate the revised PRISM scope by Friday, (2) Karan to validate the synthetic-data licensing path, (3) PMO to lock dates for the May review. Slides attached.',
    attachment: 'Q2-roadmap-sync.pdf',
  },
  {
    id: 'em2',
    sender: 'newsletter@arxiv-digest.com',
    subject: 'Weekly digest: 12 new papers in retrieval & RAG',
    preview:
      'This week: HyDE++ shows 9% recall@10 lift on BEIR, ColBERT-v3 release notes, and a new survey on hybrid sparse-dense retrieval. Full PDFs attached for the top-3.',
    attachment: 'arxiv-digest-w17.pdf',
  },
  {
    id: 'em3',
    sender: 'vendor@nv-partners.com',
    subject: 'Jetson AGX dev kits — delivery confirmation',
    preview:
      'Your 4 dev kits ship Monday. Please confirm the receiving contact and have the team review the attached unboxing checklist before first-power-on. Replies welcome.',
    attachment: 'jetson-onboarding.pdf',
  },
];

function InboxSection({ onAction }) {
  const [statuses, setStatuses] = useState({}); // { [id]: { added?: bool, extracted?: number } }
  const [open, setOpen] = useState(false);

  const handleAdd = (email) => {
    setStatuses((s) => ({ ...s, [email.id]: { ...(s[email.id] || {}), added: true } }));
    onAction?.({ type: 'added', email });
  };
  const handleExtract = (email) => {
    // Heuristic: count 'Action items'/numbered list items in the preview.
    const numbered = (email.preview.match(/\(\d\)/g) || []).length;
    const count = numbered > 0 ? numbered : 2;
    setStatuses((s) => ({ ...s, [email.id]: { ...(s[email.id] || {}), extracted: count } }));
    onAction?.({ type: 'extracted', email, count });
  };

  return (
    <section className="panel">
      <div
        className={`inbox-header ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((o) => !o)}
      >
        <div className="inbox-header-left">
          <span className="inbox-icon">📬</span>
          <h2 className="panel-title" style={{ margin: 0 }}>Inbox</h2>
          <span className="inbox-count">{MOCK_EMAILS.length} unread</span>
        </div>
        <button className="ghost-btn small" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          {open ? 'Hide' : 'View emails'}
        </button>
      </div>
      {!open && (
        <div className="inbox-collapsed-hint">
          Click to view {MOCK_EMAILS.length} new emails — add their content to the Knowledge Hub or extract action items.
        </div>
      )}
      {open && (
      <div className="inbox-list">
        {MOCK_EMAILS.map((em) => {
          const s = statuses[em.id] || {};
          return (
            <div key={em.id} className="inbox-item">
              <div className="inbox-meta">
                <span className="inbox-sender">{em.sender}</span>
                {em.attachment && <span className="inbox-attachment">📎 {em.attachment}</span>}
              </div>
              <div className="inbox-subject">{em.subject}</div>
              <p className="inbox-preview">{em.preview}</p>
              <div className="inbox-actions">
                <button
                  className="ghost-btn small"
                  onClick={() => handleAdd(em)}
                  disabled={s.added}
                >
                  {s.added ? '✓ Added to Knowledge Hub' : 'Add to Knowledge Hub'}
                </button>
                <button
                  className="ghost-btn small"
                  onClick={() => handleExtract(em)}
                  disabled={s.extracted != null}
                >
                  {s.extracted != null
                    ? `✓ ${s.extracted} action items extracted`
                    : 'Extract Action Items'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

function dedupeByFile(chunks) {
  const seen = new Map();
  for (const c of chunks) {
    if (!seen.has(c.file_id)) seen.set(c.file_id, c);
  }
  return Array.from(seen.values());
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
                <button
                  className="ghost-btn small danger"
                  onClick={() => removeItem(idx)}
                  title="Remove this item"
                >×</button>
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
                      style={{
                        background: checked ? '#dbeafe' : '#f3f4f6',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignee(idx, u.id)}
                      />
                      <span>{u.name}{u.id === activeUserId ? ' (you)' : ''}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="state-text" style={{ padding: 20, textAlign: 'center' }}>
              All items removed.
            </div>
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

export default function RetrievalTab({ parts, activePart, users = [], activeUserId }) {
  const activeUser = users.find((u) => u.id === activeUserId);
  const isMD = activeUser?.role === 'MD';
  const userScope = activeUser?.part || activeUser?.team || null;

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState(null);
  const [accessibleTo, setAccessibleTo] = useState([]); // MD only
  const [extractActions, setExtractActions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const fileInputRef = useRef(null);

  // Search state
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [searchErr, setSearchErr] = useState(null);
  const searchPart = activePart;

  // Pending action-items review (post-upload).
  const [pendingItems, setPendingItems] = useState(null);

  const toggleAccessible = (p) =>
    setAccessibleTo((curr) => (curr.includes(p) ? curr.filter((x) => x !== p) : [...curr, p]));

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return setUploadMsg({ type: 'error', text: 'Choose a file first.' });
    if (!activeUserId) return setUploadMsg({ type: 'error', text: 'No active user.' });
    if (isMD && accessibleTo.length === 0) {
      return setUploadMsg({ type: 'error', text: 'Pick at least one Part/Team that should see this document.' });
    }

    setUploading(true);
    setUploadMsg({ type: 'info', text: 'Uploading and processing — this can take 30–90s for larger files…' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('user_id', activeUserId);
      if (isMD) fd.append('accessible_to', JSON.stringify(accessibleTo));
      fd.append('extract_action_items', String(extractActions));
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setUploadMsg({
        type: 'success',
        text: `Uploaded "${file.name}" — ${json.chunk_count} chunks indexed.`,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // If extraction was requested and items came back, open the review modal.
      if (json.pending_action_items && (json.pending_action_items.items || []).length > 0) {
        setPendingItems(json.pending_action_items);
      } else if (extractActions && json.pending_action_items && json.pending_action_items.items.length === 0) {
        setUploadMsg({ type: 'info', text: 'No action items found in this document.' });
      }
    } catch (err) {
      setUploadMsg({ type: 'error', text: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    if (!activeUserId) return setSearchErr('No active user.');
    setSearching(true);
    setSearchErr(null);
    setResults(null);
    try {
      const res = await fetch('/api/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, user_id: activeUserId, mode: 'files' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.chunks || []);
    } catch (err) {
      setSearchErr(err.message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Knowledge Hub</h1>
          <div className="sub">Search your team's documents in plain English, triage your inbox, and grow the shared library.</div>
        </div>
      </div>

      {/* INBOX */}
      <InboxSection />


      {/* 1. SEARCH FIRST */}
      <section className="panel">
        <h2 className="panel-title">Search · {isMD ? 'All documents' : (userScope || '…')}</h2>
        <form className="search-form" onSubmit={handleSearch}>
          <input
            className="search-input"
            type="text"
            placeholder='e.g. "action items from last sprint review"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="primary-btn" type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searching && <div className="state"><div className="spinner" /></div>}
        {searchErr && <div className="inline-msg error">{searchErr}</div>}
        {!searching && results && results.length === 0 && (
          <div className="state-text" style={{ marginTop: 16 }}>
            No relevant documents found for this query.
          </div>
        )}
        {!searching && results && results.length > 0 && (
          <div className="file-grid">
            {dedupeByFile(results).map((r) => <FileCard key={r.id} result={r} />)}
          </div>
        )}
      </section>

      {/* 2. UPLOAD PROMPT (collapsible) */}
      <section className="panel upload-prompt-panel">
        {!showUpload ? (
          <div className="upload-prompt">
            <div>
              <div className="upload-prompt-title">Have a document to add to the library?</div>
              <div className="upload-prompt-sub">PDF, DOCX, PPTX, TXT or Excel (XLSX) — up to 30 MB.</div>
            </div>
            <button className="primary-btn" onClick={() => setShowUpload(true)}>
              Upload a document
            </button>
          </div>
        ) : (
          <>
            <div className="panel-title-row">
              <h2 className="panel-title">Upload</h2>
              <button className="ghost-btn" onClick={() => { setShowUpload(false); setUploadMsg(null); }}>
                Cancel
              </button>
            </div>
            <form className="upload-form" onSubmit={handleUpload}>
              <div className="form-row">
                <label>File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              {isMD ? (
                <div className="form-row">
                  <label>Accessible to</label>
                  <div className="checkbox-row">
                    {[...parts, 'Team 1', 'Team 2', 'Team 3'].map((p) => (
                      <label key={p} className="checkbox-pill">
                        <input
                          type="checkbox"
                          checked={accessibleTo.includes(p)}
                          onChange={() => toggleAccessible(p)}
                        />
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="form-row">
                  <label>Visibility</label>
                  <div className="sub" style={{ fontSize: 13 }}>
                    This document will be visible to members of <strong>{userScope || 'your scope'}</strong>.
                  </div>
                </div>
              )}
              <div className="form-row">
                <label className="checkbox-pill" style={{ alignSelf: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={extractActions}
                    onChange={(e) => setExtractActions(e.target.checked)}
                  />
                  <span>Extract action items from this document</span>
                </label>
              </div>
              <button className="primary-btn" disabled={uploading} type="submit">
                {uploading ? 'Uploading…' : 'Upload & Index'}
              </button>
              {uploadMsg && <div className={`inline-msg ${uploadMsg.type}`}>{uploadMsg.text}</div>}
            </form>
          </>
        )}
      </section>

      {pendingItems && (
        <ActionItemReviewModal
          pending={pendingItems}
          users={users}
          activeUserId={activeUserId}
          onClose={() => setPendingItems(null)}
          onSaved={() => {
            setPendingItems(null);
            setUploadMsg({ type: 'success', text: 'Action items saved.' });
          }}
        />
      )}
    </div>
  );
}
