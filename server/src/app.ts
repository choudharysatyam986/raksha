import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { AUTHORITIES, FREQUENCIES, HELPLINES, INCIDENT_TYPES, REPORT_TAGS, SEVERITY_LABELS } from '@raksha/shared';
import { loadConfig, WEB_DIST, type AppConfig } from './config.js';
import { deviceAuth, HttpError, type Ctx } from './context.js';
import { Db } from './db.js';
import { Notifier } from './services/notify.js';
import { aiMode } from './services/ai.js';
import { startScheduler } from './scheduler.js';
import reportRoutes from './routes/reports.js';
import circleRoutes from './routes/circles.js';
import shareRoutes, { publicShareRoutes } from './routes/share.js';
import evidenceRoutes from './routes/evidence.js';
import eventRoutes from './routes/events.js';
import accountRoutes from './routes/account.js';
import authorityRoutes from './routes/authority.js';

export interface BuildOptions {
  dataDir?: string;
  dbFile?: string;
  demoMode?: boolean;
  now?: () => number;
  scheduler?: boolean;
  logger?: boolean;
  serveWeb?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: Ctx; cfg: AppConfig; stop: () => void }> {
  const cfg = loadConfig({ dataDir: opts.dataDir, dbFile: opts.dbFile, demoMode: opts.demoMode });
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers["x-authority-key"]'] },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  const db = new Db(cfg.dbFile);
  const notify = new Notifier(db, cfg, app.log);
  const ctx: Ctx = {
    db,
    cfg,
    notify,
    log: app.log,
    now: opts.now ?? Date.now,
    origin: () => cfg.publicUrl || db.kvGet('origin') || `http://localhost:${cfg.port}`,
  };

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: cfg.maxEvidenceBytes, files: 1, fields: 5 } });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, time: ctx.now() }));
      api.get('/meta', async () => ({
        name: 'Raksha',
        demoMode: cfg.demoMode,
        unitMs: cfg.unitMs,
        aiMode: aiMode(ctx),
        telegramEnabled: notify.telegramEnabled,
        telegramBot: cfg.telegram.username ?? null,
        vapidPublicKey: notify.vapidPublicKey,
        incidentTypes: INCIDENT_TYPES,
        severityLabels: SEVERITY_LABELS,
        frequencies: FREQUENCIES,
        tags: REPORT_TAGS,
        authorities: AUTHORITIES,
        helplines: HELPLINES,
        maxEvidenceMb: Math.round(cfg.maxEvidenceBytes / 1048576),
      }));
      await api.register(publicShareRoutes, { ctx });
      await api.register(async (authApi) => {
        await authApi.register(authorityRoutes, { ctx });
      });
      await api.register(async (dev) => {
        dev.addHook('preHandler', deviceAuth(ctx));
        await dev.register(accountRoutes, { ctx });
        await dev.register(reportRoutes, { ctx });
        await dev.register(circleRoutes, { ctx });
        await dev.register(shareRoutes, { ctx });
        await dev.register(evidenceRoutes, { ctx });
        await dev.register(eventRoutes, { ctx });
      });
    },
    { prefix: '/api/v1' },
  );

  if (opts.serveWeb !== false && existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      // Resolve files per request so a rebuilt web/dist is picked up without restarting the server.
      wildcard: true,
      maxAge: '1h',
      setHeaders: (res, file) => {
        if (/(sw\.js|index\.html|manifest\.json)$/.test(file)) res.setHeader('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      // Missing static files must 404; serving index.html as JS breaks module loading and poisons caches.
      const isAsset = path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path);
      if (req.method === 'GET' && !path.startsWith('/api/') && !isAsset) {
        reply.header('cache-control', 'no-cache');
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.type('text/html').send('<h1>Raksha API</h1><p>The web app has not been built. Run <code>npm run build</code> or use <code>npm run dev</code> and open http://localhost:5173</p>');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  const stopScheduler = opts.scheduler === false ? () => {} : startScheduler(ctx);
  app.addHook('onClose', async () => {
    stopScheduler();
    db.close();
  });
  return { app, ctx, cfg, stop: stopScheduler };
}
