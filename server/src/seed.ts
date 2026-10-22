/**
 * Loads realistic demo data for Bengaluru so the Safety Map, Authority dashboard, Safe Circle and Event Bubble
 * have something to show. Safe to run repeatedly (skips if already seeded unless --reset is passed).
 *   npm run seed            # seed once
 *   npm run seed -- --reset # wipe DB + evidence and seed again
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { snapLocation } from '@raksha/shared';
import { loadConfig, loadDotEnv } from './config.js';
import { buildApp } from './app.js';
import { sha256 } from './context.js';
import { newId } from './db.js';
import { recomputeAll } from './services/risk.js';

loadDotEnv();

const reset = process.argv.includes('--reset');
if (reset) {
  const cfg = loadConfig();
  for (const f of [cfg.dbFile, cfg.dbFile + '-wal', cfg.dbFile + '-shm']) if (existsSync(f)) rmSync(f);
  rmSync(path.join(cfg.dataDir, 'evidence'), { recursive: true, force: true });
  console.log('Database reset.');
}

const { app, ctx } = await buildApp({ scheduler: false, logger: false, serveWeb: false });
const db = ctx.db;

if (db.kvGet('seeded') && !reset) {
  console.log('Demo data already present. Use `npm run seed -- --reset` to start fresh.');
  await app.close();
  process.exit(0);
}

const now = Date.now();
const H = 3_600_000;
const D = 24 * H;

function device(name: string) {
  const id = newId();
  db.insert('devices', { id, token_hash: sha256(randomBytes(32).toString('hex')), display_name: name, created_at: now, last_seen: now });
  return id;
}

const devices = Array.from({ length: 8 }, (_, i) => device(`Demo reporter ${i + 1}`));

/** Hour in IST -> epoch ms on `daysAgo`. */
function at(daysAgo: number, istHour: number, minute = 0) {
  const d = new Date(now - daysAgo * D);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), istHour, minute) - 5.5 * H;
  return Math.min(utc, now - 5 * 60_000);
}

function report(dev: number, lat: number, lng: number, type: string, severity: number, occurredAt: number, opts: { frequency?: string; tags?: string[]; description?: string; eventId?: string; subzoneId?: string } = {}) {
  const s = snapLocation(lat + (Math.random() - 0.5) * 0.0004, lng + (Math.random() - 0.5) * 0.0004);
  // keep jitter inside the intended cell
  const cell = snapLocation(lat, lng);
  db.insert('reports', {
    id: newId(), device_id: devices[dev], type, severity, frequency: opts.frequency ?? 'once', tags: opts.tags ?? [], occurred_at: occurredAt,
    cell_id: cell.cellId, lat: cell.lat, lng: cell.lng, description: opts.description ?? '', status: 'active',
    event_id: opts.eventId ?? null, subzone_id: opts.subzoneId ?? null, created_at: Math.min(now, occurredAt + 30 * 60_000),
  });
  void s;
}

// 1) Majestic bus stand: recurring late-evening harassment, many independent reporters -> high/critical + recurring.
const MAJ = [12.97672, 77.57204];
[[0, 2, 21], [1, 4, 22], [2, 6, 21], [3, 9, 20], [4, 12, 21], [5, 15, 22], [1, 20, 21]].forEach(([d, ago, h], i) =>
  report(d, MAJ[0], MAJ[1], i % 2 ? 'physical' : 'verbal', i % 2 ? 4 : 3, at(ago, h, 15), { tags: ['bus_stop', 'crowd', 'night', 'public_transport'], frequency: i === 3 ? 'repeated' : 'once', description: 'Men loitering near platform 18 pass comments and push against women while boarding.' }),
);

// 2) Silk Board junction: burst in the last 24h -> active burst escalation.
const SB = [12.91743, 77.62271];
[[0, 2], [1, 5], [2, 9], [3, 14], [6, 18]].forEach(([d, hAgo]) =>
  report(d, SB[0], SB[1], 'stalking', 4, now - hAgo * H, { tags: ['bus_stop', 'poorly_lit'], description: 'A man on a two-wheeler followed women walking from the bus stop towards HSR.' }),
);

// 3) MG Road metro exit: moderate, recurring evenings.
const MG = [12.97553, 77.60663];
[[2, 3, 18], [4, 10, 19], [6, 17, 18]].forEach(([d, ago, h]) =>
  report(d, MG[0], MG[1], 'staring', 2, at(ago, h, 30), { tags: ['metro', 'crowd'], description: 'Group of men staring and taking photos near the metro exit stairs.' }),
);
report(7, MG[0], MG[1], 'photography', 3, at(8, 19), { tags: ['metro'] });

// 4) Whitefield ITPL back gate: late-night stalking for late-shift workers.
const WF = [12.98624, 77.73695];
[[1, 3, 23], [3, 8, 0], [5, 13, 23], [7, 20, 1]].forEach(([d, ago, h]) =>
  report(d, WF[0], WF[1], 'stalking', 3, at(ago, h, 40), { tags: ['workplace', 'poorly_lit', 'night'], frequency: 'repeated', description: 'Auto drivers follow women leaving the late shift towards the bus stop.' }),
);

// 5) Koramangala 5th block: only 2 independent devices -> hidden on the map (k-anonymity demo).
const KM = [12.93519, 77.61449];
report(2, KM[0], KM[1], 'verbal', 3, at(3, 22));
report(4, KM[0], KM[1], 'verbal', 3, at(5, 22));

// 6) Cubbon Park walkway: low/moderate old reports showing time decay.
const CP = [12.97633, 77.59288];
[[0, 40], [3, 55], [5, 70]].forEach(([d, ago]) => report(d, CP[0], CP[1], 'indecent_exposure', 4, at(ago, 7), { tags: ['isolated'] }));

// Event Safety Bubble demo: festival at Palace Grounds, Food Court one report short of an advisory.
const eventId = newId();
const zones = [
  { id: 'z1', name: 'Main Stage', lat: 13.00512, lng: 77.59208, radiusM: 120 },
  { id: 'z2', name: 'Food Court', lat: 13.00335, lng: 77.59011, radiusM: 90 },
  { id: 'z3', name: 'Exit Gate 2 / Parking', lat: 13.00178, lng: 77.59391, radiusM: 110 },
];
const organizer = device('Festival Safety Desk');
db.insert('events', {
  id: eventId, name: 'Bengaluru Music Fest (demo)', organizer_device: organizer, code: 'FEST24', center_lat: 13.0039, center_lng: 77.5921, radius_m: 600,
  starts_at: now - 2 * H, ends_at: now + 2 * D, subzones: zones, thresholds: { advisory: 3, warning: 5 }, created_at: now - 3 * H,
});
db.insert('event_members', { event_id: eventId, device_id: organizer, display_name: 'Festival Safety Desk', role: 'organizer', status: 'safe', status_at: now });
['Meera', 'Sana', 'Divya'].forEach((n, i) => {
  const d = device(n);
  db.insert('event_members', { event_id: eventId, device_id: d, display_name: n, role: 'attendee', status: i === 2 ? 'unknown' : 'safe', subzone_id: i === 0 ? 'z1' : null, status_at: now - i * 600_000 });
});
report(3, zones[1].lat, zones[1].lng, 'physical', 4, now - 40 * 60_000, { tags: ['event', 'crowd'], eventId, subzoneId: 'z2' });
report(5, zones[1].lat, zones[1].lng, 'verbal', 3, now - 25 * 60_000, { tags: ['event', 'crowd'], eventId, subzoneId: 'z2' });

// Safe Circle demo with two existing members; join with invite code DEMO42.
const circleId = newId();
const priya = device('Priya');
const ananya = device('Ananya');
db.insert('circles', { id: circleId, name: 'Late-shift buddies (demo)', invite_code: 'DEMO42', created_by: priya, created_at: now - 7 * D });
db.insert('circle_members', { circle_id: circleId, device_id: priya, display_name: 'Priya', role: 'owner', joined_at: now - 7 * D });
db.insert('circle_members', { circle_id: circleId, device_id: ananya, display_name: 'Ananya', role: 'member', joined_at: now - 6 * D });
const tripId = newId();
db.insert('trips', {
  id: tripId, device_id: ananya, circle_id: circleId, destination: 'Home – Indiranagar', eta_at: now + 7 * D, checkin_interval_min: 7 * 24 * 60,
  next_checkin_at: now + 7 * D, status: 'active', stage: 0, last_state: 'ok', started_at: now - 10 * 60_000,
});
db.insert('location_pings', { device_id: ananya, lat: 12.9719, lng: 77.6412, at: now - 60_000 });

const cells = await recomputeAll(ctx);
db.kvSet('seeded', String(now));
const escalations = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM escalations')!.n;
console.log(`Seeded ${db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reports')!.n} reports across ${cells} areas, ${escalations} escalations.`);
console.log('Demo codes → Safe Circle invite: DEMO42   Event code: FEST24');
console.log(`Authority API key: ${ctx.cfg.authorityApiKey}`);
await app.close();
