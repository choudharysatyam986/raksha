import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface Meta {
  demoMode: boolean;
  unitMs: number;
  aiMode: string;
  telegramEnabled: boolean;
  telegramBot: string | null;
  vapidPublicKey: string | null;
  incidentTypes: Array<{ id: string; label: string; hi: string }>;
  severityLabels: Record<string, string>;
  frequencies: string[];
  tags: string[];
  authorities: Array<{ id: string; label: string }>;
  helplines: { emergency: string; women: string; cyber: string };
  maxEvidenceMb: number;
}

export interface Me {
  deviceId: string;
  displayName: string;
  pushSubscribed: boolean;
  unreadAlerts: number;
  trackingNeeded: boolean;
  activeTrip: boolean;
  activeSos: boolean;
  activeShares: number;
  settings: any;
}

export interface AppState {
  meta: Meta | null;
  me: Me | null;
  refreshMe: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'err' | 'info') => void;
}

export const AppCtx = createContext<AppState>({ meta: null, me: null, refreshMe: async () => {}, toast: () => {} });
export const useApp = () => useContext(AppCtx);

/** Load data from the API, optionally polling. Returns [data, error, reload, loading]. */
export function useApi<T = any>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    setLoading(!!path);
    load();
    let t: any;
    if (pollMs) t = setInterval(load, pollMs);
    return () => {
      alive.current = false;
      if (t) clearInterval(t);
    };
  }, [load, pollMs, path]);
  return { data, error, reload: load, loading, setData };
}

/** Re-render every `ms` so countdowns stay live. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Wraps an async action with busy state + toast on error. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (okMsg) toast(okMsg, 'ok');
        return r;
      } catch (e: any) {
        toast(e.message ?? String(e), 'err');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
