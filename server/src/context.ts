import { createHash } from 'node:crypto';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import { newId } from './db.js';
import type { Notifier } from './services/notify.js';

export interface Ctx {
  db: Db;
  cfg: AppConfig;
  notify: Notifier;
  log: FastifyBaseLogger;
  now: () => number;
  /** Best-known public origin, used to build links in alerts sent from background jobs. */
  origin: () => string;
}

declare module 'fastify' {
  interface FastifyRequest {
    deviceId: string;
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (what = 'Forbidden') => new HttpError(403, what);
export const badRequest = (what = 'Bad request') => new HttpError(400, what);

/**
 * Anonymous device authentication. The browser generates a random secret on first launch and sends it as a
 * bearer token. Only its SHA-256 hash is stored, so the server never learns the secret or any identity.
 */
export function deviceAuth(ctx: Ctx) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token.length < 32 || token.length > 200) throw new HttpError(401, 'Missing or invalid device token');
    const hash = sha256(token);
    const now = ctx.now();
    const row = ctx.db.get<{ id: string }>('SELECT id FROM devices WHERE token_hash = ?', hash);
    if (row) {
      req.deviceId = row.id;
      ctx.db.run('UPDATE devices SET last_seen = ? WHERE id = ?', now, row.id);
    } else {
      const id = newId();
      ctx.db.insert('devices', { id, token_hash: hash, created_at: now, last_seen: now });
      req.deviceId = id;
    }
    rememberOrigin(ctx, req);
  };
}

export function rememberOrigin(ctx: Ctx, req: FastifyRequest) {
  if (ctx.cfg.publicUrl) return;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
  if (!host) return;
  const origin = `${proto}://${host}`;
  if (ctx.db.kvGet('origin') !== origin) ctx.db.kvSet('origin', origin);
}

export function shareUrl(ctx: Ctx, token: string) {
  return `${ctx.origin()}/t/${token}`;
}
