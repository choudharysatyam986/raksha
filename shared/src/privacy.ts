import { geohashDecode, geohashEncode } from './geohash.js';

/** Precision 7 geohash ≈ 153m x 153m cells. Reports are stored only at this granularity. */
export const REPORT_CELL_PRECISION = 7;

export interface ScrubResult {
  text: string;
  redactions: string[];
}

const RULES: Array<{ kind: string; re: RegExp; replace?: (m: string, ...g: string[]) => string }> = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { kind: 'url', re: /\b(?:https?:\/\/|www\.)\S+/gi },
  { kind: 'aadhaar', re: /(?<!\d)\d{4}[\s-]\d{4}[\s-]\d{4}(?!\d)|(?<!\d)\d{12}(?!\d)/g },
  { kind: 'phone', re: /(?:\+?91[\s-]?|0)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)/g },
  { kind: 'phone', re: /(?<!\d)\d{10,11}(?!\d)/g },
  { kind: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/gi },
  { kind: 'vehicle', re: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/gi },
  { kind: 'handle', re: /(^|[\s(])@[A-Za-z0-9_.]{2,}/g, replace: (_m, pre) => `${pre}[redacted-handle]` },
  {
    kind: 'name',
    re: /\b(my name is|my name's|i am called|mera naam|meraa naam|mera name)\s+([\p{L}]+)/giu,
    replace: (_m, lead) => `${lead} [redacted-name]`,
  },
  {
    kind: 'name',
    re: /(मेरा नाम)\s+(\S+)/gu,
    replace: (_m, lead) => `${lead} [redacted-name]`,
  },
];

/** Remove common personal identifiers (phone, email, Aadhaar, PAN, vehicle no., URLs, handles, self-names). */
export function scrubPII(input: string): ScrubResult {
  let text = input ?? '';
  const redactions: string[] = [];
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: any[]) => {
      redactions.push(rule.kind);
      if (rule.replace) return rule.replace(args[0], ...args.slice(1, -2));
      return `[redacted-${rule.kind}]`;
    });
  }
  return { text: text.replace(/\s{2,}/g, ' ').trim(), redactions };
}

/** Snap a precise coordinate to the centre of its ~150 m geohash cell. */
export function snapLocation(lat: number, lng: number, precision = REPORT_CELL_PRECISION) {
  const cellId = geohashEncode(lat, lng, precision);
  const c = geohashDecode(cellId);
  return { cellId, lat: round(c.lat, 5), lng: round(c.lng, 5) };
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
