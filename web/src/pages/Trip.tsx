import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { ErrorBox, LocationPicker, Loading, Radio, Section } from '../components';
import { useAction, useApi, useApp, useNow } from '../state';
import { pingNow, getLastFix } from '../tracker';
import { absUrl, ago, copyText, countdown, fmtClock, pretty, shareOrCopy, unitLabel } from '../util';

const STAGE_TEXT = [
  null,
  { cls: 'alert-warn', text: 'You missed a check-in. Check in now — your circle will be alerted soon.' },
  { cls: 'alert-danger', text: 'Your Safe Circle has been alerted that you missed a check-in.' },
  { cls: 'alert-danger', text: 'Your circle and trusted contacts have been alerted. Check in if you are safe.' },
];

export default function Trip() {
  const { meta, refreshMe, toast } = useApp();
  const [params] = useSearchParams();
  const { busy, run } = useAction();
  const now = useNow(1000);
  const active = useApi<{ trip: any }>('/trips/active', 3000);
  const history = useApi<{ trips: any[] }>('/trips');
  const circles = useApi<{ circles: any[] }>('/circles');
  const u = unitLabel(meta?.demoMode);

  const [destination, setDestination] = useState('');
  const [dest, setDest] = useState<{ lat: number; lng: number } | null>(null);
  const [eta, setEta] = useState(30);
  const [interval, setIntervalMin] = useState(10);
  const [circleId, setCircleId] = useState(params.get('circle') ?? '');
  const [shareLocation, setShareLocation] = useState(true);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    if (!circleId && circles.data?.circles?.length) setCircleId(circles.data.circles[0].id);
  }, [circles.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = active.data?.trip;

  const start = () =>
    run(async () => {
      if (!destination.trim()) throw new Error('Where are you going?');
      await post('/trips', { destination, destLat: dest?.lat ?? null, destLng: dest?.lng ?? null, etaMinutes: eta, checkinIntervalMin: Math.min(interval, eta), circleId: circleId || null, shareLocation });
      await Promise.all([active.reload(), refreshMe()]);
      pingNow();
    }, 'Trip started. Stay safe 💜');

  const act = (path: string, body: any = {}, msg?: string) =>
    run(async () => {
      const fix = getLastFix();
      const r = await post(`/trips/${t.id}/${path}`, path === 'checkin' && fix ? { ...body, lat: fix.lat, lng: fix.lng } : body);
      await Promise.all([active.reload(), refreshMe(), history.reload()]);
      return r;
    }, msg);

  if (active.loading && !active.data) return <Loading />;

  if (t) {
    const due = t.nextCheckinAt;
    const overdue = now > due;
    const stage = STAGE_TEXT[t.stage];
    return (
      <div>
        <h1>🚶 Trip to {t.destination}</h1>
        {stage && <div className={`card ${stage.cls}`}>⚠️ {stage.text}</div>}
        {t.lastState === 'help' && <div className="card alert-danger">🆘 Help requested. Your circle and contacts have your live location. Call 112 if you can.</div>}
        <div className={`card center ${overdue ? 'alert-warn' : ''}`}>
          <small>{overdue ? 'Check-in overdue by' : 'Next check-in in'}</small>
          <div className="big-num">{countdown(due, now).replace('-', '')}</div>
          <small>
            ETA {fmtClock(t.etaAt)} ({now > t.etaAt ? `${countdown(t.etaAt, now).replace('-', '')} late` : `in ${countdown(t.etaAt, now)}`}) · check-in every {t.checkinIntervalMin} {u}
          </small>
          <button className="ok block" style={{ marginTop: 12, fontSize: '1.1rem', minHeight: 54 }} disabled={busy} onClick={() => act('checkin', { kind: 'safe' }, 'Checked in safe ✅')}>
            ✅ I’m safe
          </button>
          <div className="grid2" style={{ marginTop: 8 }}>
            <button className="warn" disabled={busy} onClick={() => act('checkin', { kind: 'delayed', delayMinutes: 10 }, `Circle told you’re 10 ${u} late`)}>
              🕒 Delayed +10
            </button>
            <button className="danger" disabled={busy} onClick={() => confirm('Alert your circle and trusted contacts that you need help now?') && act('checkin', { kind: 'help' }, 'Help requested — your circle has been alerted')}>
              🆘 Need help
            </button>
          </div>
          <div className="grid3" style={{ marginTop: 8 }}>
            <button className="secondary small" disabled={busy} onClick={() => act('extend', { minutes: 10 }, `ETA extended by 10 ${u}`)}>
              +10 ETA
            </button>
            <button className="secondary small" disabled={busy} onClick={() => act('extend', { minutes: 30 }, `ETA extended by 30 ${u}`)}>
              +30 ETA
            </button>
            <button className="ghost small" disabled={busy} onClick={() => confirm('Cancel this trip? Your circle will stop monitoring it.') && act('cancel', {}, 'Trip cancelled')}>
              Cancel trip
            </button>
          </div>
          <button className="block" style={{ marginTop: 10 }} disabled={busy} onClick={async () => {
            const r: any = await act('arrive');
            if (r) toast(`Arrived safely 🏠${r.stoppedShares ? ` · stopped ${r.stoppedShares} location share(s)` : ''}`, 'ok');
          }}>
            🏠 I’ve arrived
          </button>
        </div>

        {t.share && t.share.status === 'active' && (
          <div className="card">
            <b>📍 Live location link</b> <small>(auto-stops on arrival · expires {fmtClock(t.share.expiresAt)})</small>
            <p className="mono">{absUrl(t.share.path)}</p>
            <div className="row">
              <button className="small secondary" onClick={async () => toast((await copyText(absUrl(t.share.path))) ? 'Link copied' : 'Copy failed', 'ok')}>
                Copy
              </button>
              <button className="small secondary" onClick={() => shareOrCopy('My live location', `I'm on my way to ${t.destination}. Track me here until I arrive:`, absUrl(t.share.path))}>
                Share
              </button>
              <Link className="btn small ghost" to={t.share.path}>
                Preview
              </Link>
            </div>
          </div>
        )}

        <Section title="Timeline">
          <ul className="list">
            {t.checkins.map((c: any, i: number) => (
              <li key={i} className="row between nowrap">
                <span>
                  {c.kind.startsWith('escalation') ? `⚠️ Escalation stage ${c.kind.split('_').pop()}` : pretty(c.kind)}
                  {c.note && <small> · {c.note}</small>}
                </span>
                <small>{ago(c.at, now)}</small>
              </li>
            ))}
          </ul>
        </Section>
        <p className="muted center" style={{ fontSize: '0.8rem' }}>
          Missed check-ins escalate in stages: reminder to you → Safe Circle → trusted contacts. Raksha never contacts police automatically.
        </p>
      </div>
    );
  }

  const opts = meta?.demoMode ? [15, 30, 60, 120] : [15, 30, 45, 60, 90];
  return (
    <div>
      <h1>🚶 Start a trip check-in</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        Going home late? Your Safe Circle is alerted only if you miss a check-in.
      </p>
      <ErrorBox error={active.error} onRetry={active.reload} />
      {meta?.demoMode && <div className="card alert-info tight">⏩ Demo mode: “{u}” = seconds so you can watch escalation happen live.</div>}
      <Section title="Trip details">
        <label>Destination</label>
        <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Home, PG in Koramangala" />
        <button className="link" style={{ marginTop: 4 }} onClick={() => setShowMap((s) => !s)}>
          {showMap ? 'Hide map' : 'Pick destination on map (optional)'}
        </button>
        {showMap && <LocationPicker value={dest} onChange={setDest} />}
        <label>
          Expected travel time ({u})
        </label>
        <Radio options={opts} value={eta} onChange={setEta} labels={(o) => `${o}`} />
        <label>Check in every ({u})</label>
        <Radio options={[5, 10, 15, 20, 30]} value={interval} onChange={setIntervalMin} labels={(o) => `${o}`} />
        <label>Who should watch over this trip?</label>
        {circles.data?.circles?.length ? (
          <select value={circleId} onChange={(e) => setCircleId(e.target.value)}>
            {circles.data.circles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.members.length} members)
              </option>
            ))}
            <option value="">All my circles</option>
          </select>
        ) : (
          <p className="card alert-warn tight">
            You are not in a Safe Circle yet. <Link to="/circles">Create or join one</Link> so someone is alerted if you miss a check-in. (Trusted contacts are still alerted at the last stage.)
          </p>
        )}
        <label className="inline">
          <input type="checkbox" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} /> Share my live location with the circle during the trip (stops on arrival)
        </label>
        <button className="block" style={{ marginTop: 10 }} disabled={busy} onClick={start}>
          Start trip
        </button>
      </Section>

      {history.data?.trips?.length ? (
        <Section title="Recent trips">
          <ul className="list">
            {history.data.trips.slice(0, 5).map((h) => (
              <li key={h.id} className="row between nowrap">
                <span className="grow">{h.destination}</span>
                <span className={`badge ${h.status === 'arrived' ? 'b-ok' : 'b-muted'}`}>{pretty(h.status)}</span>
                <small>{ago(h.startedAt, now)}</small>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
