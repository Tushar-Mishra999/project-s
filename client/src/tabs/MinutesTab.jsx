export default function MinutesTab() {
  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>MoM — Minutes of Meeting</h1>
          <div className="sub">
            Capture meeting notes, decisions, and action items in one place.
          </div>
        </div>
        <button className="primary-btn" disabled>+ New Meeting</button>
      </div>

      <div className="placeholder-panel">
        <div className="placeholder-icon">📝</div>
        <h2>Coming soon</h2>
        <p>
          Upload audio, paste a transcript, or take notes live — Kernel will turn them
          into structured Minutes with attendees, decisions, and assigned action items
          that flow automatically into the Action Items tab.
        </p>
      </div>
    </div>
  );
}
