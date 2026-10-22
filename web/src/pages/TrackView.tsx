import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet';
import { api, ApiError } from '../api';
import { DEFAULT_CENTER, Recenter, TILE_ATTR, TILE_URL } from '../components';
import { useNow } from '../state';
import { ago, countdown, fmtClock } from '../util';

export default function TrackView() {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const now = useNow(1000);

  useEffect(() => {
    let stop = false;
    let timer: number;
    const load = async () => {
      try {
        const r = await api(`/public/share/${token}`, { auth: false });
        if (stop) return;
        setData(r);
        setErr(null);
        // Faster refresh during SOS
        timer = window.setTimeout(load, r.sos ? 3000 : 5000);
      } catch (e) {
        if (stop) return;
        if (e instanceof ApiError && (e.status === 410 || e.status === 404)) {
          setEnded(e.status === 404 ? 'This tracking link does not exist.' : 'Location sharing has ended for this link. 🔒');
          return;
        }
        setErr((e as Error).message);
        timer = window.setTimeout(load, 8000);
      }
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [token]);

  useEffect(() => {
    document.title = data?.sos ? '🚨 SOS — Raksha' : 'Live location — Raksha';
  }, [data?.sos]);

  const header = (
    <div className="topbar">
      <b>🛡️ Raksha · live location</b>
    </div>
  );

  if (ended)
    return (
      <div className="app">
        {header}
        <main className="center" style={{ padding: 24 }}>
          <h2>{ended}</h2>
          <p className="muted">Links expire automatically to protect the sharer’s privacy. If you are worried, call them — or 112 in an emergency.</p>
          <a className="btn danger" href="tel:112">
            📞 Call 112
          </a>
        </main>
      </div>
    );

  const latest = data?.latest;
  const pts: [number, number][] = (data?.trail ?? []).map((p: any) => [p.lat, p.lng]);
  const stale = latest && now - latest.at > 2 * 60_000;

  return (
    <div className="app">
      {header}
      <main style={{ padding: 12 }}>
        {err && <div className="card alert-warn tight">Connection problem: {err}. Retrying…</div>}
        {!data ? (
          <div className="center">
            <div className="spinner" />
          </div>
        ) : (
          <>
            {data.sos && (
              <div className="card alert-danger">
                <b>🚨 {data.name} triggered SOS</b> {ago(data.sos.since, now)}
                {data.sos.note && <div>“{data.sos.note}”</div>}
                <div>Try calling them. If you cannot reach them, call 112 and share this location.</div>
              </div>
            )}
            {data.trip && (
              <div className={`card ${data.trip.overdue || data.trip.state === 'help' ? 'alert-warn' : 'alert-info'}`}>
                🚶 On the way to <b>{data.trip.destination}</b> · ETA {fmtClock(data.trip.etaAt)}
                {data.trip.overdue && ' · ⚠️ missed a check-in'}
                {data.trip.state === 'help' && ' · 🆘 asked for help'}
                {data.trip.state === 'delayed' && ' · running late'}
              </div>
            )}
            <div className="row between nowrap">
              <div>
                <b>{data.name}</b> — {data.label}
                <br />
                <small className="muted">
                  {latest ? `Updated ${ago(latest.at, now)}${latest.accuracy ? ` · ±${Math.round(latest.accuracy)} m` : ''}` : 'Waiting for first location…'} · link expires in {countdown(data.expiresAt, now)}
                </small>
              </div>
              <label className="inline">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
              </label>
            </div>
            {stale && <div className="card alert-warn tight">No update for a while — their phone may be offline or the app closed.</div>}
            <div className="map tall">
              <MapContainer center={latest ? [latest.lat, latest.lng] : DEFAULT_CENTER} zoom={16} style={{ height: '100%' }}>
                <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
                {follow && latest && <Recenter center={[latest.lat, latest.lng]} />}
                {pts.length > 1 && <Polyline positions={pts} pathOptions={{ color: '#6a1b9a', weight: 4, opacity: 0.6 }} />}
                {latest && (
                  <CircleMarker center={[latest.lat, latest.lng]} radius={10} pathOptions={{ color: '#fff', weight: 3, fillColor: data.sos ? '#d32f2f' : '#6a1b9a', fillOpacity: 1 }}>
                    <Popup>
                      {data.name} · {fmtClock(latest.at)}
                    </Popup>
                  </CircleMarker>
                )}
              </MapContainer>
            </div>
            <div className="grid2">
              {latest && (
                <a className="btn secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${latest.lat},${latest.lng}`} target="_blank" rel="noreferrer">
                  🧭 Directions
                </a>
              )}
              <a className="btn danger" href="tel:112">
                📞 Call 112
              </a>
            </div>
            <p className="muted center" style={{ fontSize: '0.75rem' }}>
              This page stops showing location automatically when the link expires or the sharer stops it.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
