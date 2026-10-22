import webpush from 'web-push';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { newId, type Db } from '../db.js';

export interface AlertPayload {
  kind: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Delivery fan-out. Every alert is written to the in-app feed (always works), then best-effort delivered via
 * Web Push (if the device subscribed) and Telegram (for trusted contacts who linked a chat).
 */
export class Notifier {
  readonly vapidPublicKey: string;
  private pushEnabled = true;

  constructor(private db: Db, private cfg: AppConfig, private log: FastifyBaseLogger) {
    let keys = db.kvGet('vapid');
    if (!keys) {
      keys = JSON.stringify(webpush.generateVAPIDKeys());
      db.kvSet('vapid', keys);
    }
    const k = JSON.parse(keys) as { publicKey: string; privateKey: string };
    this.vapidPublicKey = k.publicKey;
    try {
      webpush.setVapidDetails(cfg.vapidSubject, k.publicKey, k.privateKey);
    } catch (e) {
      this.pushEnabled = false;
      log.warn({ err: e }, 'web push disabled');
    }
  }

  async toDevice(deviceId: string, a: AlertPayload): Promise<string> {
    const id = newId();
    this.db.insert('alerts', { id, device_id: deviceId, kind: a.kind, title: a.title, body: a.body, data: a.data ?? {}, created_at: Date.now() });
    const dev = this.db.get<{ push_sub: string | null }>('SELECT push_sub FROM devices WHERE id = ?', deviceId);
    if (this.pushEnabled && dev?.push_sub) {
      try {
        await webpush.sendNotification(JSON.parse(dev.push_sub), JSON.stringify({ id, ...a }), { TTL: 3600, urgency: 'high' });
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) this.db.run('UPDATE devices SET push_sub = NULL WHERE id = ?', deviceId);
        else this.log.warn({ status: e?.statusCode }, 'push delivery failed');
      }
    }
    return id;
  }

  async toDevices(ids: Iterable<string>, a: AlertPayload) {
    const unique = [...new Set(ids)];
    await Promise.all(unique.map((d) => this.toDevice(d, a)));
    return unique.length;
  }

  get telegramEnabled() {
    return !!this.cfg.telegram.token;
  }

  telegramLink(code: string): string | null {
    if (!this.cfg.telegram.username) return null;
    return `https://t.me/${this.cfg.telegram.username}?start=${code}`;
  }

  async telegramSend(chatId: string, text: string): Promise<boolean> {
    if (!this.cfg.telegram.token) return false;
    try {
      const r = await fetch(`https://api.telegram.org/bot${this.cfg.telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
      });
      return r.ok;
    } catch (e) {
      this.log.warn({ err: e }, 'telegram send failed');
      return false;
    }
  }

  /** Deliver to a device's trusted contacts. Returns per-contact delivery result. */
  async toContacts(deviceId: string, text: string, contactIds?: string[]) {
    let contacts = this.db.all<{ id: string; name: string; phone: string | null; telegram_chat_id: string | null }>(
      'SELECT id, name, phone, telegram_chat_id FROM contacts WHERE device_id = ?',
      deviceId,
    );
    if (contactIds?.length) contacts = contacts.filter((c) => contactIds.includes(c.id));
    const results: Array<{ contactId: string; name: string; channel: 'telegram' | 'manual'; delivered: boolean; phone: string | null }> = [];
    for (const c of contacts) {
      if (c.telegram_chat_id && this.telegramEnabled) {
        results.push({ contactId: c.id, name: c.name, channel: 'telegram', delivered: await this.telegramSend(c.telegram_chat_id, text), phone: c.phone });
      } else {
        results.push({ contactId: c.id, name: c.name, channel: 'manual', delivered: false, phone: c.phone });
      }
    }
    return results;
  }

  /** Long-poll-free Telegram linking: reads /start <code> messages and binds chat IDs to contacts. */
  async telegramPoll() {
    if (!this.cfg.telegram.token) return;
    const offset = parseInt(this.db.kvGet('tg_offset') ?? '0', 10);
    let updates: any[] = [];
    try {
      const r = await fetch(`https://api.telegram.org/bot${this.cfg.telegram.token}/getUpdates?timeout=0&offset=${offset}`);
      if (!r.ok) return;
      updates = ((await r.json()) as any).result ?? [];
    } catch {
      return;
    }
    for (const u of updates) {
      this.db.kvSet('tg_offset', String(u.update_id + 1));
      const text: string = u.message?.text ?? '';
      const chatId = u.message?.chat?.id;
      const m = text.match(/^\/start\s+(\S+)/);
      if (!m || !chatId) continue;
      const contact = this.db.get<{ id: string; name: string; device_id: string }>('SELECT id, name, device_id FROM contacts WHERE link_code = ?', m[1]);
      if (!contact) {
        await this.telegramSend(String(chatId), 'This Raksha link code is invalid or expired.');
        continue;
      }
      this.db.run('UPDATE contacts SET telegram_chat_id = ? WHERE id = ?', String(chatId), contact.id);
      const owner = this.db.get<{ display_name: string | null }>('SELECT display_name FROM devices WHERE id = ?', contact.device_id);
      await this.telegramSend(String(chatId), `Hi ${contact.name}, you are now a Raksha trusted contact for ${owner?.display_name || 'a Raksha user'}. You will receive SOS and missed check-in alerts here.`);
      await this.toDevice(contact.device_id, { kind: 'contact_linked', title: 'Telegram linked', body: `${contact.name} will now receive alerts on Telegram.` });
    }
  }
}
