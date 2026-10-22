import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';

// Loaded via require so bundler-based tooling (vitest/vite) that doesn't know the newer `node:sqlite` builtin works.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  display_name TEXT,
  push_sub TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity INTEGER NOT NULL,
  frequency TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  occurred_at INTEGER NOT NULL,
  cell_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  event_id TEXT,
  subzone_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_cell ON reports(cell_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_device ON reports(device_id);
CREATE INDEX IF NOT EXISTS idx_reports_event ON reports(event_id, subzone_id);

CREATE TABLE IF NOT EXISTS area_risk (
  cell_id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  score REAL NOT NULL,
  level TEXT NOT NULL,
  independent_devices INTEGER NOT NULL,
  report_count INTEGER NOT NULL,
  visible INTEGER NOT NULL,
  patterns TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL,
  level TEXT NOT NULL,
  reason TEXT NOT NULL,
  score REAL NOT NULL,
  report_count INTEGER NOT NULL,
  independent_devices INTEGER NOT NULL,
  patterns TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escalations_cell ON escalations(cell_id, created_at);

CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, device_id)
);
CREATE TABLE IF NOT EXISTS nudges (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL,
  from_device TEXT NOT NULL,
  to_device TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  circle_id TEXT,
  destination TEXT NOT NULL,
  dest_lat REAL,
  dest_lng REAL,
  eta_at INTEGER NOT NULL,
  checkin_interval_min INTEGER NOT NULL,
  next_checkin_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  stage INTEGER NOT NULL DEFAULT 0,
  last_state TEXT NOT NULL DEFAULT 'ok',
  share_link_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  lat REAL,
  lng REAL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  device_id TEXT NOT NULL,
  label TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  stop_on_arrival INTEGER NOT NULL DEFAULT 0,
  trip_id TEXT,
  sos_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_share_status ON share_links(status);

CREATE TABLE IF NOT EXISTS location_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pings_device ON location_pings(device_id, at);

CREATE TABLE IF NOT EXISTS sos (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  share_link_id TEXT,
  notified TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  telegram_chat_id TEXT,
  link_code TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organizer_device TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  radius_m REAL NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  subzones TEXT NOT NULL DEFAULT '[]',
  thresholds TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS event_members (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'attendee',
  status TEXT NOT NULL DEFAULT 'unknown',
  subzone_id TEXT,
  lat REAL,
  lng REAL,
  status_at INTEGER,
  PRIMARY KEY (event_id, device_id)
);
CREATE TABLE IF NOT EXISTS event_alerts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  subzone_id TEXT NOT NULL,
  level TEXT NOT NULL,
  count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts(device_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  device_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type Row = Record<string, any>;

export class Db {
  readonly raw: DatabaseSyncT;
  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec(SCHEMA);
  }
  all<T = Row>(sql: string, ...params: any[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: any[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: any[]) {
    return this.raw.prepare(sql).run(...params);
  }
  insert(table: string, row: Row) {
    const keys = Object.keys(row);
    const vals = keys.map((k) => normalize(row[k]));
    this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...vals);
  }
  update(table: string, idCol: string, id: any, patch: Row) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idCol} = ?`, ...keys.map((k) => normalize(patch[k])), id);
  }
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  kvGet(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value;
  }
  kvSet(key: string, value: string) {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }
  close() {
    this.raw.close();
  }
}

function normalize(v: any) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export const newId = () => randomUUID();

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
