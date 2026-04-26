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

export default function RetrievalTab({ parts }) {
  // Upload state
  const [file, setFile] = useState(null);
  const [uploadedBy, setUploadedBy] = useState('');
  const [accessibleTo, setAccessibleTo] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const fileInputRef = useRef(null);

  // Search state
  const [query, setQuery] = useState('');
  const [searchPart, setSearchPart] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [searchErr, setSearchErr] = useState(null);

  useEffect(() => {
    if (parts.length) {
      setUploadedBy((p) => p || parts[0]);
      setSearchPart((p) => p || parts[0]);
    }
  }, [parts]);

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
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setUploadMsg({
        type: 'success',
        text: `Uploaded "${file.name}" — ${json.chunk_count} chunks indexed.`,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
          <div className="sub">Upload documents and search them in plain English.</div>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel-title">Upload</h2>
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
          <button className="primary-btn" disabled={uploading} type="submit">
            {uploading ? 'Uploading…' : 'Upload & Index'}
          </button>
          {uploadMsg && <div className={`inline-msg ${uploadMsg.type}`}>{uploadMsg.text}</div>}
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">Search</h2>
        <form className="search-form" onSubmit={handleSearch}>
          <input
            className="search-input"
            type="text"
            placeholder='e.g. "action items from last sprint review"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={searchPart} onChange={(e) => setSearchPart(e.target.value)}>
            {parts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="primary-btn" type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searching && (
          <div className="state"><div className="spinner" /></div>
        )}
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
    </div>
  );
}
