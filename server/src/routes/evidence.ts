import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, HttpError, notFound, type Ctx } from '../context.js';
import { newId, type Row } from '../db.js';
import { deleteEvidenceFile, openEvidence, sealEvidence, sha256Hex, signCertificate } from '../services/evidence.js';

const serialize = (e: Row) => ({ id: e.id, filename: e.filename, mime: e.mime, size: e.size, sha256: e.sha256, note: e.note, createdAt: e.created_at });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default async function evidenceRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  const own = (id: string, deviceId: string) => {
    const e = ctx.db.get<Row & { wrapped_key: string; iv: string; tag: string }>('SELECT * FROM evidence WHERE id = ? AND device_id = ?', id, deviceId);
    if (!e) throw notFound('Evidence not found');
    return e;
  };

  app.post('/evidence', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: ctx.cfg.maxEvidenceBytes } });
    if (!file) throw badRequest('No file uploaded');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, `File too large (max ${Math.round(ctx.cfg.maxEvidenceBytes / 1048576)} MB)`);
    if (buf.length === 0) throw badRequest('Empty file');
    const field = (k: string) => {
      const f = (file.fields as any)[k];
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    const sha = sha256Hex(buf);
    const clientSha = field('clientSha256')?.toLowerCase();
    if (clientSha && clientSha !== sha) throw badRequest('Upload integrity check failed: the file changed in transit. Please retry.');
    const id = newId();
    const sealed = sealEvidence(ctx, id, buf);
    ctx.db.insert('evidence', {
      id, device_id: req.deviceId, filename: (file.filename || 'evidence').slice(0, 200), mime: file.mimetype || 'application/octet-stream',
      size: buf.length, sha256: sha, ...sealed, note: field('note')?.slice(0, 500) ?? null, created_at: ctx.now(),
    });
    reply.code(201);
    return { evidence: serialize(ctx.db.get('SELECT * FROM evidence WHERE id = ?', id)!), clientHashVerified: !!clientSha };
  });

  app.get('/evidence', async (req) => ({
    evidence: ctx.db.all('SELECT * FROM evidence WHERE device_id = ? ORDER BY created_at DESC', req.deviceId).map(serialize),
  }));

  app.get('/evidence/:id/download', async (req, reply) => {
    const e = own((req.params as { id: string }).id, req.deviceId);
    const buf = openEvidence(ctx, e.id, e);
    if (sha256Hex(buf) !== e.sha256) throw new HttpError(500, 'Integrity failure: stored file does not match its recorded hash');
    reply.header('content-type', e.mime);
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(e.filename)}"`);
    reply.header('x-content-sha256', e.sha256);
    return reply.send(buf);
  });

  app.post('/evidence/:id/verify', async (req) => {
    const e = own((req.params as { id: string }).id, req.deviceId);
    const { sha256 } = z.object({ sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional() }).parse(req.body ?? {});
    let computed: string | null = null;
    let decryptOk = true;
    try {
      computed = sha256Hex(openEvidence(ctx, e.id, e));
    } catch {
      decryptOk = false;
    }
    return {
      storedSha256: e.sha256,
      computedSha256: computed,
      intact: decryptOk && computed === e.sha256,
      providedMatches: sha256 ? sha256.toLowerCase() === e.sha256 : null,
      checkedAt: ctx.now(),
    };
  });

  app.get('/evidence/:id/certificate', async (req, reply) => {
    const e = own((req.params as { id: string }).id, req.deviceId);
    const certificate = {
      version: 1,
      issuer: 'Raksha Evidence Vault',
      evidenceId: e.id,
      filename: e.filename,
      mime: e.mime,
      sizeBytes: e.size,
      sha256: e.sha256,
      uploadedAt: new Date(e.created_at).toISOString(),
      issuedAt: new Date(ctx.now()).toISOString(),
      encryption: 'AES-256-GCM with per-file key wrapped by server master key',
      statement: 'The SHA-256 fingerprint above was computed when the file was uploaded. Any change to the file will produce a different fingerprint.',
    };
    const signature = signCertificate(ctx, certificate);
    const format = (req.query as { format?: string }).format;
    if (format === 'html') {
      reply.header('content-type', 'text/html; charset=utf-8');
      const rows = Object.entries(certificate).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join('');
      return `<!doctype html><html><head><meta charset="utf-8"><title>Integrity certificate ${esc(e.id)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#222}h1{color:#8b1e5b}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.5rem;text-align:left;vertical-align:top;word-break:break-all}th{background:#f6eef3;width:30%}.sig{font-family:monospace;word-break:break-all;background:#f4f4f4;padding:.75rem}</style>
</head><body><h1>🛡️ Raksha — Evidence Integrity Certificate</h1><table>${rows}</table>
<h3>Signature (HMAC-SHA256)</h3><p class="sig">${signature}</p>
<p>To verify independently, compute the SHA-256 of your original file (e.g. <code>certutil -hashfile file SHA256</code> on Windows or <code>sha256sum file</code> on Linux/macOS) and compare it with the value above.</p>
<button onclick="print()">Print / Save as PDF</button></body></html>`;
    }
    return { certificate, signature, algorithm: 'HMAC-SHA256' };
  });

  app.delete('/evidence/:id', async (req) => {
    const e = own((req.params as { id: string }).id, req.deviceId);
    ctx.db.run('DELETE FROM evidence WHERE id = ?', e.id);
    deleteEvidenceFile(ctx, e.id);
    return { ok: true };
  });
}
