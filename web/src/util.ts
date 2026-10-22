export const LEVEL_COLORS: Record<string, string> = {
  low: '#16a34a',
  moderate: '#ca8a04',
  high: '#ea580c',
  critical: '#dc2626',
};

export const STATE_LABELS: Record<string, { label: string; cls: string }> = {
  sos: { label: '🚨 SOS active', cls: 'b-danger' },
  help: { label: '🆘 Asked for help', cls: 'b-danger' },
  overdue: { label: '⏰ Missed check-in', cls: 'b-warn' },
  delayed: { label: '🕒 Running late', cls: 'b-warn' },
  on_trip: { label: '🚶 On a trip', cls: 'b-info' },
  idle: { label: '🏠 Not travelling', cls: 'b-muted' },
};

export function fmtTime(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function fmtClock(ms: number | null | undefined) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function ago(ms: number | null | undefined, now = Date.now()) {
  if (!ms) return '—';
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function countdown(target: number, now = Date.now()) {
  const s = Math.round((target - now) / 1000);
  const neg = s < 0;
  const a = Math.abs(s);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = a % 60;
  const str = h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
  return neg ? `-${str}` : str;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Absolute link on the origin the user is actually using (works for LAN IPs / tunnels too). */
export const absUrl = (path: string) => `${location.origin}${path}`;

/** Converts "minutes" into the user-facing unit (seconds in demo mode). */
export const unitLabel = (demo: boolean | undefined) => (demo ? 'sec' : 'min');

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function shareOrCopy(title: string, text: string, url?: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'failed';
    }
  }
  return (await copyText(url ? `${text} ${url}` : text)) ? 'copied' : 'failed';
}

export function waLink(text: string, phone?: string | null) {
  const p = phone ? phone.replace(/[^\d]/g, '') : '';
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export function smsLink(text: string, phone?: string | null) {
  const sep = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?';
  return `sms:${phone ?? ''}${sep}body=${encodeURIComponent(text)}`;
}

export async function sha256OfFile(file: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // non-HTTPS origin: server still hashes, client check skipped
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
