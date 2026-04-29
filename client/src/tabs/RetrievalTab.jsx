import { useCallback, useEffect, useRef, useState } from 'react';
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
  return (
    <article className="file-card">
      <div className="file-card-preview">
        {ext.includes('pdf') ? <PdfThumb url={result.file_url} /> : <FileIcon ext={ext} />}
      </div>
      <div className="file-card-body">
        <div className="meta">
          {result.uploaded_by} · Chunk #{result.chunk_index}
        </div>
        <div className="file-card-title">{result.filename}</div>
        <p className="summary">{result.chunk_summary || result.chunk_text.slice(0, 240) + '…'}</p>
        <div className="file-card-actions">
          <a className="more" href={result.file_url} target="_blank" rel="noopener noreferrer" download>
            Download ↓
          </a>
        </div>
      </div>
    </article>
  );
}

function dedupeByFile(chunks) {
  const seen = new Map();
  for (const c of chunks) {
    if (!seen.has(c.file_id)) seen.set(c.file_id, c);
  }
  return Array.from(seen.values());
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function LibraryRow({ file, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState(null);
  const ext = (file.filetype || '').toLowerCase();

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
        {err && <div className="inline-msg error" style={{ marginTop: 8 }}>{err}</div>}
      </div>
      <div className="library-row-actions">
        <a className="ghost-btn" href={file.file_url} target="_blank" rel="noopener noreferrer" download>
          Download
        </a>
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
          <button className="ghost-btn small danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function RetrievalTab({ parts, activePart }) {
  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState(null);
  const [uploadedBy, setUploadedBy] = useState('');
  const [accessibleTo, setAccessibleTo] = useState([]);
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

  // Library
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryErr, setLibraryErr] = useState(null);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryErr(null);
    try {
      const res = await fetch('/api/files');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setLibrary(json.files || []);
    } catch (err) {
      setLibraryErr(err.message);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (parts.length) {
      setUploadedBy((p) => p || activePart || parts[0]);
    }
  }, [parts, activePart]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const toggleAccessible = (p) =>
    setAccessibleTo((curr) => (curr.includes(p) ? curr.filter((x) => x !== p) : [...curr, p]));

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return setUploadMsg({ type: 'error', text: 'Choose a file first.' });
    if (!uploadedBy) return setUploadMsg({ type: 'error', text: 'Pick an "uploaded by" Part.' });
    if (accessibleTo.length === 0) return setUploadMsg({ type: 'error', text: 'Select at least one Part with access.' });

    setUploading(true);
    setUploadMsg({ type: 'info', text: 'Uploading and processing — this can take 30–90s for larger files…' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploaded_by', uploadedBy);
      fd.append('accessible_to', JSON.stringify(accessibleTo));
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
      loadLibrary();
    } catch (err) {
      setUploadMsg({ type: 'error', text: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    if (!searchPart) return setSearchErr('Select a Part to search within.');
    setSearching(true);
    setSearchErr(null);
    setResults(null);
    try {
      const res = await fetch('/api/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, part: searchPart, mode: 'files' }),
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
          <h1>Smart File Retrieval</h1>
          <div className="sub">Search your team's documents in plain English.</div>
        </div>
      </div>

      {/* 1. SEARCH FIRST */}
      <section className="panel">
        <h2 className="panel-title">Search · {searchPart}</h2>
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
              <div className="upload-prompt-sub">PDF, DOCX, PPTX or TXT — up to 30 MB.</div>
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
                  accept=".pdf,.docx,.pptx,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="form-row">
                <label>Uploaded by</label>
                <select value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)}>
                  {parts.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Accessible to</label>
                <div className="checkbox-row">
                  {parts.map((p) => (
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

      {/* 3. LIBRARY */}
      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Library · {library.length} document{library.length === 1 ? '' : 's'}</h2>
          <button className="ghost-btn" onClick={loadLibrary} disabled={libraryLoading}>
            {libraryLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {libraryLoading && <div className="state"><div className="spinner" /></div>}
        {libraryErr && <div className="inline-msg error">{libraryErr}</div>}
        {!libraryLoading && !libraryErr && library.length === 0 && (
          <div className="state-text" style={{ marginTop: 8 }}>
            No documents uploaded yet.
          </div>
        )}
        {!libraryLoading && library.length > 0 && (
          <div className="library-list">
            {library.map((f) => (
              <LibraryRow
                key={f.id}
                file={f}
                onDeleted={(id) => setLibrary((curr) => curr.filter((x) => x.id !== id))}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
