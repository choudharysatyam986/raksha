import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Rectangle, TileLayer, useMapEvents, CircleMarker } from 'react-leaflet';
import type { LatLngBounds } from 'leaflet';
import { api } from '../api';
import { DEFAULT_CENTER, LevelBadge, Recenter, TILE_ATTR, TILE_URL } from '../components';
import { useApp } from '../state';
import { ago, LEVEL_COLORS, pretty } from '../util';
import { locate } from '../tracker';
import { typeLabel } from './MyReports';

export function AreaDetail({ area }: { area: any }) {
  const p = area.patterns ?? {};
  return (
    <div style={{ fontSize: '0.9rem' }}>
      <p>
        <b>{area.reportCount}</b> active reports from <b>{area.independentDevices}</b> independent people · risk score {area.score?.toFixed?.(1) ?? area.score} · updated {ago(area.updatedAt)}
      </p>
      <div className="row" style={{ marginBottom: 6 }}>
        {p.recurring && <span className="badge b-warn">🔁 Recurring: {p.recurring.label} ({p.recurring.days} days)</span>}
                {p.burst?.active && <span className="badge b-danger">⚡ Spike: {p.burst.count} reports recently</span>}
        {p.dominantType && <span className="badge b-primary">Mostly: {typeLabel(p.dominantType)}</span>}
      </div>
      {area.guidance?.length > 0 && (
        <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
          {area.guidance.map((g: string, i: number) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BoundsWatcher({ onChange }: { onChange: (b: LatLngBounds) => unknown }) {
  const map = useMapEvents({
    moveend: () => {
      void onChange(map.getBounds());
    },
  });
  useEffect(() => {
    // Block body: onChange may be async, and a returned Promise would be treated as an effect cleanup.
    void onChange(map.getBounds());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function SafetyMap() {
  const { toast } = useApp();
  const [areas, setAreas] = useState<any[]>([]);
  const [hidden, setHidden] = useState(0);
  const [sel, setSel] = useState<any>(null);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);

  const load = useCallback(
    async (b: LatLngBounds) => {
      try {
        const q = `minLat=${b.getSouth()}&maxLat=${b.getNorth()}&minLng=${b.getWest()}&maxLng=${b.getEast()}`;
        const r = await api<{ areas: any[]; hiddenAreas: number }>(`/map/areas?${q}`);
        setAreas(r.areas);
        setHidden(r.hiddenAreas);
      } catch (e: any) {
        toast(e.message, 'err');
      }
    },
    [toast],
  );

  const findMe = async () => {
    const f = await locate();
    if (f) {
      setMe([f.lat, f.lng]);
      setCenter([f.lat, f.lng]);
    } else toast('Could not get your location', 'err');
  };

  return (
    <div>
      <div className="row between">
        <h1>🗺️ Safety map</h1>
        <button className="small secondary" onClick={findMe}>
          ◎ Near me
        </button>
      </div>
      <div className="map tall">
        <MapContainer center={DEFAULT_CENTER} zoom={12} style={{ height: '100%' }}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <BoundsWatcher onChange={load} />
          <Recenter center={center} zoom={15} />
          {me && <CircleMarker center={me} radius={8} pathOptions={{ color: '#2563eb', fillOpacity: 0.8 }} />}
          {areas.map((a) => (
            <Rectangle
              key={a.cellId}
              bounds={a.bounds}
              pathOptions={{ color: LEVEL_COLORS[a.level], fillColor: LEVEL_COLORS[a.level], fillOpacity: 0.45, weight: sel?.cellId === a.cellId ? 3 : 1 }}
              eventHandlers={{ click: () => setSel(a) }}
            />
          ))}
        </MapContainer>
      </div>
      <div className="legend">
        {Object.entries(LEVEL_COLORS).map(([k, c]) => (
          <span key={k} style={{ ['--c' as any]: c }}>
            {pretty(k)}
          </span>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '0.82rem' }}>
        Showing {areas.length} area(s). {hidden > 0 && <>{hidden} more area(s) in view are hidden because fewer than 3 independent people reported there (privacy). </>}
        Tap a coloured square for details. Recent reports count more; older ones fade over time.
      </p>
      {sel ? (
        <div className="card">
          <div className="row between">
            <h3 style={{ margin: 0 }}>Selected area</h3>
            <LevelBadge level={sel.level} />
          </div>
          <AreaDetail area={sel} />
          <div className="row">
            <Link className="btn small secondary" to="/report">
              Report here
            </Link>
            <Link className="btn small secondary" to="/trip">
              Start trip check-in
            </Link>
          </div>
        </div>
      ) : (
        areas.length > 0 && (
          <div className="card">
            <h3>Highest-risk areas in view</h3>
            <ul className="list">
              {areas.slice(0, 5).map((a) => (
                <li key={a.cellId} onClick={() => { setSel(a); setCenter([a.lat, a.lng]); }} style={{ cursor: 'pointer' }}>
                  <div className="row between nowrap">
                    <span className="grow">
                      {a.patterns?.dominantType ? typeLabel(a.patterns.dominantType) : 'Reports'} · {a.reportCount} reports
                      {a.patterns?.recurring && ' · 🔁'}
                      {a.patterns?.burst?.active && ' · ⚡'}
                    </span>
                    <LevelBadge level={a.level} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
