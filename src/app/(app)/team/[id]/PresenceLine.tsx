'use client';

// Live status line for the member detail header. Presence ("in the dashboard
// now") takes precedence over punch status, which takes precedence over the
// punch-derived "last seen". Updates in real time as the member comes and goes.
import { usePresence } from '@/components/Presence';

export function PresenceLine({
  userId,
  onTheClock,
  lastSeenLabel,
}: {
  userId: string;
  onTheClock: boolean;
  lastSeenLabel: string;
}) {
  const online = usePresence().has(userId);
  const green = online || onTheClock;
  return (
    <div
      className="text-xs mt-1 flex items-center gap-2"
      style={{
        color: green ? 'var(--color-green-primary)' : 'var(--color-grey-text)',
        fontWeight: green ? 600 : 400,
      }}
    >
      <span className={online ? 'dot dot-live' : `dot ${onTheClock ? 'dot-green' : 'dot-grey'}`} />
      {online
        ? 'Online now · in the dashboard'
        : onTheClock
          ? 'On the clock'
          : `Last seen ${lastSeenLabel}`}
    </div>
  );
}
