// Server-side read queries. Replaces the prototype's localStorage *Service
// read methods. Every call goes through the RLS-scoped server client, so a
// non-board user simply gets back only their own rows.
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  fmtDate,
  addDays,
  parseDate,
  startOfDay,
  isWorkingDay,
  istDayStartMs,
  daysBetween,
  GO_LIVE_DATE,
} from '@/lib/dates';
import type {
  Profile,
  UserRole,
  Punch,
  WorkLog,
  Goal,
  GoalAssignee,
  GoalChecklistItem,
  GoalChecklistCompletion,
  Leave,
  Holiday,
  Company,
  Notification,
  NotificationPref,
  NotificationType,
  TransactionalEmailLog,
  TransactionalEmailSettings,
  WorkReport,
  WorkReportReview,
  ReportTemplate,
  GoalTemplateRow,
  ChangeRequest,
  ChangeRequestStatus,
  PunchChangeRequest,
  PunchChangeRequestStatus,
  SavedView,
  GoalViewConfig,
  DepartmentApp,
  BirthdayWish,
  BirthdayWishRow,
} from '@/lib/types';
import { parseGoalTemplate, type GoalTemplate } from '@/lib/goal-templates';

// Wrapped in React.cache so the layout and the page (and anything else in
// the same request) share ONE auth+profile round-trip instead of repeating
// it. This alone removes a duplicate getUser() call per dashboard render.
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  return data;
});

// All profiles. By default only currently-active members are returned —
// pass { includeInactive: true } (the Team page) to also get former members.
// cache()d so the layout and page share one round-trip per request.
export const getAllProfiles = cache(
  async (opts: { includeInactive?: boolean } = {}): Promise<Profile[]> => {
    const supabase = await createClient();
    let q = supabase.from('profiles').select('*').order('created_at');
    if (!opts.includeInactive) q = q.eq('is_active', true);
    const { data } = await q;
    return data ?? [];
  },
);

export const getProfile = cache(async (id: string): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
  return data;
});

export const getPunches = cache(
  async (userId: string, fromDate?: string): Promise<Punch[]> => {
    const supabase = await createClient();
    let q = supabase.from('punches').select('*').eq('user_id', userId).order('punch_in');
    if (fromDate) q = q.gte('work_date', fromDate);
    const { data } = await q;
    return data ?? [];
  },
);

export const getAllPunches = cache(async (fromDate?: string): Promise<Punch[]> => {
  const supabase = await createClient();
  let q = supabase.from('punches').select('*').order('punch_in');
  if (fromDate) q = q.gte('work_date', fromDate);
  const { data } = await q;
  return data ?? [];
});

export const getLogs = cache(async (userId: string): Promise<WorkLog[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('logs')
    .select('*')
    .eq('user_id', userId)
    .order('log_date', { ascending: false });
  return data ?? [];
});

// Logs from the last `days` only — lighter than getLogs (which pulls every
// log ever). For "recent logs" style widgets (a short list of the latest
// entries) ONLY — a streak can run longer than any fixed window, so
// logStreak() below needs the full, unwindowed getLogs() history or it
// silently truncates once a streak outlives this window.
export const getRecentLogs = cache(
  async (userId: string, days = 40): Promise<WorkLog[]> => {
    const supabase = await createClient();
    const from = fmtDate(addDays(new Date(), -days));
    const { data } = await supabase
      .from('logs')
      .select('*')
      .eq('user_id', userId)
      .gte('log_date', from)
      .order('log_date', { ascending: false });
    return data ?? [];
  },
);

// Distinct tags the member has used across all their logs, with how many logs
// carry each one, most-used first. Powers both the tag autocomplete (names
// only) and the tag manager's usage pie chart (name + count).
export const getUserTagStats = cache(
  async (userId: string): Promise<{ tag: string; count: number }[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('logs')
      .select('tags')
      .eq('user_id', userId)
      .not('tags', 'is', null);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      for (const t of ((row.tags as string[] | null) ?? [])) {
        const tag = t.trim();
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  },
);

export const getLog = cache(
  async (userId: string, date: string): Promise<WorkLog | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('logs')
      .select('*')
      .eq('user_id', userId)
      .eq('log_date', date)
      .maybeSingle();
    return data;
  },
);

// Every member's logs. Pass `fromDate` to fetch only logs on/after that day —
// the team-analytics page only needs the current week, so windowing it avoids
// pulling (and transferring) the full block content of every log ever written.
// Omit it (the Team page) to get all history.
export const getAllLogs = cache(async (fromDate?: string): Promise<WorkLog[]> => {
  const supabase = await createClient();
  let q = supabase.from('logs').select('*');
  if (fromDate) q = q.gte('log_date', fromDate);
  const { data } = await q;
  return data ?? [];
});

export const getGoals = cache(async (): Promise<Goal[]> => {
  const supabase = await createClient();
  // Archived goals (see migration 0044) are excluded from every live view —
  // cascade, dashboard, team and analytics all read through getGoals().
  const { data } = await supabase
    .from('goals')
    .select('*')
    .is('archived_at', null)
    .order('sort_order');
  return data ?? [];
});

// Archived goals only, newest-archived first. Board-only in the UI (used by the
// Goals cleanup "Archived" tab to restore or permanently delete).
export const getArchivedGoals = cache(async (): Promise<Goal[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('goals')
    .select('*')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  return data ?? [];
});

// All goal→member assignments. The app joins these against the current user
// to decide which goals to show.
export const getGoalAssignees = cache(async (): Promise<GoalAssignee[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('goal_assignees').select('*');
  return data ?? [];
});

// Goals visible to a member: a goal counts if it (or any ancestor) is
// assigned directly to them. Including descendants of a visible goal means an
// assigned yearly goal also surfaces its monthly/weekly children in the focus
// view. A goal with no assignees is hidden from everyone except the Board —
// department-tagging alone no longer grants visibility.
export function visibleGoals(
  goals: Goal[],
  assignees: GoalAssignee[],
  profile: Profile,
): Goal[] {
  if (profile.role === 'board') return goals;

  const assignedIds = new Set(
    assignees.filter((a) => a.user_id === profile.id).map((a) => a.goal_id),
  );
  const byId = new Map(goals.map((g) => [g.id, g]));

  // Directly visible: explicitly assigned to me.
  const directlyVisible = (g: Goal) => assignedIds.has(g.id);

  // A goal is visible if it, or any ancestor up the parent chain, is
  // directly visible.
  const isVisible = (g: Goal): boolean => {
    let cur: Goal | undefined = g;
    const seen = new Set<string>(); // guard against cyclic parent_id
    while (cur && !seen.has(cur.id)) {
      if (directlyVisible(cur)) return true;
      seen.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };

  return goals.filter(isVisible);
}

// All goal checklist items, ordered for display. The app groups these by
// goal_id; goals without items simply have none.
export const getGoalChecklists = cache(async (): Promise<GoalChecklistItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('goal_checklist_items')
    .select('*')
    .order('goal_id')
    .order('sort_order');
  return data ?? [];
});

// Minimal public identity (id · name · avatar) for a set of members, used to
// label goal assignees. Goes through the service-role client on purpose: the
// profiles RLS only lets a member read their OWN row, so a teammate sharing a
// goal — or a board member viewing an inactive assignee — could otherwise not
// resolve the other person's name. Only name + avatar are exposed.
export const getAssigneeProfiles = cache(
  async (
    ids: string[],
  ): Promise<{ id: string; name: string; avatar_url: string | null }[]> => {
    if (ids.length === 0) return [];
    const admin = createAdminClient();
    const { data } = await admin
      .from('profiles')
      .select('id, name, avatar_url')
      .in('id', Array.from(new Set(ids)));
    return data ?? [];
  },
);

// User IDs on approved leave TODAY. Goes through the service role on purpose:
// every viewer (the Board or a teammate sharing a goal) must see the SAME
// on-leave set, otherwise a goal's combined progress would differ per viewer.
// Only the bare fact "on leave today" is exposed — no leave type, dates or notes.
export const getOnLeaveUserIdsToday = cache(async (): Promise<string[]> => {
  const admin = createAdminClient();
  const today = fmtDate(new Date());
  const { data } = await admin
    .from('leaves')
    .select('user_id')
    .eq('status', 'approved')
    .lte('start_date', today)
    .gte('end_date', today);
  return Array.from(new Set((data ?? []).map((l) => l.user_id as string)));
});

// Per-member checklist completions. Completion is independent per assignee, so
// a goal card joins these by item_id × user_id to show each person's progress.
export const getGoalCompletions = cache(
  async (): Promise<GoalChecklistCompletion[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('goal_checklist_completions')
      .select('*');
    return data ?? [];
  },
);

// Member work reports — one per (checklist item, member, day). Used to gate
// "Report Work" items (a member can only tick once today's report exists) and to
// show the Board what each member reported. All rows are read; the table is
// small (filtered per item/member in the view), consistent with completions.
export const getWorkReports = cache(async (): Promise<WorkReport[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('goal_work_reports')
    .select('*')
    .order('report_date', { ascending: false });
  return (data ?? []) as WorkReport[];
});

// Work-report reviews — a Manager/Board rating (1-5) + comment on a member's
// report. All rows are read (small table, filtered per report in the view),
// consistent with reports/completions; the member sees feedback on their own.
export const getWorkReportReviews = cache(async (): Promise<WorkReportReview[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('goal_work_report_reviews')
    .select('*')
    .order('created_at', { ascending: true });
  return (data ?? []) as WorkReportReview[];
});

// Minimal identity (id · name · avatar · role · is_manager) for a set of
// reviewers, used to label each rating/comment with WHO gave it ("Board Member"
// / "Department Manager"). Service-role on purpose: profiles RLS hides other
// members' rows, so a member couldn't otherwise resolve their reviewer's name —
// same rationale as getAssigneeProfiles, but role + is_manager are also needed
// for the label. Only these label fields are exposed.
export const getReviewerProfiles = cache(
  async (
    ids: string[],
  ): Promise<
    {
      id: string;
      name: string;
      avatar_url: string | null;
      role: UserRole;
      is_manager: boolean | null;
    }[]
  > => {
    if (ids.length === 0) return [];
    const admin = createAdminClient();
    const { data } = await admin
      .from('profiles')
      .select('id, name, avatar_url, role, is_manager')
      .in('id', Array.from(new Set(ids)));
    return (data ?? []) as {
      id: string;
      name: string;
      avatar_url: string | null;
      role: UserRole;
      is_manager: boolean | null;
    }[];
  },
);

// Per-department reporting templates (the shape members should follow). Read by
// everyone; edited by the Board (see actions.saveReportTemplate).
export const getReportTemplates = cache(async (): Promise<ReportTemplate[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('report_templates').select('*');
  return (data ?? []) as ReportTemplate[];
});

// Shared goal templates (blueprints), newest first. Read by everyone; the Board
// creates/removes them (see actions.createGoalTemplate / deleteGoalTemplate).
export const getGoalTemplates = cache(async (): Promise<GoalTemplate[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('goal_templates')
    .select('*')
    .order('created_at', { ascending: false });
  return ((data ?? []) as GoalTemplateRow[]).map(parseGoalTemplate);
});

// Per-user pinned goal ids (see migration 0036). RLS scopes rows to the caller,
// so we never need to pass/trust a userId — but it's accepted to key the cache.
export const getGoalPins = cache(async (_userId: string): Promise<string[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('goal_pins').select('goal_id');
  return ((data ?? []) as { goal_id: string }[]).map((r) => r.goal_id);
});

// Per-user saved views (filter/sort/grouping presets), newest first. RLS scopes
// rows to the caller. config is stored as JSON mirroring GoalViewConfig.
export const getSavedViews = cache(async (_userId: string): Promise<SavedView[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('goal_saved_views')
    .select('id, name, config')
    .order('created_at', { ascending: false });
  return ((data ?? []) as { id: string; name: string; config: GoalViewConfig }[]).map((r) => ({
    id: r.id,
    name: r.name,
    config: r.config,
  }));
});

export const getLeaves = cache(async (userId?: string): Promise<Leave[]> => {
  const supabase = await createClient();
  let q = supabase.from('leaves').select('*').order('start_date', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  return data ?? [];
});

export const getHolidays = cache(async (): Promise<Holiday[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from('holidays').select('*').order('holiday_date');
  return data ?? [];
});

// A member's explicit notification mutes (one row per type they've changed).
// A type with no row uses the default (both channels on).
export const getNotificationPrefs = cache(
  async (userId: string): Promise<NotificationPref[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('notification_prefs')
      .select('*')
      .eq('user_id', userId);
    return data ?? [];
  },
);

// The types this member has muted from the in-app bell. Used to filter both the
// server-rendered list and the bell's live realtime stream.
export async function getMutedInAppTypes(userId: string): Promise<NotificationType[]> {
  const prefs = await getNotificationPrefs(userId);
  return prefs.filter((p) => !p.in_app).map((p) => p.type);
}

// A member's most recent notifications, newest first. The notifications bell
// renders these and then subscribes to Realtime INSERTs for anything newer.
// Types the member has muted in-app are filtered out here (and in the bell's
// realtime handler) so the bell only ever shows what they want.
export const getNotifications = cache(
  async (userId: string, limit = 30): Promise<Notification[]> => {
    const supabase = await createClient();
    const muted = await getMutedInAppTypes(userId);
    let q = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (muted.length) q = q.not('type', 'in', `(${muted.join(',')})`);
    const { data } = await q;
    return data ?? [];
  },
);

export const getCompany = cache(async (): Promise<Company> => {
  const supabase = await createClient();
  const { data } = await supabase.from('company').select('*').eq('id', 1).single();
  return data ?? { id: 1, mission: '', vision: '', updated_by: null, updated_at: '' };
});

// ---- derived helpers (ported from lib.js) ----

// A single punch session can never count for more than 24 hours. A member who
// forgets to punch out shouldn't rack up 28h+ — the session stops accruing at
// 24h from punch-in (until they actually punch out).
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

// Effective end time of a session: its punch_out, or — for an open session —
// now, but never more than 24h after punch-in.
function sessionEndMs(s: { punch_in: string; punch_out: string | null }, now: number): number {
  const start = new Date(s.punch_in).getTime();
  const rawEnd = s.punch_out ? new Date(s.punch_out).getTime() : now;
  return Math.min(rawEnd, start + MAX_SESSION_MS);
}

export function punchTotalMs(sessions: Punch[]): number {
  const now = Date.now();
  return sessions.reduce((sum, s) => {
    const a = new Date(s.punch_in).getTime();
    return sum + Math.max(0, sessionEndMs(s, now) - a);
  }, 0);
}

// The portion of a single punch session that falls inside one IST calendar day
// (YYYY-MM-DD). A session punched in at 11:55 PM and out at 12:30 AM the next
// day contributes 5 minutes to the first day and 30 minutes to the second.
// Open sessions count up to `now`. Sessions that don't overlap the day → 0.
export function punchMsOnDate(
  s: { punch_in: string; punch_out: string | null },
  ds: string,
  now: number = Date.now(),
): number {
  const dayStart = istDayStartMs(ds);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const start = new Date(s.punch_in).getTime();
  // Open sessions are capped at 24h from punch-in (see MAX_SESSION_MS).
  const end = sessionEndMs(s, now);
  const lo = Math.max(start, dayStart);
  const hi = Math.min(end, dayEnd);
  return Math.max(0, hi - lo);
}

// Total time worked on one IST calendar day across a set of sessions, with each
// session split at the midnight boundary (see punchMsOnDate). Pass any sessions
// that might overlap the day — non-overlapping ones simply add nothing — so a
// session whose work_date is the previous day still contributes its post-
// midnight minutes to this day.
export function punchTotalMsForDate(
  sessions: { punch_in: string; punch_out: string | null }[],
  ds: string,
  now: number = Date.now(),
): number {
  return sessions.reduce((sum, s) => sum + punchMsOnDate(s, ds, now), 0);
}

// ---- quarterly leaves ----

// Leaves are allocated per calendar quarter and refresh on the 1st of Jan /
// Apr / Jul / Oct. Allotment is intentionally simple and the same for everyone.
export const QUARTERLY_LEAVE_ALLOTMENT: Record<'casual' | 'sick' | 'emergency', number> = {
  casual: 12,
  sick: 10,
  emergency: 3,
};

export interface QuarterInfo {
  start: string; // YYYY-MM-DD, first day of the quarter (IST)
  end: string; // YYYY-MM-DD, last day of the quarter
  nextStart: string; // YYYY-MM-DD, first day of the next quarter (refresh date)
  label: string; // e.g. "Q2 2026"
}

// The IST quarter containing `ref` (defaults to now).
export function quarterInfo(ref: Date | string = new Date()): QuarterInfo {
  const today = fmtDate(ref);
  const [y, m] = today.split('-').map(Number);
  const qi = Math.floor((m - 1) / 3); // 0..3
  const startMonth = qi * 3 + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${y}-${pad(startMonth)}-01`;
  const rollsYear = startMonth + 3 > 12;
  const nextStart = `${rollsYear ? y + 1 : y}-${pad(rollsYear ? 1 : startMonth + 3)}-01`;
  const end = fmtDate(addDays(parseDate(nextStart), -1));
  return { start, end, nextStart, label: `Q${qi + 1} ${y}` };
}

export interface LeaveUsage {
  quarter: QuarterInfo;
  allotment: typeof QUARTERLY_LEAVE_ALLOTMENT;
  used: Record<'casual' | 'sick' | 'emergency', number>;
  remaining: Record<'casual' | 'sick' | 'emergency', number>;
}

// Derives this-quarter leave usage straight from approved leaves, so the
// balance "auto-refreshes" each quarter with no stored counter to reset. A
// leave is counted in the quarter of its start_date; half-days count as 0.5.
export function leaveUsage(leaves: Leave[], ref: Date | string = new Date()): LeaveUsage {
  const quarter = quarterInfo(ref);
  const used = { casual: 0, sick: 0, emergency: 0 };
  for (const l of leaves) {
    if (l.status !== 'approved') continue;
    if (l.start_date < quarter.start || l.start_date > quarter.end) continue;
    if (l.type !== 'casual' && l.type !== 'sick' && l.type !== 'emergency') continue;
    const days = l.is_half_day
      ? 0.5
      : (daysBetween(parseDate(l.start_date), parseDate(l.end_date)) || 0) + 1;
    used[l.type] += days;
  }
  const remaining = {
    casual: Math.max(0, QUARTERLY_LEAVE_ALLOTMENT.casual - used.casual),
    sick: Math.max(0, QUARTERLY_LEAVE_ALLOTMENT.sick - used.sick),
    emergency: Math.max(0, QUARTERLY_LEAVE_ALLOTMENT.emergency - used.emergency),
  };
  return { quarter, allotment: QUARTERLY_LEAVE_ALLOTMENT, used, remaining };
}

// Public read of department → accent colour. Everyone authenticated may read
// the departments table; board members set the colours (see actions.ts).
export const getDepartmentColors = cache(async (): Promise<Record<string, string>> => {
  const supabase = await createClient();
  const { data } = await supabase.from('departments').select('name, color');
  const map: Record<string, string> = {};
  for (const d of data ?? []) map[d.name] = d.color;
  return map;
});

// ---- department apps (the Launchpad) ----

// Apps the CURRENT user may open. RLS already scopes this: the Board gets every
// app, everyone else gets only ACTIVE company-wide apps plus the active apps of
// their own department. Ordered the way they'll render (dept, then manual order).
export const getDepartmentApps = cache(async (): Promise<DepartmentApp[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('department_apps')
    .select('*')
    .eq('is_active', true)
    .order('department', { nullsFirst: true })
    .order('sort_order')
    .order('name');
  return data ?? [];
});

// Every app including hidden ones, for the Board's Manage > Apps screen. RLS
// returns all rows to the Board; a non-board caller would only get their own
// active set, so callers must gate this to the Board.
export const getAllDepartmentApps = cache(async (): Promise<DepartmentApp[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('department_apps')
    .select('*')
    .order('department', { nullsFirst: true })
    .order('sort_order')
    .order('name');
  return data ?? [];
});

// ---- department managers ----

// The caller's team — the members whose manager_id points at them. RLS lets a
// Manager read these rows (and only these, plus their own). `includeInactive`
// off by default, matching getAllProfiles. Ordered by name.
export const getManagedTeam = cache(
  async (managerId: string, opts: { includeInactive?: boolean } = {}): Promise<Profile[]> => {
    const supabase = await createClient();
    let q = supabase
      .from('profiles')
      .select('*')
      .eq('manager_id', managerId)
      .order('name', { ascending: true });
    if (!opts.includeInactive) q = q.eq('is_active', true);
    const { data } = await q;
    return data ?? [];
  },
);

// Change requests, newest first. RLS scopes the result: the Board sees every
// request; a Manager sees only the ones they raised. Pass status to filter.
export const getChangeRequests = cache(
  async (status?: ChangeRequestStatus): Promise<ChangeRequest[]> => {
    const supabase = await createClient();
    let q = supabase
      .from('change_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data } = await q;
    return (data ?? []) as ChangeRequest[];
  },
);

// Count of pending change requests visible to the caller (Board: all; Manager:
// their own). Drives the sidebar badge.
export const getPendingChangeRequestCount = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from('change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  return count ?? 0;
});

// A member's own punch change requests, newest first, every status. Always
// scoped explicitly to `userId` (not left to RLS) because the Founder's RLS
// grant sees every member's rows — this call is for "MY requests" on the
// Punch page, which must show only the caller's own, even for the Founder.
export const getMyPunchChangeRequests = cache(
  async (userId: string): Promise<PunchChangeRequest[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('punch_change_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return (data ?? []) as PunchChangeRequest[];
  },
);

// Punch change requests, newest first. RLS scopes the result: the Founder
// sees every request; a member sees only their own. Pass status to filter.
// Used by the Founder's review queue on /team/requests.
export const getPunchChangeRequests = cache(
  async (status?: PunchChangeRequestStatus): Promise<PunchChangeRequest[]> => {
    const supabase = await createClient();
    let q = supabase
      .from('punch_change_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data } = await q;
    return (data ?? []) as PunchChangeRequest[];
  },
);

// Count of pending punch change requests visible to the caller — Founder
// only, via RLS. Drives the /team/requests sidebar badge.
export const getPendingPunchChangeRequestCount = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from('punch_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  return count ?? 0;
});

export function punchStatus(sessions: Punch[]): 'not-started' | 'in' | 'complete' {
  if (sessions.length === 0) return 'not-started';
  const last = sessions[sessions.length - 1];
  return last.punch_out ? 'complete' : 'in';
}

// An open punch (no punch-out) is the member's CURRENT, still-running session —
// even one that began late last night and crossed midnight — until it has been
// open this long. Beyond it, the session is treated as a forgotten punch: it no
// longer reads as "on the clock" and the missed-punch reminder fires. No real
// single work session runs this long, so it cleanly separates "working late"
// from "forgot to punch out yesterday".
export const STALE_PUNCH_HOURS = 18;

// The member's active open session, if any — the most recent punch with no
// punch-out that began within the active window. Returns null when the only
// open punches are stale (forgotten) or there are none. Lets the dashboard /
// punch page show "Punch out" the day after a late-night punch-in.
export function activeOpenSession<T extends { punch_in: string; punch_out: string | null }>(
  punches: T[],
  now: number = Date.now(),
): T | null {
  const cutoff = now - STALE_PUNCH_HOURS * 60 * 60 * 1000;
  let best: T | null = null;
  for (const p of punches) {
    if (p.punch_out) continue;
    const t = new Date(p.punch_in).getTime();
    if (t < cutoff) continue; // open too long — forgotten, not active
    if (!best || t > new Date(best.punch_in).getTime()) best = p;
  }
  return best;
}

// Consecutive working days (Mon–Fri, on/after go-live) with a non-empty log,
// counted back from the most recent working day. Today only breaks the
// streak if it is itself a past working day with no log — an as-yet-unlogged
// "today" doesn't reset a streak built on prior days.
export function logStreak(logs: WorkLog[]): number {
  const logged = new Set(
    logs.filter((l) => l.blocks && l.blocks.length).map((l) => l.log_date),
  );
  let streak = 0;
  let d = startOfDay(new Date());
  const todayStr = fmtDate(new Date());
  for (let i = 0; i < 400; i++) {
    if (!isWorkingDay(d)) {
      d = addDays(d, -1);
      if (fmtDate(d) < GO_LIVE_DATE) break;
      continue;
    }
    const ds = fmtDate(d);
    if (logged.has(ds)) {
      streak += 1;
    } else if (ds !== todayStr) {
      break; // a past working day with no log ends the streak
    }
    d = addDays(d, -1);
    if (fmtDate(d) < GO_LIVE_DATE) break;
  }
  return streak;
}

export function isOnLeave(leaves: Leave[], userId: string, date: string): boolean {
  return leaves.some(
    (l) =>
      l.user_id === userId &&
      l.status === 'approved' &&
      date >= l.start_date &&
      date <= l.end_date,
  );
}

// Human label for a member's full-day approved leave on a date, for analytics
// charts that need to explain a zero/missing value instead of showing a bare
// gap. Excludes WFH and half-day leave, since the member is still expected to
// work (and log/punch) normally on those days.
export function leaveLabel(leaves: Leave[], userId: string, date: string): string | null {
  const leave = leaves.find(
    (l) =>
      l.user_id === userId &&
      l.status === 'approved' &&
      l.type !== 'wfh' &&
      !l.is_half_day &&
      date >= l.start_date &&
      date <= l.end_date,
  );
  if (!leave) return null;
  return leave.type === 'casual' ? 'Casual leave' : leave.type === 'sick' ? 'Sick leave' : 'Emergency leave';
}

export function isHoliday(holidays: Holiday[], date: string): boolean {
  return holidays.some((h) => h.holiday_date === date);
}

// ---- transactional emails (board-only; RLS enforces it) ----

// The single settings row. Falls back to a sane "off" default if the row is
// somehow missing (e.g. migration not yet applied) so the page still renders.
export const getTransactionalSettings = cache(
  async (): Promise<TransactionalEmailSettings> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('transactional_email_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    return (
      (data as TransactionalEmailSettings) ?? {
        id: 1,
        enabled: false,
        on_leave: true,
        on_goal: true,
        on_punch: true,
        updated_by: null,
        updated_at: '',
      }
    );
  },
);

// Every active member (board included — they get goal/punch/leave emails too)
// with their per-member transactional toggle, for the controls list.
export const getTransactionalMembers = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, name, role, department, avatar_url, commute_email, email, transactional_emails_enabled')
    .eq('is_active', true)
    .is('left_at', null)
    .order('name', { ascending: true });
  return (data ?? []) as Pick<
    Profile,
    'id' | 'name' | 'role' | 'department' | 'avatar_url' | 'commute_email' | 'email' | 'transactional_emails_enabled'
  >[];
});

// Transactional email send history — newest first. Board-only (RLS).
export const getTransactionalEmailLogs = cache(
  async (limit = 100): Promise<TransactionalEmailLog[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('transactional_email_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as TransactionalEmailLog[];
  },
);

// Active, non-departed members whose date of birth is today (month/day match,
// IST calendar day) — feeds the dashboard birthday wishing card.
export const getTodaysBirthdays = cache(
  async (): Promise<{ id: string; name: string; avatarUrl: string | null; department: string }[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('profiles')
      .select('id, name, avatar_url, department, date_of_birth')
      .eq('is_active', true)
      .is('left_at', null)
      .not('date_of_birth', 'is', null);
    const today = parseDate(fmtDate(new Date()));
    return (data ?? [])
      .filter((u) => {
        const b = parseDate(u.date_of_birth as string);
        return b.getMonth() === today.getMonth() && b.getDate() === today.getDate();
      })
      .map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatar_url, department: u.department }));
  },
);

// Minimal identity for a set of member ids — resolves wish senders' names /
// avatars for the birthday card. Everyone can already see this via Team.
export const getBasicProfiles = cache(
  async (ids: string[]): Promise<{ id: string; name: string; avatarUrl: string | null }[]> => {
    if (ids.length === 0) return [];
    const supabase = await createClient();
    const { data } = await supabase.from('profiles').select('id, name, avatar_url').in('id', ids);
    return (data ?? []).map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatar_url }));
  },
);

// "Who wished whom, and were they replied to" — NEVER the message text. Calls
// the birthday_wishers() SECURITY DEFINER function (migration
// 0056_birthday_privacy.sql) so any authenticated member can see who wished a
// celebrant without RLS granting them the message column itself.
export const getBirthdayWishers = cache(
  async (
    celebrantIds: string[],
  ): Promise<{ id: string; birthday_user_id: string; author_id: string; created_at: string; has_reply: boolean }[]> => {
    if (celebrantIds.length === 0) return [];
    const supabase = await createClient();
    const { data } = await supabase.rpc('birthday_wishers', { targets: celebrantIds });
    return data ?? [];
  },
);

// The viewer's OWN wishes sent toward today's celebrants, full text included
// — RLS allows this because `author_id = auth.uid()`.
export const getMyBirthdayWishes = cache(
  async (celebrantIds: string[], viewerId: string): Promise<BirthdayWishRow[]> => {
    if (celebrantIds.length === 0) return [];
    const supabase = await createClient();
    const { data } = await supabase
      .from('birthday_wishes')
      .select('*')
      .eq('author_id', viewerId)
      .in('birthday_user_id', celebrantIds);
    return (data ?? []) as BirthdayWishRow[];
  },
);

// Every wish addressed to the signed-in member (only ever called when they
// ARE today's celebrant) — RLS allows this because `birthday_user_id = auth.uid()`.
export const getBirthdayWishesToMe = cache(
  async (celebrantId: string): Promise<BirthdayWishRow[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('birthday_wishes')
      .select('*')
      .eq('birthday_user_id', celebrantId)
      .order('created_at', { ascending: true });
    return (data ?? []) as BirthdayWishRow[];
  },
);

// Assembles the privacy-safe Celebrant[] the dashboard's BirthdayBanner
// renders: for the viewer's own celebrant card, every wish is fully
// populated (they're allowed to read all of them); for every other
// celebrant, only the viewer's own wish (if any) carries real message/reply
// text — everyone else's entry exposes just who wished, matching
// birthday_wishers()'s columns.
export const getBirthdayCelebrants = cache(
  async (
    viewerId: string,
  ): Promise<
    {
      id: string;
      name: string;
      avatar_url: string | null;
      department: string;
      isViewerCelebrant: boolean;
      wishes: BirthdayWish[];
    }[]
  > => {
    const todays = await getTodaysBirthdays();
    if (todays.length === 0) return [];
    const celebrantIds = todays.map((c) => c.id);
    const viewerIsCelebrant = todays.some((c) => c.id === viewerId);

    const [wishers, myWishes, wishesToMe] = await Promise.all([
      getBirthdayWishers(celebrantIds),
      getMyBirthdayWishes(celebrantIds, viewerId),
      viewerIsCelebrant ? getBirthdayWishesToMe(viewerId) : Promise.resolve([] as BirthdayWishRow[]),
    ]);

    const senderIds = new Set([
      ...wishers.map((w) => w.author_id),
      ...wishesToMe.map((w) => w.author_id),
    ]);
    const senders = await getBasicProfiles([...senderIds]);
    const senderById = new Map(senders.map((s) => [s.id, s]));
    const toReply = (msg: string | null, at: string | null) => (msg ? { message: msg, created_at: at! } : null);

    return todays.map((c) => {
      const isViewerCelebrant = c.id === viewerId;
      if (isViewerCelebrant) {
        const wishes: BirthdayWish[] = wishesToMe.map((w) => {
          const sender = senderById.get(w.author_id);
          return {
            id: w.id,
            sender_id: w.author_id,
            sender_name: sender?.name ?? 'Someone',
            sender_avatar_url: sender?.avatarUrl ?? null,
            message: w.message,
            created_at: w.created_at,
            reply: toReply(w.reply_message, w.reply_created_at),
          };
        });
        return { id: c.id, name: c.name, avatar_url: c.avatarUrl, department: c.department, isViewerCelebrant, wishes };
      }

      const mine = myWishes.find((w) => w.birthday_user_id === c.id);
      const wishes: BirthdayWish[] = wishers
        .filter((w) => w.birthday_user_id === c.id)
        .map((w) => {
          const sender = senderById.get(w.author_id);
          const isMine = w.author_id === viewerId;
          return {
            id: w.id,
            sender_id: w.author_id,
            sender_name: sender?.name ?? 'Someone',
            sender_avatar_url: sender?.avatarUrl ?? null,
            message: isMine && mine ? mine.message : '',
            created_at: w.created_at,
            reply: isMine && mine ? toReply(mine.reply_message, mine.reply_created_at) : null,
          };
        });
      return { id: c.id, name: c.name, avatar_url: c.avatarUrl, department: c.department, isViewerCelebrant, wishes };
    });
  },
);
