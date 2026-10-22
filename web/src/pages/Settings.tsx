import { useEffect, useState } from 'react';
import { del, post, put, resetDeviceToken } from '../api';
import { Loading, LocationPicker, Radio, Section } from '../components';
import { pushSupported, enablePush, disablePush } from '../push';
import { useAction, useApp } from '../state';
import { locate } from '../tracker';
import { unitLabel } from '../util';
import { voiceGuardSupported } from '../voiceGuard';

type Perm = 'granted' | 'denied' | 'prompt' | 'unknown';

async function queryPerm(name: string): Promise<Perm> {
  try {
    const r = await navigator.permissions.query({ name: name as PermissionName });
    return r.state as Perm;
  } catch {
    return 'unknown';
  }
}

const PERM_BADGE: Record<Perm, string> = { granted: 'b-ok', denied: 'b-danger', prompt: 'b-warn', unknown: 'b-muted' };

export default function Settings() {
  const { me, meta, refreshMe, toast } = useApp();
  const { busy, run } = useAction();
  const s = me?.settings;
  const [name, setName] = useState(me?.displayName ?? '');
  const [keywords, setKeywords] = useState<string>('');
  const [areaLabel, setAreaLabel] = useState('');
  const [areaPos, setAreaPos] = useState<{ lat: number; lng: number } | null>(null);
  const [areaRadius, setAreaRadius] = useState(1000);
  const [perms, setPerms] = useState<Record<string, Perm>>({});

  useEffect(() => {
    if (s) setKeywords(s.voiceGuard.keywords.join(', '));
  }, [s?.voiceGuard?.keywords?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (me?.displayName && !name) setName(me.displayName);
  }, [me?.displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkPerms = async () => {
    const [geo, mic, notif] = await Promise.all([queryPerm('geolocation'), queryPerm('microphone'), queryPerm('notifications')]);
    setPerms({ geolocation: geo, microphone: mic, notifications: notif });
  };
  useEffect(() => {
    checkPerms();
  }, []);

  if (!me || !s) return <Loading />;

  const save = (patch: any, msg = 'Saved') =>
    run(async () => {
      await put('/settings', patch);
      await refreshMe();
    }, msg);

  const saveName = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Name cannot be empty');
      await put('/me', { displayName: name.trim() });
      await put('/settings', { displayName: name.trim() });
      await refreshMe();
    }, 'Name updated');

  const saveKeywords = () => {
    const list = keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 10);
    if (!list.length) return toast('Add at least one keyword', 'err');
    save({ voiceGuard: { ...s.voiceGuard, keywords: list } }, 'Keywords saved');
  };

  const addArea = () => {
    if (!areaLabel.trim() || !areaPos) return toast('Give the area a name and pick it on the map', 'err');
    save({ watchAreas: [...s.watchAreas, { label: areaLabel.trim(), lat: areaPos.lat, lng: areaPos.lng, radiusM: areaRadius }] }, 'Watch area added');
    setAreaLabel('');
    setAreaPos(null);
  };

  const togglePush = () =>
    run(async () => {
      if (me.pushSubscribed) {
        await disablePush();
      } else {
        const r = await enablePush(meta?.vapidPublicKey ?? null);
        if (r !== 'ok') throw new Error(r);
      }
      await refreshMe();
      checkPerms();
    }, me.pushSubscribed ? 'Push notifications off' : 'Push notifications on');

  const askLocation = async () => {
    const f = await locate(10000);
    toast(f ? `Location OK (±${Math.round(f.accuracy ?? 0)} m)` : 'Could not get location — check browser/OS settings', f ? 'ok' : 'err');
    checkPerms();
  };

  const askMic = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      st.getTracks().forEach((t) => t.stop());
      toast('Microphone OK', 'ok');
    } catch {
      toast('Microphone blocked — allow it in site settings', 'err');
    }
    checkPerms();
  };

  const wipe = () =>
    confirm('Delete ALL your data from Raksha (reports, circles, trips, evidence, contacts)? This cannot be undone.') &&
    run(async () => {
      await del('/me');
      await disablePush().catch(() => {});
      resetDeviceToken();
      location.href = '/';
    });

  const n = s.notifications;
  const u = unitLabel(meta?.demoMode);
  const shareOpts = [15, 30, 60, 120, 240];

  return (
    <div>
      <h1>⚙️ Settings</h1>

      <Section title="Your name">
        <small className="muted">Shown to your Safe Circle, event bubble and trusted contacts. Never attached to anonymous reports.</small>
        <div className="row nowrap" style={{ marginTop: 6 }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Priya" />
          <button disabled={busy} onClick={saveName}>
            Save
          </button>
        </div>
      </Section>

      <Section
        title="🎙 Voice Guard"
        right={
          <label className="inline">
            <input type="checkbox" disabled={!voiceGuardSupported || busy} checked={s.voiceGuard.enabled} onChange={(e) => save({ voiceGuard: { ...s.voiceGuard, enabled: e.target.checked } }, e.target.checked ? 'Voice Guard on' : 'Voice Guard off')} /> On
          </label>
        }
      >
        {voiceGuardSupported ? (
          <small className="muted">While Raksha is open, saying a keyword starts a 5-second SOS countdown you can cancel. Audio is processed by your browser’s speech service; Raksha stores nothing.</small>
        ) : (
          <div className="card alert-warn tight">This browser doesn’t support speech recognition. Use Chrome on Android for Voice Guard.</div>
        )}
        <label>Keywords (comma separated)</label>
        <div className="row nowrap">
          <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          <button className="secondary" disabled={busy} onClick={saveKeywords}>
            Save
          </button>
        </div>
      </Section>

      <Section title="📍 Watch areas">
        <small className="muted">Get an alert when an area you care about (home, college, office) rises to a higher risk level.</small>
        <ul className="list">
          {s.watchAreas.map((a: any, i: number) => (
            <li key={i} className="row between nowrap">
              <span className="grow">
                {a.label} <small className="muted">{a.radiusM} m</small>
              </span>
              <button className="small ghost" disabled={busy} onClick={() => save({ watchAreas: s.watchAreas.filter((_: any, j: number) => j !== i) }, 'Removed')}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {s.watchAreas.length < 10 && (
          <>
            <label>New area name</label>
            <input type="text" value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder="e.g. Hostel" maxLength={40} />
            <LocationPicker value={areaPos} onChange={setAreaPos} />
            <label>Radius: {areaRadius} m</label>
            <input type="range" min={100} max={10000} step={100} value={areaRadius} onChange={(e) => setAreaRadius(+e.target.value)} />
            <button className="secondary block" disabled={busy} onClick={addArea}>
              Add watch area
            </button>
          </>
        )}
      </Section>

      <Section title="🔔 Notifications">
        <div className="row between">
          <span>Push notifications {me.pushSubscribed ? <span className="badge b-ok">on</span> : <span className="badge b-muted">off</span>}</span>
          {pushSupported() ? (
            <button className="small" disabled={busy} onClick={togglePush}>
              {me.pushSubscribed ? 'Turn off' : 'Turn on'}
            </button>
          ) : (
            <small className="muted">Not supported here (needs HTTPS; on iPhone add to Home Screen first)</small>
          )}
        </div>
        {me.pushSubscribed && (
          <button className="link" onClick={() => run(() => post('/push/test'), 'Test sent')}>
            Send a test notification
          </button>
        )}
        <small className="muted">In-app alerts always work while Raksha is open.</small>
        {(
          [
            ['circleAlerts', 'Safe Circle alerts (nudges, missed check-ins, SOS)'],
            ['watchAreaAlerts', 'Watch area risk changes'],
            ['eventAlerts', 'Event bubble alerts'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="inline">
            <input type="checkbox" disabled={busy} checked={n[k]} onChange={(e) => save({ notifications: { ...n, [k]: e.target.checked } })} /> {label}
          </label>
        ))}
      </Section>

      <Section title="⏱ Default location-share duration">
        <Radio options={shareOpts.includes(s.defaultShareMinutes) ? shareOpts : [...shareOpts, s.defaultShareMinutes].sort((a, b) => a - b)} value={s.defaultShareMinutes} onChange={(v) => save({ defaultShareMinutes: v })} labels={(o) => `${o} ${u}`} />
      </Section>

      <Section title="🔐 Permissions" right={<button className="small ghost" onClick={checkPerms}>Refresh</button>}>
        <ul className="list">
          <li className="row between">
            <span>
              Location <span className={`badge ${PERM_BADGE[perms.geolocation ?? 'unknown']}`}>{perms.geolocation ?? '…'}</span>
            </span>
            <button className="small secondary" onClick={askLocation}>
              Test
            </button>
          </li>
          <li className="row between">
            <span>
              Microphone <span className={`badge ${PERM_BADGE[perms.microphone ?? 'unknown']}`}>{perms.microphone ?? '…'}</span>
            </span>
            <button className="small secondary" onClick={askMic}>
              Test
            </button>
          </li>
          <li className="row between">
            <span>
              Notifications <span className={`badge ${PERM_BADGE[perms.notifications ?? 'unknown']}`}>{perms.notifications ?? '…'}</span>
            </span>
          </li>
        </ul>
        {!window.isSecureContext && <div className="card alert-warn tight">This page is not on HTTPS, so location, microphone and push may be blocked by the browser. See README → “Use on your phone”.</div>}
        <small className="muted">Location is only sent to the server while a trip, share or SOS is active.</small>
      </Section>

      <Section title="🗑 Your data">
        <small className="muted">
          Device ID <span className="mono">{me.deviceId.slice(0, 8)}…</span> — no account, email or phone number is required.
        </small>
        <button className="danger block" style={{ marginTop: 8 }} disabled={busy} onClick={wipe}>
          Delete all my data
        </button>
      </Section>
    </div>
  );
}
