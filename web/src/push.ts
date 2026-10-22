import { api } from './api';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Asks for notification permission and registers this browser for Web Push alerts. */
export async function enablePush(vapidPublicKey: string | null): Promise<string> {
  if (!pushSupported()) return 'This browser does not support push notifications. On iPhone, first add Raksha to the Home Screen.';
  if (!window.isSecureContext) return 'Notifications need HTTPS. Open the app via its https:// link (see README).';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Notification permission was not granted.';
  if (!vapidPublicKey) return 'Server push keys are missing.';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(vapidPublicKey) });
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  return 'ok';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
  await api('/push/subscribe', { method: 'DELETE' });
}
