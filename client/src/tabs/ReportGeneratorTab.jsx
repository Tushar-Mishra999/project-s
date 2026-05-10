import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

const MODEL_ICONS = {
  gemini: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#rgi)"/>
      <defs><radialGradient id="rgi" cx="30%" cy="30%"><stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#3b82f6"/></radialGradient></defs>
    </svg>
  ),
  gemma: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2L4 7v10l8 5 8-5V7z" fill="url(#rgma)"/>
      <defs><radialGradient id="rgma" cx="30%" cy="30%"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></radialGradient></defs>
    </svg>
  ),
  glm: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="url(#rglm)"/>
      <defs><radialGradient id="rglm" cx="30%" cy="30%"><stop offset="0%" stopColor="#f472b6"/><stop offset="100%" stopColor="#9333ea"/></radialGradient></defs>
    </svg>
  ),
  kimi: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4l2 4h4l-3 3 1 4-4-2.5L8 17l1-4-3-3h4z" fill="url(#rkimi)"/>
      <defs><radialGradient id="rkimi" cx="30%" cy="30%"><stop offset="0%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#f59e0b"/></radialGradient></defs>
    </svg>
  ),
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
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 10px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border-strong)',
          borderRadius: 10, cursor: 'pointer',
          color: 'var(--text)', fontSize: 12, fontWeight: 500,
          fontFamily: 'inherit', transition: 'border-color .15s, box-shadow .15s',
          boxShadow: open ? '0 0 0 2px rgba(59,130,246,.25)' : 'none',
          minWidth: 200,
        }}
      >
        {MODEL_ICONS[selected.id]}
        <span style={{ flex: 1, textAlign: 'left' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 10, display: 'block', lineHeight: 1.2 }}>Model</span>
          <span style={{ letterSpacing: '0.01em' }}>{selected.label}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
          borderRadius: 12, overflow: 'hidden', zIndex: 50, minWidth: 260,
          boxShadow: '0 8px 32px rgba(0,0,0,.45)',
        }}>
          <div style={{ padding: '6px 10px 4px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Select model
          </div>
          {MODEL_OPTIONS.map((opt) => {
            const active = opt.id === value;
            return (
              <button
                key={opt.id}
                onClick={() => { onChange(opt.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px', border: 'none',
                  background: active ? 'rgba(59,130,246,.12)' : 'transparent',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  borderLeft: active ? '2px solid #3b82f6' : '2px solid transparent',
                  transition: 'background .12s',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,.04)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: active ? 'rgba(59,130,246,.18)' : 'var(--surface-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {MODEL_ICONS[opt.id]}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#93c5fd' : 'var(--text)' }}>{opt.label}</div>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <path d="M2.5 7l3 3 6-6" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  triggerDownload(filename, new Blob([text], { type: 'text/html;charset=utf-8' }));
}

async function downloadPdf(filename, html) {
  const res = await fetch('/api/render-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, filename }),
  });
  if (!res.ok) {
    let msg = `Server returned ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  triggerDownload(filename, blob);
}

async function downloadXlsx(filename, html, report_model) {
  const res = await fetch('/api/render-xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, filename, report_model }),
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

  // Model selection
  const [reportModel, setReportModel] = useState('gemini');

  // Mode: 'template' | 'free'
  const [mode, setMode] = useState('template');

  // Generate state
  const [selectedId, setSelectedId] = useState(null);
  const [inputData, setInputData] = useState('');
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);
  const [generateErr, setGenerateErr] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const [downloadErr, setDownloadErr] = useState(null);

  // NL "describe your report" flow
  const [instruction, setInstruction] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchErr, setMatchErr] = useState(null);
  const [matchAll, setMatchAll] = useState([]);
  const [matchPicked, setMatchPicked] = useState(new Set());
  const [matchRationale, setMatchRationale] = useState('');
  const [matchActive, setMatchActive] = useState(false);

  // Excel Compiler state
  const [xlsxInstruction, setXlsxInstruction] = useState('');
  const [xlsxMatching, setXlsxMatching] = useState(false);
  const [xlsxMatchErr, setXlsxMatchErr] = useState(null);
  const [xlsxMatchAll, setXlsxMatchAll] = useState([]);
  const [xlsxMatchPicked, setXlsxMatchPicked] = useState(new Set());
  const [xlsxMatchRationale, setXlsxMatchRationale] = useState('');
  const [xlsxMatchActive, setXlsxMatchActive] = useState(false);
  const [xlsxCompiling, setXlsxCompiling] = useState(false);
  const [xlsxCompileErr, setXlsxCompileErr] = useState(null);

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
    if (mode === 'template' && !selectedId) return setGenerateErr('Select a template first.');
    if (matchPicked.size === 0) return setGenerateErr('Pick at least one source file.');
    setGenerating(true);
    setGenerateErr(null);
    setReport(null);
    try {
      let url, body;
      if (mode === 'template') {
        url = `/api/report-templates/${selectedId}/generate-from-files`;
        body = { instruction, file_ids: Array.from(matchPicked), report_model: reportModel };
      } else {
        url = '/api/report/generate-from-files';
        body = { instruction, file_ids: Array.from(matchPicked), report_model: reportModel };
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv']);
  const isExcel = (filename) => EXCEL_EXTS.has((filename || '').split('.').pop().toLowerCase());

  const handleXlsxFindFiles = async (e) => {
    e?.preventDefault();
    if (!xlsxInstruction.trim()) return setXlsxMatchErr('Describe which files to compile first.');
    setXlsxMatching(true);
    setXlsxMatchErr(null);
    try {
      const res = await fetch('/api/files/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: xlsxInstruction, user_id: activeUserId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Match failed (${res.status})`);
      setXlsxMatchAll(json.all || []);
      // Pre-select only Excel/CSV files from the AI's suggestions
      const suggestedIds = new Set((json.matched || []).map((f) => f.id));
      const excelSuggested = new Set(
        (json.all || []).filter((f) => suggestedIds.has(f.id) && isExcel(f.filename)).map((f) => f.id)
      );
      setXlsxMatchPicked(excelSuggested);
      setXlsxMatchRationale(json.rationale || '');
      setXlsxMatchActive(true);
    } catch (err) {
      setXlsxMatchErr(err.message);
    } finally {
      setXlsxMatching(false);
    }
  };

  const toggleXlsxPick = (id, filename) => {
    if (!isExcel(filename)) return; // non-Excel files are not selectable
    setXlsxMatchPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleXlsxCompile = async () => {
    if (xlsxMatchPicked.size === 0) return setXlsxCompileErr('Select at least one Excel file.');
    setXlsxCompiling(true);
    setXlsxCompileErr(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/xlsx/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_ids: Array.from(xlsxMatchPicked),
          instruction: xlsxInstruction,
          output_filename: `compiled-${stamp}.xlsx`,
          report_model: reportModel,
        }),
      });
      if (!res.ok) {
        let msg = `Server returned ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      triggerDownload(`compiled-${stamp}.xlsx`, blob);
    } catch (err) {
      setXlsxCompileErr(err.message);
    } finally {
      setXlsxCompiling(false);
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
    if (mode === 'template' && !selectedId) return setGenerateErr('Select a template first.');
    if (!inputData.trim()) return setGenerateErr('Provide some input data.');
    setGenerating(true);
    setGenerateErr(null);
    setReport(null);
    try {
      let url, body;
      if (mode === 'template') {
        url = `/api/report-templates/${selectedId}/generate`;
        body = { input_data: inputData, report_model: reportModel };
      } else {
        url = '/api/report/generate';
        body = { input_data: inputData, report_model: reportModel };
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = (selected?.filename || 'report').replace(/\.[^.]+$/, '');

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Report Generator</h1>
          <div className="sub">
            Generate reports from templates or free-form. Download as PDF or XLSX.
          </div>
        </div>
        <div className="chat-controls">
          <ModelDropdown value={reportModel} onChange={setReportModel} />
        </div>
      </div>

      {/* Mode toggle */}
      <section className="panel" style={{ paddingTop: 14, paddingBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, marginRight: 4 }}>Mode:</span>
          <button
            className={mode === 'template' ? 'primary-btn' : 'ghost-btn'}
            style={{ fontSize: 12, padding: '5px 14px' }}
            onClick={() => { setMode('template'); setReport(null); setGenerateErr(null); }}
          >
            Use template
          </button>
          <button
            className={mode === 'free' ? 'primary-btn' : 'ghost-btn'}
            style={{ fontSize: 12, padding: '5px 14px' }}
            onClick={() => { setMode('free'); setSelectedId(null); setReport(null); setGenerateErr(null); }}
          >
            Free-form (no template)
          </button>
        </div>
        {mode === 'free' && (
          <div className="sub" style={{ marginTop: 8, fontSize: 12 }}>
            The AI will choose an appropriate report structure based on your input — no template needed.
          </div>
        )}
      </section>

      {/* Templates list — only in template mode */}
      {mode === 'template' && (
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
      )}

      {/* Upload prompt — only in template mode */}
      {mode === 'template' && (
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
      )}

      {/* Generate */}
      <section className="panel">
        <h2 className="panel-title">
          {mode === 'template'
            ? `Generate report${selected ? ` · using ${selected.filename}` : ''}`
            : 'Generate report · free-form'}
        </h2>

        {mode === 'template' && !selectedId && (
          <div className="state-text" style={{ marginBottom: 12 }}>
            Pick a template from the list above first.
          </div>
        )}

        {/* ── Path A: from Library files ── */}
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 14,
          background: 'var(--surface-2)',
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>
            From Library files
          </div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 12 }}>
            Describe which files to use. Kernel will find them and generate the report from their contents.
          </div>
          <form className="upload-form" onSubmit={handleFindFiles}>
            <div className="form-row">
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
                  Clear
                </button>
              )}
            </div>
            {matchErr && <div className="inline-msg error">{matchErr}</div>}
          </form>

          {matchActive && (
            <div style={{ marginTop: 14 }}>
              <div className="panel-title-row" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {matchPicked.size} of {matchAll.length} file{matchAll.length === 1 ? '' : 's'} selected
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="ghost-btn small" onClick={() => setMatchPicked(new Set(matchAll.map((f) => f.id)))}>
                    All
                  </button>
                  <button type="button" className="ghost-btn small" onClick={() => setMatchPicked(new Set())}>
                    None
                  </button>
                </div>
              </div>
              {matchRationale && (
                <div className="sub" style={{ fontSize: 11, marginBottom: 10 }}>
                  <em>{matchRationale}</em>
                </div>
              )}
              {matchAll.length === 0 ? (
                <div className="state-text">No files in your scope.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
                  {matchAll.map((f) => {
                    const checked = matchPicked.has(f.id);
                    return (
                      <label
                        key={f.id}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                          padding: '8px 12px',
                          background: checked ? 'var(--blue-soft-2)' : 'var(--surface)',
                          border: `1px solid ${checked ? 'rgba(59,130,246,.45)' : 'var(--border)'}`,
                          borderRadius: 8, cursor: 'pointer',
                        }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => togglePick(f.id)} style={{ marginTop: 3 }} />
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
              <button
                className="primary-btn"
                onClick={handleConfirmAndGenerate}
                disabled={(mode === 'template' && !selectedId) || matchPicked.size === 0 || generating}
                style={{ width: '100%' }}
              >
                {generating
                  ? 'Generating…'
                  : `Generate report from ${matchPicked.size} file${matchPicked.size === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>

        {/* ── divider ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>OR</span>
          <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
        </div>

        {/* ── Path B: paste your own input ── */}
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 16px',
          background: 'var(--surface-2)',
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>
            From pasted input
          </div>
          <div className="sub" style={{ fontSize: 12, marginBottom: 12 }}>
            Paste raw notes, data, or context and the AI will write the report directly.
          </div>
          <form className="upload-form" onSubmit={handleGenerate}>
            <div className="form-row">
              <textarea
                className="search-input"
                style={{ minHeight: 160, resize: 'vertical', padding: 12 }}
                placeholder="e.g. Sprint #14 ran from 14–28 April. Team: Arjun, Priya, Karan. Delivered: search reranker, file-delete API. Blockers: Voyage rate-limit, Firecrawl quota. Next sprint: ship Reports Tab."
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
                disabled={(mode === 'template' && !selectedId) || generating}
              />
            </div>
            <button
              className="primary-btn"
              type="submit"
              style={{ width: '100%' }}
              disabled={(mode === 'template' && !selectedId) || generating}
            >
              {generating ? 'Generating…' : 'Generate report'}
            </button>
            {generateErr && <div className="inline-msg error">{generateErr}</div>}
          </form>
        </div>

        {generating && <div className="state" style={{ marginTop: 16 }}><div className="spinner" /></div>}

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
                  Copy HTML
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    downloadText(`${baseName}-${stamp}.html`, report.text);
                  }}
                >
                  Download .html
                </button>
                <button
                  className="ghost-btn"
                  disabled={downloadingXlsx}
                  onClick={async () => {
                    setDownloadingXlsx(true);
                    setDownloadErr(null);
                    try {
                      await downloadXlsx(`${baseName}-${stamp}.xlsx`, report.text, reportModel);
                    } catch (e) {
                      setDownloadErr(e.message);
                    } finally {
                      setDownloadingXlsx(false);
                    }
                  }}
                >
                  {downloadingXlsx ? 'Preparing…' : 'Download .xlsx'}
                </button>
                <button
                  className="primary-btn"
                  disabled={downloadingPdf}
                  onClick={async () => {
                    setDownloadingPdf(true);
                    setDownloadErr(null);
                    try {
                      await downloadPdf(`${baseName}-${stamp}.pdf`, report.text);
                    } catch (e) {
                      setDownloadErr(e.message);
                    } finally {
                      setDownloadingPdf(false);
                    }
                  }}
                >
                  {downloadingPdf ? 'Preparing…' : 'Download .pdf'}
                </button>
              </div>
            </div>
            {downloadErr && <div className="inline-msg error" style={{ marginTop: 8 }}>{downloadErr}</div>}
            <div
              className="report-preview md"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(report.text) }}
            />
          </div>
        )}
      </section>

      {/* ── Excel Compiler ── */}
      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Excel Compiler</h2>
        </div>
        <div className="sub" style={{ marginBottom: 14, fontSize: 12 }}>
          Select Excel or CSV files from the Library. Optionally describe how to merge or transform them — the AI will follow your instructions. Without an instruction the sheets are combined as-is.
        </div>

        <form className="upload-form" onSubmit={handleXlsxFindFiles} style={{ marginBottom: 18 }}>
          <div className="form-row">
            <label>Describe which files to use (and optionally how to compile them)</label>
            <textarea
              className="search-input"
              style={{ minHeight: 80, resize: 'vertical', padding: 12 }}
              placeholder='e.g. "Merge the Q1, Q2 and Q3 sales reports into one sheet with a Source File column" or "Combine all budget trackers from Finance into a single workbook."'
              value={xlsxInstruction}
              onChange={(e) => setXlsxInstruction(e.target.value)}
              disabled={xlsxMatching}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="primary-btn" type="submit" disabled={xlsxMatching || !xlsxInstruction.trim()}>
              {xlsxMatching ? 'Finding files…' : 'Find matching files'}
            </button>
            {xlsxMatchActive && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setXlsxMatchActive(false);
                  setXlsxMatchPicked(new Set());
                  setXlsxMatchAll([]);
                  setXlsxMatchRationale('');
                  setXlsxCompileErr(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
          {xlsxMatchErr && <div className="inline-msg error">{xlsxMatchErr}</div>}
        </form>

        {xlsxMatchActive && (
          <div className="panel" style={{ padding: 14, background: 'var(--surface-2)' }}>
            <div className="panel-title-row" style={{ marginBottom: 8 }}>
              <h3 className="panel-title" style={{ fontSize: 14 }}>
                {xlsxMatchPicked.size} Excel file{xlsxMatchPicked.size === 1 ? '' : 's'} selected
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="ghost-btn small"
                  onClick={() => setXlsxMatchPicked(new Set(xlsxMatchAll.filter((f) => isExcel(f.filename)).map((f) => f.id)))}
                >
                  Select all Excel
                </button>
                <button
                  type="button"
                  className="ghost-btn small"
                  onClick={() => setXlsxMatchPicked(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            {xlsxMatchRationale && (
              <div className="sub" style={{ fontSize: 12, marginBottom: 10 }}>
                <em>{xlsxMatchRationale}</em>
              </div>
            )}
            {xlsxMatchAll.length === 0 ? (
              <div className="state-text">No files in your scope.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                {xlsxMatchAll.map((f) => {
                  const excel = isExcel(f.filename);
                  const checked = xlsxMatchPicked.has(f.id);
                  return (
                    <label
                      key={f.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 12px',
                        background: checked ? 'var(--blue-soft-2)' : excel ? 'var(--surface)' : 'transparent',
                        border: `1px solid ${checked ? 'rgba(59,130,246,.45)' : excel ? 'var(--border)' : 'transparent'}`,
                        borderRadius: 8,
                        cursor: excel ? 'pointer' : 'default',
                        opacity: excel ? 1 : 0.4,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!excel}
                        onChange={() => toggleXlsxPick(f.id, f.filename)}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'center' }}>
                          {f.filename}
                          {excel && (
                            <span style={{ fontSize: 10, background: 'rgba(34,197,94,.15)', color: '#4ade80', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                              EXCEL
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {f.uploaded_by} · {formatDate(f.uploaded_at)}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="primary-btn"
                onClick={handleXlsxCompile}
                disabled={xlsxMatchPicked.size === 0 || xlsxCompiling}
              >
                {xlsxCompiling
                  ? 'Compiling…'
                  : xlsxInstruction.trim()
                    ? `Compile ${xlsxMatchPicked.size} file${xlsxMatchPicked.size === 1 ? '' : 's'} with AI`
                    : `Merge ${xlsxMatchPicked.size} file${xlsxMatchPicked.size === 1 ? '' : 's'}`}
              </button>
              {xlsxInstruction.trim() && (
                <span className="sub" style={{ fontSize: 11 }}>AI will follow your instruction</span>
              )}
            </div>
            {xlsxCompileErr && <div className="inline-msg error" style={{ marginTop: 8 }}>{xlsxCompileErr}</div>}
          </div>
        )}
      </section>
    </div>
  );
}
