import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const WEB_DIST = path.resolve(SERVER_ROOT, '..', 'web', 'dist');

const bool = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  dbFile: string;
  demoMode: boolean;
  /** Length of one "minute" in ms. In demo mode, 1 minute = 1 second so flows can be shown live. */
  unitMs: number;
  tickMs: number;
  publicUrl: string;
  timeZone: string;
  authorityApiKey: string;
  masterKey: Buffer;
  telegram: { token?: string; username?: string };
  openai: { apiKey?: string; model: string; baseUrl: string; azureEndpoint?: string; azureKey?: string; azureDeployment?: string; azureApiVersion: string };
  vapidSubject: string;
  maxEvidenceBytes: number;
}

/** Load `.env` from the repo root (or server/) without extra dependencies. Real env vars win. */
export function loadDotEnv() {
  for (const file of [path.resolve(SERVER_ROOT, '..', '.env'), path.join(SERVER_ROOT, '.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

function readOrCreate(file: string, create: () => string): string {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const v = create();
  writeFileSync(file, v, { mode: 0o600 });
  return v;
}

export function loadConfig(overrides: Partial<{ dataDir: string; dbFile: string; demoMode: boolean }> = {}): AppConfig {
  const dataDir = path.resolve(overrides.dataDir ?? process.env.DATA_DIR ?? path.join(SERVER_ROOT, 'data'));
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(path.join(dataDir, 'evidence'), { recursive: true });
  const demoMode = overrides.demoMode ?? bool(process.env.DEMO_MODE);
  const masterHex = process.env.MASTER_KEY ?? readOrCreate(path.join(dataDir, 'master.key'), () => randomBytes(32).toString('hex'));
  const authorityApiKey = process.env.AUTHORITY_API_KEY ?? readOrCreate(path.join(dataDir, 'authority.key'), () => 'auth_' + randomBytes(18).toString('base64url'));
  const port = parseInt(process.env.PORT ?? '8080', 10);
  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    dataDir,
    dbFile: overrides.dbFile ?? process.env.DB_FILE ?? path.join(dataDir, 'raksha.db'),
    demoMode,
    unitMs: demoMode ? 1000 : 60_000,
    tickMs: demoMode ? 2000 : 15_000,
    publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    timeZone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata',
    authorityApiKey,
    masterKey: Buffer.from(masterHex, 'hex'),
    telegram: { token: process.env.TELEGRAM_BOT_TOKEN || undefined, username: process.env.TELEGRAM_BOT_USERNAME || undefined },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || undefined,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      // Any OpenAI-compatible endpoint, e.g. Gemini, Groq or GitHub Models (free tiers).
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT || undefined,
      azureKey: process.env.AZURE_OPENAI_API_KEY || undefined,
      azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || undefined,
      azureApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
    },
    vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:raksha@example.com',
    maxEvidenceBytes: parseInt(process.env.MAX_EVIDENCE_MB ?? '25', 10) * 1024 * 1024,
  };
}
