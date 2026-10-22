import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Circle, MapContainer, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import { post } from '../api';
import { DEFAULT_CENTER, ErrorBox, Loading, LocationPicker, Recenter, Section, TILE_ATTR, TILE_URL } from '../components';
import { useAction, useApi, useApp, useNow } from '../state';
import { locate } from '../tracker';
import { ago, fmtTime } from '../util';

const ZONE_COLORS: Record<string, string> = { warning: '#d32f2f', advisory: '#f57c00' };
const toLocalInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function ClickToAdd({ onAdd }: { onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onAdd(e.latlng.lat, e.latlng.lng) });
  return null;
}

function CreateEvent({ onCreated }: { onCreated: (id: string) => void }) {
  const { me } = useApp();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(500);
  const [starts, setStarts] = useState(toLocalInput(Date.now()));
  const [ends, setEnds] = useState(toLocalInput(Date.now() + 6 * 3600_000));
  const [zones, setZones] = useState<Array<{ name: string; lat: number; lng: number; radiusM: number }>>([]);
  const [advisory, setAdvisory] = useState(2);
  const [warning, setWarning] = useState(4);

  const create = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Give the event a name');
      if (!center) throw new Error('Pick the event location');
      if (!zones.length) throw new Error('Add at least one subzone (tap the map below)');
      const r = await post<any>('/events', {
        name, centerLat: center.lat, centerLng: center.lng, radiusM: radius,
        startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(),
        subzones: zones, thresholds: { advisory, warning }, displayName: me?.displayName || 'Organiser',
      });
      onCreated(r.event.id);
    }, 'Event created');

  return (
    <Section title="Organise an event">
      <label>Event name</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. College fest 2025" />
      <label>Venue centre</label>
      <LocationPicker value={center} onChange={setCenter} />
      <label>Venue radius: {radius} m</label>
      <input type="range" min={100} max={3000} step={50} value={radius} onChange={(e) => setRadius(+e.target.value)} />
      <div className="grid2">
        <div>
          <label>Starts</label>
          <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        </div>
        <div>
          <label>Ends</label>
          <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </div>
      </div>
      {center && (
        <>
          <label>Subzones — tap the map to add (gates, stage, parking…)</label>
          <div className="map short">
            <MapContainer center={[center.lat, center.lng]} zoom={16} style={{ height: '100%' }}>
              <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
              <Circle center={[center.lat, center.lng]} radius={radius} pathOptions={{ color: '#6a1b9a', fillOpacity: 0.05 }} />
              {zones.map((z, i) => (
                <Circle key={i} center={[z.lat, z.lng]} radius={z.radiusM} pathOptions={{ color: '#0277bd' }}>
                  <Tooltip permanent>{z.name}</Tooltip>
                </Circle>
              ))}
              <ClickToAdd onAdd={(lat, lng) => setZones((zs) => [...zs, { name: `Zone ${zs.length + 1}`, lat, lng, radiusM: 80 }])} />
            </MapContainer>
          </div>
          {zones.map((z, i) => (
            <div key={i} className="row nowrap" style={{ marginTop: 6 }}>
              <input type="text" value={z.name} onChange={(e) => setZones((zs) => zs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input type="number" style={{ width: 80 }} min={20} max={5000} value={z.radiusM} onChange={(e) => setZones((zs) => zs.map((x, j) => (j === i ? { ...x, radiusM: +e.target.value || 80 } : x)))} />
              <button className="small ghost" onClick={() => setZones((zs) => zs.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </>
      )}
      <label>Alert thresholds (reports per subzone)</label>
      <div className="grid2">
        <div>
          <small>Advisory at</small>
          <input type="number" min={1} max={50} value={advisory} onChange={(e) => setAdvisory(+e.target.value || 1)} />
        </div>
        <div>
          <small>Warning at</small>
          <input type="number" min={1} max={100} value={warning} onChange={(e) => setWarning(+e.target.value || 1)} />
        </div>
      </div>
      <button className="block" style={{ marginTop: 12 }} disabled={busy} onClick={create}>
        Create event
      </button>
    </Section>
  );
}

function EventList() {
  const { me } = useApp();
  const nav = useNavigate();
  const { busy, run } = useAction();
  const list = useApi<{ events: any[] }>('/events');
  const [code, setCode] = useState('');
  const [name, setName] = useState(me?.displayName ?? '');
  const [showCreate, setShowCreate] = useState(false);

  const join = () =>
    run(async () => {
      const r = await post<any>('/events/join', { code, displayName: name || 'Attendee' });
      nav(`/events/${r.event.id}`);
    }, 'Joined the safety bubble');

  return (
    <div>
      <h1>🎪 Event Safety Bubble</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        For fests, concerts and melas: share a quick “safe / need help” status with your group and get alerts when harassment reports cluster in a part of the venue.
      </p>
      <Section title="Join with a code">
        <div className="grid2">
          <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Event code (e.g. FEST24)" maxLength={8} />
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name in this event" />
        </div>
        <button className="block" style={{ marginTop: 8 }} disabled={busy || !code} onClick={join}>
          Join event
        </button>
      </Section>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading /> : null}
      {list.data?.events?.map((e) => (
        <Link key={e.id} to={`/events/${e.id}`} className="card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
          <div className="row between nowrap">
            <b>{e.name}</b>
            <span className={`badge ${e.myRole === 'organizer' ? 'b-primary' : 'b-muted'}`}>{e.myRole}</span>
          </div>
          <small className="muted">
            {fmtTime(e.startsAt)} – {fmtTime(e.endsAt)} · {e.memberCount} in bubble · code {e.code}
          </small>
        </Link>
      ))}
      {showCreate ? (
        <CreateEvent onCreated={(id) => nav(`/events/${id}`)} />
      ) : (
        <button className="secondary block" onClick={() => setShowCreate(true)}>
          + Organise a new event
        </button>
      )}
    </div>
  );
}

function EventDetail({ id }: { id: string }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const now = useNow(5000);
  const { busy, run } = useAction();
  const ev = useApi<{ event: any }>(`/events/${id}`, 5000);
  const [zone, setZone] = useState('');

  if (ev.loading && !ev.data) return <Loading />;
  if (ev.error) return <ErrorBox error={ev.error} onRetry={ev.reload} />;
  const e = ev.data!.event;

  const setStatus = (status: 'safe' | 'need_help') =>
    run(async () => {
      const fix = await locate(5000);
      const r = await post<any>(`/events/${id}/status`, { status, subzoneId: zone || undefined, lat: fix?.lat, lng: fix?.lng });
      ev.setData(r);
    }, status === 'safe' ? 'Marked safe ✅' : 'Your bubble has been alerted');

  const leave = () =>
    confirm('Leave this event bubble?') &&
    run(async () => {
      await post(`/events/${id}/leave`);
      nav('/events');
    }, 'Left event');

  const helpers = e.members.filter((m: any) => m.status === 'need_help');
  const activeAlerts = e.subzones.filter((z: any) => z.alertLevel);

  return (
    <div>
      <Link to="/events" className="link">
        ← Events
      </Link>
      <h1 style={{ marginTop: 4 }}>{e.name}</h1>
      <small className="muted">
        {fmtTime(e.startsAt)} – {fmtTime(e.endsAt)} · code <b className="mono">{e.code}</b>{' '}
        <button className="link" onClick={async () => toast((await navigator.clipboard?.writeText(e.code).then(() => true, () => false)) ? 'Code copied' : e.code, 'ok')}>
          copy
        </button>
      </small>

      {helpers.map((m: any) => (
        <div key={m.memberId} className="card alert-danger">
          🆘 <b>{m.isMe ? 'You' : m.displayName}</b> need{m.isMe ? '' : 's'} help{m.subzoneId ? ` near ${e.subzones.find((z: any) => z.id === m.subzoneId)?.name ?? m.subzoneId}` : ''} · {ago(m.statusAt, now)}
        </div>
      ))}
      {activeAlerts.map((z: any) => (
        <div key={z.id} className={`card ${z.alertLevel === 'warning' ? 'alert-danger' : 'alert-warn'}`}>
          ⚠️ <b>{z.alertLevel === 'warning' ? 'Warning' : 'Advisory'}:</b> {z.reportCount} harassment reports near <b>{z.name}</b>. {z.alertLevel === 'warning' ? 'Avoid this area or move in groups; organisers have been alerted.' : 'Stay alert and stick with friends.'}
        </div>
      ))}

      <div className="card">
        <div className="row between">
          <b>My status: {e.myStatus === 'safe' ? '✅ Safe' : e.myStatus === 'need_help' ? '🆘 Need help' : '❔ Not shared'}</b>
        </div>
        <label>I’m near (optional)</label>
        <select value={zone} onChange={(x) => setZone(x.target.value)}>
          <option value="">Use my GPS</option>
          {e.subzones.map((z: any) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <div className="grid2" style={{ marginTop: 8 }}>
          <button className="ok" disabled={busy} onClick={() => setStatus('safe')}>
            ✅ I’m safe
          </button>
          <button className="danger" disabled={busy} onClick={() => setStatus('need_help')}>
            🆘 Need help
          </button>
        </div>
        <Link to={`/report?event=${e.id}`} className="btn secondary block" style={{ marginTop: 8 }}>
          📝 Report harassment at this event
        </Link>
      </div>

      <div className="map">
        <MapContainer center={[e.centerLat ?? DEFAULT_CENTER[0], e.centerLng ?? DEFAULT_CENTER[1]]} zoom={16} style={{ height: '100%' }}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <Recenter center={[e.centerLat, e.centerLng]} zoom={16} />
          <Circle center={[e.centerLat, e.centerLng]} radius={e.radiusM} pathOptions={{ color: '#6a1b9a', fillOpacity: 0.04 }} />
          {e.subzones.map((z: any) => (
            <Circle key={z.id} center={[z.lat, z.lng]} radius={z.radiusM} pathOptions={{ color: ZONE_COLORS[z.alertLevel] ?? '#2e7d32', fillOpacity: z.alertLevel ? 0.35 : 0.12 }}>
              <Tooltip permanent direction="top">
                {z.name} · {z.reportCount}
              </Tooltip>
            </Circle>
          ))}
        </MapContainer>
      </div>

      <div className="grid3">
        <div className="tile">
          <div className="big-num">{e.statusCounts.safe}</div>
          <small>Safe</small>
        </div>
        <div className="tile">
          <div className="big-num" style={{ color: e.statusCounts.needHelp ? '#d32f2f' : undefined }}>
            {e.statusCounts.needHelp}
          </div>
          <small>Need help</small>
        </div>
        <div className="tile">
          <div className="big-num">{e.statusCounts.unknown}</div>
          <small>Unknown</small>
        </div>
      </div>

      <Section title={`Subzones (alert at ${e.thresholds.advisory} / ${e.thresholds.warning} reports)`}>
        <table className="simple">
          <tbody>
            {e.subzones.map((z: any) => (
              <tr key={z.id}>
                <td>{z.name}</td>
                <td>{z.reportCount} reports</td>
                <td>{z.alertLevel ? <span className={`badge ${z.alertLevel === 'warning' ? 'b-danger' : 'b-warn'}`}>{z.alertLevel}</span> : <span className="badge b-ok">ok</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`People in the bubble (${e.members.length})`}>
        <ul className="list">
          {e.members.map((m: any) => (
            <li key={m.memberId} className="row between nowrap">
              <span className="grow">
                {m.displayName} {m.isMe && <small>(you)</small>} {m.role === 'organizer' && <span className="badge b-primary">organiser</span>}
              </span>
              <span className={`badge ${m.status === 'safe' ? 'b-ok' : m.status === 'need_help' ? 'b-danger' : 'b-muted'}`}>{m.status.replace('_', ' ')}</span>
              <small>{m.statusAt ? ago(m.statusAt, now) : ''}</small>
            </li>
          ))}
        </ul>
      </Section>

      {e.alerts.length > 0 && (
        <Section title="Alert history">
          <ul className="list">
            {e.alerts.map((a: any) => (
              <li key={a.id}>
                <span className={`badge ${a.level === 'warning' ? 'b-danger' : 'b-warn'}`}>{a.level}</span> {a.subzoneName} reached {a.count} reports · {ago(a.createdAt, now)}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {e.myRole !== 'organizer' && (
        <button className="ghost block" disabled={busy} onClick={leave}>
          Leave event
        </button>
      )}
    </div>
  );
}

export default function Events() {
  const { id } = useParams();
  return id ? <EventDetail id={id} /> : <EventList />;
}
