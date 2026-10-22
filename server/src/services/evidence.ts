import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';

/**
 * Envelope encryption: each file gets a random 256-bit data key (DEK). The file is sealed with AES-256-GCM under the
 * DEK, and the DEK is itself sealed with the server master key. Only ciphertext is written to disk.
 */
export function sealEvidence(ctx: Ctx, id: string, plain: Buffer) {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  const tag = c.getAuthTag();
  writeFileSync(evidencePath(ctx, id), enc);
  return { wrapped_key: wrapKey(ctx.cfg.masterKey, dek), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

export function openEvidence(ctx: Ctx, id: string, meta: { wrapped_key: string; iv: string; tag: string }): Buffer {
  const dek = unwrapKey(ctx.cfg.masterKey, meta.wrapped_key);
  const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(meta.iv, 'base64'));
  d.setAuthTag(Buffer.from(meta.tag, 'base64'));
  return Buffer.concat([d.update(readFileSync(evidencePath(ctx, id))), d.final()]);
}

export function deleteEvidenceFile(ctx: Ctx, id: string) {
  rmSync(evidencePath(ctx, id), { force: true });
}

export const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function signCertificate(ctx: Ctx, payload: object) {
  const key = createHmac('sha256', ctx.cfg.masterKey).update('raksha-certificate-v1').digest();
  return createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
}

function evidencePath(ctx: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('bad evidence id');
  return path.join(ctx.cfg.dataDir, 'evidence', `${id}.bin`);
}

function wrapKey(master: Buffer, dek: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master, iv);
  const enc = Buffer.concat([c.update(dek), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function unwrapKey(master: Buffer, wrapped: string) {
  const b = Buffer.from(wrapped, 'base64');
  const d = createDecipheriv('aes-256-gcm', master, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
