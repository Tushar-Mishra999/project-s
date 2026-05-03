import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadText(filename, text) {
  triggerDownload(filename, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
}

async function downloadDocx(filename, markdown) {
  const res = await fetch('/api/render-docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, filename }),
  });
  if (!res.ok) {
    let msg = `Server returned ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  triggerDownload(filename, blob);
}

function TemplateRow({ tmpl, isSelected, onSelect, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/report-templates/${tmpl.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      onDeleted(tmpl.id);
    } catch (e) {
      alert(e.message);
      setDeleting(false);
    }
  };

  return (
    <div className={`library-row ${isSelected ? 'selected' : ''}`}>
      <div className="library-row-icon">
        <div className="file-icon">
          <div className="file-icon-doc" />
          <div className="file-icon-label">{(tmpl.filetype || 'DOC').toUpperCase()}</div>
        </div>
      </div>
      <div className="library-row-main">
        <div className="library-row-title">{tmpl.filename}</div>
        <div className="library-row-meta">
          <span>By <strong>{tmpl.uploaded_by}</strong></span>
          <span>·</span>
          <span>{formatDate(tmpl.uploaded_at)}</span>
        </div>
      </div>
      <div className="library-row-actions">
        <button
          className={isSelected ? 'primary-btn' : 'ghost-btn'}
          onClick={onSelect}
        >
          {isSelected ? 'Selected' : 'Use this'}
        </button>
        {confirming ? (
          <>
            <button className="ghost-btn small danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Confirm'}
            </button>
            <button className="ghost-btn small" onClick={() => setConfirming(false)}>Cancel</button>
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

export default function ReportGeneratorTab({ activePart, activeUserId }) {
  // Templates list
  const [templates, setTemplates] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listErr, setListErr] = useState(null);

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const fileInputRef = useRef(null);

  // Generate state
  const [selectedId, setSelectedId] = useState(null);
  const [inputData, setInputData] = useState('');
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);
  const [generateErr, setGenerateErr] = useState(null);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadErr, setDownloadErr] = useState(null);

  // NL "describe your report" flow
  const [instruction, setInstruction] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchErr, setMatchErr] = useState(null);
  const [matchAll, setMatchAll] = useState([]);   // every file in scope
  const [matchPicked, setMatchPicked] = useState(new Set()); // ids checked
  const [matchRationale, setMatchRationale] = useState('');
  const [matchActive, setMatchActive] = useState(false);

  const handleFindFiles = async (e) => {
    e?.preventDefault();
    if (!instruction.trim()) return setMatchErr('Type an instruction first.');
    setMatching(true);
    setMatchErr(null);
    try {
      const res = await fetch('/api/files/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, user_id: activeUserId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Match failed (${res.status})`);
      setMatchAll(json.all || []);
      setMatchPicked(new Set((json.matched || []).map((f) => f.id)));
      setMatchRationale(json.rationale || '');
      setMatchActive(true);
    } catch (err) {
      setMatchErr(err.message);
    } finally {
      setMatching(false);
    }
  };

  const togglePick = (id) => {
    setMatchPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirmAndGenerate = async () => {
    if (!selectedId) return setGenerateErr('Select a template first.');
    if (matchPicked.size === 0) return setGenerateErr('Pick at least one source file.');
    setGenerating(true);
    setGenerateErr(null);
    setReport(null);
    try {
      const res = await fetch(`/api/report-templates/${selectedId}/generate-from-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, file_ids: Array.from(matchPicked) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Generation failed (${res.status})`);
      setReport({ text: json.report, templateName: json.template_filename, usedFiles: json.used_files });
    } catch (err) {
      setGenerateErr(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const loadTemplates = useCallback(async () => {
    setLoadingList(true);
    setListErr(null);
    try {
      const res = await fetch('/api/report-templates');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server returned ${res.status}`);
      setTemplates(json.templates || []);
    } catch (err) {
      setListErr(err.message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return setUploadMsg({ type: 'error', text: 'Choose a template file first.' });
    setUploading(true);
    setUploadMsg({ type: 'info', text: 'Uploading template…' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploaded_by', activePart || 'Unknown');
      const res = await fetch('/api/report-templates', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setUploadMsg({ type: 'success', text: `Uploaded "${file.name}" as a template.` });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowUpload(false);
      loadTemplates();
    } catch (err) {
      setUploadMsg({ type: 'error', text: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async (e) => {
    e?.preventDefault();
    if (!selectedId) return setGenerateErr('Select a template first.');
    if (!inputData.trim()) return setGenerateErr('Provide some input data.');
    setGenerating(true);
    setGenerateErr(null);
    setReport(null);
    try {
      const res = await fetch(`/api/report-templates/${selectedId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_data: inputData }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Generation failed (${res.status})`);
      setReport({ text: json.report, templateName: json.template_filename });
    } catch (err) {
      setGenerateErr(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const selected = templates.find((t) => t.id === selectedId);

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Report Generator</h1>
          <div className="sub">
            Upload a template once, then generate filled reports from your input data.
          </div>
        </div>
      </div>

      {/* Templates list */}
      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Templates · {templates.length}</h2>
          <button className="ghost-btn" onClick={loadTemplates} disabled={loadingList}>
            {loadingList ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {loadingList && <div className="state"><div className="spinner" /></div>}
        {listErr && <div className="inline-msg error">{listErr}</div>}
        {!loadingList && !listErr && templates.length === 0 && (
          <div className="state-text" style={{ marginTop: 8 }}>
            No templates uploaded yet. Upload one below to get started.
          </div>
        )}
        {!loadingList && templates.length > 0 && (
          <div className="library-list">
            {templates.map((t) => (
              <TemplateRow
                key={t.id}
                tmpl={t}
                isSelected={selectedId === t.id}
                onSelect={() => { setSelectedId(t.id); setReport(null); setGenerateErr(null); }}
                onDeleted={(id) => {
                  setTemplates((curr) => curr.filter((x) => x.id !== id));
                  if (selectedId === id) setSelectedId(null);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Upload prompt */}
      <section className="panel upload-prompt-panel">
        {!showUpload ? (
          <div className="upload-prompt">
            <div>
              <div className="upload-prompt-title">Add a new template</div>
              <div className="upload-prompt-sub">PDF, DOCX, PPTX, TXT or MD — used as the report's structure.</div>
            </div>
            <button className="primary-btn" onClick={() => setShowUpload(true)}>
              Upload template
            </button>
          </div>
        ) : (
          <>
            <div className="panel-title-row">
              <h2 className="panel-title">Upload template</h2>
              <button className="ghost-btn" onClick={() => { setShowUpload(false); setUploadMsg(null); }}>
                Cancel
              </button>
            </div>
            <form className="upload-form" onSubmit={handleUpload}>
              <div className="form-row">
                <label>Template file</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,.md"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
              <button className="primary-btn" disabled={uploading} type="submit">
                {uploading ? 'Uploading…' : 'Upload template'}
              </button>
              {uploadMsg && <div className={`inline-msg ${uploadMsg.type}`}>{uploadMsg.text}</div>}
            </form>
          </>
        )}
      </section>

      {/* Generate */}
      <section className="panel">
        <h2 className="panel-title">
          Generate report {selected ? `· using ${selected.filename}` : ''}
        </h2>
        {!selectedId && (
          <div className="state-text" style={{ marginBottom: 12 }}>
            Pick a template from the list above first.
          </div>
        )}

        {/* NL flow */}
        <form className="upload-form" onSubmit={handleFindFiles} style={{ marginBottom: 18 }}>
          <div className="form-row">
            <label>Describe your report — Kernel will pick matching files from the Library</label>
            <textarea
              className="search-input"
              style={{ minHeight: 70, resize: 'vertical', padding: 12 }}
              placeholder='e.g. "Make a Q1 summary from the Vision CoE monthly reports" or "Summarise all PMO submissions from April."'
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={matching}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="primary-btn" type="submit" disabled={matching || !instruction.trim()}>
              {matching ? 'Finding files…' : 'Find matching files'}
            </button>
            {matchActive && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => { setMatchActive(false); setMatchPicked(new Set()); setMatchAll([]); setMatchRationale(''); }}
              >
                Clear match
              </button>
            )}
          </div>
          {matchErr && <div className="inline-msg error">{matchErr}</div>}
        </form>

        {matchActive && (
          <div className="panel" style={{ marginBottom: 18, padding: 14, background: 'var(--surface-2)' }}>
            <div className="panel-title-row" style={{ marginBottom: 8 }}>
              <h3 className="panel-title" style={{ fontSize: 14 }}>
                {matchPicked.size} of {matchAll.length} file{matchAll.length === 1 ? '' : 's'} selected
              </h3>
            </div>
            {matchRationale && (
              <div className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
                <em>{matchRationale}</em>
              </div>
            )}
            {matchAll.length === 0 ? (
              <div className="state-text">No files in your scope.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                {matchAll.map((f) => {
                  const checked = matchPicked.has(f.id);
                  return (
                    <label
                      key={f.id}
                      className="checkbox-pill"
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 12px',
                        background: checked ? 'var(--blue-soft-2)' : 'var(--surface)',
                        border: `1px solid ${checked ? 'rgba(59,130,246,.45)' : 'var(--border)'}`,
                        borderRadius: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePick(f.id)}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>{f.filename}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {f.uploaded_by} · {formatDate(f.uploaded_at)}
                          {Array.isArray(f.accessible_to) && f.accessible_to.length
                            ? ` · ${f.accessible_to.join(', ')}`
                            : ''}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                className="primary-btn"
                onClick={handleConfirmAndGenerate}
                disabled={!selectedId || matchPicked.size === 0 || generating}
              >
                {generating ? 'Generating…' : `Confirm & generate from ${matchPicked.size} file${matchPicked.size === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => setMatchPicked(new Set(matchAll.map((f) => f.id)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => setMatchPicked(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="sub" style={{ fontSize: 12, marginBottom: 6 }}>
          Or paste your own input below:
        </div>
        <form className="upload-form" onSubmit={handleGenerate}>
          <div className="form-row">
            <label>Input data — paste the facts, notes, or context you want written up</label>
            <textarea
              className="search-input"
              style={{ minHeight: 180, resize: 'vertical', padding: 12 }}
              placeholder="e.g. Sprint #14 ran from 14–28 April. Team: Arjun, Priya, Karan. Delivered: search reranker, file-delete API. Blockers: Voyage rate-limit, Firecrawl quota. Next sprint: ship Reports Tab."
              value={inputData}
              onChange={(e) => setInputData(e.target.value)}
              disabled={!selectedId || generating}
            />
          </div>
          <button className="primary-btn" type="submit" disabled={!selectedId || generating}>
            {generating ? 'Generating…' : 'Generate report'}
          </button>
          {generateErr && <div className="inline-msg error">{generateErr}</div>}
        </form>

        {generating && <div className="state"><div className="spinner" /></div>}

        {report && (
          <div className="report-output">
            {report.usedFiles && report.usedFiles.length > 0 && (
              <div className="sub" style={{ marginTop: 16, fontSize: 12 }}>
                Built from {report.usedFiles.length} file{report.usedFiles.length === 1 ? '' : 's'}:{' '}
                {report.usedFiles.map((f) => f.filename).join(', ')}
              </div>
            )}
            <div className="panel-title-row" style={{ marginTop: 8 }}>
              <h3 className="panel-title">Generated report</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="ghost-btn"
                  onClick={() => navigator.clipboard.writeText(report.text)}
                >
                  Copy
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    const base = report.templateName.replace(/\.[^.]+$/, '');
                    const stamp = new Date().toISOString().slice(0, 10);
                    downloadText(`${base}-${stamp}.md`, report.text);
                  }}
                >
                  Download .md
                </button>
                <button
                  className="primary-btn"
                  disabled={downloadingDocx}
                  onClick={async () => {
                    setDownloadingDocx(true);
                    setDownloadErr(null);
                    const base = report.templateName.replace(/\.[^.]+$/, '');
                    const stamp = new Date().toISOString().slice(0, 10);
                    try {
                      await downloadDocx(`${base}-${stamp}.docx`, report.text);
                    } catch (e) {
                      setDownloadErr(e.message);
                    } finally {
                      setDownloadingDocx(false);
                    }
                  }}
                >
                  {downloadingDocx ? 'Preparing…' : 'Download .docx'}
                </button>
              </div>
            </div>
            {downloadErr && <div className="inline-msg error" style={{ marginTop: 8 }}>{downloadErr}</div>}
            <div className="report-preview md">
              <ReactMarkdown>{report.text}</ReactMarkdown>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
