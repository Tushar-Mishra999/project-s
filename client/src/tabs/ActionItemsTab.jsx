export default function ActionItemsTab({ activePart }) {
  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>Action Items</h1>
          <div className="sub">
            Extract, track, and follow up on action items mined from your team's documents.
          </div>
        </div>
      </div>
      <div className="placeholder-panel">
        <div className="placeholder-icon">📋</div>
        <h2>Coming soon</h2>
        <p>
          This tab will surface action items detected across uploaded documents
          for <strong>{activePart || 'your part'}</strong>, with owners, due dates,
          and status tracking.
        </p>
      </div>
    </div>
  );
}
