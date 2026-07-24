'use client';

// Idle auto-logout. A member who has been inactive for an hour is signed out
// and bounced to the login screen — UNLESS they are still punched in (on the
// clock), in which case they are left alone. "Activity" is any pointer, key,
// scroll, or tab-focus event. We only hit the server (to check punch status)
// once the idle threshold is actually crossed, so this is essentially free
// while the member is active.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { isPunchedIn } from '@/lib/actions';
import { signOut } from '@/lib/auth-actions';

const IDLE_MS = 60 * 60 * 1000; // 1 hour
const CHECK_MS = 30 * 1000; // re-evaluate twice a minute

export function IdleLogout() {
  const router = useRouter();

  React.useEffect(() => {
    let last = Date.now();
    let busy = false;

    const bump = () => {
      last = Date.now();
    };

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'wheel',
      'scroll',
      'touchstart',
    ];
    events.forEach((e) =>
      window.addEventListener(e, bump, { passive: true } as AddEventListenerOptions),
    );
    document.addEventListener('visibilitychange', bump);

    const tick = async () => {
      if (busy) return;
      if (Date.now() - last < IDLE_MS) return;
      busy = true;
      try {
        // Still on the clock? Keep them signed in and reset the idle window.
        const onClock = await isPunchedIn();
        if (onClock) {
          last = Date.now();
        } else {
          await signOut(); // server action redirects to /login
          router.push('/login'); // fallback in case the redirect is swallowed
        }
      } catch {
        // Network hiccup — try again on the next tick rather than logging out.
        last = Date.now();
      } finally {
        busy = false;
      }
    };

    const id = setInterval(tick, CHECK_MS);
    return () => {
      clearInterval(id);
      events.forEach((e) => window.removeEventListener(e, bump));
      document.removeEventListener('visibilitychange', bump);
    };
  }, [router]);

  return null;
}
