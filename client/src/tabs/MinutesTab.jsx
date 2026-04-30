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
function MomPreviewPanel({ minutes, transcript, onSaved, onBack }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...minutes, transcript }),
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

  return (
    <div className="mom-panel">
      <div className="panel-title">Generated Minutes</div>
      <MomContent minutes={minutes} />
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
function MomContent({ minutes }) {
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

      {minutes.action_items?.length > 0 && (
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

// ─── Saved Meeting Card ────────────────────────────────────────────────────
function MomCard({ minute, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Delete these meeting minutes? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await fetch(`/api/minutes/${minute.id}`, { method: 'DELETE' });
      onDelete(minute.id);
    } catch {
      setDeleting(false);
    }
  };

  const date = new Date(minute.created_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const decCount = minute.decisions?.length ?? 0;
  const aiCount = minute.action_items?.length ?? 0;

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
            {aiCount > 0 && (
              <span className="mom-chip mom-chip-action">{aiCount} action item{aiCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <div className="mom-card-btns">
          <button className="ghost-btn mom-sm-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Collapse' : 'View'}
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

      {expanded && (
        <div className="mom-card-body">
          <MomContent minutes={minute} />
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
export default function MinutesTab() {
  // view: 'list' | 'record' | 'transcript' | 'preview'
  const [view, setView] = useState('list');
  const [savedMinutes, setSavedMinutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [parsedMom, setParsedMom] = useState(null);

  useEffect(() => {
    fetch('/api/minutes')
      .then((r) => r.json())
      .then((d) => { setSavedMinutes(d.minutes || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

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
                <MomCard key={m.id} minute={m} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
