import { describe, expect, it } from 'vitest';
import {
  computeCellRisk,
  decideEscalation,
  DEFAULT_RISK_CONFIG,
  detectBurst,
  detectRecurring,
  geohashDecode,
  geohashEncode,
  geohashNeighbors,
  generateDraft,
  newlyCrossedThresholds,
  overdueStage,
  reportWeight,
  scrubPII,
  shareLinkState,
  snapLocation,
  structureIncidentOffline,
  tripDueAt,
  type RiskReport,
} from '../src/index.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-08T17:00:00Z');

describe('privacy', () => {
  it('scrubs phones, emails, aadhaar, PAN, vehicle numbers, urls, handles and names', () => {
    const input =
      'My name is Priya. Call me at +91 98765 43210 or priya@example.com. Aadhaar 1234 5678 9012, PAN ABCDE1234F. ' +
      'He drove KA 01 AB 1234, his insta @creepy_guy, see https://x.com/abc';
    const { text, redactions } = scrubPII(input);
    expect(text).not.toMatch(/Priya/);
    expect(text).not.toMatch(/98765/);
    expect(text).not.toMatch(/example\.com/);
    expect(text).not.toMatch(/5678/);
    expect(text).not.toMatch(/ABCDE1234F/);
    expect(text).not.toMatch(/KA 01/);
    expect(text).not.toMatch(/creepy_guy/);
    expect(text).not.toMatch(/x\.com/);
    expect(redactions).toEqual(expect.arrayContaining(['name', 'phone', 'email', 'aadhaar', 'pan', 'vehicle', 'handle', 'url']));
  });

  it('keeps ordinary text intact', () => {
    expect(scrubPII('A man followed me near the bus stop at 9 pm').text).toBe('A man followed me near the bus stop at 9 pm');
  });

  it('scrubs Hindi self-names', () => {
    expect(scrubPII('मेरा नाम सीमा है').text).toContain('[redacted-name]');
    expect(scrubPII('mera naam Seema hai').text).toBe('mera naam [redacted-name] hai');
  });

  it('snaps locations to a ~150m cell centre', () => {
    const a = snapLocation(12.97161, 77.59456);
    const b = snapLocation(12.97165, 77.5946);
    expect(a.cellId).toHaveLength(7);
    expect(a.cellId).toBe(b.cellId);
    expect(a.lat).not.toBe(12.97161);
  });
});

describe('geohash', () => {
  it('round-trips and finds 8 distinct neighbours', () => {
    const h = geohashEncode(28.6139, 77.209, 7);
    const c = geohashDecode(h);
    expect(Math.abs(c.lat - 28.6139)).toBeLessThan(0.001);
    const n = geohashNeighbors(h);
    expect(new Set(n).size).toBe(8);
    expect(n).not.toContain(h);
  });
});

function rep(i: number, device: string, daysAgo: number, extra: Partial<RiskReport> = {}): RiskReport {
  return { id: `r${i}`, deviceId: device, type: 'verbal', severity: 3, frequency: 'once', occurredAt: NOW - daysAgo * DAY, ...extra };
}

describe('risk engine', () => {
  it('decays report weight with a 30-day half-life', () => {
    const fresh = reportWeight(rep(1, 'a', 0), NOW);
    const old = reportWeight(rep(2, 'a', 30), NOW);
    expect(old / fresh).toBeCloseTo(0.5, 5);
  });

  it('caps the contribution of a single device', () => {
    const spam = Array.from({ length: 50 }, (_, i) => rep(i, 'spammer', 0, { severity: 5, frequency: 'ongoing' }));
    const cell = computeCellRisk(spam, NOW);
    expect(cell.score).toBe(DEFAULT_RISK_CONFIG.deviceCap);
    expect(cell.independentDevices).toBe(1);
    expect(cell.visible).toBe(false);
  });

  it('hides cells below k independent devices and shows them at k', () => {
    expect(computeCellRisk([rep(1, 'a', 0), rep(2, 'b', 0)], NOW).visible).toBe(false);
    expect(computeCellRisk([rep(1, 'a', 0), rep(2, 'b', 0), rep(3, 'c', 0)], NOW).visible).toBe(true);
  });

  it('assigns higher levels with more independent severe reports', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((d, i) => rep(i, d, 0, { severity: 5, frequency: 'repeated' }));
    const cell = computeCellRisk(many, NOW);
    expect(cell.level).toBe('critical');
  });

  it('detects recurring time-of-day patterns across distinct days', () => {
    // 21:30 IST = 16:00 UTC on 3 different days
    const reports = [1, 3, 5].map((d, i) => ({ ...rep(i, `d${i}`, 0), occurredAt: Date.parse('2026-10-08T16:00:00Z') - d * DAY }));
    const r = detectRecurring(reports, NOW);
    expect(r?.bucket).toBe('night');
    expect(r?.days).toBe(3);
  });

  it('detects bursts within 24h', () => {
    const reports = [0.1, 0.2, 0.3, 0.4].map((d, i) => rep(i, `d${i}`, d));
    expect(detectBurst(reports, NOW)?.active).toBe(true);
    expect(detectBurst(reports.slice(0, 3), NOW)).toBeNull();
  });

  it('decides escalations on level increase and burst, with dedupe', () => {
    const reports = ['a', 'b', 'c', 'd'].map((d, i) => rep(i, d, i * 0.1, { severity: 5 }));
    const cell = computeCellRisk(reports, NOW);
    const first = decideEscalation('low', cell, [], NOW);
    expect(first.map((e) => e.reason)).toEqual(expect.arrayContaining(['burst']));
    expect(first.some((e) => e.reason.startsWith('level_'))).toBe(true);
    const again = decideEscalation('low', cell, first.map((e) => ({ reason: e.reason, createdAt: NOW - 1000 })), NOW);
    expect(again).toHaveLength(0);
  });
});

describe('check-in staging and share expiry', () => {
  const unit = 60_000;
  it('stages missed check-ins', () => {
    const due = tripDueAt({ nextCheckinAt: NOW, etaAt: NOW + 60 * unit }, unit);
    expect(due).toBe(NOW);
    expect(overdueStage(NOW - 1, due, unit)).toBe(0);
    expect(overdueStage(NOW + 1 * unit, due, unit)).toBe(1);
    expect(overdueStage(NOW + 5 * unit, due, unit)).toBe(2);
    expect(overdueStage(NOW + 10 * unit, due, unit)).toBe(3);
  });
  it('uses ETA + grace when earlier than next check-in', () => {
    expect(tripDueAt({ nextCheckinAt: NOW + 100 * unit, etaAt: NOW }, unit)).toBe(NOW + 10 * unit);
  });
  it('reminds before expiry and expires', () => {
    expect(shareLinkState({ expiresAt: NOW + 30 * unit, reminderSent: false }, NOW, unit)).toBe('active');
    expect(shareLinkState({ expiresAt: NOW + 5 * unit, reminderSent: false }, NOW, unit)).toBe('reminder_due');
    expect(shareLinkState({ expiresAt: NOW + 5 * unit, reminderSent: true }, NOW, unit)).toBe('active');
    expect(shareLinkState({ expiresAt: NOW, reminderSent: true }, NOW, unit)).toBe('expired');
  });
  it('crosses event thresholds once', () => {
    expect(newlyCrossedThresholds(2, { advisory: 3, warning: 6 }, [])).toEqual([]);
    expect(newlyCrossedThresholds(3, { advisory: 3, warning: 6 }, [])).toEqual(['advisory']);
    expect(newlyCrossedThresholds(7, { advisory: 3, warning: 6 }, ['advisory'])).toEqual(['warning']);
  });
});

describe('AI assistance (offline)', () => {
  const now = new Date('2026-10-08T12:00:00+05:30');
  it('structures English text', () => {
    const r = structureIncidentOffline('A man followed me from the metro station last night and kept staring', now);
    expect(r.type).toBe('stalking');
    expect(r.tags).toEqual(expect.arrayContaining(['metro', 'night']));
    expect(r.timeHint).toBe('Last night');
    expect(r.language).toBe('en');
  });
  it('structures Hinglish text', () => {
    const r = structureIncidentOffline('Kal raat bus stop pe kuch ladke roz chhedkhani karte hai, mujhe bahut dar lagta hai', now);
    expect(r.type).toBe('physical');
    expect(r.frequency).toBe('repeated');
    expect(r.tags).toEqual(expect.arrayContaining(['bus_stop', 'group_of_men', 'night']));
    expect(r.language).toBe('hinglish');
  });
  it('structures Hindi text', () => {
    const r = structureIncidentOffline('शाम को बाजार में एक आदमी ने पीछा किया', now);
    expect(r.type).toBe('stalking');
    expect(r.placeHint).toBe('Market');
    expect(r.language).toBe('hi');
  });
  it('parses clock times', () => {
    const r = structureIncidentOffline('Someone groped me in the bus at 9:30 pm', now);
    expect(r.type).toBe('physical');
    expect(new Date(r.occurredAtSuggestion!).getHours()).toBe(21);
  });
  it('generates authority-specific drafts', () => {
    const base = { type: 'stalking', severity: 4, frequency: 'repeated', description: 'He follows me daily', location: 'MG Road' };
    expect(generateDraft({ ...base, authority: 'police' }).body).toMatch(/FIR/);
    expect(generateDraft({ ...base, authority: 'workplace' }).body).toMatch(/POSH|2013/);
    expect(generateDraft({ ...base, authority: 'college' }).body).toMatch(/UGC/);
    expect(generateDraft({ ...base, authority: 'transport' }).body).toMatch(/CCTV/);
    expect(generateDraft({ ...base, authority: 'cybercrime' }).body).toMatch(/cybercrime\.gov\.in/);
  });
});
