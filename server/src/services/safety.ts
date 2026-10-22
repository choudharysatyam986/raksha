import { randomBytes } from 'node:crypto';
import { haversineMeters, newlyCrossedThresholds, overdueStage, shareLinkState, tripDueAt, type EventThresholds } from '@raksha/shared';
import { shareUrl, type Ctx } from '../context.js';
import { newId, parseJson, type Row } from '../db.js';

export function displayName(ctx: Ctx, deviceId: string): string {
  return ctx.db.get<{ display_name: string | null }>('SELECT display_name FROM devices WHERE id = ?', deviceId)?.display_name || 'A Raksha user';
}

export function circleMateIds(ctx: Ctx, deviceId: string, circleId?: string | null): string[] {
  const rows = circleId
    ? ctx.db.all<{ device_id: string }>('SELECT device_id FROM circle_members WHERE circle_id = ? AND device_id != ?', circleId, deviceId)
    : ctx.db.all<{ device_id: string }>(
        'SELECT DISTINCT m2.device_id FROM circle_members m1 JOIN circle_members m2 ON m1.circle_id = m2.circle_id WHERE m1.device_id = ? AND m2.device_id != ?',
        deviceId,
        deviceId,
      );
  return rows.map((r) => r.device_id);
}

export function latestPing(ctx: Ctx, deviceId: string) {
  return ctx.db.get<{ lat: number; lng: number; accuracy: number | null; at: number }>(
    'SELECT lat, lng, accuracy, at FROM location_pings WHERE device_id = ? ORDER BY at DESC, id DESC LIMIT 1',
    deviceId,
  );
}

export function createShareLink(ctx: Ctx, deviceId: string, opts: { label: string; durationMin: number; stopOnArrival?: boolean; tripId?: string | null; sosId?: string | null }) {
  const now = ctx.now();
  const row = {
    id: newId(),
    token: randomBytes(16).toString('base64url'),
    device_id: deviceId,
    label: opts.label,
    expires_at: now + opts.durationMin * ctx.cfg.unitMs,
    reminder_sent: 0,
    stop_on_arrival: opts.stopOnArrival ? 1 : 0,
    trip_id: opts.tripId ?? null,
    sos_id: opts.sosId ?? null,
    status: 'active',
    created_at: now,
  };
  ctx.db.insert('share_links', row);
  return row;
}

export function serializeShare(ctx: Ctx, r: Row) {
  return {
    id: r.id,
    token: r.token,
    url: shareUrl(ctx, r.token),
    path: `/t/${r.token}`,
    label: r.label,
    expiresAt: r.expires_at,
    reminderSent: !!r.reminder_sent,
    stopOnArrival: !!r.stop_on_arrival,
    tripId: r.trip_id,
    sosId: r.sos_id,
    status: r.status,
    createdAt: r.created_at,
  };
}

/** Derived status of a person as seen by their Safe Circle. */
export function memberState(ctx: Ctx, deviceId: string) {
  const sos = ctx.db.get("SELECT id, started_at FROM sos WHERE device_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1", deviceId);
  const trip = ctx.db.get("SELECT * FROM trips WHERE device_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1", deviceId);
  const lastCheckin = trip ? ctx.db.get('SELECT kind, at FROM checkins WHERE trip_id = ? ORDER BY at DESC LIMIT 1', trip.id) : undefined;
  const share = ctx.db.get("SELECT token FROM share_links WHERE device_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", deviceId);
  let state: 'sos' | 'help' | 'overdue' | 'delayed' | 'on_trip' | 'idle' = 'idle';
  if (sos) state = 'sos';
  else if (trip?.last_state === 'help') state = 'help';
  else if (trip && trip.stage >= 1) state = 'overdue';
  else if (trip?.last_state === 'delayed') state = 'delayed';
  else if (trip) state = 'on_trip';
  return {
    state,
    trip: trip ? { id: trip.id, destination: trip.destination, etaAt: trip.eta_at, nextCheckinAt: trip.next_checkin_at, stage: trip.stage } : null,
    lastCheckin: lastCheckin ? { kind: lastCheckin.kind, at: lastCheckin.at } : null,
    sharePath: share ? `/t/${share.token}` : null,
    sosSince: sos?.started_at ?? null,
  };
}

/** Scheduler step: escalate missed trip check-ins in stages. Never contacts police. */
export async function processTrips(ctx: Ctx) {
  const now = ctx.now();
  const trips = ctx.db.all("SELECT * FROM trips WHERE status = 'active'");
  for (const t of trips) {
    const due = tripDueAt({ nextCheckinAt: t.next_checkin_at, etaAt: t.eta_at }, ctx.cfg.unitMs);
    const stage = overdueStage(now, due, ctx.cfg.unitMs);
    if (stage <= t.stage) continue;
    for (let s = t.stage + 1; s <= stage; s++) await escalateTrip(ctx, t, s);
    ctx.db.run('UPDATE trips SET stage = ? WHERE id = ?', stage, t.id);
  }
}

export async function escalateTrip(ctx: Ctx, t: Row, stage: number, reason: 'missed' | 'help' = 'missed') {
  const name = displayName(ctx, t.device_id);
  const share = t.share_link_id ? ctx.db.get("SELECT token FROM share_links WHERE id = ? AND status = 'active'", t.share_link_id) : undefined;
  const ping = latestPing(ctx, t.device_id);
  const where = share ? `Live location: ${shareUrl(ctx, share.token)}` : ping ? `Last known location: https://maps.google.com/?q=${ping.lat},${ping.lng}` : 'No location available.';
  const what = reason === 'help' ? `${name} requested HELP during a trip to ${t.destination}.` : `${name} missed a safety check-in on the way to ${t.destination}.`;
  if (stage === 1) {
    await ctx.notify.toDevice(t.device_id, {
      kind: 'checkin_missed',
      title: 'Check-in missed. Are you safe?',
      body: 'Tap to check in. Your Safe Circle will be alerted if you do not respond.',
      data: { tripId: t.id, url: '/trip' },
    });
  } else if (stage === 2) {
    await ctx.notify.toDevices(circleMateIds(ctx, t.device_id, t.circle_id), {
      kind: reason === 'help' ? 'trip_help' : 'trip_overdue',
      title: reason === 'help' ? `${name} needs help` : `${name} missed a check-in`,
      body: `${what} Please try calling them. ${where}`,
      data: { tripId: t.id, deviceId: t.device_id, url: share ? `/t/${share.token}` : '/circles' },
    });
  } else if (stage === 3) {
    const text = `RAKSHA ALERT: ${what} They have not responded. ${where}. If you cannot reach them, consider calling 112.`;
    const results = await ctx.notify.toContacts(t.device_id, text);
    await ctx.notify.toDevices(circleMateIds(ctx, t.device_id, t.circle_id), {
      kind: 'trip_urgent',
      title: `URGENT: ${name} still not responding`,
      body: `${what} Trusted contacts have been alerted. ${where}`,
      data: { tripId: t.id, url: share ? `/t/${share.token}` : '/circles' },
    });
    const manual = results.filter((r) => !r.delivered);
    if (manual.length) {
      await ctx.notify.toDevice(t.device_id, {
        kind: 'contacts_manual',
        title: 'Some contacts need a manual alert',
        body: `${manual.map((m) => m.name).join(', ')} have no linked Telegram. Open the app to SMS/WhatsApp them.`,
        data: { url: '/sos', text },
      });
    }
  }
  ctx.db.insert('checkins', { id: newId(), trip_id: t.id, kind: `escalation_stage_${stage}`, note: reason, at: ctx.now() });
}

/** Scheduler step: pre-expiry reminders and auto-expiry for temporary location shares. */
export async function processShares(ctx: Ctx) {
  const now = ctx.now();
  const links = ctx.db.all("SELECT * FROM share_links WHERE status = 'active'");
  for (const l of links) {
    const st = shareLinkState({ expiresAt: l.expires_at, reminderSent: !!l.reminder_sent }, now, ctx.cfg.unitMs);
    if (st === 'reminder_due') {
      ctx.db.run('UPDATE share_links SET reminder_sent = 1 WHERE id = ?', l.id);
      const mins = Math.max(1, Math.round((l.expires_at - now) / ctx.cfg.unitMs));
      await ctx.notify.toDevice(l.device_id, {
        kind: 'share_expiring',
        title: 'Location sharing ends soon',
        body: `"${l.label}" stops in about ${mins} ${ctx.cfg.demoMode ? 'sec' : 'min'}. Extend it if you are not home yet.`,
        data: { shareId: l.id, url: '/share' },
      });
    } else if (st === 'expired') {
      ctx.db.run("UPDATE share_links SET status = 'expired', ended_at = ? WHERE id = ?", now, l.id);
      await ctx.notify.toDevice(l.device_id, { kind: 'share_expired', title: 'Location sharing stopped', body: `"${l.label}" has expired and is no longer visible.`, data: { url: '/share' } });
    }
  }
}

export function eventThresholds(e: Row): EventThresholds {
  return parseJson<EventThresholds>(e.thresholds, { advisory: 3, warning: 6 });
}

export function findSubzone(e: Row, lat: number, lng: number): string | null {
  const zones = parseJson<Array<{ id: string; lat: number; lng: number; radiusM: number }>>(e.subzones, []);
  let best: { id: string; d: number } | null = null;
  for (const z of zones) {
    const d = haversineMeters(z.lat, z.lng, lat, lng);
    if (d <= z.radiusM && (!best || d < best.d)) best = { id: z.id, d };
  }
  return best?.id ?? null;
}

/** Count reports per event subzone and alert members when a configured threshold is crossed. */
export async function evaluateEventRisk(ctx: Ctx, eventId: string, subzoneId: string) {
  const e = ctx.db.get('SELECT * FROM events WHERE id = ?', eventId);
  if (!e) return [];
  const count = ctx.db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reports WHERE event_id = ? AND subzone_id = ? AND status = 'active' AND created_at BETWEEN ? AND ?",
    eventId, subzoneId, e.starts_at - 3_600_000, e.ends_at + 3_600_000,
  )!.n;
  const already = ctx.db.all<{ level: string }>('SELECT level FROM event_alerts WHERE event_id = ? AND subzone_id = ?', eventId, subzoneId).map((r) => r.level);
  const crossed = newlyCrossedThresholds(count, eventThresholds(e), already);
  const zone = parseJson<Array<{ id: string; name: string }>>(e.subzones, []).find((z) => z.id === subzoneId);
  for (const level of crossed) {
    ctx.db.insert('event_alerts', { id: newId(), event_id: eventId, subzone_id: subzoneId, level, count, created_at: ctx.now() });
    const members = ctx.db.all<{ device_id: string }>('SELECT device_id FROM event_members WHERE event_id = ?', eventId).map((m) => m.device_id);
    await ctx.notify.toDevices(members, {
      kind: 'event_risk',
      title: level === 'warning' ? `Warning: avoid ${zone?.name ?? 'a zone'} at ${e.name}` : `Advisory: reports near ${zone?.name ?? 'a zone'} at ${e.name}`,
      body: `${count} harassment reports in ${zone?.name ?? 'this zone'}. ${level === 'warning' ? 'Move away, stay with your group and approach volunteers/police booth.' : 'Stay alert and keep your group close.'}`,
      data: { eventId, subzoneId, level, url: `/events/${eventId}` },
    });
  }
  return crossed;
}
