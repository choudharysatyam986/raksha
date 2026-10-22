import { post } from './api';

export interface Fix {
  lat: number;
  lng: number;
  accuracy?: number;
  at: number;
}

/** One-shot location with a timeout. Resolves null if unavailable or denied. */
export function locate(timeoutMs = 10000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      () => resolve(lastFix),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

type Status = { active: boolean; lastSent: number | null; error: string | null; fix: Fix | null };
let lastFix: Fix | null = null;
let watchId: number | null = null;
let lastSentAt = 0;
let lastSentFix: Fix | null = null;
let wakeLock: any = null;
let status: Status = { active: false, lastSent: null, error: null, fix: null };
const listeners = new Set<(s: Status) => void>();

const emit = (patch: Partial<Status>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
};

export function onTrackerStatus(fn: (s: Status) => void) {
  listeners.add(fn);
  fn(status);
  return () => {
    listeners.delete(fn);
  };
}

function metersBetween(a: Fix, b: Fix) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function send(fix: Fix, force = false) {
  const now = Date.now();
  const moved = lastSentFix ? metersBetween(lastSentFix, fix) : Infinity;
  if (!force && now - lastSentAt < 5000 && moved < 25) return;
  if (!force && now - lastSentAt < 15000 && moved < 10) return;
  lastSentAt = now;
  lastSentFix = fix;
  try {
    const r = await post<{ trackingNeeded: boolean }>('/location/ping', { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy });
    emit({ lastSent: now, error: null });
    if (!r.trackingNeeded) stopTracking();
  } catch (e: any) {
    emit({ error: e.message });
  }
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await (navigator as any).wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (status.active && document.visibilityState === 'visible') {
    acquireWakeLock();
    if (lastFix) send(lastFix, true);
  }
});

/** Starts continuous GPS updates (only while a trip / share / SOS is active – the server rejects pings otherwise). */
export function startTracking() {
  if (watchId !== null || !('geolocation' in navigator)) {
    if (!('geolocation' in navigator)) emit({ error: 'Location is not supported on this device' });
    return;
  }
  emit({ active: true, error: null });
  acquireWakeLock();
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      lastFix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
      emit({ fix: lastFix });
      send(lastFix);
    },
    (err) => emit({ error: err.code === 1 ? 'Location permission denied. Enable it in browser settings.' : 'Waiting for GPS…' }),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}

export function stopTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  wakeLock?.release?.().catch?.(() => undefined);
  wakeLock = null;
  emit({ active: false });
}

/** Immediately push the current position (e.g., right after creating a share). */
export async function pingNow() {
  const fix = await locate(8000);
  if (fix) {
    lastFix = fix;
    emit({ fix });
    await send(fix, true);
  }
  return fix;
}

export const getLastFix = () => lastFix;
