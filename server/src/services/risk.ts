import {
  computeCellRisk,
  decideEscalation,
  DEFAULT_RISK_CONFIG,
  geohashDecode,
  haversineMeters,
  levelRank,
  type RiskLevel,
  type RiskReport,
  DEFAULT_SETTINGS,
  type Settings,
} from '@raksha/shared';
import type { Ctx } from '../context.js';
import { newId, parseJson } from '../db.js';

export function riskConfig(ctx: Ctx) {
  return { ...DEFAULT_RISK_CONFIG, timeZone: ctx.cfg.timeZone };
}

function loadCellReports(ctx: Ctx, cellId: string): RiskReport[] {
  return ctx.db
    .all("SELECT id, device_id, type, severity, frequency, occurred_at FROM reports WHERE cell_id = ? AND status = 'active'", cellId)
    .map((r) => ({ id: r.id, deviceId: r.device_id, type: r.type, severity: r.severity, frequency: r.frequency, occurredAt: r.occurred_at }));
}

/** Recompute one cell, persist it, create escalation records and notify watchers. */
export async function recomputeCell(ctx: Ctx, cellId: string) {
  const now = ctx.now();
  const reports = loadCellReports(ctx, cellId);
  const prev = ctx.db.get<{ level: RiskLevel; visible: number }>('SELECT level, visible FROM area_risk WHERE cell_id = ?', cellId);
  if (reports.length === 0) {
    ctx.db.run('DELETE FROM area_risk WHERE cell_id = ?', cellId);
    return null;
  }
  const cell = computeCellRisk(reports, now, riskConfig(ctx));
  const c = geohashDecode(cellId);
  ctx.db.run(
    `INSERT INTO area_risk (cell_id, lat, lng, score, level, independent_devices, report_count, visible, patterns, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cell_id) DO UPDATE SET score=excluded.score, level=excluded.level, independent_devices=excluded.independent_devices,
       report_count=excluded.report_count, visible=excluded.visible, patterns=excluded.patterns, updated_at=excluded.updated_at`,
    cellId, c.lat, c.lng, cell.score, cell.level, cell.independentDevices, cell.reportCount, cell.visible ? 1 : 0, JSON.stringify(cell.patterns), now,
  );
  const prevLevel: RiskLevel | null = prev && prev.visible ? prev.level : null;
  const recent = ctx.db
    .all('SELECT reason, created_at FROM escalations WHERE cell_id = ? AND created_at > ?', cellId, now - 86_400_000)
    .map((e) => ({ reason: e.reason, createdAt: e.created_at }));
  const decisions = decideEscalation(prevLevel, cell, recent, now);
  for (const d of decisions) {
    ctx.db.insert('escalations', {
      id: newId(),
      cell_id: cellId,
      level: d.level,
      reason: d.reason,
      score: cell.score,
      report_count: cell.reportCount,
      independent_devices: cell.independentDevices,
      patterns: cell.patterns,
      status: 'open',
      created_at: now,
      updated_at: now,
    });
  }
  const becameVisibleOrWorse = cell.visible && (levelRank(cell.level) > levelRank(prevLevel) || prevLevel === null) && levelRank(cell.level) >= 1;
  if (decisions.length || becameVisibleOrWorse) await notifyWatchers(ctx, cellId, c.lat, c.lng, cell.level, decisions.some((d) => d.reason === 'burst'));
  return cell;
}

export async function recomputeAll(ctx: Ctx) {
  const cells = ctx.db.all<{ cell_id: string }>("SELECT DISTINCT cell_id FROM reports UNION SELECT cell_id FROM area_risk");
  for (const { cell_id } of cells) await recomputeCell(ctx, cell_id);
  return cells.length;
}

async function notifyWatchers(ctx: Ctx, cellId: string, lat: number, lng: number, level: RiskLevel, burst: boolean) {
  const rows = ctx.db.all<{ device_id: string; data: string }>('SELECT device_id, data FROM settings');
  for (const r of rows) {
    const s = { ...DEFAULT_SETTINGS, ...parseJson<Settings>(r.data, {}) };
    if (!s.notifications?.watchAreaAlerts) continue;
    const area = s.watchAreas?.find((w) => haversineMeters(w.lat, w.lng, lat, lng) <= w.radiusM + 120);
    if (!area) continue;
    await ctx.notify.toDevice(r.device_id, {
      kind: 'watch_area',
      title: `Safety update near ${area.label || 'your watch area'}`,
      body: burst ? `A spike in harassment reports was detected nearby (area level: ${level}).` : `An area near ${area.label || 'you'} is now rated ${level} risk.`,
      data: { cellId, lat, lng, level, url: `/map?lat=${lat}&lng=${lng}` },
    });
  }
}
