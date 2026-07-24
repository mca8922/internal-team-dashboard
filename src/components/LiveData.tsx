'use client';

// Live data sync.
//
// Mounted once in the authenticated layout. It opens ONE Supabase Realtime
// channel that listens for any insert/update/delete on the core domain
// tables (punches, goals, leaves, logs, …) and, on a change, calls
// router.refresh(). That re-runs the current route's Server Components and
// streams fresh data into the open page — no full reload, scroll preserved.
//
// The refresh is debounced so a burst of related writes (e.g. a goal plus
// its assignees) triggers a single refresh. Crucially, it is also
// ROUTE-AWARE: an event on `leaves` does not refresh the Goals page, an
// event on `goal_checklist_items` does not refresh /punch, and so on. The
// pages each table actually feeds are declared in TABLE_ROUTES below. This
// avoids re-running expensive server queries on pages that wouldn't show
// any difference. RLS still applies to Realtime, so a client is only woken
// by rows it is already allowed to read.
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// For each table, the route prefixes whose Server Components depend on it.
// Notifications are handled directly by NotificationsBell and don't need a
// page refresh. The shell layout always cares about `leaves` (pending count
// badge) and `logs` (missing-log banner) — represented by '/'.
const TABLE_ROUTES: Record<string, string[]> = {
  punches: ['/dashboard', '/punch', '/team', '/analytics'],
  goals: ['/dashboard', '/goals'],
  goal_assignees: ['/dashboard', '/goals'],
  goal_checklist_items: ['/dashboard', '/goals'],
  goal_checklist_completions: ['/dashboard', '/goals'],
  goal_work_reports: ['/dashboard', '/goals'],
  goal_work_report_reviews: ['/dashboard', '/goals'],
  goal_item_unlocks: ['/goals', '/dashboard'],
  report_templates: ['/goals'],
  goal_templates: ['/goals'],
  leaves: ['/', '/dashboard', '/leaves', '/team'],
  logs: ['/', '/dashboard', '/log', '/team', '/analytics'],
};

function matchesRoute(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => (p === '/' ? true : pathname.startsWith(p)));
}

export function LiveData() {
  const router = useRouter();
  const pathname = usePathname();
  // Keep the latest pathname in a ref so the channel handler always reads
  // it without needing to resubscribe on every navigation.
  const pathRef = React.useRef(pathname);
  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Coalesce a burst of changes into one refresh ~600ms after the last one.
    // A little longer than the old 400ms — keeps "live" feel but cuts the
    // refresh count when several rows change in quick succession.
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 600);
    };

    const channel = supabase.channel('live-data');
    for (const [table, routes] of Object.entries(TABLE_ROUTES)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (matchesRoute(pathRef.current, routes)) refresh();
      });
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
