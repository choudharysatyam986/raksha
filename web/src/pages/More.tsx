import { Link } from 'react-router-dom';

const ITEMS = [
  ['/map', '🗺️', 'Safety map', 'Aggregated area risk, patterns and guidance'],
  ['/circles', '👭', 'Safe Circles', 'Peer check-ins and “Are you okay?” nudges'],
  ['/share', '📍', 'Temporary location sharing', 'Links that expire automatically'],
  ['/events', '🎪', 'Event Safety Bubble', 'Group status and crowd risk alerts'],
  ['/evidence', '🔒', 'Evidence vault', 'Encrypted files with SHA-256 integrity'],
  ['/reports', '🗂️', 'My reports', 'History, details and retraction'],
  ['/contacts', '📇', 'Trusted contacts', 'Link Telegram for alerts'],
  ['/alerts', '🔔', 'Alerts', 'Everything Raksha told you'],
  ['/settings', '⚙️', 'Settings & permissions', 'Voice Guard, watch areas, notifications'],
  ['/authority', '🏛️', 'Authority dashboard', 'For police / campus / transport officials (key required)'],
];

export default function More() {
  return (
    <div className="card">
      <ul className="list">
        {ITEMS.map(([to, ic, title, sub]) => (
          <li key={to}>
            <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }} className="row nowrap">
              <span style={{ fontSize: '1.5rem', width: 36 }}>{ic}</span>
              <span className="grow">
                <b>{title}</b>
                <br />
                <small>{sub}</small>
              </span>
              <span className="muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
