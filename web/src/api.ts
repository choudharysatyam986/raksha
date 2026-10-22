/** Tiny API client. Each browser gets a random anonymous device secret; no account, phone number or email needed. */
const TOKEN_KEY = 'raksha.deviceToken';

export function deviceToken(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    t = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

export function resetDeviceToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

const BASE = '/api/v1';

export async function api<T = any>(path: string, opts: { method?: string; body?: any; headers?: Record<string, string>; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.authorization = `Bearer ${deviceToken()}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.details?.length ? `${data.error}: ${data.details.map((d: any) => `${d.path} ${d.message}`).join('; ')}` : data?.error || data?.message || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: any = {}) => api<T>(p, { method: 'POST', body });
export const put = <T = any>(p: string, body: any) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

export async function authedBlob(path: string): Promise<{ blob: Blob; headers: Headers }> {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${deviceToken()}` } });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? 'Download failed');
  return { blob: await res.blob(), headers: res.headers };
}
