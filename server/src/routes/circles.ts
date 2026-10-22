import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { CircleCreateSchema, CircleJoinSchema, TripCheckinSchema, TripStartSchema } from '@raksha/shared';
import { badRequest, forbidden, HttpError, notFound, type Ctx } from '../context.js';
import { newId, type Row } from '../db.js';
import { circleMateIds, createShareLink, displayName, escalateTrip, memberState, serializeShare } from '../services/safety.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = (len = 6) => Array.from({ length: len }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

function setNameIfMissing(ctx: Ctx, deviceId: string, name: string) {
  ctx.db.run("UPDATE devices SET display_name = ? WHERE id = ? AND (display_name IS NULL OR display_name = '')", name, deviceId);
}

function requireMember(ctx: Ctx, circleId: string, deviceId: string) {
  const m = ctx.db.get('SELECT * FROM circle_members WHERE circle_id = ? AND device_id = ?', circleId, deviceId);
  if (!m) throw forbidden('You are not a member of this circle');
  return m;
}

function serializeCircle(ctx: Ctx, c: Row, me: string) {
  const members = ctx.db.all('SELECT * FROM circle_members WHERE circle_id = ? ORDER BY joined_at', c.id).map((m) => ({
    memberId: m.device_id,
    displayName: m.display_name,
    role: m.role,
    isMe: m.device_id === me,
    joinedAt: m.joined_at,
    ...memberState(ctx, m.device_id),
  }));
  return { id: c.id, name: c.name, inviteCode: c.invite_code, createdAt: c.created_at, members };
}

function serializeTrip(ctx: Ctx, t: Row) {
  const share = t.share_link_id ? ctx.db.get('SELECT * FROM share_links WHERE id = ?', t.share_link_id) : undefined;
  const checkins = ctx.db.all('SELECT kind, note, at FROM checkins WHERE trip_id = ? ORDER BY at DESC LIMIT 30', t.id);
  return {
    id: t.id,
    destination: t.destination,
    destLat: t.dest_lat,
    destLng: t.dest_lng,
    circleId: t.circle_id,
    etaAt: t.eta_at,
    checkinIntervalMin: t.checkin_interval_min,
    nextCheckinAt: t.next_checkin_at,
    status: t.status,
    stage: t.stage,
    lastState: t.last_state,
    startedAt: t.started_at,
    endedAt: t.ended_at,
    share: share ? serializeShare(ctx, share) : null,
    checkins,
  };
}

function ownTrip(ctx: Ctx, id: string, deviceId: string, mustBeActive = true) {
  const t = ctx.db.get('SELECT * FROM trips WHERE id = ? AND device_id = ?', id, deviceId);
  if (!t) throw notFound('Trip not found');
  if (mustBeActive && t.status !== 'active') throw badRequest('Trip is no longer active');
  return t;
}

export default async function circleRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const U = () => ctx.cfg.unitMs;

  // ---------- Safe Circles ----------
  app.post('/circles', async (req, reply) => {
    const b = CircleCreateSchema.parse(req.body);
    const now = ctx.now();
    let code = makeCode();
    while (ctx.db.get('SELECT 1 FROM circles WHERE invite_code = ?', code)) code = makeCode();
    const id = newId();
    ctx.db.tx(() => {
      ctx.db.insert('circles', { id, name: b.name, invite_code: code, created_by: req.deviceId, created_at: now });
      ctx.db.insert('circle_members', { circle_id: id, device_id: req.deviceId, display_name: b.displayName, role: 'owner', joined_at: now });
    });
    setNameIfMissing(ctx, req.deviceId, b.displayName);
    reply.code(201);
    return { circle: serializeCircle(ctx, ctx.db.get('SELECT * FROM circles WHERE id = ?', id)!, req.deviceId) };
  });

  app.post('/circles/join', async (req) => {
    const b = CircleJoinSchema.parse(req.body);
    const c = ctx.db.get('SELECT * FROM circles WHERE invite_code = ?', b.inviteCode.trim().toUpperCase());
    if (!c) throw notFound('No circle with that invite code');
    const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM circle_members WHERE circle_id = ?', c.id)!.n;
    const already = ctx.db.get('SELECT 1 FROM circle_members WHERE circle_id = ? AND device_id = ?', c.id, req.deviceId);
    if (!already) {
      if (count >= 25) throw badRequest('This circle is full (25 members)');
      ctx.db.insert('circle_members', { circle_id: c.id, device_id: req.deviceId, display_name: b.displayName, role: 'member', joined_at: ctx.now() });
      setNameIfMissing(ctx, req.deviceId, b.displayName);
      await ctx.notify.toDevices(circleMateIds(ctx, req.deviceId, c.id), {
        kind: 'circle_join', title: `${b.displayName} joined ${c.name}`, body: 'Your Safe Circle just grew.', data: { url: '/circles' },
      });
    }
    return { circle: serializeCircle(ctx, c, req.deviceId) };
  });

  app.get('/circles', async (req) => {
    const rows = ctx.db.all('SELECT c.* FROM circles c JOIN circle_members m ON m.circle_id = c.id WHERE m.device_id = ? ORDER BY c.created_at', req.deviceId);
    return { circles: rows.map((c) => serializeCircle(ctx, c, req.deviceId)) };
  });

  app.get('/circles/:id', async (req) => {
    const { id } = req.params as { id: string };
    requireMember(ctx, id, req.deviceId);
    const c = ctx.db.get('SELECT * FROM circles WHERE id = ?', id);
    if (!c) throw notFound();
    return { circle: serializeCircle(ctx, c, req.deviceId) };
  });

  app.post('/circles/:id/leave', async (req) => {
    const { id } = req.params as { id: string };
    requireMember(ctx, id, req.deviceId);
    ctx.db.run('DELETE FROM circle_members WHERE circle_id = ? AND device_id = ?', id, req.deviceId);
    const left = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM circle_members WHERE circle_id = ?', id)!.n;
    if (left === 0) ctx.db.run('DELETE FROM circles WHERE id = ?', id);
    return { ok: true };
  });

  app.post('/circles/:id/nudge', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { memberId } = z.object({ memberId: z.string() }).parse(req.body);
    const me = requireMember(ctx, id, req.deviceId);
    requireMember(ctx, id, memberId);
    if (memberId === req.deviceId) throw badRequest('You cannot nudge yourself');
    const now = ctx.now();
    const recent = ctx.db.get('SELECT 1 FROM nudges WHERE from_device = ? AND to_device = ? AND created_at > ?', req.deviceId, memberId, now - 60_000);
    if (recent) throw new HttpError(429, 'You just nudged this person. Wait a minute before nudging again.');
    const nudgeId = newId();
    ctx.db.insert('nudges', { id: nudgeId, circle_id: id, from_device: req.deviceId, to_device: memberId, status: 'pending', created_at: now });
    await ctx.notify.toDevice(memberId, {
      kind: 'nudge',
      title: `${me.display_name} asks: Are you okay?`,
      body: 'Tap to reply "I\'m OK" or "I need help".',
      data: { nudgeId, url: '/circles', actions: ['ok', 'need_help'] },
    });
    reply.code(201);
    return { nudgeId };
  });

  app.get('/nudges', async (req) => {
    const rows = ctx.db.all(
      `SELECT n.*, m.display_name AS from_name, t.display_name AS to_name, c.name AS circle_name FROM nudges n
       JOIN circles c ON c.id = n.circle_id
       LEFT JOIN circle_members m ON m.circle_id = n.circle_id AND m.device_id = n.from_device
       LEFT JOIN circle_members t ON t.circle_id = n.circle_id AND t.device_id = n.to_device
       WHERE n.to_device = ? OR n.from_device = ? ORDER BY n.created_at DESC LIMIT 50`,
      req.deviceId, req.deviceId,
    );
    return {
      nudges: rows.map((n) => ({
        id: n.id, circleId: n.circle_id, circleName: n.circle_name, fromName: n.from_name, toName: n.to_name, incoming: n.to_device === req.deviceId,
        status: n.status, createdAt: n.created_at, respondedAt: n.responded_at,
      })),
    };
  });

  app.post('/nudges/:id/respond', async (req) => {
    const { id } = req.params as { id: string };
    const { response } = z.object({ response: z.enum(['ok', 'need_help']) }).parse(req.body);
    const n = ctx.db.get('SELECT * FROM nudges WHERE id = ? AND to_device = ?', id, req.deviceId);
    if (!n) throw notFound('Nudge not found');
    ctx.db.run('UPDATE nudges SET status = ?, responded_at = ? WHERE id = ?', response, ctx.now(), id);
    const name = ctx.db.get<{ display_name: string }>('SELECT display_name FROM circle_members WHERE circle_id = ? AND device_id = ?', n.circle_id, req.deviceId)?.display_name ?? displayName(ctx, req.deviceId);
    if (response === 'ok') {
      await ctx.notify.toDevice(n.from_device, { kind: 'nudge_ok', title: `${name} is OK 💚`, body: 'They replied to your check-in nudge.', data: { url: '/circles' } });
    } else {
      const share = createShareLink(ctx, req.deviceId, { label: 'Help requested via nudge', durationMin: 120 });
      await ctx.notify.toDevices(circleMateIds(ctx, req.deviceId, n.circle_id), {
        kind: 'nudge_help', title: `${name} needs help`, body: `${name} replied "I need help" to a check-in. Live location is shared for 2 hours.`,
        data: { url: `/t/${share.token}` },
      });
      return { ok: true, share: serializeShare(ctx, share) };
    }
    return { ok: true };
  });

  // ---------- Trip check-ins ----------
  app.post('/trips', async (req, reply) => {
    const b = TripStartSchema.parse(req.body);
    if (ctx.db.get("SELECT 1 FROM trips WHERE device_id = ? AND status = 'active'", req.deviceId)) throw new HttpError(409, 'You already have an active trip');
    if (b.circleId) requireMember(ctx, b.circleId, req.deviceId);
    const now = ctx.now();
    const id = newId();
    let shareId: string | null = null;
    if (b.shareLocation) {
      shareId = createShareLink(ctx, req.deviceId, { label: `Trip to ${b.destination}`, durationMin: b.etaMinutes + 30, stopOnArrival: true, tripId: id }).id;
    }
    ctx.db.insert('trips', {
      id, device_id: req.deviceId, circle_id: b.circleId ?? null, destination: b.destination, dest_lat: b.destLat ?? null, dest_lng: b.destLng ?? null,
      eta_at: now + b.etaMinutes * U(), checkin_interval_min: b.checkinIntervalMin, next_checkin_at: now + b.checkinIntervalMin * U(),
      status: 'active', stage: 0, last_state: 'ok', share_link_id: shareId, started_at: now,
    });
    ctx.db.insert('checkins', { id: newId(), trip_id: id, kind: 'start', at: now });
    const name = displayName(ctx, req.deviceId);
    await ctx.notify.toDevices(circleMateIds(ctx, req.deviceId, b.circleId), {
      kind: 'trip_start', title: `${name} started a trip`, body: `Heading to ${b.destination}. ETA ${b.etaMinutes} ${ctx.cfg.demoMode ? 'sec (demo)' : 'min'}.`, data: { url: '/circles' },
    });
    reply.code(201);
    return { trip: serializeTrip(ctx, ctx.db.get('SELECT * FROM trips WHERE id = ?', id)!) };
  });

  app.get('/trips/active', async (req) => {
    const t = ctx.db.get("SELECT * FROM trips WHERE device_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1", req.deviceId);
    return { trip: t ? serializeTrip(ctx, t) : null, unitMs: U() };
  });

  app.get('/trips', async (req) => {
    const rows = ctx.db.all('SELECT * FROM trips WHERE device_id = ? ORDER BY started_at DESC LIMIT 20', req.deviceId);
    return { trips: rows.map((t) => serializeTrip(ctx, t)) };
  });

  app.post('/trips/:id/checkin', async (req) => {
    const { id } = req.params as { id: string };
    const b = TripCheckinSchema.parse(req.body);
    const t = ownTrip(ctx, id, req.deviceId);
    const now = ctx.now();
    const name = displayName(ctx, req.deviceId);
    ctx.db.insert('checkins', { id: newId(), trip_id: id, kind: b.kind, note: b.note ?? null, lat: b.lat ?? null, lng: b.lng ?? null, at: now });
    if (b.lat !== undefined && b.lng !== undefined) ctx.db.insert('location_pings', { device_id: req.deviceId, lat: b.lat, lng: b.lng, at: now });
    const mates = circleMateIds(ctx, req.deviceId, t.circle_id);
    if (b.kind === 'safe') {
      ctx.db.update('trips', 'id', id, { next_checkin_at: now + t.checkin_interval_min * U(), stage: 0, last_state: 'ok' });
      if (t.stage >= 2 || t.last_state === 'help') {
        await ctx.notify.toDevices(mates, { kind: 'trip_safe', title: `${name} checked in safe ✅`, body: `Update on the trip to ${t.destination}.`, data: { url: '/circles' } });
      }
    } else if (b.kind === 'delayed') {
      const delay = b.delayMinutes ?? 10;
      ctx.db.update('trips', 'id', id, {
        eta_at: Math.max(t.eta_at, now) + delay * U(),
        next_checkin_at: now + Math.min(t.checkin_interval_min, delay) * U(),
        stage: 0,
        last_state: 'delayed',
      });
      if (t.share_link_id) ctx.db.run('UPDATE share_links SET expires_at = MAX(expires_at, ?), reminder_sent = 0 WHERE id = ?', now + (delay + 30) * U(), t.share_link_id);
      await ctx.notify.toDevices(mates, { kind: 'trip_delayed', title: `${name} is delayed`, body: `Running ${delay} ${ctx.cfg.demoMode ? 's' : 'min'} late to ${t.destination}${b.note ? `: ${b.note}` : ''}.`, data: { url: '/circles' } });
    } else {
      ctx.db.update('trips', 'id', id, { last_state: 'help', stage: 3 });
      const fresh = ctx.db.get('SELECT * FROM trips WHERE id = ?', id)!;
      await escalateTrip(ctx, fresh, 2, 'help');
      await escalateTrip(ctx, fresh, 3, 'help');
    }
    return { trip: serializeTrip(ctx, ctx.db.get('SELECT * FROM trips WHERE id = ?', id)!) };
  });

  app.post('/trips/:id/extend', async (req) => {
    const { id } = req.params as { id: string };
    const { minutes } = z.object({ minutes: z.number().int().min(1).max(240) }).parse(req.body);
    const t = ownTrip(ctx, id, req.deviceId);
    const now = ctx.now();
    ctx.db.update('trips', 'id', id, { eta_at: Math.max(t.eta_at, now) + minutes * U(), stage: 0, next_checkin_at: Math.max(t.next_checkin_at, now + U()) });
    if (t.share_link_id) ctx.db.run('UPDATE share_links SET expires_at = expires_at + ?, reminder_sent = 0 WHERE id = ?', minutes * U(), t.share_link_id);
    ctx.db.insert('checkins', { id: newId(), trip_id: id, kind: 'extend', note: `+${minutes}`, at: now });
    return { trip: serializeTrip(ctx, ctx.db.get('SELECT * FROM trips WHERE id = ?', id)!) };
  });

  app.post('/trips/:id/arrive', async (req) => {
    const { id } = req.params as { id: string };
    const t = ownTrip(ctx, id, req.deviceId);
    const now = ctx.now();
    ctx.db.update('trips', 'id', id, { status: 'arrived', ended_at: now, stage: 0, last_state: 'ok' });
    ctx.db.insert('checkins', { id: newId(), trip_id: id, kind: 'arrived', at: now });
    const stopped = ctx.db.run(
      "UPDATE share_links SET status = 'stopped', ended_at = ? WHERE device_id = ? AND status = 'active' AND stop_on_arrival = 1 AND (trip_id = ? OR trip_id IS NULL)",
      now, req.deviceId, id,
    ).changes;
    await ctx.notify.toDevices(circleMateIds(ctx, req.deviceId, t.circle_id), {
      kind: 'trip_arrived', title: `${displayName(ctx, req.deviceId)} arrived safely 🏠`, body: `Reached ${t.destination}.`, data: { url: '/circles' },
    });
    return { trip: serializeTrip(ctx, ctx.db.get('SELECT * FROM trips WHERE id = ?', id)!), stoppedShares: Number(stopped) };
  });

  app.post('/trips/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    const t = ownTrip(ctx, id, req.deviceId);
    const now = ctx.now();
    ctx.db.update('trips', 'id', id, { status: 'cancelled', ended_at: now });
    ctx.db.insert('checkins', { id: newId(), trip_id: id, kind: 'cancelled', at: now });
    if (t.share_link_id) ctx.db.run("UPDATE share_links SET status = 'stopped', ended_at = ? WHERE id = ? AND status = 'active'", now, t.share_link_id);
    if (t.stage >= 2) {
      await ctx.notify.toDevices(circleMateIds(ctx, req.deviceId, t.circle_id), {
        kind: 'trip_cancelled', title: `${displayName(ctx, req.deviceId)} cancelled their trip`, body: 'They are safe and stopped the trip alerts.', data: { url: '/circles' },
      });
    }
    return { trip: serializeTrip(ctx, ctx.db.get('SELECT * FROM trips WHERE id = ?', id)!) };
  });
}
