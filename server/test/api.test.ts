import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { runTick } from '../src/scheduler.js';
import type { Ctx } from '../src/context.js';

let app: FastifyInstance;
let ctx: Ctx;
let dir: string;
let clock = Date.UTC(2025, 0, 15, 14, 0);

const token = () => randomBytes(24).toString('hex');
const A = token();
const B = token();
const C = token();
const D = token();

async function call(tok: string | null, method: string, url: string, payload?: any, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: method as any,
    url: '/api/v1' + url,
    payload,
    headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers },
  });
  let body: any = res.body;
  try {
    body = res.json();
  } catch {
    /* not json */
  }
  return { status: res.statusCode, body, headers: res.headers };
}

const iso = (ms: number) => new Date(ms).toISOString();
const report = (tok: string, extra: Record<string, any> = {}) =>
  call(tok, 'POST', '/reports', {
    type: 'verbal', severity: 3, frequency: 'once', tags: ['night'], occurredAt: iso(clock - 3_600_000),
    lat: 12.97672, lng: 77.57204, description: 'Man passed comments, call me at 9876543210', ...extra,
  });

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'raksha-test-'));
  clock = Date.UTC(2025, 0, 15, 14, 0);
  ({ app, ctx } = await buildApp({ dataDir: dir, dbFile: ':memory:', demoMode: true, now: () => clock, scheduler: false, logger: false, serveWeb: false }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('meta & auth', () => {
  it('exposes public meta and rejects missing device token', async () => {
    const meta = await call(null, 'GET', '/meta');
    expect(meta.status).toBe(200);
    expect(meta.body.helplines.emergency).toBe('112');
    expect(meta.body.demoMode).toBe(true);
    expect((await call(null, 'GET', '/reports/mine')).status).toBe(401);
  });
});

describe('anonymous reports & map privacy', () => {
  it('scrubs PII, snaps location and hides areas below the independent-device threshold', async () => {
    const r = await report(A);
    expect(r.status).toBe(201);
    expect(r.body.report.description).not.toContain('9876543210');
    expect(r.body.redactions.length).toBeGreaterThan(0);

    const bbox = '?minLat=12.9&maxLat=13.1&minLng=77.5&maxLng=77.7';
    let map = await call(B, 'GET', '/map/areas' + bbox);
    expect(map.body.areas).toHaveLength(0);
    expect(map.body.hiddenAreas).toBe(1);

    await report(B);
    await report(C, { type: 'stalking', severity: 4 });
    map = await call(D, 'GET', '/map/areas' + bbox);
    expect(map.body.areas).toHaveLength(1);
    expect(map.body.areas[0].independentDevices).toBeGreaterThanOrEqual(3);

    const mine = await call(A, 'GET', '/reports/mine');
    expect(mine.body.reports).toHaveLength(1);
    const id = mine.body.reports[0].id;
    expect((await call(B, 'POST', `/reports/${id}/retract`)).status).toBe(404);
    expect((await call(A, 'POST', `/reports/${id}/retract`)).status).toBe(200);
    map = await call(D, 'GET', '/map/areas' + bbox);
    expect(map.body.areas).toHaveLength(0);
  });

  it('rejects future incidents', async () => {
    const r = await report(A, { occurredAt: iso(clock + 5 * 3_600_000) });
    expect(r.status).toBe(400);
  });

  it('structures Hinglish text and generates a complaint draft', async () => {
    const s = await call(A, 'POST', '/ai/structure', { text: 'kal raat bus stop pe ek aadmi ne mera peecha kiya aur ganda comment kiya' });
    expect(s.status).toBe(200);
    expect(s.body.suggestion.type).toBe('stalking');
    const d = await call(A, 'POST', '/ai/draft', { authority: 'police', type: 'stalking', severity: 4, frequency: 'once', description: 'A man followed me from the bus stop.' });
    expect(d.status).toBe(200);
    expect(d.body.draft.body).toMatch(/follow/i);
  });
});

describe('safe circle trips', () => {
  it('escalates a missed check-in in stages to circle mates', async () => {
    const c = await call(A, 'POST', '/circles', { name: 'Night shift', displayName: 'Asha' });
    expect(c.status).toBe(201);
    const code = c.body.circle.inviteCode;
    expect((await call(B, 'POST', '/circles/join', { inviteCode: code, displayName: 'Bina' })).status).toBe(200);

    const t = await call(A, 'POST', '/trips', { destination: 'Home', etaMinutes: 30, checkinIntervalMin: 5, circleId: c.body.circle.id, shareLocation: true });
    expect(t.status).toBe(201);

    // demo mode: 1 minute = 1 s. Check-in due at +5 s; stage 2 (circle) after 5 more units.
    clock += 6_000;
    await runTick(ctx);
    let tripRes = await call(A, 'GET', '/trips/active');
    expect(tripRes.body.trip.stage).toBe(1);
    clock += 6_000;
    await runTick(ctx);
    const bAlerts = await call(B, 'GET', '/alerts');
    expect(bAlerts.body.alerts.some((a: any) => /Asha/.test(a.title + a.body))).toBe(true);

    const detail = await call(B, 'GET', `/circles/${c.body.circle.id}`);
    const asha = detail.body.circle.members.find((m: any) => m.displayName === 'Asha');
    expect(['overdue', 'help']).toContain(asha.state);

    expect((await call(A, 'POST', `/trips/${t.body.trip.id}/checkin`, { kind: 'safe' })).status).toBe(200);
    tripRes = await call(A, 'GET', '/trips/active');
    expect(tripRes.body.trip.stage).toBe(0);
    expect((await call(A, 'POST', `/trips/${t.body.trip.id}/arrive`)).status).toBe(200);
  });
});

describe('expiring location share & SOS', () => {
  it('serves a public tracking link until it expires', async () => {
    await call(A, 'PUT', '/me', { displayName: 'Asha' });
    const s = await call(A, 'POST', '/shares', { durationMin: 15, label: 'Cab home' });
    expect(s.status).toBe(201);
    const tok = s.body.share.token;
    await call(A, 'POST', '/location/ping', { lat: 12.97, lng: 77.6 });
    let pub = await call(null, 'GET', `/public/share/${tok}`);
    expect(pub.status).toBe(200);
    expect(pub.body.latest.lat).toBeCloseTo(12.97);

    clock += 6_000; // inside reminder window (10 units before expiry)
    await runTick(ctx);
    const alerts = await call(A, 'GET', '/alerts');
    expect(alerts.body.alerts.some((a: any) => a.kind === 'share_expiring')).toBe(true);

    clock += 15_000;
    await runTick(ctx);
    pub = await call(null, 'GET', `/public/share/${tok}`);
    expect(pub.status).toBe(410);
  });

  it('raises and cancels an SOS', async () => {
    const s = await call(A, 'POST', '/sos', { lat: 12.97, lng: 77.6 });
    expect(s.status).toBe(201);
    expect(s.body.helplines.emergency).toBe('112');
    expect((await call(A, 'GET', '/sos/active')).body.sos).toBeTruthy();
    expect((await call(A, 'POST', `/sos/${s.body.sos.id}/cancel`)).status).toBe(200);
    expect((await call(A, 'GET', '/sos/active')).body.sos).toBeNull();
  });
});

describe('evidence vault', () => {
  it('encrypts, verifies and certifies an upload', async () => {
    const content = Buffer.from('photo-bytes-' + 'x'.repeat(100));
    const boundary = '----raksha';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nbus 500D\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await call(A, 'POST', '/evidence', body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
    expect(up.status).toBe(201);
    const id = up.body.evidence.id;
    const v = await call(A, 'POST', `/evidence/${id}/verify`, {});
    expect(v.body.intact).toBe(true);
    const dl = await app.inject({ method: 'GET', url: `/api/v1/evidence/${id}/download`, headers: { authorization: `Bearer ${A}` } });
    expect(dl.rawPayload.equals(content)).toBe(true);
    const cert = await call(A, 'GET', `/evidence/${id}/certificate`);
    expect(cert.body.certificate.sha256).toBe(up.body.evidence.sha256);
    expect((await call(B, 'GET', `/evidence/${id}/download`)).status).toBe(404);
  });
});

describe('event safety bubble', () => {
  it('alerts members when subzone reports cross the threshold', async () => {
    const e = await call(A, 'POST', '/events', {
      name: 'Fest', centerLat: 13.0039, centerLng: 77.5921, radiusM: 600, startsAt: iso(clock - 3_600_000), endsAt: iso(clock + 3_600_000 * 5),
      subzones: [{ name: 'Food Court', lat: 13.00335, lng: 77.59011, radiusM: 90 }], thresholds: { advisory: 2, warning: 4 }, displayName: 'Organizer',
    });
    expect(e.status).toBe(201);
    expect((await call(B, 'POST', '/events/join', { code: e.body.event.code, displayName: 'Bina' })).status).toBe(200);
    const at = { lat: 13.00336, lng: 77.59012, occurredAt: iso(clock - 600_000), eventId: e.body.event.id };
    await report(C, at);
    await report(D, at);
    const alerts = await call(B, 'GET', '/alerts');
    expect(alerts.body.alerts.some((a: any) => a.kind.startsWith('event'))).toBe(true);
    const detail = await call(B, 'GET', `/events/${e.body.event.id}`);
    expect(detail.body.event.subzones[0].alertLevel).toBe('advisory');
  });
});

describe('authority API', () => {
  it('requires the authority key', async () => {
    expect((await call(null, 'GET', '/authority/analytics')).status).toBe(401);
    const ok = await call(null, 'GET', '/authority/analytics', undefined, { 'x-authority-key': ctx.cfg.authorityApiKey });
    expect(ok.status).toBe(200);
  });
});
