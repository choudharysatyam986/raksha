import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HOUR_BUCKETS, geohashNeighbors, hourBucket, levelRank, safetyGuidance, type CellPatterns } from '@raksha/shared';
import { HttpError, notFound, sha256, type Ctx } from '../context.js';
import { parseJson, type Row } from '../db.js';

function serializeCell(a: Row) {
  const patterns = parseJson<CellPatterns>(a.patterns, { recurring: null, burst: null, dominantType: null, typeCounts: {} });
  return {
    cellId: a.cell_id, lat: a.lat, lng: a.lng, level: a.level, score: a.score, reportCount: a.report_count,
    independentDevices: a.independent_devices, patterns, guidance: safetyGuidance({ level: a.level, patterns }), updatedAt: a.updated_at,
  };
}

/**
 * Read-only aggregate API for police / municipal / campus safety teams. Never exposes device ids, raw descriptions
 * or cells below the k-anonymity threshold.
 */
export default async function authorityRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const expected = Buffer.from(sha256(ctx.cfg.authorityApiKey));
  app.addHook('preHandler', async (req) => {
    const key = (req.headers['x-authority-key'] as string | undefined) ?? '';
    const got = Buffer.from(sha256(key));
    if (!key || !timingSafeEqual(got, expected)) throw new HttpError(401, 'Invalid or missing X-Authority-Key');
  });

  app.get('/authority/patterns', async (req) => {
    const q = req.query as { minLevel?: string; pattern?: string };
    const min = levelRank(q.minLevel ?? 'low');
    let cells = ctx.db.all('SELECT * FROM area_risk WHERE visible = 1 ORDER BY score DESC').map(serializeCell).filter((c) => levelRank(c.level) >= min);
    if (q.pattern === 'recurring') cells = cells.filter((c) => c.patterns.recurring);
    if (q.pattern === 'burst') cells = cells.filter((c) => c.patterns.burst?.active);
    return {
      generatedAt: ctx.now(),
      cells,
      summary: {
        recurring: cells.filter((c) => c.patterns.recurring).length,
        activeBursts: cells.filter((c) => c.patterns.burst?.active).length,
        byLevel: Object.fromEntries(['low', 'moderate', 'high', 'critical'].map((l) => [l, cells.filter((c) => c.level === l).length])),
      },
    };
  });

  app.get('/authority/escalations', async (req) => {
    const { status } = req.query as { status?: string };
    const rows = status
      ? ctx.db.all('SELECT * FROM escalations WHERE status = ? ORDER BY created_at DESC LIMIT 500', status)
      : ctx.db.all('SELECT * FROM escalations ORDER BY created_at DESC LIMIT 500');
    return {
      escalations: rows.map((e) => {
        const area = ctx.db.get('SELECT lat, lng, level, score FROM area_risk WHERE cell_id = ?', e.cell_id);
        return {
          id: e.id, cellId: e.cell_id, lat: area?.lat ?? null, lng: area?.lng ?? null, level: e.level, currentLevel: area?.level ?? null,
          reason: e.reason, score: e.score, reportCount: e.report_count, independentDevices: e.independent_devices,
          patterns: parseJson(e.patterns, {}), status: e.status, note: e.note, createdAt: e.created_at, updatedAt: e.updated_at,
        };
      }),
    };
  });

  app.post('/authority/escalations/:id/ack', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['acknowledged', 'actioned', 'dismissed']).default('acknowledged'), note: z.string().max(1000).optional() }).parse(req.body ?? {});
    const e = ctx.db.get('SELECT * FROM escalations WHERE id = ?', id);
    if (!e) throw notFound('Escalation not found');
    ctx.db.update('escalations', 'id', id, { status: b.status, note: b.note ?? e.note, updated_at: ctx.now() });
    return { ok: true, status: b.status };
  });

  /** Adjacent elevated cells form hotspot "corridors" – useful for patrol route planning. */
  app.get('/authority/zone-graph', async (req) => {
    const { minLevel } = req.query as { minLevel?: string };
    const min = levelRank(minLevel ?? 'moderate');
    const cells = ctx.db.all('SELECT * FROM area_risk WHERE visible = 1').map(serializeCell).filter((c) => levelRank(c.level) >= min);
    const byId = new Map(cells.map((c) => [c.cellId, c]));
    const edges: Array<{ from: string; to: string }> = [];
    for (const c of cells) {
      for (const n of geohashNeighbors(c.cellId)) if (byId.has(n) && c.cellId < n) edges.push({ from: c.cellId, to: n });
    }
    const parent = new Map(cells.map((c) => [c.cellId, c.cellId]));
    const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
    for (const e of edges) parent.set(find(e.from), find(e.to));
    const groups = new Map<string, string[]>();
    for (const c of cells) groups.set(find(c.cellId), [...(groups.get(find(c.cellId)) ?? []), c.cellId]);
    const clusters = [...groups.values()]
      .map((ids, i) => {
        const members = ids.map((id) => byId.get(id)!);
        const score = members.reduce((s, m) => s + m.score, 0);
        return {
          id: `cluster-${i + 1}`,
          cells: ids,
          size: ids.length,
          totalScore: Math.round(score * 100) / 100,
          maxLevel: members.reduce((m, c) => (levelRank(c.level) > levelRank(m) ? c.level : m), 'low'),
          centroid: { lat: members.reduce((s, m) => s + m.lat, 0) / members.length, lng: members.reduce((s, m) => s + m.lng, 0) / members.length },
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);
    return { nodes: cells.map((c) => ({ id: c.cellId, lat: c.lat, lng: c.lng, level: c.level, score: c.score })), edges, clusters };
  });

  app.get('/authority/analytics', async (req) => {
    const days = Math.min(Math.max(Number((req.query as { days?: string }).days ?? 30) || 30, 1), 365);
    const now = ctx.now();
    const since = now - days * 86_400_000;
    const reports = ctx.db.all("SELECT type, severity, frequency, occurred_at, tags, cell_id FROM reports WHERE status = 'active' AND occurred_at >= ?", since);
    const count = (f: (r: Row) => string) => reports.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
    const byDay = count((r) => new Date(r.occurred_at).toLocaleDateString('en-CA', { timeZone: ctx.cfg.timeZone }));
    const tagCounts: Record<string, number> = {};
    for (const r of reports) for (const t of parseJson<string[]>(r.tags, [])) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    const byBucket = count((r) => hourBucket(r.occurred_at, ctx.cfg.timeZone));
    const levels = ctx.db.all<{ level: string; n: number }>('SELECT level, COUNT(*) AS n FROM area_risk WHERE visible = 1 GROUP BY level');
    return {
      windowDays: days,
      totalReports: reports.length,
      retracted: ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE status = 'retracted' AND occurred_at >= ?", since)!.n,
      byType: count((r) => r.type),
      bySeverity: count((r) => String(r.severity)),
      byFrequency: count((r) => r.frequency),
      byTimeOfDay: HOUR_BUCKETS.map((b) => ({ bucket: b.id, label: b.label, count: byBucket[b.id] ?? 0 })),
      byDay: Object.entries(byDay).sort().map(([day, n]) => ({ day, count: n })),
      topTags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, n]) => ({ tag, count: n })),
      areas: {
        visible: ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM area_risk WHERE visible = 1')!.n,
        hiddenBelowK: ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM area_risk WHERE visible = 0')!.n,
        byLevel: Object.fromEntries(levels.map((l) => [l.level, l.n])),
      },
      escalations: {
        open: ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM escalations WHERE status = 'open'")!.n,
        total: ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM escalations WHERE created_at >= ?', since)!.n,
      },
      eventAlerts: ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM event_alerts WHERE created_at >= ?', since)!.n,
      generatedAt: now,
    };
  });

  app.get('/authority/events', async () => {
    const events = ctx.db.all('SELECT * FROM events ORDER BY starts_at DESC LIMIT 50');
    return {
      events: events.map((e) => ({
        id: e.id, name: e.name, startsAt: e.starts_at, endsAt: e.ends_at, centerLat: e.center_lat, centerLng: e.center_lng, radiusM: e.radius_m,
        subzones: parseJson<any[]>(e.subzones, []).map((z) => ({
          ...z,
          reportCount: ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE event_id = ? AND subzone_id = ? AND status = 'active'", e.id, z.id)!.n,
        })),
        alerts: ctx.db.all('SELECT subzone_id, level, count, created_at FROM event_alerts WHERE event_id = ? ORDER BY created_at DESC', e.id),
        needHelp: ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_members WHERE event_id = ? AND status = 'need_help'", e.id)!.n,
      })),
    };
  });
}
