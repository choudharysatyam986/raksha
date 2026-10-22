import { ReactNode, useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { LEVEL_COLORS, pretty } from './util';
import { locate } from './tracker';

export const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946];
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; OpenStreetMap contributors';

export function Loading() {
  return <div className="spinner" aria-label="Loading" />;
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="card alert-danger">
      <div className="row between">
        <span>⚠️ {error}</span>
        {onRetry && (
          <button className="small secondary" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function LevelBadge({ level }: { level: string }) {
  return (
    <span className="badge lvl" style={{ background: LEVEL_COLORS[level] ?? '#888' }}>
      {pretty(level)}
    </span>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        {children}
      </div>
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange, labels, suggested }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void; labels?: (o: T) => string; suggested?: T[] }) {
  return (
    <div className="chips">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button type="button" key={o} className={`chip ${on ? 'on' : ''} ${!on && suggested?.includes(o) ? 'suggested' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {labels ? labels(o) : pretty(o)}
          </button>
        );
      })}
    </div>
  );
}

export function Radio<T extends string | number>({ options, value, onChange, labels }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: (o: T) => string }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={String(o)} className={`chip ${o === value ? 'on' : ''}`} onClick={() => onChange(o)}>
          {labels ? labels(o) : pretty(String(o))}
        </button>
      ))}
    </div>
  );
}

function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function Recenter({ center, zoom }: { center: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom ?? map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.[0], center?.[1]]);
  return null;
}

/** Tap-to-pick location map with a "use my location" button. */
export function LocationPicker({ value, onChange, height = 'short' }: { value: { lat: number; lng: number } | null; onChange: (v: { lat: number; lng: number }) => void; height?: 'short' | '' | 'tall' }) {
  const [center, setCenter] = useState<[number, number] | null>(value ? [value.lat, value.lng] : null);
  const [locating, setLocating] = useState(false);
  const useMine = async () => {
    setLocating(true);
    const f = await locate();
    setLocating(false);
    if (f) {
      onChange({ lat: f.lat, lng: f.lng });
      setCenter([f.lat, f.lng]);
    } else alert('Could not get your location. Tap on the map to choose the place instead.');
  };
  return (
    <div>
      <div className={`map ${height}`}>
        <MapContainer center={value ? [value.lat, value.lng] : DEFAULT_CENTER} zoom={value ? 15 : 12} style={{ height: '100%' }}>
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
          <ClickPicker onPick={(lat, lng) => onChange({ lat, lng })} />
          <Recenter center={center} zoom={15} />
          {value && <CircleMarker center={[value.lat, value.lng]} radius={10} pathOptions={{ color: '#6d28d9', fillOpacity: 0.5 }} />}
        </MapContainer>
      </div>
      <div className="row between" style={{ marginTop: 6 }}>
        <small>{value ? `📍 ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)} (stored only approximately)` : 'Tap the map to mark the approximate place'}</small>
        <button type="button" className="small secondary" onClick={useMine} disabled={locating}>
          {locating ? 'Locating…' : '◎ My location'}
        </button>
      </div>
    </div>
  );
}

export function Section({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}
