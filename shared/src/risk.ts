import type { Frequency, RiskLevel } from './constants.js';

export interface RiskReport {
  id: string;
  deviceId: string;
  type: string;
  severity: number; // 1..5
  frequency: Frequency;
  occurredAt: number; // epoch ms
}

export interface RiskConfig {
  halfLifeDays: number;
  deviceCap: number;
  kAnonymity: number;
  thresholds: { moderate: number; high: number; critical: number };
  burst: { count: number; windowHours: number; activeHours: number };
  recurring: { minReports: number; minDays: number; lookbackDays: number };
  timeZone: string;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  halfLifeDays: 30,
  deviceCap: 2.0,
  kAnonymity: 3,
  thresholds: { moderate: 1.5, high: 3, critical: 5 },
  burst: { count: 4, windowHours: 24, activeHours: 72 },
  recurring: { minReports: 3, minDays: 3, lookbackDays: 60 },
  timeZone: 'Asia/Kolkata',
};

const FREQ_MULT: Record<string, number> = { once: 1, repeated: 1.25, ongoing: 1.5 };
const DAY = 86_400_000;
const HOUR = 3_600_000;

export const HOUR_BUCKETS = [
  { id: 'late_night', label: 'Late night (12am–5am)', from: 0, to: 5 },
  { id: 'morning', label: 'Morning (5am–12pm)', from: 5, to: 12 },
  { id: 'afternoon', label: 'Afternoon (12pm–5pm)', from: 12, to: 17 },
  { id: 'evening', label: 'Evening (5pm–8pm)', from: 17, to: 20 },
  { id: 'night', label: 'Night (8pm–12am)', from: 20, to: 24 },
] as const;

export function localHour(ms: number, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(ms));
  return parseInt(h, 10) % 24;
}

export function localDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function hourBucket(ms: number, timeZone: string): string {
  const h = localHour(ms, timeZone);
  return HOUR_BUCKETS.find((b) => h >= b.from && h < b.to)!.id;
}

/** Contribution of a single report before per-device capping. */
export function reportWeight(r: RiskReport, now: number, cfg: RiskConfig = DEFAULT_RISK_CONFIG): number {
  const ageDays = Math.max(0, (now - r.occurredAt) / DAY);
  const decay = Math.pow(0.5, ageDays / cfg.halfLifeDays);
  const sev = Math.min(5, Math.max(1, r.severity)) / 5;
  return sev * (FREQ_MULT[r.frequency] ?? 1) * decay;
}

export interface CellPatterns {
  recurring: null | { bucket: string; label: string; reports: number; days: number };
  burst: null | { count: number; windowStart: number; windowEnd: number; active: boolean };
  dominantType: string | null;
  typeCounts: Record<string, number>;
}

export interface CellRisk {
  score: number;
  level: RiskLevel;
  independentDevices: number;
  reportCount: number;
  visible: boolean;
  patterns: CellPatterns;
}

export function levelFor(score: number, cfg: RiskConfig = DEFAULT_RISK_CONFIG): RiskLevel {
  if (score >= cfg.thresholds.critical) return 'critical';
  if (score >= cfg.thresholds.high) return 'high';
  if (score >= cfg.thresholds.moderate) return 'moderate';
  return 'low';
}

export function levelRank(l: RiskLevel | string | null | undefined): number {
  return ({ low: 0, moderate: 1, high: 2, critical: 3 } as Record<string, number>)[l ?? 'low'] ?? 0;
}

export function detectRecurring(reports: RiskReport[], now: number, cfg: RiskConfig = DEFAULT_RISK_CONFIG): CellPatterns['recurring'] {
  const recent = reports.filter((r) => now - r.occurredAt <= cfg.recurring.lookbackDays * DAY);
  const byBucket = new Map<string, { n: number; days: Set<string> }>();
  for (const r of recent) {
    const b = hourBucket(r.occurredAt, cfg.timeZone);
    const e = byBucket.get(b) ?? { n: 0, days: new Set<string>() };
    e.n++;
    e.days.add(localDay(r.occurredAt, cfg.timeZone));
    byBucket.set(b, e);
  }
  let best: CellPatterns['recurring'] = null;
  for (const [bucket, e] of byBucket) {
    if (e.n >= cfg.recurring.minReports && e.days.size >= cfg.recurring.minDays) {
      if (!best || e.n > best.reports) {
        best = { bucket, label: HOUR_BUCKETS.find((h) => h.id === bucket)!.label, reports: e.n, days: e.days.size };
      }
    }
  }
  return best;
}

export function detectBurst(reports: RiskReport[], now: number, cfg: RiskConfig = DEFAULT_RISK_CONFIG): CellPatterns['burst'] {
  const win = cfg.burst.windowHours * HOUR;
  const sorted = reports.map((r) => r.occurredAt).filter((t) => now - t <= 30 * DAY).sort((a, b) => a - b);
  let best: CellPatterns['burst'] = null;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (sorted[i] - sorted[j] > win) j++;
    const count = i - j + 1;
    if (count >= cfg.burst.count && (!best || sorted[i] >= best.windowEnd)) {
      best = { count, windowStart: sorted[j], windowEnd: sorted[i], active: now - sorted[i] <= cfg.burst.activeHours * HOUR };
    }
  }
  return best;
}

/** Aggregate a cell's reports into a privacy-preserving risk summary. */
export function computeCellRisk(reports: RiskReport[], now: number, cfg: RiskConfig = DEFAULT_RISK_CONFIG): CellRisk {
  const perDevice = new Map<string, number>();
  const typeCounts: Record<string, number> = {};
  for (const r of reports) {
    perDevice.set(r.deviceId, (perDevice.get(r.deviceId) ?? 0) + reportWeight(r, now, cfg));
    typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
  }
  let score = 0;
  for (const v of perDevice.values()) score += Math.min(v, cfg.deviceCap);
  score = Math.round(score * 100) / 100;
  const independentDevices = perDevice.size;
  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    score,
    level: levelFor(score, cfg),
    independentDevices,
    reportCount: reports.length,
    visible: independentDevices >= cfg.kAnonymity,
    patterns: {
      recurring: detectRecurring(reports, now, cfg),
      burst: detectBurst(reports, now, cfg),
      dominantType,
      typeCounts,
    },
  };
}

export interface EscalationDecision {
  reason: 'level_high' | 'level_critical' | 'burst';
  level: RiskLevel;
}

/**
 * Decide whether a cell update should create an escalation record.
 * Escalate on a level increase into high/critical, or on an active burst, deduped per reason within `dedupeMs`.
 */
export function decideEscalation(
  prevLevel: RiskLevel | null,
  cell: CellRisk,
  recent: Array<{ reason: string; createdAt: number }>,
  now: number,
  dedupeMs = DAY,
): EscalationDecision[] {
  if (!cell.visible) return [];
  const out: EscalationDecision[] = [];
  const seen = (reason: string) => recent.some((e) => e.reason === reason && now - e.createdAt < dedupeMs);
  if (levelRank(cell.level) > levelRank(prevLevel) && levelRank(cell.level) >= 2) {
    const reason = cell.level === 'critical' ? 'level_critical' : 'level_high';
    if (!seen(reason)) out.push({ reason, level: cell.level });
  }
  if (cell.patterns.burst?.active && !seen('burst')) out.push({ reason: 'burst', level: cell.level });
  return out;
}

export function safetyGuidance(cell: Pick<CellRisk, 'level' | 'patterns'>): string[] {
  const g: string[] = [];
  const t = cell.patterns.dominantType;
  if (levelRank(cell.level) >= 2) g.push('Prefer travelling with a companion or start a Trip check-in with your Safe Circle here.');
  if (cell.patterns.recurring) g.push(`Incidents recur during ${cell.patterns.recurring.label.toLowerCase()}. Plan to avoid this window or stay in well-lit, busy spots.`);
  if (cell.patterns.burst?.active) g.push('A recent spike in reports was detected. Stay alert and share your live location.');
  if (t === 'stalking') g.push('Following has been reported. Vary your route and keep Temporary Location Sharing on.');
  if (t === 'physical' || t === 'assault') g.push('Physical harassment reported. Keep SOS ready; dial 112 in an emergency.');
  if (t === 'verbal' || t === 'staring') g.push('Verbal harassment reported. Move towards crowded shops or security staff if approached.');
  if (t === 'photography' || t === 'online') g.push('Image/online abuse reported. Preserve evidence in the Evidence Vault; cyber helpline 1930.');
  if (g.length === 0) g.push('No strong pattern. Usual precautions apply. Women helpline 181.');
  return g;
}
