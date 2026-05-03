import { useCallback, useEffect, useRef, useState } from 'react';

function fmt(secs) {
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

// ─── Recording Panel ───────────────────────────────────────────────────────
function RecordPanel({ onTranscribed, onManual, onCancel }) {
  const [phase, setPhase] = useState('idle'); // idle | recording | done | transcribing
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState(null);

  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (mrRef.current?.state !== 'inactive') mrRef.current?.stop();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setPhase('done');
      };
      mr.start();
      mrRef.current = mr;
      setPhase('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError('Microphone access denied. Please allow microphone permissions and try again.');
    }
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    if (mrRef.current?.state !== 'inactive') mrRef.current.stop();
  };

  const reRecord = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setPhase('idle');
    setSeconds(0);
    setError(null);
  };

  const transcribe = async () => {
    if (!audioBlob) return;
    setPhase('transcribing');
    setError(null);
    try {
      const form = new FormData();
      form.append('audio', audioBlob, 'recording.webm');
      const res = await fetch('/api/minutes/transcribe', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      onTranscribed(json.transcript);
    } catch (e) {
      setError(e.message);
      setPhase('done');
    }
  };

  return (
    <div className="mom-panel">
      <div className="panel-title">Record Meeting Audio</div>

      {phase === 'idle' && (
        <>
          <p className="mom-hint">
            Press <strong>Start Recording</strong> to capture your meeting via microphone.
            When done, the audio will be transcribed automatically.
          </p>
          {error && <div className="inline-msg error" style={{ marginBottom: 14 }}>{error}</div>}
          <div className="mom-btn-row">
            <button className="primary-btn" onClick={startRecording}>Start Recording</button>
            <button className="ghost-btn" onClick={onManual}>Enter transcript manually</button>
            <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}

      {phase === 'recording' && (
        <>
          <div className="mom-rec-status">
            <span className="mom-rec-dot" />
            <span className="mom-rec-timer">{fmt(seconds)}</span>
            <span className="mom-rec-label">Recording…</span>
          </div>
          <div className="mom-btn-row" style={{ marginTop: 20 }}>
            <button className="mom-stop-btn" onClick={stopRecording}>Stop Recording</button>
          </div>
        </>
      )}

      {(phase === 'done' || phase === 'transcribing') && (
        <>
          <div className="inline-msg success" style={{ marginBottom: 16 }}>
            Recording complete — {fmt(seconds)} captured.
          </div>
          <audio controls src={audioUrl} className="mom-audio-player" />
          {error && <div className="inline-msg error" style={{ margin: '12px 0' }}>{error}</div>}
          <div className="mom-btn-row" style={{ marginTop: 16 }}>
            <button className="primary-btn" onClick={transcribe} disabled={phase === 'transcribing'}>
              {phase === 'transcribing' ? 'Transcribing…' : 'Transcribe Recording'}
            </button>
            <button className="ghost-btn" onClick={reRecord} disabled={phase === 'transcribing'}>Re-record</button>
            <button className="ghost-btn" onClick={onCancel} disabled={phase === 'transcribing'}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Transcript Panel ──────────────────────────────────────────────────────
function TranscriptPanel({ initialTranscript, onParsed, onBack }) {
  const [transcript, setTranscript] = useState(initialTranscript || '');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);

  const parse = async () => {
    if (!transcript.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch('/api/minutes/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      onParsed(json.minutes, transcript);
    } catch (e) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="mom-panel">
      <div className="panel-title">Review Transcript</div>
      <p className="mom-hint">
        Review and edit the transcript below, then click <strong>Generate MoM</strong> to extract
        decisions, action items, and a summary.
      </p>
      <textarea
        className="mom-transcript-editor"
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={14}
        placeholder="Paste or type the meeting transcript here…"
      />
      {error && <div className="inline-msg error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="mom-btn-row" style={{ marginTop: 16 }}>
        <button
          className="primary-btn"
          onClick={parse}
          disabled={parsing || !transcript.trim()}
        >
          {parsing ? 'Generating MoM…' : 'Generate MoM'}
        </button>
        <button className="ghost-btn" onClick={onBack} disabled={parsing}>Back</button>
      </div>
    </div>
  );
}

// ─── MoM Preview Panel ─────────────────────────────────────────────────────
function MomPreviewPanel({ minutes, transcript, activeUser, parts, onSaved, onBack }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fallbackScope = activeUser?.part || activeUser?.team || '';
  const [accessibleTo, setAccessibleTo] = useState(
    fallbackScope ? [fallbackScope] : []
  );

  const toggle = (p) =>
    setAccessibleTo((curr) => (curr.includes(p) ? curr.filter((x) => x !== p) : [...curr, p]));

  const save = async () => {
    if (!activeUser?.id) return setError('No active user.');
    if (accessibleTo.length === 0) {
      return setError('Pick at least one Part/Team that should see these minutes.');
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...minutes,
          transcript,
          user_id: activeUser.id,
          accessible_to: accessibleTo,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      onSaved(json.minute);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const everyone = [...(parts || []), 'Team 1', 'Team 2', 'Team 3'];

  return (
    <div className="mom-panel">
      <div className="panel-title">Generated Minutes</div>
      <MomContent minutes={minutes} showActionItems={false} />

      <div className="form-row" style={{ marginTop: 18 }}>
        <label>Accessible to</label>
        <div className="checkbox-row">
          {everyone.map((p) => (
            <label key={p} className="checkbox-pill">
              <input
                type="checkbox"
                checked={accessibleTo.includes(p)}
                onChange={() => toggle(p)}
              />
              <span>{p}</span>
            </label>
          ))}
        </div>
      </div>

      {error && <div className="inline-msg error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="mom-btn-row" style={{ marginTop: 24 }}>
        <button className="primary-btn" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Minutes'}
        </button>
        <button className="ghost-btn" onClick={onBack} disabled={saving}>Back</button>
      </div>
    </div>
  );
}

// ─── Shared MoM content renderer ──────────────────────────────────────────
function MomContent({ minutes, showActionItems = true }) {
  return (
    <div className="mom-content">
      <h2 className="mom-content-title">{minutes.title}</h2>

      {minutes.attendees?.length > 0 && (
        <div className="mom-meta-row">
          <span className="mom-meta-label">Attendees</span>
          <span className="mom-meta-value">{minutes.attendees.join(', ')}</span>
        </div>
      )}

      {minutes.summary && (
        <div className="mom-section">
          <div className="mom-section-label">Summary</div>
          <p className="mom-section-text">{minutes.summary}</p>
        </div>
      )}

      {minutes.decisions?.length > 0 && (
        <div className="mom-section">
          <div className="mom-section-label">Decisions</div>
          <ul className="mom-item-list">
            {minutes.decisions.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      {showActionItems && minutes.action_items?.length > 0 && (
        <div className="mom-section">
          <div className="mom-section-label">Action Items</div>
          <ul className="mom-item-list">
            {minutes.action_items.map((a, i) => (
              <li key={i}>
                {a.text}
                {a.owner && <span className="mom-owner"> — {a.owner}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Action items review (MoM-flavoured) ──────────────────────────────────
function MomActionItemsModal({ pending, users, activeUserId, onClose, onSaved }) {
  const [items, setItems] = useState(() =>
    (pending.items || []).map((it) => ({
      id: it.id,
      text: it.text,
      assignees: Array.isArray(it.assignees) && it.assignees.length ? it.assignees : [activeUserId].filter(Boolean),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const toggleAssignee = (idx, uid) =>
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const has = it.assignees.includes(uid);
      return { ...it, assignees: has ? it.assignees.filter((u) => u !== uid) : [...it.assignees, uid] };
    }));

  const setText = (idx, text) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, text } : it)));

  const remove = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (items.length === 0) return setErr('Add at least one item before saving.');
    if (items.some((it) => it.assignees.length === 0)) return setErr('Each item needs at least one assignee.');
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/action-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: pending.source_type,
          source_id: pending.source_id,
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
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2 className="modal-title">Review action items</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="sub" style={{ marginBottom: 12 }}>
          {items.length} item{items.length === 1 ? '' : 's'} from <strong>{pending.filename}</strong>.
          Assign each item, then save.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '50vh', overflowY: 'auto' }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <textarea
                  rows={2}
                  value={it.text}
                  onChange={(e) => setText(idx, e.target.value)}
                  style={{ flex: 1, fontSize: 14 }}
                />
                <button className="ghost-btn small danger" onClick={() => remove(idx)}>×</button>
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

// ─── Saved Meeting Card ────────────────────────────────────────────────────
function MomCard({ minute, activeUser, users, onDelete, onPendingItems }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [savingHub, setSavingHub] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleDelete = async () => {
    if (!confirm('Delete these meeting minutes? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await fetch(`/api/minutes/${minute.id}?user_id=${encodeURIComponent(activeUser?.id || '')}`, { method: 'DELETE' });
      onDelete(minute.id);
    } catch {
      setDeleting(false);
    }
  };

  const handleSaveToHub = async () => {
    setSavingHub(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/minutes/${minute.id}/save-to-hub`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUser?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      setMsg({ type: 'success', text: `Saved as “${json.file?.filename}” in the Library.` });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setSavingHub(false);
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/minutes/${minute.id}/extract-action-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUser?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      if (!json.items || json.items.length === 0) {
        setMsg({ type: 'info', text: 'No action items in this meeting.' });
      } else {
        onPendingItems(json);
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setExtracting(false);
    }
  };


  const date = new Date(minute.created_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const decCount = minute.decisions?.length ?? 0;

  return (
    <div className="mom-card">
      <div className="mom-card-header">
        <div className="mom-card-info">
          <div className="mom-card-title">{minute.title}</div>
          <div className="mom-card-meta">
            {date}
            {minute.attendees?.length > 0 && ` · ${minute.attendees.join(', ')}`}
          </div>
          <div className="mom-card-chips">
            {decCount > 0 && (
              <span className="mom-chip">{decCount} decision{decCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <div className="mom-card-btns">
          <button className="ghost-btn mom-sm-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Collapse' : 'View'}
          </button>
          <button
            className="ghost-btn mom-sm-btn"
            onClick={handleExtract}
            disabled={extracting}
            title="Extract action items from this meeting"
          >
            {extracting ? 'Extracting…' : 'Extract action items'}
          </button>
          <button
            className="ghost-btn mom-sm-btn"
            onClick={handleSaveToHub}
            disabled={savingHub}
            title="Save this MoM as a .docx in the Library"
          >
            {savingHub ? 'Saving…' : 'Save to Library'}
          </button>
          <button
            className="ghost-btn mom-sm-btn mom-danger-btn"
            onClick={handleDelete}
            disabled={deleting}
          >
            Delete
          </button>
        </div>
      </div>

      {msg && (
        <div className={`inline-msg ${msg.type}`} style={{ margin: '8px 16px 0' }}>
          {msg.text}
        </div>
      )}

      {expanded && (
        <div className="mom-card-body">
          <MomContent minutes={minute} />
          {Array.isArray(minute.accessible_to) && minute.accessible_to.length > 0 && (
            <div className="library-row-access" style={{ marginTop: 10 }}>
              {minute.accessible_to.map((p) => (
                <span key={p} className="access-chip">{p}</span>
              ))}
            </div>
          )}
          {minute.transcript && (
            <details className="mom-transcript-details">
              <summary className="mom-transcript-toggle">Raw Transcript</summary>
              <pre className="mom-transcript-text">{minute.transcript}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Tab ──────────────────────────────────────────────────────────────
export default function MinutesTab({ parts = [], users = [], activeUserId }) {
  const activeUser = users.find((u) => u.id === activeUserId) || null;
  // view: 'list' | 'record' | 'transcript' | 'preview'
  const [view, setView] = useState('list');
  const [savedMinutes, setSavedMinutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [parsedMom, setParsedMom] = useState(null);
  const [pendingItems, setPendingItems] = useState(null);

  useEffect(() => {
    if (!activeUserId) return;
    setLoading(true);
    fetch(`/api/minutes?user_id=${encodeURIComponent(activeUserId)}`)
      .then((r) => r.json())
      .then((d) => { setSavedMinutes(d.minutes || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeUserId]);

  const handleTranscribed = useCallback((text) => {
    setTranscript(text);
    setView('transcript');
  }, []);

  const handleParsed = useCallback((mom, rawTranscript) => {
    setParsedMom(mom);
    setTranscript(rawTranscript);
    setView('preview');
  }, []);

  const handleSaved = useCallback((record) => {
    setSavedMinutes((prev) => [record, ...prev]);
    setView('list');
    setTranscript('');
    setParsedMom(null);
  }, []);

  const handleDelete = useCallback((id) => {
    setSavedMinutes((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const reset = useCallback(() => {
    setView('list');
    setTranscript('');
    setParsedMom(null);
  }, []);

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Minutes of Meeting</h1>
          <div className="sub">
            Record your meeting audio, transcribe it, and generate structured minutes with decisions and action items.
          </div>
        </div>
        {view === 'list' && (
          <button className="primary-btn" onClick={() => setView('record')}>
            + New Meeting
          </button>
        )}
      </div>

      {view === 'record' && (
        <RecordPanel
          onTranscribed={handleTranscribed}
          onManual={() => { setTranscript(''); setView('transcript'); }}
          onCancel={reset}
        />
      )}

      {view === 'transcript' && (
        <TranscriptPanel
          initialTranscript={transcript}
          onParsed={handleParsed}
          onBack={() => setView('record')}
        />
      )}

      {view === 'preview' && (
        <MomPreviewPanel
          minutes={parsedMom}
          transcript={transcript}
          activeUser={activeUser}
          parts={parts}
          onSaved={handleSaved}
          onBack={() => setView('transcript')}
        />
      )}

      {view === 'list' && (
        <>
          {loading && <div className="state"><div className="spinner" /></div>}

          {!loading && savedMinutes.length === 0 && (
            <div className="placeholder-panel">
              <div className="placeholder-icon">🎙️</div>
              <h2>No meetings recorded yet</h2>
              <p>
                Click <strong>+ New Meeting</strong> to record audio, transcribe it, and generate
                structured minutes with decisions and action items.
              </p>
            </div>
          )}

          {!loading && savedMinutes.length > 0 && (
            <div className="mom-cards-list">
              {savedMinutes.map((m) => (
                <MomCard
                  key={m.id}
                  minute={m}
                  activeUser={activeUser}
                  users={users}
                  onDelete={handleDelete}
                  onPendingItems={setPendingItems}
                />
              ))}
            </div>
          )}
        </>
      )}

      {pendingItems && (
        <MomActionItemsModal
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
