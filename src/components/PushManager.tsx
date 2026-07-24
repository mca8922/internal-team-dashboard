'use client';

// Manages the browser push subscription lifecycle. Mounted once in the app
// shell — renders nothing. Reacts to 'restruc:push-changed' custom events
// dispatched by Settings when the user toggles browser notifications on/off.
import * as React from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
  });
}

async function saveToServer(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
  });
}

async function removeFromServer(endpoint: string): Promise<void> {
  await fetch('/api/push', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

export function PushManager() {
  React.useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !VAPID_PUBLIC_KEY
    ) {
      return;
    }

    let reg: ServiceWorkerRegistration | null = null;

    const init = async () => {
      reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // If the user previously enabled push and permission is still granted,
      // ensure the subscription is registered (handles page refreshes).
      try {
        const raw = localStorage.getItem('restruc:prefs');
        const prefs: Record<string, unknown> = raw ? JSON.parse(raw) : {};
        if (prefs.pushEnabled === true && Notification.permission === 'granted') {
          const sub = await subscribe(reg);
          if (sub) await saveToServer(sub);
        }
      } catch {
        // non-critical
      }
    };

    init().catch(() => {});

    const handleChange = async (e: Event) => {
      if (!reg) return;
      const { enabled } = (e as CustomEvent<{ enabled: boolean }>).detail;

      if (enabled) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          // Permission denied — revert the pref and tell Settings to flip back.
          try {
            const raw = localStorage.getItem('restruc:prefs');
            const prefs: Record<string, unknown> = raw ? JSON.parse(raw) : {};
            prefs.pushEnabled = false;
            localStorage.setItem('restruc:prefs', JSON.stringify(prefs));
          } catch {
            // ignore
          }
          window.dispatchEvent(new Event('restruc:push-denied'));
          return;
        }
        try {
          const sub = await subscribe(reg);
          if (sub) await saveToServer(sub);
        } catch {
          // ignore subscription errors
        }
      } else {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await removeFromServer(sub.endpoint);
            await sub.unsubscribe();
          }
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('restruc:push-changed', handleChange);
    return () => {
      window.removeEventListener('restruc:push-changed', handleChange);
    };
  }, []);

  return null;
}
