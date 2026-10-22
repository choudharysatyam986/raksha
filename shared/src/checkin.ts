/**
 * Staged trip check-in escalation.
 * Stage 0: on time. Stage 1: check-in missed -> remind traveller.
 * Stage 2: still missing -> alert Safe Circle. Stage 3: still missing -> alert trusted contacts.
 * Raksha never contacts police automatically.
 */
export interface CheckinConfig {
  stage2AfterMin: number;
  stage3AfterMin: number;
  etaGraceMin: number;
  shareReminderBeforeMin: number;
}

export const DEFAULT_CHECKIN_CONFIG: CheckinConfig = {
  stage2AfterMin: 5,
  stage3AfterMin: 10,
  etaGraceMin: 10,
  shareReminderBeforeMin: 10,
};

export interface TripTiming {
  nextCheckinAt: number;
  etaAt: number;
}

/** When is the traveller next "due" – the earlier of the next check-in or ETA + grace. */
export function tripDueAt(t: TripTiming, unitMs: number, cfg: CheckinConfig = DEFAULT_CHECKIN_CONFIG): number {
  return Math.min(t.nextCheckinAt, t.etaAt + cfg.etaGraceMin * unitMs);
}

export function overdueStage(now: number, dueAt: number, unitMs: number, cfg: CheckinConfig = DEFAULT_CHECKIN_CONFIG): 0 | 1 | 2 | 3 {
  if (now < dueAt) return 0;
  const overdue = now - dueAt;
  if (overdue >= cfg.stage3AfterMin * unitMs) return 3;
  if (overdue >= cfg.stage2AfterMin * unitMs) return 2;
  return 1;
}

export type ShareState = 'active' | 'reminder_due' | 'expired';

export function shareLinkState(
  link: { expiresAt: number; reminderSent: boolean },
  now: number,
  unitMs: number,
  cfg: CheckinConfig = DEFAULT_CHECKIN_CONFIG,
): ShareState {
  if (now >= link.expiresAt) return 'expired';
  if (!link.reminderSent && link.expiresAt - now <= cfg.shareReminderBeforeMin * unitMs) return 'reminder_due';
  return 'active';
}

export interface EventThresholds {
  advisory: number;
  warning: number;
}

export const DEFAULT_EVENT_THRESHOLDS: EventThresholds = { advisory: 3, warning: 6 };

/** Return threshold levels newly crossed by `count` that haven't been alerted yet (lowest first). */
export function newlyCrossedThresholds(count: number, t: EventThresholds, alreadyAlerted: string[]): Array<'advisory' | 'warning'> {
  const out: Array<'advisory' | 'warning'> = [];
  if (count >= t.advisory && !alreadyAlerted.includes('advisory')) out.push('advisory');
  if (count >= t.warning && !alreadyAlerted.includes('warning')) out.push('warning');
  return out;
}
