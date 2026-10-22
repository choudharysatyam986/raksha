import { Link } from 'react-router-dom';
import { useApp, useApi, useNow } from '../state';
import { countdown, STATE_LABELS } from '../util';

export default function Home() {
  const { me, meta } = useApp();
  const now = useNow();
  const trip = useApi<{ trip: any }>('/trips/active', 5000);
  const circles = useApi<{ circles: any[] }>('/circles', 8000);
  const nudges = useApi<{ nudges: any[] }>('/nudges', 8000);
  const pendingNudges = (nudges.data?.nudges ?? []).filter((n) => n.incoming && n.status === 'pending');
  const t = trip.data?.trip;
  const attention = (circles.data?.circles ?? []).flatMap((c) => c.members.filter((m: any) => !m.isMe && ['sos', 'help', 'overdue'].includes(m.state)).map((m: any) => ({ ...m, circle: c.name })));

  return (
    <div>
      <div className="card hero">
        <h1>Hi{me?.displayName ? `, ${me.displayName}` : ''} 💜</h1>
        <p className="muted">Anonymous by default. No phone number or email needed.</p>
        <div className="row" style={{ marginTop: 10 }}>
          <a className="btn small" style={{ background: '#fff', color: '#b91c1c' }} href={`tel:${meta?.helplines.emergency ?? '112'}`}>
            📞 112 Emergency
          </a>
          <a className="btn small" style={{ background: '#fff', color: '#6d28d9' }} href={`tel:${meta?.helplines.women ?? '181'}`}>
            📞 181 Women helpline
          </a>
        </div>
      </div>

      {me?.activeSos && (
        <Link to="/sos" className="card alert-danger" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <b>🚨 Your SOS is active.</b> Tap to resolve or cancel.
        </Link>
      )}

      {attention.map((m) => (
        <Link key={m.memberId} to={m.sharePath ?? '/circles'} className="card alert-danger" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <b>{m.displayName}</b> ({m.circle}) — {STATE_LABELS[m.state]?.label}. {m.sharePath ? 'Tap to see live location.' : 'Open Safe Circles.'}
        </Link>
      ))}

      {pendingNudges.map((n) => (
        <Link key={n.id} to="/circles" className="card alert-warn" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          💬 <b>{n.fromName}</b> asks: “Are you okay?” Tap to reply.
        </Link>
      ))}

      {t && (
        <Link to="/trip" className={`card ${t.stage >= 1 || now > t.nextCheckinAt ? 'alert-warn' : 'alert-info'}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div className="row between">
            <b>🚶 Trip to {t.destination}</b>
            <span className="badge b-primary">ETA {countdown(t.etaAt, now)}</span>
          </div>
          <small>Next check-in in {countdown(t.nextCheckinAt, now)} — tap to check in</small>
        </Link>
      )}

      <div className="grid3">
        <Tile to="/report" ic="📝" title="Report" sub="Anonymous" />
        <Tile to="/map" ic="🗺️" title="Safety map" sub="Area risk" />
        <Tile to="/trip" ic="🚶" title="Trip check-in" sub="Late commute" />
        <Tile to="/circles" ic="👭" title="Safe Circles" sub="Peers" />
        <Tile to="/share" ic="📍" title="Share location" sub="Auto-expires" />
        <Tile to="/events" ic="🎪" title="Event bubble" sub="Crowds" />
        <Tile to="/evidence" ic="🔒" title="Evidence vault" sub="Encrypted" />
        <Tile to="/reports" ic="🗂️" title="My reports" sub="History" />
        <Tile to="/contacts" ic="📇" title="Trusted contacts" sub="Telegram" />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>How Raksha protects you</h3>
        <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6, fontSize: '0.9rem' }}>
          <li>Reports are anonymous; names/phones are scrubbed and locations blurred to ~150 m.</li>
          <li>Areas appear on the map only after 3+ independent devices report there.</li>
          <li>Missed check-ins alert your circle in stages — Raksha never calls police on its own.</li>
          <li>Location links expire automatically; you get a reminder before they do.</li>
        </ul>
      </div>
    </div>
  );
}

function Tile({ to, ic, title, sub }: { to: string; ic: string; title: string; sub: string }) {
  return (
    <Link to={to} className="tile">
      <span className="ic">{ic}</span>
      <b>{title}</b>
      <small className="muted">{sub}</small>
    </Link>
  );
}
