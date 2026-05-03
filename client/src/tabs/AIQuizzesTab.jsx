import { useCallback, useEffect, useState } from 'react';

const QUIZ = {
  id: 'rag-basics',
  title: 'RAG Fundamentals',
  subtitle: 'Retrieval Augmented Generation — 5 questions',
  questions: [
    {
      q: 'What does RAG stand for?',
      options: [
        'Retrieval Augmented Generation',
        'Recursive Algorithmic Grounding',
        'Ranked Attention Grounding',
        'Retrieval Assisted Grading',
      ],
      answer: 0,
    },
    {
      q: 'What is the primary purpose of the retrieval step in RAG?',
      options: [
        'To fine-tune the language model on new data',
        "To compress the model's parameters",
        'To fetch relevant documents from an external knowledge base before generating a response',
        "To rank the model's output by confidence score",
      ],
      answer: 2,
    },
    {
      q: 'Which of the following best describes a vector database in the context of RAG?',
      options: [
        'A database that stores data in traditional rows and columns',
        'A storage system that holds numerical representations of text for similarity search',
        'A cache layer that speeds up API calls to the language model',
        'A database that stores only structured JSON documents',
      ],
      answer: 1,
    },
    {
      q: 'What is "chunking" in a RAG pipeline?',
      options: [
        'Splitting retrieved documents into smaller pieces before embedding them',
        'Compressing the language model weights for faster inference',
        'Grouping user queries by topic before retrieval',
        'Filtering out irrelevant tokens from the model output',
      ],
      answer: 0,
    },
    {
      q: 'What is a key limitation of RAG compared to fine-tuning?',
      options: [
        'RAG cannot work with large language models',
        'RAG is unable to use external documents',
        'RAG responses are dependent on retrieval quality — if the wrong documents are fetched, the answer will be poor',
        'RAG permanently modifies the underlying model weights',
      ],
      answer: 2,
    },
  ],
};

const LETTERS = ['A', 'B', 'C', 'D'];

function performanceMessage(score, total) {
  if (score === total) return 'Perfect score!';
  if (score >= total - 1) return 'Good effort!';
  if (score >= Math.ceil(total / 2)) return 'Good effort!';
  return 'Keep learning!';
}

function performanceTone(score, total) {
  if (score === total) return 'gold';
  if (score >= 3) return 'good';
  return 'keep';
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function QuizIntro({ onStart }) {
  return (
    <div className="quiz-intro">
      <div className="quiz-intro-icon">🧠</div>
      <h2 className="quiz-intro-title">{QUIZ.title}</h2>
      <p className="quiz-intro-sub">{QUIZ.subtitle}</p>
      <ul className="quiz-intro-list">
        <li>5 multiple-choice questions, one at a time</li>
        <li>Answer locks the option — feedback shown instantly</li>
        <li>Your latest score is saved to the leaderboard</li>
      </ul>
      <button className="primary-btn quiz-start-btn" onClick={onStart}>Start quiz</button>
    </div>
  );
}

function QuizRunner({ onFinish, onCancel }) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);     // user's choice this question
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);

  const total = QUIZ.questions.length;
  const q = QUIZ.questions[idx];
  const pct = ((idx + (revealed ? 1 : 0)) / total) * 100;

  const choose = (i) => {
    if (revealed) return;
    setPicked(i);
    setRevealed(true);
    if (i === q.answer) setScore((s) => s + 1);
  };

  const next = () => {
    if (idx < total - 1) {
      setIdx(idx + 1);
      setPicked(null);
      setRevealed(false);
    } else {
      onFinish(score);
    }
  };

  return (
    <div className="quiz-runner">
      <div className="quiz-progress-row">
        <div className="quiz-progress-text">Question <strong>{idx + 1}</strong> of {total}</div>
        <button className="ghost-btn small" onClick={onCancel}>Cancel</button>
      </div>
      <div className="quiz-progress-bar">
        <div className="quiz-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="quiz-question">
        <div className="quiz-question-text">{q.q}</div>
        <div className="quiz-options">
          {q.options.map((opt, i) => {
            const isPicked = picked === i;
            const isCorrect = q.answer === i;
            let state = '';
            if (revealed) {
              if (isCorrect) state = 'correct';
              else if (isPicked) state = 'incorrect';
              else state = 'dim';
            }
            return (
              <button
                key={i}
                className={`quiz-option ${state}${isPicked ? ' picked' : ''}`}
                onClick={() => choose(i)}
                disabled={revealed}
              >
                <span className="quiz-option-letter">{LETTERS[i]}</span>
                <span className="quiz-option-text">{opt}</span>
                {revealed && isCorrect && <span className="quiz-option-mark">✓</span>}
                {revealed && isPicked && !isCorrect && <span className="quiz-option-mark">✕</span>}
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className={`quiz-feedback ${picked === q.answer ? 'correct' : 'incorrect'}`}>
            {picked === q.answer ? (
              <>✓ Correct!</>
            ) : (
              <>
                ✕ Incorrect. The correct answer is <strong>{LETTERS[q.answer]}</strong>{' — '}
                {q.options[q.answer]}
              </>
            )}
          </div>
        )}

        {revealed && (
          <div className="quiz-actions-row">
            <button className="primary-btn" onClick={next}>
              {idx < total - 1 ? 'Next →' : 'See results'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QuizResult({ score, total, saving, saveErr, onRetry, onSeeBoard }) {
  const tone = performanceTone(score, total);
  const message = performanceMessage(score, total);
  const pct = total ? Math.round((score / total) * 100) : 0;
  return (
    <div className={`quiz-result quiz-result-${tone}`}>
      <div className="quiz-result-ring">
        <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r="68" stroke="rgba(148,163,184,.18)" strokeWidth="12" fill="none" />
          <circle
            cx="80" cy="80" r="68"
            stroke="currentColor" strokeWidth="12" fill="none"
            strokeDasharray={`${(pct / 100) * 2 * Math.PI * 68} ${2 * Math.PI * 68}`}
            strokeLinecap="round"
            transform="rotate(-90 80 80)"
          />
        </svg>
        <div className="quiz-result-score">
          <div className="quiz-result-score-num">{score}<span className="quiz-result-score-tot">/{total}</span></div>
          <div className="quiz-result-pct">{pct}%</div>
        </div>
      </div>
      <h2 className="quiz-result-msg">{message}</h2>
      <p className="quiz-result-sub">
        {saving ? 'Saving your score…' : (saveErr ? saveErr : 'Your latest score is on the leaderboard.')}
      </p>
      <div className="quiz-actions-row" style={{ justifyContent: 'center' }}>
        <button className="primary-btn" onClick={onRetry}>Retake quiz</button>
        <button className="ghost-btn" onClick={onSeeBoard}>See leaderboard</button>
      </div>
    </div>
  );
}

function Leaderboard({ scores, activeUserId, loading, error, onRefresh }) {
  return (
    <section className="panel quiz-leaderboard">
      <div className="panel-title-row">
        <h2 className="panel-title">Leaderboard</h2>
        <button className="ghost-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="inline-msg error">{error}</div>}
      {!error && scores.length === 0 && !loading && (
        <div className="state-text" style={{ marginTop: 8 }}>
          Be the first to take the quiz!
        </div>
      )}
      {scores.length > 0 && (
        <div className="quiz-leaderboard-table">
          <div className="quiz-lb-row quiz-lb-head">
            <div>Rank</div>
            <div>Name</div>
            <div>Score</div>
            <div>Attempted</div>
          </div>
          {scores.map((s, i) => {
            const rank = i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
            const isMe = s.user_id === activeUserId;
            return (
              <div key={s.user_id} className={`quiz-lb-row${isMe ? ' me' : ''}`}>
                <div className="quiz-lb-rank">{medal || `#${rank}`}</div>
                <div className="quiz-lb-name">{s.user_name}{isMe && <span className="quiz-lb-you"> · you</span>}</div>
                <div className="quiz-lb-score">{s.score}<span className="quiz-lb-total">/{s.total}</span></div>
                <div className="quiz-lb-date">{formatDate(s.attempted_at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function AIQuizzesTab({ activeUserId }) {
  const [view, setView] = useState('intro'); // intro | running | result
  const [finalScore, setFinalScore] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const [scores, setScores] = useState([]);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardErr, setBoardErr] = useState(null);

  const loadBoard = useCallback(async () => {
    setBoardLoading(true);
    setBoardErr(null);
    try {
      const res = await fetch('/api/quiz/leaderboard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      setScores(json.scores || []);
    } catch (e) {
      setBoardErr(e.message);
    } finally {
      setBoardLoading(false);
    }
  }, []);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const handleFinish = async (score) => {
    setFinalScore(score);
    setView('result');
    if (!activeUserId) {
      setSaveErr('No active user — your score was not saved.');
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch('/api/quiz/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: activeUserId, score, total: QUIZ.questions.length, quiz_id: QUIZ.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      loadBoard();
    } catch (e) {
      setSaveErr(`Couldn't save score: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const restart = () => {
    setFinalScore(null);
    setSaveErr(null);
    setView('running');
  };

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>AI Quizzes</h1>
          <div className="sub">
            Test your understanding. Your latest score is saved to the team leaderboard.
          </div>
        </div>
      </div>

      <section className="panel quiz-panel">
        {view === 'intro' && <QuizIntro onStart={() => setView('running')} />}
        {view === 'running' && (
          <QuizRunner onFinish={handleFinish} onCancel={() => setView('intro')} />
        )}
        {view === 'result' && finalScore !== null && (
          <QuizResult
            score={finalScore}
            total={QUIZ.questions.length}
            saving={saving}
            saveErr={saveErr}
            onRetry={restart}
            onSeeBoard={() => setView('intro')}
          />
        )}
      </section>

      <Leaderboard
        scores={scores}
        activeUserId={activeUserId}
        loading={boardLoading}
        error={boardErr}
        onRefresh={loadBoard}
      />
    </div>
  );
}
