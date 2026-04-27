export default function ReportGeneratorTab({ activePart }) {
  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Report Generator</h1>
          <div className="sub">
            Auto-draft polished reports from your knowledge base.
          </div>
        </div>
      </div>
      <div className="placeholder-panel">
        <div className="placeholder-icon">📝</div>
        <h2>Coming soon</h2>
        <p>
          This tab will let <strong>{activePart || 'your part'}</strong> generate
          structured reports (status updates, executive briefs, project recaps)
          drafted by the AI from accessible documents.
        </p>
      </div>
    </div>
  );
}
