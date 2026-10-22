import type { FastifyInstance } from 'fastify';
import { DEFAULT_EVENT_THRESHOLDS, EventCreateSchema, EventJoinSchema, EventStatusSchema } from '@raksha/shared';
import { badRequest, forbidden, notFound, type Ctx } from '../context.js';
import { newId, parseJson, type Row } from '../db.js';
import { eventThresholds, findSubzone } from '../services/safety.js';
import { makeCode } from './circles.js';

type Subzone = { id: string; name: string; lat: number; lng: number; radiusM: number };

function serializeEvent(ctx: Ctx, e: Row, me: string, detail = false) {
  const member = ctx.db.get('SELECT * FROM event_members WHERE event_id = ? AND device_id = ?', e.id, me);
  const zones = parseJson<Subzone[]>(e.subzones, []);
  const base = {
    id: e.id,
    name: e.name,
    code: e.code,
    centerLat: e.center_lat,
    centerLng: e.center_lng,
    radiusM: e.radius_m,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    thresholds: eventThresholds(e),
    myRole: member?.role ?? null,
    myStatus: member?.status ?? null,
    memberCount: ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_members WHERE event_id = ?', e.id)!.n,
  };
  if (!detail) return base;
  const alerts = ctx.db.all('SELECT * FROM event_alerts WHERE event_id = ? ORDER BY created_at DESC', e.id);
  const subzones = zones.map((z) => {
    const count = ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE event_id = ? AND subzone_id = ? AND status = 'active'", e.id, z.id)!.n;
    const zAlerts = alerts.filter((a) => a.subzone_id === z.id).map((a) => a.level);
    return { ...z, reportCount: count, alertLevel: zAlerts.includes('warning') ? 'warning' : zAlerts.includes('advisory') ? 'advisory' : null };
  });
  const members = ctx.db.all('SELECT * FROM event_members WHERE event_id = ? ORDER BY display_name', e.id).map((m) => ({
    memberId: m.device_id,
    displayName: m.display_name,
    role: m.role,
    status: m.status,
    subzoneId: m.subzone_id,
    statusAt: m.status_at,
    isMe: m.device_id === me,
  }));
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id;
  return {
    ...base,
    subzones,
    members,
    statusCounts: {
      safe: members.filter((m) => m.status === 'safe').length,
      needHelp: members.filter((m) => m.status === 'need_help').length,
      unknown: members.filter((m) => m.status === 'unknown').length,
    },
    alerts: alerts.map((a) => ({ id: a.id, subzoneId: a.subzone_id, subzoneName: zoneName(a.subzone_id), level: a.level, count: a.count, createdAt: a.created_at })),
  };
}

export default async function eventRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const requireMember = (eventId: string, deviceId: string) => {
    const m = ctx.db.get('SELECT * FROM event_members WHERE event_id = ? AND device_id = ?', eventId, deviceId);
    if (!m) throw forbidden('Join this event first');
    return m;
  };

  app.post('/events', async (req, reply) => {
    const b = EventCreateSchema.parse(req.body);
    const startsAt = Date.parse(b.startsAt);
    const endsAt = Date.parse(b.endsAt);
    if (isNaN(startsAt) || isNaN(endsAt) || endsAt <= startsAt) throw badRequest('Invalid event time window');
    const t = b.thresholds ?? DEFAULT_EVENT_THRESHOLDS;
    if (t.warning < t.advisory) throw badRequest('Warning threshold must be ≥ advisory threshold');
    let code = makeCode(6);
    while (ctx.db.get('SELECT 1 FROM events WHERE code = ?', code)) code = makeCode(6);
    const id = newId();
    const subzones = b.subzones.map((z, i) => ({ ...z, id: z.id || `z${i + 1}` }));
    const now = ctx.now();
    ctx.db.tx(() => {
      ctx.db.insert('events', {
        id, name: b.name, organizer_device: req.deviceId, code, center_lat: b.centerLat, center_lng: b.centerLng, radius_m: b.radiusM,
        starts_at: startsAt, ends_at: endsAt, subzones, thresholds: t, created_at: now,
      });
      ctx.db.insert('event_members', { event_id: id, device_id: req.deviceId, display_name: b.displayName, role: 'organizer', status: 'safe', status_at: now });
    });
    reply.code(201);
    return { event: serializeEvent(ctx, ctx.db.get('SELECT * FROM events WHERE id = ?', id)!, req.deviceId, true) };
  });

  app.post('/events/join', async (req) => {
    const b = EventJoinSchema.parse(req.body);
    const e = ctx.db.get('SELECT * FROM events WHERE code = ?', b.code.trim().toUpperCase());
    if (!e) throw notFound('No event with that code');
    if (e.ends_at < ctx.now()) throw badRequest('This event has ended');
    if (!ctx.db.get('SELECT 1 FROM event_members WHERE event_id = ? AND device_id = ?', e.id, req.deviceId)) {
      ctx.db.insert('event_members', { event_id: e.id, device_id: req.deviceId, display_name: b.displayName, role: 'attendee', status: 'unknown' });
    }
    return { event: serializeEvent(ctx, e, req.deviceId, true) };
  });

  app.get('/events', async (req) => {
    const rows = ctx.db.all('SELECT e.* FROM events e JOIN event_members m ON m.event_id = e.id WHERE m.device_id = ? ORDER BY e.starts_at DESC', req.deviceId);
    return { events: rows.map((e) => serializeEvent(ctx, e, req.deviceId)) };
  });

  app.get('/events/:id', async (req) => {
    const { id } = req.params as { id: string };
    requireMember(id, req.deviceId);
    const e = ctx.db.get('SELECT * FROM events WHERE id = ?', id);
    if (!e) throw notFound();
    return { event: serializeEvent(ctx, e, req.deviceId, true) };
  });

  app.post('/events/:id/status', async (req) => {
    const { id } = req.params as { id: string };
    const b = EventStatusSchema.parse(req.body);
    const m = requireMember(id, req.deviceId);
    const e = ctx.db.get('SELECT * FROM events WHERE id = ?', id)!;
    const zones = parseJson<Subzone[]>(e.subzones, []);
    let subzoneId = b.subzoneId && zones.some((z) => z.id === b.subzoneId) ? b.subzoneId : null;
    if (!subzoneId && b.lat !== undefined && b.lng !== undefined) subzoneId = findSubzone(e, b.lat, b.lng);
    const now = ctx.now();
    ctx.db.run(
      'UPDATE event_members SET status = ?, subzone_id = ?, lat = ?, lng = ?, status_at = ? WHERE event_id = ? AND device_id = ?',
      b.status, subzoneId, b.lat ?? null, b.lng ?? null, now, id, req.deviceId,
    );
    if (b.status === 'need_help') {
      const zone = zones.find((z) => z.id === subzoneId);
      const others = ctx.db.all<{ device_id: string }>('SELECT device_id FROM event_members WHERE event_id = ? AND device_id != ?', id, req.deviceId).map((r) => r.device_id);
      await ctx.notify.toDevices(others, {
        kind: 'event_help',
        title: `${m.display_name} needs help at ${e.name}`,
        body: `${zone ? `Near ${zone.name}. ` : ''}Organisers/volunteers please respond.`,
        data: { eventId: id, url: `/events/${id}`, lat: b.lat, lng: b.lng },
      });
    } else if (m.status === 'need_help') {
      const others = ctx.db.all<{ device_id: string }>('SELECT device_id FROM event_members WHERE event_id = ? AND device_id != ?', id, req.deviceId).map((r) => r.device_id);
      await ctx.notify.toDevices(others, { kind: 'event_safe', title: `${m.display_name} is safe now`, body: `Update from ${e.name}.`, data: { eventId: id, url: `/events/${id}` } });
    }
    return { event: serializeEvent(ctx, e, req.deviceId, true) };
  });

  app.post('/events/:id/leave', async (req) => {
    const { id } = req.params as { id: string };
    const m = requireMember(id, req.deviceId);
    if (m.role === 'organizer') throw badRequest('Organisers cannot leave their own event');
    ctx.db.run('DELETE FROM event_members WHERE event_id = ? AND device_id = ?', id, req.deviceId);
    return { ok: true };
  });
}
