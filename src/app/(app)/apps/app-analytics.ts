'use server';

// Board-only analytics for the Launchpad. Called from AppAnalytics (client)
// when switching periods and from page.tsx for the SSR initial render.
// Returns aggregated click data per app with member breakdown and trend vs
// the previous equal-length period.

import { createClient } from '@/lib/supabase/server';
import { fmtTime } from '@/lib/dates';

export interface MemberClickStat {
  id: string;
  name: string;
  avatar_url: string | null;
  count: number;
}

// Who opened an app on one specific day, and when — powers the Daily
// Activity chart's click-to-drill-down (see AppAnalytics.tsx).
export interface DayClick {
  userId: string;
  name: string;
  avatarUrl: string | null;
  time: string; // e.g. "3:41 PM", already IST-formatted
  clickedAt: string; // raw ISO timestamp, for sorting most-recent-first
}

export interface AppClickStat {
  app: {
    id: string;
    name: string;
    department: string | null;
    image_url: string | null;
    icon: string;
  };
  total: number;
  share: number;   // 0-100, this app's % of all opens in the period
  trend: number | null; // % change vs previous equal period, null = no history
  members: MemberClickStat[];
  // One entry per day, all days filled (0 on quiet days). `clicks` is only
  // ever non-empty when count > 0.
  dailyClicks: { date: string; count: number; clicks: DayClick[] }[];
}

export interface AppAnalyticsResult {
  stats: AppClickStat[];
  totalClicks: number;
  uniqueUsers: number;
  mostOpened: string | null;
}

export async function getAppAnalytics(days: number): Promise<AppAnalyticsResult> {
  const supabase = await createClient();

  // Verify board access (RLS alone is not enough — non-board gets empty rows).
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (prof?.role !== 'board') throw new Error('Board members only');

  const now = Date.now();
  const since    = new Date(now - days * 86_400_000).toISOString();
  const prevSince = new Date(now - days * 86_400_000 * 2).toISOString();

  const [
    { data: apps },
    { data: clicks },
    { data: prevClicks },
    { data: profiles },
  ] = await Promise.all([
    supabase
      .from('department_apps')
      .select('id, name, department, image_url, icon')
      .eq('is_active', true),
    supabase
      .from('department_app_clicks')
      .select('app_id, user_id, clicked_at')
      .gte('clicked_at', since),
    supabase
      .from('department_app_clicks')
      .select('app_id')
      .gte('clicked_at', prevSince)
      .lt('clicked_at', since),
    supabase
      .from('profiles')
      .select('id, name, avatar_url'),
  ]);

  // Build per-app daily buckets (one entry per calendar day in the period).
  // `clicks` per day carries who + when — bundled here since every raw click
  // row is already fetched for the count aggregation, so the chart's
  // click-to-drill-down (AppAnalytics.tsx) costs nothing extra to wire up.
  const allClicks = clicks ?? [];
  function buildDailyBuckets(appId: string): { date: string; count: number; clicks: DayClick[] }[] {
    const buckets = new Map<string, DayClick[]>();
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
      buckets.set(key, []);
    }
    for (const c of allClicks) {
      if (c.app_id !== appId) continue;
      const key = (c.clicked_at as string).slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const p = profileMap.get(c.user_id);
      bucket.push({
        userId: c.user_id,
        name: p?.name ?? 'Unknown',
        avatarUrl: p?.avatar_url ?? null,
        time: fmtTime(c.clicked_at as string),
        clickedAt: c.clicked_at as string,
      });
    }
    return [...buckets.entries()].map(([date, dayClicks]) => ({
      date,
      count: dayClicks.length,
      clicks: dayClicks.sort((a, b) => b.clickedAt.localeCompare(a.clickedAt)),
    }));
  }

  // Group current clicks by app_id.
  const byApp = new Map<string, string[]>(); // app_id -> user_id[]
  for (const c of allClicks) {
    const list = byApp.get(c.app_id) ?? [];
    list.push(c.user_id);
    byApp.set(c.app_id, list);
  }

  // Group prev-period clicks by app_id for trend.
  const prevByApp = new Map<string, number>();
  for (const c of prevClicks ?? []) {
    prevByApp.set(c.app_id, (prevByApp.get(c.app_id) ?? 0) + 1);
  }

  // Profile lookup for member breakdown.
  const profileMap = new Map<string, { name: string; avatar_url: string | null }>();
  for (const p of profiles ?? []) profileMap.set(p.id, p);

  const totalClicks = allClicks.length;
  const uniqueUsers = new Set(allClicks.map(c => c.user_id)).size;

  const stats: AppClickStat[] = [];

  for (const app of apps ?? []) {
    const userIds  = byApp.get(app.id) ?? [];
    const total    = userIds.length;
    const prevTotal = prevByApp.get(app.id) ?? 0;

    // Skip apps with zero activity in both windows (keeps the list clean).
    if (total === 0 && prevTotal === 0) continue;

    // Member breakdown: count per user, sort descending, cap at 8 shown.
    const memberCounts = new Map<string, number>();
    for (const uid of userIds) memberCounts.set(uid, (memberCounts.get(uid) ?? 0) + 1);
    const members: MemberClickStat[] = [...memberCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count]) => ({
        id,
        name: profileMap.get(id)?.name ?? 'Unknown',
        avatar_url: profileMap.get(id)?.avatar_url ?? null,
        count,
      }));

    const trend = prevTotal === 0
      ? null
      : Math.round(((total - prevTotal) / prevTotal) * 100);

    stats.push({
      app: {
        id: app.id,
        name: app.name,
        department: app.department,
        image_url: app.image_url,
        icon: app.icon,
      },
      total,
      share: totalClicks === 0 ? 0 : Math.round((total / totalClicks) * 100),
      trend,
      members,
      dailyClicks: buildDailyBuckets(app.id),
    });
  }

  // Most-opened first.
  stats.sort((a, b) => b.total - a.total);

  return {
    stats,
    totalClicks,
    uniqueUsers,
    mostOpened: stats[0]?.app.name ?? null,
  };
}
