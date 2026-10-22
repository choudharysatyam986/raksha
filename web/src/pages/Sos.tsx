import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '../api';
import { Loading, Section } from '../components';
import { useAction, useApi, useApp, useNow } from '../state';
import { locate, pingNow } from '../tracker';
import { absUrl, ago, copyText, shareOrCopy, smsLink, waLink } from '../util';
import { DeliveryList, Recipients } from './Share';

const VOICE_COUNTDOWN = 5;

export default function Sos() {
  const { me, meta, refreshMe, toast } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { busy, run } = useAction();
  const now = useNow(1000);
  const active = useApi<{ sos: any }>('/sos/active', 4000);
  const [note, setNote] = useState('');
  const [circleIds, setCircleIds] = useState<string[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [picked, setPicked] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [count, setCount] = useState<number | null>(null);
  const timer = useRef<number>();

  // Default: alert everyone
  useEffect(() => {
    if (picked) return;
    Promise.all([get<any>('/circles'), get<any>('/contacts')])
      .then(([c, k]) => {
        setCircleIds(c.circles.map((x: any) => x.id));
        setContactIds(k.contacts.map((x: any) => x.id));
        setPicked(true);
      })
      .catch(() => {});
  }, [picked]);

  const trigger = () =>
    run(async () => {
      const fix = await locate(6000).catch(() => null);
      const r = await post<any>('/sos', { lat: fix?.lat, lng: fix?.lng, note: note || undefined, circleIds, contactIds });
      setResult(r);
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      await Promise.all([active.reload(), refreshMe()]);
      pingNow();
    }, 'SOS sent');

  // Voice Guard → 5-second cancellable countdown
  useEffect(() => {
    if (params.get('trigger') !== 'voice' || !picked || active.data?.sos) return;
    setCount(VOICE_COUNTDOWN);
    timer.current = window.setInterval(() => setCount((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearInterval(timer.current);
  }, [params, picked, active.data?.sos]);
  useEffect(() => {
    if (count === 0) {
      window.clearInterval(timer.current);
      setCount(null);
      setParams({}, { replace: true });
      trigger();
    }
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps
  const abortCountdown = () => {
    window.clearInterval(timer.current);
    setCount(null);
    setParams({}, { replace: true });
    toast('Voice SOS cancelled', 'info');
  };

  const end = (kind: 'resolve' | 'cancel') =>
    run(async () => {
      const r = await post<any>(`/sos/${active.data!.sos.id}/${kind}`);
      setResult(null);
      await Promise.all([active.reload(), refreshMe()]);
      toast(r.message, 'ok');
    });

  const helplines = meta?.helplines ?? { emergency: '112', women: '181', cyber: '1930' };
  const callRow = (
    <div className="grid2">
      <a className="btn danger" href={`tel:${helplines.emergency}`}>
        📞 Call {helplines.emergency}
      </a>
      <a className="btn warn" href={`tel:${helplines.women}`}>
        📞 Women {helplines.women}
      </a>
    </div>
  );

  if (active.loading && !active.data) return <Loading />;
  const sos = active.data?.sos;

  if (count !== null) {
    return (
      <div className="center">
        <h1>🎙 Voice Guard heard your keyword</h1>
        <div className="sos-big pulse" style={{ fontSize: '4rem' }}>
          {count}
        </div>
        <p>Sending SOS to your circle and contacts…</p>
        <button className="block secondary" style={{ minHeight: 60, fontSize: '1.2rem' }} onClick={abortCountdown}>
          ✋ Cancel — I’m okay
        </button>
      </div>
    );
  }

  if (sos) {
    const link = sos.share ? absUrl(sos.share.path) : '';
    const text = result?.smsText ? result.smsText.replace(sos.share?.url ?? '\u0000', link) : `SOS from ${me?.displayName ?? 'me'} via Raksha. I need help. Live location: ${link}`;
    return (
      <div>
        <div className="card alert-danger center">
          <h1 style={{ margin: 0 }}>🚨 SOS active</h1>
          <small>Started {ago(sos.startedAt, now)} · your live location is being shared</small>
          {sos.note && <p>“{sos.note}”</p>}
        </div>
        {callRow}
        <Section title="Who was alerted">
          <p>🔔 Circle members notified: {sos.notified?.circleMembers ?? 0}</p>
          {result?.contacts ? (
            <DeliveryList contacts={result.contacts} text={text} />
          ) : (
            (sos.notified?.contacts ?? []).map((c: any, i: number) => (
              <div key={i}>
                {c.name} — {c.delivered ? `sent via ${c.channel}` : 'needs manual message'}
              </div>
            ))
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <a className="btn small secondary" href={smsLink(text)}>
              SMS anyone
            </a>
            <a className="btn small secondary" href={waLink(text)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <button className="small secondary" onClick={async () => toast((await shareOrCopy('SOS', text)) === 'failed' ? 'Could not share' : 'Ready to send', 'ok')}>
              Share…
            </button>
            <button className="small ghost" onClick={async () => toast((await copyText(link)) ? 'Link copied' : 'Copy failed', 'ok')}>
              Copy link
            </button>
          </div>
          {link && (
            <Link to={sos.share.path} className="link">
              View what they see →
            </Link>
          )}
        </Section>
        <div className="grid2">
          <button className="ok" disabled={busy} onClick={() => confirm('Mark yourself safe and stop sharing?') && end('resolve')}>
            ✅ I’m safe now
          </button>
          <button className="ghost" disabled={busy} onClick={() => confirm('Cancel as a false alarm? Everyone alerted will be told.') && end('cancel')}>
            False alarm
          </button>
        </div>
        <p className="muted center" style={{ fontSize: '0.8rem' }}>
          Keep this screen open so your location keeps updating. Raksha does not call police for you — use 112.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="center">Emergency SOS</h1>
      <div className="center">
        <button className="sos-big pulse" disabled={busy} onClick={() => confirm('Send SOS with your live location now?') && trigger()}>
          {busy ? '…' : 'SOS'}
        </button>
        <p className="muted">Alerts your selected circles and contacts with a live location link.</p>
      </div>
      {callRow}
      <Section title="Send to">
        <Recipients circleIds={circleIds} setCircleIds={setCircleIds} contactIds={contactIds} setContactIds={setContactIds} />
        <label>Note (optional)</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Being followed near bus stop" maxLength={200} />
      </Section>
      <Section title="Helplines (India)">
        <ul className="list">
          <li className="row between">
            <span>Emergency (police/ambulance/fire)</span> <a href={`tel:${helplines.emergency}`}>{helplines.emergency}</a>
          </li>
          <li className="row between">
            <span>Women helpline</span> <a href={`tel:${helplines.women}`}>{helplines.women}</a>
          </li>
          <li className="row between">
            <span>Cybercrime</span> <a href={`tel:${helplines.cyber}`}>{helplines.cyber}</a>
          </li>
        </ul>
      </Section>
      <p className="muted center" style={{ fontSize: '0.8rem' }}>
        Tip: turn on <Link to="/settings">Voice Guard</Link> to trigger SOS by saying “bachao” or “help me” while the app is open.
      </p>
      <button className="link" onClick={() => nav(-1)}>
        ← Back
      </button>
    </div>
  );
}
