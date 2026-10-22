import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PingSchema, ShareCreateSchema, SosStartSchema, HELPLINES } from '@raksha/shared';
import { badRequest, forbidden, HttpError, notFound, shareUrl, type Ctx } from '../context.js';
import { newId, parseJson, type Row } from '../db.js';
import { circleMateIds, createShareLink, displayName, latestPing, serializeShare } from '../services/safety.js';

function circleMembersFor(ctx: Ctx, deviceId: string, circleIds?: string[]) {
  if (!circleIds?.length) return circleMateIds(ctx, deviceId);
  const out: string[] = [];
  for (const cid of circleIds) {
    if (!ctx.db.get('SELECT 1 FROM circle_members WHERE circle_id = ? AND device_id = ?', cid, deviceId)) throw forbidden('Not a member of one of the selected circles');
    out.push(...circleMateIds(ctx, deviceId, cid));
  }
  return [...new Set(out)];
}

function serializeSos(ctx: Ctx, s: Row) {
  const share = s.share_link_id ? ctx.db.get('SELECT * FROM share_links WHERE id = ?', s.share_link_id) : undefined;
  return { id: s.id, status: s.status, note: s.note, startedAt: s.started_at, endedAt: s.ended_at, notified: parseJson(s.notified, {}), share: share ? serializeShare(ctx, share) : null };
}

export function trackingNeeded(ctx: Ctx, deviceId: string) {
  return !!(
    ctx.db.get("SELECT 1 FROM share_links WHERE device_id = ? AND status = 'active'", deviceId) ||
    ctx.db.get("SELECT 1 FROM trips WHERE device_id = ? AND status = 'active'", deviceId) ||
    ctx.db.get("SELECT 1 FROM sos WHERE device_id = ? AND status = 'active'", deviceId)
  );
}

export default async function shareRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const U = () => ctx.cfg.unitMs;

  // ---------- Temporary location sharing ----------
  app.post('/shares', async (req, reply) => {
    const b = ShareCreateSchema.parse(req.body);
    if (b.tripId && !ctx.db.get('SELECT 1 FROM trips WHERE id = ? AND device_id = ?', b.tripId, req.deviceId)) throw notFound('Trip not found');
    const active = ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM share_links WHERE device_id = ? AND status = 'active'", req.deviceId)!.n;
    if (active >= 10) throw badRequest('Too many active shares. Stop one first.');
    const link = createShareLink(ctx, req.deviceId, { label: b.label, durationMin: b.durationMin, stopOnArrival: b.stopOnArrival, tripId: b.tripId });
    const url = shareUrl(ctx, link.token);
    const name = displayName(ctx, req.deviceId);
    let circleNotified = 0;
    if (b.circleIds.length) {
      circleNotified = await ctx.notify.toDevices(circleMembersFor(ctx, req.deviceId, b.circleIds), {
        kind: 'share', title: `${name} is sharing live location`, body: `"${b.label}" for ${b.durationMin} ${ctx.cfg.demoMode ? 'sec (demo)' : 'min'}.`, data: { url: `/t/${link.token}` },
      });
    }
    const contacts = b.contactIds.length ? await ctx.notify.toContacts(req.deviceId, `${name} is sharing their live location with you via Raksha until it expires: ${url}`, b.contactIds) : [];
    reply.code(201);
    return { share: serializeShare(ctx, link), circleNotified, contacts };
  });

  app.get('/shares', async (req) => {
    const rows = ctx.db.all('SELECT * FROM share_links WHERE device_id = ? ORDER BY created_at DESC LIMIT 30', req.deviceId);
    return { shares: rows.map((r) => serializeShare(ctx, r)), unitMs: U() };
  });

  const ownShare = (id: string, deviceId: string) => {
    const s = ctx.db.get('SELECT * FROM share_links WHERE id = ? AND device_id = ?', id, deviceId);
    if (!s) throw notFound('Share not found');
    return s;
  };

  app.post('/shares/:id/extend', async (req) => {
    const { id } = req.params as { id: string };
    const { minutes } = z.object({ minutes: z.number().int().min(1).max(12 * 60) }).parse(req.body);
    const s = ownShare(id, req.deviceId);
    if (s.status !== 'active') throw badRequest('This share has already ended. Create a new one.');
    ctx.db.run('UPDATE share_links SET expires_at = ?, reminder_sent = 0 WHERE id = ?', Math.max(s.expires_at, ctx.now()) + minutes * U(), id);
    return { share: serializeShare(ctx, ctx.db.get('SELECT * FROM share_links WHERE id = ?', id)!) };
  });

  app.post('/shares/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    ownShare(id, req.deviceId);
    ctx.db.run("UPDATE share_links SET status = 'stopped', ended_at = ? WHERE id = ? AND status = 'active'", ctx.now(), id);
    return { share: serializeShare(ctx, ctx.db.get('SELECT * FROM share_links WHERE id = ?', id)!) };
  });

  // ---------- Location pings (only accepted while something is being shared) ----------
  app.post('/location/ping', async (req) => {
    const b = PingSchema.parse(req.body);
    const needed = trackingNeeded(ctx, req.deviceId);
    if (needed) {
      const now = ctx.now();
      ctx.db.insert('location_pings', { device_id: req.deviceId, lat: b.lat, lng: b.lng, accuracy: b.accuracy ?? null, at: now });
      ctx.db.run('DELETE FROM location_pings WHERE device_id = ? AND at < ?', req.deviceId, now - 24 * 3_600_000);
    }
    return { stored: needed, trackingNeeded: needed };
  });

  app.get('/location/needed', async (req) => ({ trackingNeeded: trackingNeeded(ctx, req.deviceId) }));

  // ---------- SOS ----------
  app.post('/sos', async (req, reply) => {
    const b = SosStartSchema.parse(req.body ?? {});
    const existing = ctx.db.get("SELECT * FROM sos WHERE device_id = ? AND status = 'active'", req.deviceId);
    if (existing) return { sos: serializeSos(ctx, existing), alreadyActive: true, contacts: [], smsText: '' };
    const now = ctx.now();
    if (b.lat !== undefined && b.lng !== undefined) ctx.db.insert('location_pings', { device_id: req.deviceId, lat: b.lat, lng: b.lng, at: now });
    const id = newId();
    const link = createShareLink(ctx, req.deviceId, { label: 'SOS live location', durationMin: 120, sosId: id });
    const url = shareUrl(ctx, link.token);
    const name = displayName(ctx, req.deviceId);
    const ping = latestPing(ctx, req.deviceId);
    const smsText = `SOS from ${name} via Raksha. I need help. Live location: ${url}${ping ? ` (last known: https://maps.google.com/?q=${ping.lat},${ping.lng})` : ''}${b.note ? ` Note: ${b.note}` : ''}`;
    ctx.db.insert('sos', { id, device_id: req.deviceId, status: 'active', note: b.note ?? null, share_link_id: link.id, notified: {}, started_at: now });
    const circleCount = await ctx.notify.toDevices(circleMembersFor(ctx, req.deviceId, b.circleIds), {
      kind: 'sos', title: `🚨 SOS: ${name} needs help`, body: `${b.note ? b.note + ' — ' : ''}Open to see live location. Call them or 112 if you cannot reach them.`, data: { url: `/t/${link.token}`, sosId: id },
    });
    const contacts = await ctx.notify.toContacts(req.deviceId, smsText, b.contactIds);
    ctx.db.update('sos', 'id', id, { notified: { circleMembers: circleCount, contacts: contacts.map((c) => ({ name: c.name, channel: c.channel, delivered: c.delivered })) } });
    reply.code(201);
    return { sos: serializeSos(ctx, ctx.db.get('SELECT * FROM sos WHERE id = ?', id)!), contacts, smsText, helplines: HELPLINES };
  });

  app.get('/sos/active', async (req) => {
    const s = ctx.db.get("SELECT * FROM sos WHERE device_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1", req.deviceId);
    return { sos: s ? serializeSos(ctx, s) : null };
  });

  const endSos = async (deviceId: string, id: string, status: 'resolved' | 'false_alarm') => {
    const s = ctx.db.get('SELECT * FROM sos WHERE id = ? AND device_id = ?', id, deviceId);
    if (!s) throw notFound('SOS not found');
    if (s.status !== 'active') throw new HttpError(409, 'This SOS has already ended');
    const now = ctx.now();
    ctx.db.update('sos', 'id', id, { status, ended_at: now });
    if (s.share_link_id) ctx.db.run("UPDATE share_links SET status = 'stopped', ended_at = ? WHERE id = ? AND status = 'active'", now, s.share_link_id);
    const name = displayName(ctx, deviceId);
    const msg = status === 'resolved' ? `${name} marked their SOS as resolved and is safe now.` : `${name} cancelled the SOS — it was a false alarm. They are safe.`;
    await ctx.notify.toDevices(circleMateIds(ctx, deviceId), { kind: 'sos_end', title: status === 'resolved' ? `${name} is safe now 💚` : 'SOS cancelled (false alarm)', body: msg, data: { url: '/circles' } });
    await ctx.notify.toContacts(deviceId, `Raksha update: ${msg}`);
    return { sos: serializeSos(ctx, ctx.db.get('SELECT * FROM sos WHERE id = ?', id)!), message: msg };
  };

  app.post('/sos/:id/resolve', async (req) => endSos(req.deviceId, (req.params as { id: string }).id, 'resolved'));
  app.post('/sos/:id/cancel', async (req) => endSos(req.deviceId, (req.params as { id: string }).id, 'false_alarm'));
}

/** Unauthenticated viewer for a share link. Returns nothing once the link has expired or was stopped. */
export async function publicShareRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get('/public/share/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const s = ctx.db.get('SELECT * FROM share_links WHERE token = ?', token);
    if (!s) throw notFound('This link does not exist');
    const now = ctx.now();
    if (s.status !== 'active' || s.expires_at <= now) {
      reply.code(410);
      return { status: s.status === 'active' ? 'expired' : s.status, message: 'Location sharing has ended for this link.' };
    }
    const trail = ctx.db
      .all('SELECT lat, lng, accuracy, at FROM location_pings WHERE device_id = ? AND at >= ? ORDER BY at DESC LIMIT 60', s.device_id, s.created_at - 10 * 60_000)
      .reverse();
    const sos = ctx.db.get("SELECT started_at, note FROM sos WHERE device_id = ? AND status = 'active'", s.device_id);
    const trip = ctx.db.get("SELECT destination, eta_at, last_state, stage FROM trips WHERE device_id = ? AND status = 'active'", s.device_id);
    reply.header('cache-control', 'no-store');
    return {
      status: 'active',
      name: displayName(ctx, s.device_id),
      label: s.label,
      expiresAt: s.expires_at,
      latest: trail[trail.length - 1] ?? null,
      trail,
      sos: sos ? { since: sos.started_at, note: sos.note } : null,
      trip: trip ? { destination: trip.destination, etaAt: trip.eta_at, state: trip.last_state, overdue: trip.stage >= 1 } : null,
      serverTime: now,
    };
  });
}
