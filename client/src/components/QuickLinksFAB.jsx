import { useState } from 'react';

const LINKS_BY_PART = {
  PRISM: [
    { label: 'OnePrism',  href: 'https://oneprism.com', icon: '🔗' },
  ],
  'Data Management': [
    { label: 'Dataflo',   href: 'https://dataflo.io',  icon: '📊' },
    { label: 'DataVault', href: 'https://datavault.io', icon: '🗄️' },
  ],
};

export default function QuickLinksFAB({ activePart }) {
  const [open, setOpen] = useState(false);
  const links = LINKS_BY_PART[activePart];
  if (!links?.length) return null;

  return (
    <>
      {/* Panel — slides up above the FAB */}
      <div className={`ql-fab-panel${open ? ' ql-fab-panel-open' : ''}`}>
        <div className="ql-fab-panel-title">Quick Links</div>
        {links.map((lk) => (
          <a
            key={lk.href}
            href={lk.href}
            target="_blank"
            rel="noopener noreferrer"
            className="ql-fab-link"
            onClick={() => setOpen(false)}
          >
            <span className="ql-fab-link-icon">{lk.icon}</span>
            <span className="ql-fab-link-label">{lk.label}</span>
            <span className="ql-fab-link-arrow">↗</span>
          </a>
        ))}
      </div>

      {/* Transparent backdrop to close panel on outside click */}
      {open && <div className="ql-fab-backdrop" onClick={() => setOpen(false)} />}

      {/* FAB pill */}
      <button
        className={`ql-fab${open ? ' ql-fab-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Quick Links"
      >
        <div className="ql-fab-inner">
          {open ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          )}
        </div>
        <span className="ql-fab-label">Quick Links</span>
      </button>
    </>
  );
}
