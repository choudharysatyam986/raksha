import type { FastifyInstance } from 'fastify';
import {
  AiStructureSchema,
  DraftSchema,
  ReportCreateSchema,
  generateDraft,
  geohashBounds,
  safetyGuidance,
  scrubPII,
  snapLocation,
  type CellPatterns,
} from '@raksha/shared';
import { badRequest, HttpError, notFound, type Ctx } from '../context.js';
import { newId, parseJson, type Row } from '../db.js';
import { aiMode, structureIncident } from '../services/ai.js';
import { recomputeCell } from '../services/risk.js';
import { evaluateEventRisk, findSubzone } from '../services/safety.js';

const MAX_REPORTS_PER_HOUR = 10;

function serializeReport(r: Row) {
  return {
    id: r.id,
    type: r.type,
    severity: r.severity,
    frequency: r.frequency,
    tags: parseJson<string[]>(r.tags, []),
    occurredAt: r.occurred_at,
    cellId: r.cell_id,
    lat: r.lat,
    lng: r.lng,
    description: r.description,
    status: r.status,
    eventId: r.event_id,
    subzoneId: r.subzone_id,
    createdAt: r.created_at,
  };
}

function serializeArea(a: Row) {
  const patterns = parseJson<CellPatterns>(a.patterns, { recurring: null, burst: null, dominantType: null, typeCounts: {} });
  const b = geohashBounds(a.cell_id);
  return {
    cellId: a.cell_id,
    lat: a.lat,
    lng: a.lng,
    bounds: [[b.latMin, b.lngMin], [b.latMax, b.lngMax]],
    level: a.level,
    score: a.score,
    reportCount: a.report_count,
    independentDevices: a.independent_devices,
    patterns,
    guidance: safetyGuidance({ level: a.level, patterns }),
    updatedAt: a.updated_at,
  };
}

export default async function reportRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.post('/reports', async (req, reply) => {
    const body = ReportCreateSchema.parse(req.body);
    const now = ctx.now();
    const occurredAt = Date.parse(body.occurredAt);
    if (isNaN(occurredAt) || occurredAt > now + 3_600_000) throw badRequest('Incident time cannot be in the future');
    if (occurredAt < now - 365 * 86_400_000) throw badRequest('Incident must be within the last year');
    const recent = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE device_id = ? AND created_at > ?', req.deviceId, now - 3_600_000)!.n;
    if (recent >= MAX_REPORTS_PER_HOUR) throw new HttpError(429, 'Too many reports from this device. Please try again later.');

    const snapped = snapLocation(body.lat, body.lng);
    const scrub = scrubPII(body.description);
    let eventId: string | null = null;
    let subzoneId: string | null = null;
    if (body.eventId) {
      const ev = ctx.db.get('SELECT * FROM events WHERE id = ?', body.eventId);
      if (ev) {
        eventId = ev.id;
        const zones = parseJson<Array<{ id: string }>>(ev.subzones, []);
        subzoneId = body.subzoneId && zones.some((z) => z.id === body.subzoneId) ? body.subzoneId : findSubzone(ev, body.lat, body.lng);
      }
    }
    const row = {
      id: newId(),
      device_id: req.deviceId,
      type: body.type,
      severity: body.severity,
      frequency: body.frequency,
      tags: body.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
      occurred_at: occurredAt,
      cell_id: snapped.cellId,
      lat: snapped.lat,
      lng: snapped.lng,
      description: scrub.text,
      status: 'active',
      event_id: eventId,
      subzone_id: subzoneId,
      created_at: now,
    };
    ctx.db.insert('reports', row);
    const cell = await recomputeCell(ctx, snapped.cellId);
    const eventAlerts = eventId && subzoneId ? await evaluateEventRisk(ctx, eventId, subzoneId) : [];
    reply.code(201);
    return {
      report: serializeReport(ctx.db.get('SELECT * FROM reports WHERE id = ?', row.id)!),
      redactions: scrub.redactions,
      area: cell ? { level: cell.visible ? cell.level : null, visible: cell.visible } : null,
      eventAlerts,
    };
  });

  app.get('/reports/mine', async (req) => {
    const rows = ctx.db.all('SELECT * FROM reports WHERE device_id = ? ORDER BY created_at DESC', req.deviceId);
    return { reports: rows.map(serializeReport) };
  });

  app.get('/reports/:id', async (req) => {
    const { id } = req.params as { id: string };
    const r = ctx.db.get('SELECT * FROM reports WHERE id = ? AND device_id = ?', id, req.deviceId);
    if (!r) throw notFound('Report not found');
    const area = ctx.db.get('SELECT * FROM area_risk WHERE cell_id = ? AND visible = 1', r.cell_id);
    return { report: serializeReport(r), area: area ? serializeArea(area) : null };
  });

  app.post('/reports/:id/retract', async (req) => {
    const { id } = req.params as { id: string };
    const r = ctx.db.get('SELECT * FROM reports WHERE id = ? AND device_id = ?', id, req.deviceId);
    if (!r) throw notFound('Report not found');
    if (r.status !== 'retracted') {
      ctx.db.run("UPDATE reports SET status = 'retracted' WHERE id = ?", id);
      await recomputeCell(ctx, r.cell_id);
    }
    return { ok: true, report: serializeReport(ctx.db.get('SELECT * FROM reports WHERE id = ?', id)!) };
  });

  app.get('/map/areas', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const n = (k: string, d: number) => (q[k] !== undefined && !isNaN(Number(q[k])) ? Number(q[k]) : d);
    const minLat = n('minLat', -90), maxLat = n('maxLat', 90), minLng = n('minLng', -180), maxLng = n('maxLng', 180);
    const rows = ctx.db.all(
      'SELECT * FROM area_risk WHERE visible = 1 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY score DESC LIMIT 2000',
      minLat, maxLat, minLng, maxLng,
    );
    const hidden = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM area_risk WHERE visible = 0 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?', minLat, maxLat, minLng, maxLng)!.n;
    return { areas: rows.map(serializeArea), hiddenAreas: hidden, kAnonymity: 3 };
  });

  app.get('/map/areas/:cellId', async (req) => {
    const { cellId } = req.params as { cellId: string };
    const a = ctx.db.get('SELECT * FROM area_risk WHERE cell_id = ? AND visible = 1', cellId);
    if (!a) throw notFound('Area not available (not enough independent reports yet)');
    return { area: serializeArea(a) };
  });

  app.post('/ai/structure', async (req) => {
    const { text } = AiStructureSchema.parse(req.body);
    return { suggestion: await structureIncident(ctx, text), mode: aiMode(ctx) };
  });

  app.post('/ai/draft', async (req) => {
    const body = DraftSchema.parse(req.body);
    return { draft: generateDraft(body) };
  });
}
