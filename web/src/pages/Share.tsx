import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { post } from '../api';
import { ErrorBox, Loading, Radio, Section } from '../components';
import { useAction, useApi, useApp, useNow } from '../state';
import { pingNow } from '../tracker';
import { absUrl, copyText, countdown, fmtClock, pretty, shareOrCopy, smsLink, unitLabel, waLink } from '../util';

/** Checkbox lists of Safe Circles and trusted contacts (used by Share and SOS). */
export function Recipients({ circleIds, setCircleIds, contactIds, setContactIds }: { circleIds: string[]; setCircleIds: (v: string[]) => void; contactIds: string[]; setContactIds: (v: string[]) => void }) {
  const circles = useApi<{ circles: any[] }>('/circles');
  const contacts = useApi<{ contacts: any[] }>('/contacts');
  const toggle = (arr: string[], id: string, set: (v: string[]) => void) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  return (
    <div>
      <label>Safe Circles</label>
      {circles.data?.circles?.length ? (
        circles.data.circles.map((c) => (
          <label key={c.id} className="inline">
            <input type="checkbox" checked={circleIds.includes(c.id)} onChange={() => toggle(circleIds, c.id, setCircleIds)} /> {c.name} <small className="muted">({c.members.length})</small>
          </label>
        ))
      ) : (
        <small className="muted">
          No circles yet. <Link to="/circles">Create one</Link>
        </small>
      )}
      <label>Trusted contacts</label>
      {contacts.data?.contacts?.length ? (
        contacts.data.contacts.map((c) => (
          <label key={c.id} className="inline">
            <input type="checkbox" checked={contactIds.includes(c.id)} onChange={() => toggle(contactIds, c.id, setContactIds)} /> {c.name}{' '}
            <small className="muted">{c.telegramLinked ? '· Telegram ✓' : c.phone ? '· SMS/WhatsApp (manual)' : ''}</small>
          </label>
        ))
      ) : (
        <small className="muted">
          No contacts yet. <Link to="/contacts">Add trusted contacts</Link>
        </small>
      )}
    </div>
  );
}

/** Shows per-contact delivery status with manual SMS / WhatsApp fallbacks. */
export function DeliveryList({ contacts, text }: { contacts: any[]; text: string }) {
  if (!contacts?.length) return null;
  return (
    <ul className="list">
      {contacts.map((c) => (
        <li key={c.contactId} className="row between nowrap">
          <span className="grow">
            {c.name} {c.delivered ? <span className="badge b-ok">Sent via {c.channel}</span> : <span className="badge b-warn">Send manually</span>}
          </span>
          {!c.delivered && (
            <>
              <a className="btn small secondary" href={smsLink(text, c.phone)}>
                SMS
              </a>
              <a className="btn small secondary" href={waLink(text, c.phone)} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function QR({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setSrc).catch(() => setSrc(''));
  }, [url]);
  return src ? <img className="qr" src={src} alt="QR code for tracking link" /> : null;
}

export default function Share() {
  const { meta, me, refreshMe, toast } = useApp();
  const { busy, run } = useAction();
  const now = useNow(1000);
  const shares = useApi<{ shares: any[] }>('/shares', 4000);
  const u = unitLabel(meta?.demoMode);
  const [label, setLabel] = useState('Cab ride home');
  const [duration, setDuration] = useState<number>(me?.settings?.defaultShareMinutes ?? 30);
  const [stopOnArrival, setStopOnArrival] = useState(true);
  const [circleIds, setCircleIds] = useState<string[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [created, setCreated] = useState<any>(null);

  const create = () =>
    run(async () => {
      const r = await post<any>('/shares', { label: label || 'My location', durationMin: duration, stopOnArrival, circleIds, contactIds });
      setCreated(r);
      await Promise.all([shares.reload(), refreshMe()]);
      pingNow();
    }, 'Sharing started');

  const act = (id: string, path: string, body: any = {}, msg?: string) =>
    run(async () => {
      await post(`/shares/${id}/${path}`, body);
      await Promise.all([shares.reload(), refreshMe()]);
    }, msg);

  const active = (shares.data?.shares ?? []).filter((s) => s.status === 'active');
  const past = (shares.data?.shares ?? []).filter((s) => s.status !== 'active').slice(0, 5);
  const durations = [15, 30, 60, 120, 240];

  return (
    <div>
      <h1>📍 Share location (auto-expiring)</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        Links stop by themselves — you get a reminder before expiry, so you never “forget to turn it off”.
      </p>
      <ErrorBox error={shares.error} onRetry={shares.reload} />

      {created && (
        <div className="card alert-ok">
          <div className="row between">
            <b>Link ready ✓</b>
            <button className="small ghost" onClick={() => setCreated(null)}>
              ✕
            </button>
          </div>
          <div className="center">
            <QR url={absUrl(created.share.path)} />
          </div>
          <p className="mono">{absUrl(created.share.path)}</p>
          <div className="row">
            <button className="small" onClick={async () => toast((await shareOrCopy('Track my location', `Track my live location (${created.share.label}) until ${fmtClock(created.share.expiresAt)}:`, absUrl(created.share.path))) === 'failed' ? 'Could not share' : 'Shared', 'ok')}>
              Share…
            </button>
            <a className="btn small secondary" href={waLink(`Track my live location until ${fmtClock(created.share.expiresAt)}: ${absUrl(created.share.path)}`)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <a className="btn small secondary" href={smsLink(`Track my live location: ${absUrl(created.share.path)}`)}>
              SMS
            </a>
            <button className="small secondary" onClick={async () => toast((await copyText(absUrl(created.share.path))) ? 'Copied' : 'Copy failed', 'ok')}>
              Copy
            </button>
          </div>
          {created.circleNotified > 0 && <p>🔔 Notified {created.circleNotified} circle member(s).</p>}
          <DeliveryList contacts={created.contacts} text={`Track my live location: ${absUrl(created.share.path)}`} />
        </div>
      )}

      {shares.loading && !shares.data ? <Loading /> : null}
      {active.map((s) => {
        const left = s.expiresAt - now;
        return (
          <div key={s.id} className={`card ${s.sosId ? 'alert-danger' : left < 5 * (meta?.unitMs ?? 60000) ? 'alert-warn' : ''}`}>
            <div className="row between nowrap">
              <b>{s.sosId ? '🆘 ' : s.tripId ? '🚶 ' : '📍 '}{s.label}</b>
              <span className="badge b-primary">⏱ {left > 0 ? countdown(s.expiresAt, now) : 'expiring…'}</span>
            </div>
            <small className="muted">
              Expires {fmtClock(s.expiresAt)}
              {s.stopOnArrival && ' · stops on arrival'}
              {s.reminderSent && ' · reminder sent'}
            </small>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="small secondary" disabled={busy} onClick={() => act(s.id, 'extend', { minutes: 15 }, `Extended by 15 ${u}`)}>
                +15
              </button>
              <button className="small secondary" disabled={busy} onClick={() => act(s.id, 'extend', { minutes: 60 }, `Extended by 60 ${u}`)}>
                +60
              </button>
              <button className="small secondary" onClick={() => shareOrCopy('Track my location', `Track my live location (${s.label}):`, absUrl(s.path))}>
                Share
              </button>
              <Link className="btn small ghost" to={s.path}>
                View
              </Link>
              <button className="small danger" disabled={busy} onClick={() => act(s.id, 'stop', {}, 'Stopped sharing')}>
                Stop
              </button>
            </div>
          </div>
        );
      })}

      <Section title="New share link">
        <label>Label (what recipients see)</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        <label>Auto-expire after ({u})</label>
        <Radio options={durations.includes(duration) ? durations : [...durations, duration].sort((a, b) => a - b)} value={duration} onChange={setDuration} labels={(o) => `${o}`} />
        <label className="inline">
          <input type="checkbox" checked={stopOnArrival} onChange={(e) => setStopOnArrival(e.target.checked)} /> Stop automatically when I mark a trip as arrived
        </label>
        <Recipients circleIds={circleIds} setCircleIds={setCircleIds} contactIds={contactIds} setContactIds={setContactIds} />
        <button className="block" style={{ marginTop: 12 }} disabled={busy} onClick={create}>
          Start sharing
        </button>
        <small className="muted">Your location is sent only while a share, trip or SOS is active. Keep this tab open for live updates.</small>
      </Section>

      {past.length > 0 && (
        <Section title="Recent">
          <ul className="list">
            {past.map((s) => (
              <li key={s.id} className="row between nowrap">
                <span className="grow">{s.label}</span>
                <span className="badge b-muted">{pretty(s.status)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
