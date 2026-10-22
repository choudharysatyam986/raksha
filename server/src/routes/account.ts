import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { ContactSchema, DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@raksha/shared';
import { notFound, type Ctx } from '../context.js';
import { newId, parseJson, type Row } from '../db.js';
import { deleteEvidenceFile } from '../services/evidence.js';
import { recomputeCell } from '../services/risk.js';
import { trackingNeeded } from './share.js';

export function getSettings(ctx: Ctx, deviceId: string): Required<Settings> {
  const row = ctx.db.get<{ data: string }>('SELECT data FROM settings WHERE device_id = ?', deviceId);
  const s = parseJson<Settings>(row?.data, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    voiceGuard: { ...DEFAULT_SETTINGS.voiceGuard, ...s.voiceGuard },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...s.notifications },
  };
}

const serializeContact = (ctx: Ctx, c: Row) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  telegramLinked: !!c.telegram_chat_id,
  linkCode: c.link_code,
  telegramLink: c.link_code ? ctx.notify.telegramLink(c.link_code) : null,
  createdAt: c.created_at,
});

export default async function accountRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get('/me', async (req) => {
    const d = ctx.db.get('SELECT * FROM devices WHERE id = ?', req.deviceId)!;
    const unread = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM alerts WHERE device_id = ? AND read = 0', req.deviceId)!.n;
    const settings = getSettings(ctx, req.deviceId);
    return {
      deviceId: d.id,
      displayName: d.display_name || settings.displayName || '',
      pushSubscribed: !!d.push_sub,
      unreadAlerts: unread,
      trackingNeeded: trackingNeeded(ctx, req.deviceId),
      activeTrip: !!ctx.db.get("SELECT 1 FROM trips WHERE device_id = ? AND status = 'active'", req.deviceId),
      activeSos: !!ctx.db.get("SELECT 1 FROM sos WHERE device_id = ? AND status = 'active'", req.deviceId),
      activeShares: ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM share_links WHERE device_id = ? AND status = 'active'", req.deviceId)!.n,
      settings,
    };
  });

  app.put('/me', async (req) => {
    const { displayName } = z.object({ displayName: z.string().min(1).max(40) }).parse(req.body);
    ctx.db.run('UPDATE devices SET display_name = ? WHERE id = ?', displayName, req.deviceId);
    return { ok: true };
  });

  /** Erase every record linked to this device (right to be forgotten). Reports are retracted, not kept. */
  app.delete('/me', async (req) => {
    const id = req.deviceId;
    const cells = ctx.db.all<{ cell_id: string }>('SELECT DISTINCT cell_id FROM reports WHERE device_id = ?', id);
    for (const e of ctx.db.all<{ id: string }>('SELECT id FROM evidence WHERE device_id = ?', id)) deleteEvidenceFile(ctx, e.id);
    ctx.db.tx(() => {
      for (const t of ['reports', 'evidence', 'contacts', 'alerts', 'settings', 'location_pings', 'share_links', 'sos', 'circle_members', 'event_members']) {
        ctx.db.run(`DELETE FROM ${t} WHERE device_id = ?`, id);
      }
      ctx.db.run('DELETE FROM checkins WHERE trip_id IN (SELECT id FROM trips WHERE device_id = ?)', id);
      ctx.db.run('DELETE FROM trips WHERE device_id = ?', id);
      ctx.db.run('DELETE FROM nudges WHERE from_device = ? OR to_device = ?', id, id);
      ctx.db.run('DELETE FROM devices WHERE id = ?', id);
    });
    for (const c of cells) await recomputeCell(ctx, c.cell_id);
    return { ok: true };
  });

  app.get('/settings', async (req) => ({ settings: getSettings(ctx, req.deviceId) }));

  app.put('/settings', async (req) => {
    const patch = SettingsSchema.parse(req.body);
    const merged = { ...getSettings(ctx, req.deviceId), ...patch };
    ctx.db.run('INSERT INTO settings (device_id, data) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET data = excluded.data', req.deviceId, JSON.stringify(merged));
    if (patch.displayName) ctx.db.run('UPDATE devices SET display_name = ? WHERE id = ?', patch.displayName, req.deviceId);
    return { settings: getSettings(ctx, req.deviceId) };
  });

  // ---------- Alerts feed ----------
  app.get('/alerts', async (req) => {
    const q = req.query as { since?: string; limit?: string };
    const since = Number(q.since ?? 0) || 0;
    const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
    const rows = ctx.db.all('SELECT * FROM alerts WHERE device_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?', req.deviceId, since, limit);
    return {
      alerts: rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, data: parseJson(a.data, {}), read: !!a.read, createdAt: a.created_at })),
      unread: ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM alerts WHERE device_id = ? AND read = 0', req.deviceId)!.n,
    };
  });

  app.post('/alerts/read', async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
    if (ids?.length) {
      for (const id of ids) ctx.db.run('UPDATE alerts SET read = 1 WHERE id = ? AND device_id = ?', id, req.deviceId);
    } else {
      ctx.db.run('UPDATE alerts SET read = 1 WHERE device_id = ?', req.deviceId);
    }
    return { ok: true };
  });

  // ---------- Web Push ----------
  app.post('/push/subscribe', async (req) => {
    const sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).passthrough().parse((req.body as any)?.subscription ?? req.body);
    ctx.db.run('UPDATE devices SET push_sub = ? WHERE id = ?', JSON.stringify(sub), req.deviceId);
    return { ok: true };
  });

  app.delete('/push/subscribe', async (req) => {
    ctx.db.run('UPDATE devices SET push_sub = NULL WHERE id = ?', req.deviceId);
    return { ok: true };
  });

  app.post('/push/test', async (req) => {
    await ctx.notify.toDevice(req.deviceId, { kind: 'test', title: 'Raksha test notification', body: 'Notifications are working 🎉', data: { url: '/alerts' } });
    return { ok: true };
  });

  // ---------- Trusted contacts ----------
  app.get('/contacts', async (req) => ({
    contacts: ctx.db.all('SELECT * FROM contacts WHERE device_id = ? ORDER BY created_at', req.deviceId).map((c) => serializeContact(ctx, c)),
    telegramEnabled: ctx.notify.telegramEnabled,
    telegramBot: ctx.cfg.telegram.username ?? null,
  }));

  app.post('/contacts', async (req, reply) => {
    const b = ContactSchema.parse(req.body);
    const id = newId();
    ctx.db.insert('contacts', { id, device_id: req.deviceId, name: b.name, phone: b.phone ?? null, created_at: ctx.now() });
    reply.code(201);
    return { contact: serializeContact(ctx, ctx.db.get('SELECT * FROM contacts WHERE id = ?', id)!) };
  });

  const ownContact = (id: string, deviceId: string) => {
    const c = ctx.db.get('SELECT * FROM contacts WHERE id = ? AND device_id = ?', id, deviceId);
    if (!c) throw notFound('Contact not found');
    return c;
  };

  app.put('/contacts/:id', async (req) => {
    const { id } = req.params as { id: string };
    ownContact(id, req.deviceId);
    const b = ContactSchema.parse(req.body);
    ctx.db.update('contacts', 'id', id, { name: b.name, phone: b.phone ?? null });
    return { contact: serializeContact(ctx, ctx.db.get('SELECT * FROM contacts WHERE id = ?', id)!) };
  });

  app.delete('/contacts/:id', async (req) => {
    const { id } = req.params as { id: string };
    ownContact(id, req.deviceId);
    ctx.db.run('DELETE FROM contacts WHERE id = ?', id);
    return { ok: true };
  });

  app.post('/contacts/:id/telegram-link', async (req) => {
    const { id } = req.params as { id: string };
    const c = ownContact(id, req.deviceId);
    const code = c.link_code ?? randomBytes(9).toString('base64url');
    if (!c.link_code) ctx.db.run('UPDATE contacts SET link_code = ? WHERE id = ?', code, id);
    const link = ctx.notify.telegramLink(code);
    return {
      contact: serializeContact(ctx, ctx.db.get('SELECT * FROM contacts WHERE id = ?', id)!),
      link,
      code,
      enabled: ctx.notify.telegramEnabled,
      instructions: link
        ? `Send this link to ${c.name}. When they open it and press Start in Telegram, they will receive your SOS and missed check-in alerts.`
        : `Telegram bot is not configured on this server. Ask the admin to set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME. Link code: ${code}`,
    };
  });

  app.post('/contacts/:id/telegram-test', async (req) => {
    const c = ownContact((req.params as { id: string }).id, req.deviceId);
    const ok = c.telegram_chat_id ? await ctx.notify.telegramSend(c.telegram_chat_id, 'Raksha test: you will receive safety alerts here.') : false;
    return { delivered: ok };
  });
}
