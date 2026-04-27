export default function AIQuizzesTab({ activePart }) {
  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>AI Quizzes</h1>
          <div className="sub">
            Generate quizzes and learning checkpoints from any uploaded material.
          </div>
        </div>
      </div>
      <div className="placeholder-panel">
        <div className="placeholder-icon">🧠</div>
        <h2>Coming soon</h2>
        <p>
          This tab will let <strong>{activePart || 'your part'}</strong> turn any
          document into multiple-choice quizzes, flashcards, and short-answer
          assessments — useful for onboarding and team upskilling.
        </p>
      </div>
    </div>
  );
}
