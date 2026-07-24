'use client';

// Live presence — "who is actually in the dashboard right now".
//
// This is distinct from punch status (on the clock) and from the punch-derived
// "last seen". A member can be browsing goals, reading notifications or filing
// leave without ever punching in; presence captures that they are online *now*.
//
// Mounted once in the authenticated layout. Every signed-in client joins ONE
// Supabase Realtime presence channel keyed by their user id and announces
// itself. Supabase tracks join/leave (including tab close) and broadcasts the
// roster to everyone on the channel, so the Team views update within ~1s with
// no DB writes and no polling. RLS isn't involved — presence is broadcast, not
// table data — so it works for board and members alike.
import * as React from 'react';
import { createClient } from '@/lib/supabase/client';

const PresenceContext = React.createContext<Set<string>>(new Set());

// Set of user ids currently online. Consumers re-render whenever the roster
// changes (a teammate opens or closes the app).
export function usePresence(): Set<string> {
  return React.useContext(PresenceContext);
}

export function PresenceProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [online, setOnline] = React.useState<Set<string>>(() => new Set([userId]));

  React.useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase.channel('presence:online', {
      config: { presence: { key: userId } },
    });

    // 'sync' fires on join, leave and the initial snapshot. presenceState()'s
    // top-level keys are the per-client presence keys — i.e. the user ids.
    channel
      .on('presence', { event: 'sync' }, () => {
        const ids = Object.keys(channel.presenceState());
        setOnline(new Set(ids));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>;
}
