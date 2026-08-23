'use server';

// Server Actions — every mutation in the app. Replaces the prototype's
// localStorage *Service write methods. RLS enforces who may do what; these
// actions just shape the data and revalidate the affected routes.
import { revalidatePath } from 'next/cache';
// Post-response work (push, transactional email) is scheduled through after():
// a bare `void promise` is killed the instant the serverless function returns
// its response, so pushes and emails were silently dropped on Vercel.
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDate, fmtFriendly, fmtDateDMY, parseDate, istDayStartMs } from '@/lib/dates';
import { milestoneForToday, milestonePings, type Milestone, type MilestoneKind } from '@/lib/milestones';
import { STALE_PUNCH_HOURS } from '@/lib/queries';
import { FOUNDER_USER_IDS, belongsToDepartment } from '@/lib/roles';
import { sendPush } from '@/lib/push';
import { notifyByEmail } from '@/lib/notify-email';
import { sendMail } from '@/lib/mailer';
import { renderTransactionalEmail, transactionalPlainText } from '@/lib/email-shell';
import type {
  Block,
  ChangeRequestField,
  ChecklistRecurrence,
  GoalLevel,
  GoalViewConfig,
  LeaveType,
  NotificationType,
  UserRole,
} from '@/lib/types';
import {
  MONTHLY_REQUEST_LIMIT,
  monthKey,
  isWithinRequestWindow,
  countsTowardMonthlyLimit,
} from '@/lib/punch-requests';

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

// Asserts the caller is a Board Member. Used to gate board-only actions in
// addition to RLS (RLS can't guard the auth-admin API).
async function requireBoard() {
  const { supabase, userId } = await requireUser();
  // A Founder is always Board-level, even if the role column got corrupted.
  if ((FOUNDER_USER_IDS as readonly string[]).includes(userId)) return { supabase, userId };
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
  if (!data || data.role !== 'board') throw new Error('Board Members only');
  return { supabase, userId };
}

// Asserts the caller is an active Department Manager and returns their profile
// (including the department they head). Used to gate manager-only actions in
// addition to RLS.
async function requireManager() {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from('profiles')
    .select('id, name, is_manager, managed_department')
    .eq('id', userId)
    .single();
  if (!data || !data.is_manager) throw new Error('Department Managers only');
  return { supabase, userId, manager: data };
}

// Asserts the caller is the Founder. Founder powers (editing anyone's
// punches, permanent deletion) are above the Board level. Keyed off the
// immutable user id, so an email change never affects it.
async function requireFounder() {
  const { supabase, userId } = await requireUser();
  if (!(FOUNDER_USER_IDS as readonly string[]).includes(userId)) throw new Error('Founder only');
  return { supabase, userId };
}

// True when the given id is one of the Founders. Identity is the immutable
// Supabase user id, so changing the login email never affects it.
function isFounderId(id: string): boolean {
  return (FOUNDER_USER_IDS as readonly string[]).includes(id);
}

// Guards a board action that targets a member. A Founder account is frozen:
// only that SAME Founder may touch their own row (allowSelf) — one Founder
// may never use this bypass to edit the OTHER Founder's protected row.
function guardFounderTarget(
  memberId: string,
  callerId: string,
  opts: { allowSelf?: boolean } = {},
) {
  if (!isFounderId(memberId)) return;
  if (opts.allowSelf && callerId === memberId) return;
  throw new Error('The Founder account is protected and cannot be changed.');
}

// Board-level guard for an action that TARGETS one member. On top of the
// Founder freeze this enforces a Director's scope (migration 0061): a Director
// may only touch the people ASSIGNED to them, while a Founder — who belongs to
// no department and directs no one — reaches everyone.
//
// RLS already blocks the write, but failing here gives the Director a real
// error instead of a silent zero-row update.
async function requireMemberScope(memberId: string, opts: { allowSelf?: boolean } = {}) {
  const { supabase, userId } = await requireBoard();
  guardFounderTarget(memberId, userId, opts);
  if (isFounderId(userId) || memberId === userId) return { supabase, userId };

  const { data } = await supabase
    .from('profiles')
    .select('id, director_id')
    .eq('id', memberId)
    .maybeSingle();
  if (!data || data.director_id !== userId) {
    throw new Error('You can only manage the members assigned to you.');
  }
  return { supabase, userId };
}

// The department the calling Director runs. Founders get null — they are not
// scoped to one. Throws if the caller isn't board-level.
async function callerDepartment(): Promise<string | null> {
  const { supabase, userId } = await requireBoard();
  if (isFounderId(userId)) return null;
  const { data } = await supabase
    .from('profiles')
    .select('department')
    .eq('id', userId)
    .single();
  const d = data?.department?.trim();
  if (!d) throw new Error('You have not been assigned to a department yet.');
  return d;
}

// Self-heal the Founder account. If a stray edit ever demoted the Founder's
// role or marked them inactive/banned, this quietly restores it so the owner
// can never be locked out. No-op for everyone else, and a no-op for the
// Founder when nothing is wrong. Called on every authenticated page load.
// (The login email is intentionally left untouched — the Founder may change
// it freely; identity is the user id, not the email.)
export async function ensureFounderIntegrity(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(FOUNDER_USER_IDS as readonly string[]).includes(user.id)) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();
  if (!profile) return;

  const patch: Record<string, unknown> = {};
  if (profile.role !== 'board') patch.role = 'board';
  if (!profile.is_active) {
    patch.is_active = true;
    patch.left_at = null;
  }
  if (Object.keys(patch).length === 0) return;

  // Restore the profile (the Founder may always update their own row), and
  // lift any ban so sign-in works again. No revalidatePath here: this runs
  // during layout render (where revalidate is disallowed), and callers read
  // the profile *after* this heal, so they already see the restored values.
  await supabase.from('profiles').update(patch).eq('id', user.id);
  if (patch.is_active) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(user.id, { ban_duration: 'none' });
  }
}

// ---- session ----

// Whether the caller currently has an open punch session (no punch_out). Used
// by the idle auto-logout guard: a member who is still on the clock is never
// signed out for inactivity, only one who has already punched out.
export async function isPunchedIn(): Promise<boolean> {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from('punches')
    .select('id')
    .eq('user_id', userId)
    .is('punch_out', null)
    .limit(1);
  return !!(data && data.length);
}

// Forgot-to-punch-out reminder. Any punch still open with a work_date BEFORE
// today means the member punched in on an earlier day and never punched out —
// the session has crossed midnight. Each affected member gets a one-time
// notification (de-duplicated per missed day) telling them to ask the Founder
// to correct the punch, since only the Founder can edit punch sessions.
//
// Runs through the service-role client so it can sweep every member and write
// their notifications, and is called on each app load — the first teammate to
// open the app after midnight triggers the reminders for everyone. No
// revalidatePath: this runs during layout render (where revalidate is
// disallowed) and the layout reads notifications immediately afterwards.
export async function sweepMissedPunchOuts(): Promise<void> {
  const admin = createAdminClient();
  const today = fmtDate(new Date());

  // Only a session that has been open longer than the active window is a
  // genuine forgotten punch. A punch from late last night that's still running
  // is real work crossing midnight — it must NOT trigger a reminder.
  const staleBeforeISO = new Date(Date.now() - STALE_PUNCH_HOURS * 60 * 60 * 1000).toISOString();
  const { data: open } = await admin
    .from('punches')
    .select('id, user_id, work_date')
    .is('punch_out', null)
    .lt('work_date', today)
    .lt('punch_in', staleBeforeISO);
  if (!open || open.length === 0) return;

  const userIds = Array.from(new Set(open.map((p) => p.user_id)));

  // Existing reminders, so we never notify twice for the same missed day.
  const [{ data: existing }, { data: founders }] = await Promise.all([
    admin
      .from('notifications')
      .select('user_id, href')
      .eq('type', 'punch_missing')
      .in('user_id', userIds),
    admin.from('profiles').select('name').in('id', FOUNDER_USER_IDS as unknown as string[]),
  ]);
  const founderNames = (founders ?? []).map((f) => f.name);
  const founderName =
    founderNames.length > 0 ? founderNames.join(' or ') : 'the Founder';
  const founderLabel = founderNames.length > 1 ? 'Founders' : 'Founder';
  const seen = new Set((existing ?? []).map((n) => `${n.user_id}|${n.href}`));

  const rows: {
    user_id: string;
    type: 'punch_missing';
    title: string;
    body: string;
    href: string;
  }[] = [];
  for (const p of open) {
    const href = `/punch?missed=${p.work_date}`;
    const key = `${p.user_id}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key); // guard against two open sessions on the same missed day
    rows.push({
      user_id: p.user_id,
      type: 'punch_missing',
      title: 'You forgot to punch out',
      body: `Your session from ${fmtFriendly(parseDate(p.work_date))} is still running. Please ask ${founderName} (${founderLabel}) to correct your punch. Message them on WhatsApp.`,
      href,
    });
  }
  if (rows.length) {
    await admin.from('notifications').insert(rows);
    for (const r of rows) {
      // Web-push so the reminder reaches the member even with the app closed —
      // consistent with leave/goal events (no-op unless they've subscribed).
      after(() => sendPush(r.user_id, { title: r.title, body: r.body, url: r.href }, 'punch_missing'));
      // One email per affected member (opt-in; no-op unless enabled).
      after(() => notifyByEmail([r.user_id], { eventType: 'punch_missing', title: r.title, body: r.body, href: r.href }));
    }
  }
}

// How long a notification lives before the daily sweep removes it. Bell rows
// are transient reminders, not records — anything older than this is stale, so
// dropping it keeps the `notifications` table bounded instead of growing with
// every goal/leave event forever. Tunable via env without a redeploy.
const NOTIFICATION_RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 7;

// Window within which a repeat work-report submit for the same member+goal is
// treated as an edit and does NOT re-notify reviewers. Tunable via env.
const NOTIFY_DEBOUNCE_MINUTES = Number(process.env.NOTIFY_DEBOUNCE_MINUTES) || 45;

// Deletes already-seen OR already-dismissed notifications older than
// NOTIFICATION_RETENTION_DAYS across all members. Runs from the daily cron
// (see api/cron/daily) so the table self-prunes even when nobody opens the
// app. An unread, still-showing reminder (e.g. an unopened goal_due_soon) is
// kept regardless of age — only notifications the member has already seen OR
// dismissed age out. This is also the point where a *dismissed* reminder for
// a condition that is somehow still true (say a punch left open for over a
// week) genuinely gets a fresh notification again — a week of silence is long
// enough that re-reminding is the right call, not a repeat of the bug this
// dismissed_at column exists to fix. Service-role client: a retention sweep
// must reach every member's rows, beyond any one caller's RLS scope.
export async function sweepOldNotifications(): Promise<void> {
  const admin = createAdminClient();
  const cutoffISO = new Date(
    Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  await admin
    .from('notifications')
    .delete()
    .lt('created_at', cutoffISO)
    .or('is_read.eq.true,dismissed_at.not.is.null');
}

// Goal-deadline reminder. Runs on every app load. For each active goal due
// tomorrow or the day after, inserts a one-time notification for each
// assignee (de-duplicated by goal + member so the member only ever sees one
// reminder per goal, regardless of how many times the app is opened).
export async function sweepGoalDeadlines(): Promise<void> {
  const admin = createAdminClient();
  const today = new Date();
  const tomorrow = fmtDate(new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000));
  const dayAfter = fmtDate(new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000));

  const { data: goals } = await admin
    .from('goals')
    .select('id, title, due_date, department')
    .neq('status', 'achieved')
    .neq('status', 'not_met') // settled — no "deadline approaching" nudge
    .in('due_date', [tomorrow, dayAfter]);
  if (!goals || goals.length === 0) return;

  const goalIds = goals.map((g) => g.id);
  const { data: assignees } = await admin
    .from('goal_assignees')
    .select('goal_id, user_id')
    .in('goal_id', goalIds);
  if (!assignees || assignees.length === 0) return;

  // De-duplicate: only one reminder per goal per member, ever.
  const userIds = Array.from(new Set(assignees.map((a) => a.user_id)));
  const { data: existing } = await admin
    .from('notifications')
    .select('user_id, goal_id')
    .eq('type', 'goal_due_soon')
    .in('goal_id', goalIds)
    .in('user_id', userIds);
  const seen = new Set((existing ?? []).map((n) => `${n.user_id}|${n.goal_id}`));

  const goalMap = new Map(goals.map((g) => [g.id, g]));
  const rows: {
    user_id: string;
    type: 'goal_due_soon';
    title: string;
    body: string;
    href: string;
    goal_id: string;
    department: string | null;
  }[] = [];

  for (const a of assignees) {
    const key = `${a.user_id}|${a.goal_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const goal = goalMap.get(a.goal_id)!;
    const daysLeft = goal.due_date === tomorrow ? 1 : 2;
    rows.push({
      user_id: a.user_id,
      type: 'goal_due_soon',
      title: daysLeft === 1 ? 'Task due tomorrow' : 'Task due in 2 days',
      body: goal.title,
      href: `/goals?goal=${a.goal_id}`,
      goal_id: a.goal_id,
      department: goal.department ?? null,
    });
  }
  if (rows.length) {
    await admin.from('notifications').insert(rows);
    // Group by title so members with multiple due goals get one push each.
    const byTitle = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byTitle.get(r.title) ?? [];
      arr.push(r.user_id);
      byTitle.set(r.title, arr);
    }
    for (const [title, ids] of byTitle) {
      after(() => sendPush(ids, { title, body: '', url: '/goals' }, 'goal_due_soon'));
    }
  }
}

// Daily sweep: ping members on a tenure milestone today (bell notification +
// web push). Gentle (plain-month) milestones get the in-app celebration only —
// no ping — so this fires for medium (quarterly) and grand (intern / yearly)
// tiers. The notification links to /dashboard?celebrate=<kind> so opening it
// replays the celebration. De-duped so a member is pinged once per day.
// `onlyUserId` runs the sweep for a single member (used by the manual trigger).
export async function sweepWorkAnniversaries(onlyUserId?: string): Promise<void> {
  const admin = createAdminClient();
  const now = new Date();

  let q = admin
    .from('profiles')
    .select('id, name, role, joined_date, internship_months')
    .eq('is_active', true)
    .is('left_at', null);
  if (onlyUserId) q = q.eq('id', onlyUserId);
  const { data: members } = await q;
  if (!members || members.length === 0) return;

  // Today's milestone for each member, computed once.
  const milestones = members
    .map((m) => ({
      id: m.id,
      ms: milestoneForToday(
        { role: m.role, joined_date: m.joined_date, internship_months: m.internship_months },
        now,
      ),
    }))
    .filter((x): x is { id: string; ms: Milestone } => x.ms !== null);
  if (milestones.length === 0) return;

  // Run-to-completion work (web-push pings) is collected here and awaited at
  // the very end. On Vercel the serverless function is frozen the instant the
  // cron route returns its response, so any fire-and-forget promise gets
  // killed mid-flight.
  const tasks: Promise<unknown>[] = [];

  // 1) Bell + web-push ping for medium/grand tiers (gentle = in-app only).
  //    De-duped so a member is pinged at most once per day.
  const pingable = milestones.filter((x) => milestonePings(x.ms));
  if (pingable.length > 0) {
    const todayStartISO = new Date(istDayStartMs(fmtDate(now))).toISOString();
    const { data: existing } = await admin
      .from('notifications')
      .select('user_id')
      .eq('type', 'work_anniversary')
      .gte('created_at', todayStartISO)
      .in(
        'user_id',
        pingable.map((h) => h.id),
      );
    const seen = new Set((existing ?? []).map((n) => n.user_id));
    const fresh = pingable.filter((h) => !seen.has(h.id));
    if (fresh.length > 0) {
      const rows = fresh.map((h) => ({
        user_id: h.id,
        type: 'work_anniversary' as const,
        title: `${h.ms.label} at Mahesh Chandra & Associates 🎉`,
        body: 'Tap to relive your celebration.',
        href: `/dashboard?celebrate=${h.ms.kind}`,
      }));
      await admin.from('notifications').insert(rows);
      for (const r of rows) {
        tasks.push(sendPush(r.user_id, { title: r.title, body: r.body, url: r.href }, 'work_anniversary'));
      }
    }
  }

  await Promise.allSettled(tasks);
}

// Verification helper: force a milestone ping (notification + push) for one
// member, bypassing the date check. Gated behind the cron route's secret, so
// only the Board (or Vercel) can call it. Used to test the bell/push without
// waiting for a real milestone day.
export async function previewMilestonePing(userId: string, kind: MilestoneKind): Promise<void> {
  const admin = createAdminClient();
  const label =
    kind === 'yearly' ? '1 year' : kind.startsWith('intern') ? 'Month 2 of 3' : '3 months';
  const title = `${label} at Mahesh Chandra & Associates 🎉`;
  const body = 'Tap to relive your celebration.';
  const href = `/dashboard?celebrate=${kind}`;
  await admin.from('notifications').insert({ user_id: userId, type: 'work_anniversary', title, body, href });
  after(() => sendPush(userId, { title, body, url: href }, 'work_anniversary'));
}

// Daily sweep: ping members whose date of birth is today (bell notification +
// web push), so they get their personal reminder regardless of the
// notificationsFull flag (which only hides the bell rendering, not the
// underlying reminder) — same shape as sweepWorkAnniversaries. De-duped so a
// member is pinged once per day.
export async function sweepBirthdays(): Promise<void> {
  const admin = createAdminClient();
  const now = new Date();
  const today = parseDate(fmtDate(now)); // today's IST calendar day

  const { data: members } = await admin
    .from('profiles')
    .select('id, name, date_of_birth')
    .eq('is_active', true)
    .is('left_at', null)
    .not('date_of_birth', 'is', null);
  if (!members || members.length === 0) return;

  const todaysBirthdays = members.filter((m) => {
    if (!m.date_of_birth) return false;
    const b = parseDate(m.date_of_birth);
    return b.getMonth() === today.getMonth() && b.getDate() === today.getDate();
  });
  if (todaysBirthdays.length === 0) return;

  const todayStartISO = new Date(istDayStartMs(fmtDate(now))).toISOString();
  const { data: existing } = await admin
    .from('notifications')
    .select('user_id')
    .eq('type', 'birthday')
    .gte('created_at', todayStartISO)
    .in(
      'user_id',
      todaysBirthdays.map((m) => m.id),
    );
  const seen = new Set((existing ?? []).map((n) => n.user_id));
  const fresh = todaysBirthdays.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return;

  const rows = fresh.map((m) => ({
    user_id: m.id,
    type: 'birthday' as const,
    title: '🎂 Happy Birthday!',
    body: 'The whole team is wishing you a great day.',
    href: '/dashboard',
  }));
  await admin.from('notifications').insert(rows);
  const tasks = rows.map((r) => sendPush(r.user_id, { title: r.title, body: r.body, url: r.href }, 'birthday'));
  await Promise.allSettled(tasks);
}

// ---- punch ----

// Punch in.
export async function punchIn(): Promise<void> {
  const { supabase, userId } = await requireUser();
  const today = fmtDate(new Date());

  // Already on the clock? Any open session counts — including one that began
  // late last night and is still running — so we don't create a duplicate.
  // A stale (forgotten) open punch doesn't block a fresh punch-in.
  const activeCutoffMs = Date.now() - STALE_PUNCH_HOURS * 60 * 60 * 1000;
  const { data: open } = await supabase
    .from('punches')
    .select('id, punch_in')
    .eq('user_id', userId)
    .is('punch_out', null)
    .order('punch_in', { ascending: false })
    .limit(1);
  if (open && open.length && new Date(open[0].punch_in).getTime() >= activeCutoffMs) {
    return; // already punched in
  }
  await supabase.from('punches').insert({
    user_id: userId,
    work_date: today,
    punch_in: new Date().toISOString(),
    punch_out: null,
  });

  // Push to board members (non-blocking — fire and forget).
  const admin = createAdminClient();
  const [{ data: me }, { data: boards }] = await Promise.all([
    supabase.from('profiles').select('name').eq('id', userId).single(),
    admin.from('profiles').select('id').eq('role', 'board').eq('is_active', true).neq('id', userId),
  ]);
  if (boards?.length) {
    const boardIds = boards.map((b) => b.id);
    after(() => sendPush(boardIds, {
      title: `${me?.name ?? 'A teammate'} punched in`,
      body: '',
      url: '/team',
    }));
  }

  revalidatePath('/punch');
  revalidatePath('/dashboard');
}

// Punch out.
export async function punchOut(): Promise<void> {
  const { supabase, userId } = await requireUser();
  // Close the member's current open session — the most recent punch without a
  // punch-out, regardless of which calendar day it began on. This correctly
  // closes a session that was started late last night and crossed midnight.
  const { data: open } = await supabase
    .from('punches')
    .select('id')
    .eq('user_id', userId)
    .is('punch_out', null)
    .order('punch_in', { ascending: false })
    .limit(1);
  if (open && open.length) {
    await supabase
      .from('punches')
      .update({ punch_out: new Date().toISOString() })
      .eq('id', open[0].id);
  }

  // Push to board members (non-blocking).
  const admin = createAdminClient();
  const [{ data: me }, { data: boards }] = await Promise.all([
    supabase.from('profiles').select('name').eq('id', userId).single(),
    admin.from('profiles').select('id').eq('role', 'board').eq('is_active', true).neq('id', userId),
  ]);
  if (boards?.length) {
    const boardIds = boards.map((b) => b.id);
    after(() => sendPush(boardIds, {
      title: `${me?.name ?? 'A teammate'} punched out`,
      body: '',
      url: '/team',
    }));
  }

  revalidatePath('/punch');
  revalidatePath('/dashboard');
}

// ---- logs ----

export async function saveLog(input: {
  date: string;
  mood: string;
  energyLevel: number;
  tags: string[];
  blocks: Block[];
}) {
  const { supabase, userId } = await requireUser();
  await supabase.from('logs').upsert(
    {
      user_id: userId,
      log_date: input.date,
      mood: input.mood,
      energy_level: input.energyLevel,
      tags: input.tags,
      blocks: input.blocks,
      is_draft: false,
      saved_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,log_date' },
  );
  revalidatePath('/log');
  revalidatePath('/log/history');
  revalidatePath('/dashboard');
}

// Deletes the member's log for a given date. RLS scopes this to the owner.
export async function deleteLog(date: string) {
  const { supabase, userId } = await requireUser();
  await supabase.from('logs').delete().eq('user_id', userId).eq('log_date', date);
  revalidatePath('/log');
  revalidatePath('/log/history');
  revalidatePath('/dashboard');
}

// Renames a tag everywhere it appears across the member's own logs (RLS scopes
// this to the owner). Merges into an existing tag of the new name rather than
// creating a duplicate entry on any log that already carries both.
export async function renameTag(oldTag: string, newTag: string) {
  const clean = newTag.trim();
  if (!clean || clean === oldTag) return;
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from('logs')
    .select('id, tags')
    .eq('user_id', userId)
    .contains('tags', [oldTag]);
  await Promise.all(
    (data ?? []).map((row) => {
      const tags = [
        ...new Set((row.tags as string[]).map((t) => (t === oldTag ? clean : t))),
      ];
      return supabase.from('logs').update({ tags }).eq('id', row.id);
    }),
  );
  revalidatePath('/log');
  revalidatePath('/log/history');
}

// Removes a tag everywhere it appears across the member's own logs.
export async function deleteTag(tag: string) {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from('logs')
    .select('id, tags')
    .eq('user_id', userId)
    .contains('tags', [tag]);
  await Promise.all(
    (data ?? []).map((row) => {
      const tags = (row.tags as string[]).filter((t) => t !== tag);
      return supabase.from('logs').update({ tags }).eq('id', row.id);
    }),
  );
  revalidatePath('/log');
  revalidatePath('/log/history');
}

// ---- goals (board only — RLS enforces it) ----

// The RLS-scoped server client, as returned by createClient().
type ServerClient = Awaited<ReturnType<typeof createClient>>;

// Inserts a "goal assigned" notification for each member in `userIds`. The
// notifications table is in the supabase_realtime publication, so each row
// is streamed live to that member's dashboard (see NotificationsBell).
async function notifyAssignees(
  supabase: ServerClient,
  goalId: string,
  goalTitle: string,
  userIds: string[],
) {
  if (!userIds.length) return;
  // Tag the notification with the goal's department so the bell can group it
  // under that department for the Board (see src/lib/notif-sections.ts).
  const { data: goal } = await supabase
    .from('goals')
    .select('department')
    .eq('id', goalId)
    .single();
  await supabase.from('notifications').insert(
    userIds.map((user_id) => ({
      user_id,
      type: 'goal_assigned' as const,
      title: 'New task assigned to you',
      body: goalTitle,
      href: `/goals?goal=${goalId}`,
      goal_id: goalId,
      department: goal?.department ?? null,
    })),
  );
  after(() => sendPush(userIds, { title: 'New task assigned to you', body: goalTitle, url: `/goals?goal=${goalId}` }, 'goal_assigned'));
  after(() => notifyByEmail(userIds, { eventType: 'goal_assigned', title: 'New task assigned to you', body: goalTitle, href: `/goals?goal=${goalId}` }));
}

// Replaces a goal's assignee set with exactly `userIds`, and notifies only
// the members that were NOT already assigned (so re-saving a goal does not
// re-notify everyone). Returns nothing.
async function replaceAssigneesAndNotify(
  supabase: ServerClient,
  goalId: string,
  goalTitle: string,
  userIds: string[],
  assignedBy: string,
) {
  const { data: existing } = await supabase
    .from('goal_assignees')
    .select('user_id')
    .eq('goal_id', goalId);
  const before = new Set((existing ?? []).map((r) => r.user_id));

  await supabase.from('goal_assignees').delete().eq('goal_id', goalId);
  if (userIds.length) {
    await supabase
      .from('goal_assignees')
      .insert(userIds.map((user_id) => ({ goal_id: goalId, user_id, assigned_by: assignedBy })));
  }
  await notifyAssignees(
    supabase,
    goalId,
    goalTitle,
    // Never notify the person doing the assigning about their own name: an
    // executive assigning themselves a task they just wrote does not need to be
    // told about it, and RLS would refuse them the notification row anyway
    // (notifications are Board-insert only).
    userIds.filter((id) => !before.has(id) && id !== assignedBy),
  );
}

// One checklist line as submitted by the goal form. `id` is present for an
// item that already exists in the DB; absent for a freshly-added one.
export interface ChecklistInput {
  id?: string;
  label: string;
  description?: string;
  recurrence: ChecklistRecurrence;
  // Weekdays (0=Sun..6=Sat) for a 'custom' cadence; ignored otherwise.
  recurDays?: number[];
  // When true, this item requires a work report before it can be ticked.
  reportRequired?: boolean;
}

// Syncs a goal's checklist to exactly `items` by diffing against what is
// stored: existing rows are updated in place (so a member's ticked state is
// preserved), removed rows are deleted, new rows are inserted. The progress
// trigger recomputes goals.progress after each change.
async function syncChecklist(
  supabase: ServerClient,
  goalId: string,
  items: ChecklistInput[],
  createdBy: string,
) {
  // Only the SHARED checklist is the form's to rewrite. A member's personal
  // items (owner_id set — migration 0064) never appear in it, so sweeping them
  // into `existing` would make every save of the task silently delete them.
  const { data: existing } = await supabase
    .from('goal_checklist_items')
    .select('id')
    .eq('goal_id', goalId)
    .is('owner_id', null);
  const existingIds = new Set((existing ?? []).map((r) => r.id));
  const keptIds = new Set(items.map((i) => i.id).filter(Boolean) as string[]);

  const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
  if (toDelete.length) {
    await supabase.from('goal_checklist_items').delete().in('id', toDelete);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const recurDays =
      it.recurrence === 'custom' ? (it.recurDays ?? []) : [];
    if (it.id && existingIds.has(it.id)) {
      // label / order / cadence may change; members' completions are stored
      // in a separate table, so an edit never disturbs anyone's ticked state.
      await supabase
        .from('goal_checklist_items')
        .update({
          label: it.label,
          description: it.description ?? '',
          sort_order: i,
          recurrence: it.recurrence,
          recur_days: recurDays,
          report_required: !!it.reportRequired,
        })
        .eq('id', it.id);
    } else {
      await supabase
        .from('goal_checklist_items')
        .insert({
          goal_id: goalId,
          label: it.label,
          description: it.description ?? '',
          sort_order: i,
          recurrence: it.recurrence,
          recur_days: recurDays,
          report_required: !!it.reportRequired,
          // The form writes the SHARED checklist — owed by everyone on the
          // task. Personal items come in through addPersonalChecklistItem.
          owner_id: null,
          created_by: createdBy,
        });
    }
  }
}

// Replaces a goal's assignee set with exactly `userIds` (delete-all + insert).
// Open to the Board and to a Manager for goals in the department they head —
// RLS on goal_assignees enforces the manager's department/team scope.
export async function setGoalAssignees(
  goalId: string,
  userIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  // A task always keeps an owner (see goalOwnershipError). This is the third
  // way to reach zero — the handoff dialog, where a leaving member's tasks are
  // passed on: they must be passed TO someone, not just taken away.
  if (userIds.length === 0) {
    return { ok: false, error: 'Assign at least one member to this task.' };
  }
  const { data: goal } = await supabase
    .from('goals')
    .select('title')
    .eq('id', goalId)
    .single();
  await replaceAssigneesAndNotify(supabase, goalId, goal?.title ?? 'a task', userIds, userId);
  // Changing who owns a task is a real edit of it — same stamp updateGoal makes.
  await supabase
    .from('goals')
    .update({ updated_at: new Date().toISOString(), updated_by: userId })
    .eq('id', goalId);
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}

// ── Who is acting on this task? (migration 0064) ────────────────────────────
// The Board and Department Managers manage other people's work. Everybody else
// — the Executives — manages only their own: a task they create must land on
// themselves and nobody else, and the only tasks they may edit are the ones
// they created. RLS holds the same line in the database, but a server action is
// a public endpoint: the form only ever offers an executive their own name, and
// this is what makes that true rather than merely displayed.
async function taskActor(supabase: ServerClient, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('role, is_manager')
    .eq('id', userId)
    .single();
  // A Founder is Board-level even if the role column were somehow wrong.
  const isBoard =
    data?.role === 'board' || (FOUNDER_USER_IDS as readonly string[]).includes(userId);
  const isMgr = !isBoard && !!data?.is_manager;
  return { isBoard, isMgr, selfOnly: !isBoard && !isMgr };
}

// The one assignee an executive is allowed to name is themselves. Returns the
// complaint, or null when the set is acceptable.
function selfAssignError(userId: string, assigneeIds: string[]): string | null {
  if (assigneeIds.length !== 1 || assigneeIds[0] !== userId) {
    return 'You can only create tasks assigned to yourself.';
  }
  return null;
}

// Every task must land on a department AND on at least one member. An
// assignee-less task is one nobody can complete: toggle_checklist_item lets
// only a named assignee tick the checklist (falling back, on the legacy
// unassigned tasks that predate this rule, to members of the task's own
// department), so an unassigned task surfaces in people's "Your day" and then
// refuses every tick. GoalForm blocks this in the UI; this is the real guard.
//
// It lives here rather than in the database because assignees sit in a child
// table written after the goals row — no NOT NULL/CHECK can express it, and a
// deferred constraint trigger is more machinery than the rule is worth.
// Returns the complaint, or null when the task is properly owned.
function goalOwnershipError(departments: string[], assigneeIds: string[]): string | null {
  if (!departments.some((d) => d.trim())) return 'Pick a department for this task.';
  if (assigneeIds.length === 0) return 'Assign at least one member to this task.';
  return null;
}

export async function createGoal(input: {
  level: GoalLevel;
  title: string;
  description: string;
  dueDate: string;
  department: string;
  // Every department the goal spans; defaults to [department]. departments[0]
  // is the primary and is mirrored into the `department` column.
  departments?: string[];
  status: 'inactive' | 'active' | 'achieved' | 'not_met';
  progress: number;
  parentId: string | null;
  assigneeIds?: string[];
  checklist?: ChecklistInput[];
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  const departments =
    input.departments && input.departments.length ? input.departments : [input.department];
  const assigneeIds = input.assigneeIds ?? [];
  // Refuse the task outright rather than creating one nobody can complete.
  const ownership = goalOwnershipError(departments, assigneeIds);
  if (ownership) return { ok: false, error: ownership };
  const actor = await taskActor(supabase, userId);
  if (actor.selfOnly) {
    const selfErr = selfAssignError(userId, assigneeIds);
    if (selfErr) return { ok: false, error: selfErr };
  }
  const { count } = await supabase.from('goals').select('*', { count: 'exact', head: true });
  const hasChecklist = !!input.checklist && input.checklist.length > 0;
  const { data: created, error: createError } = await supabase
    .from('goals')
    .insert({
      level: input.level,
      title: input.title,
      description: input.description,
      due_date: input.dueDate,
      // Keep the single column as the primary (element 0) for back-compat.
      department: departments[0],
      departments,
      status: input.status,
      // A goal with a checklist starts at 0% — the progress trigger takes
      // over the moment its items are inserted below.
      progress: hasChecklist ? 0 : input.progress,
      parent_id: input.parentId,
      sort_order: count ?? 0,
      created_by: userId,
    })
    .select('id')
    .single();
  if (createError || !created) {
    return { ok: false, error: createError?.message || 'Could not create the task.' };
  }
  const { error: assignError } = await supabase
    .from('goal_assignees')
    .insert(
      assigneeIds.map((user_id) => ({
        goal_id: created.id,
        user_id,
        assigned_by: userId,
      })),
    );
  // The assignees are the point — a task whose assignee insert was refused (RLS
  // on an out-of-scope member, say) would be exactly the unassigned task this
  // rule exists to prevent, so take the goal row back out rather than leave one.
  if (assignError) {
    await supabase.from('goals').delete().eq('id', created.id);
    return { ok: false, error: assignError.message };
  }
  // Every assignee on a brand-new goal is new — notify all of them except the
  // author (see replaceAssigneesAndNotify for why).
  await notifyAssignees(
    supabase,
    created.id,
    input.title,
    assigneeIds.filter((id) => id !== userId),
  );
  if (hasChecklist) {
    await syncChecklist(supabase, created.id, input.checklist!, userId);
  }
  // An executive self-assigning work is the one creation leadership does not
  // already know about, so their Director is told. A Board or Manager creating
  // a task is the normal course of things and stays silent.
  if (actor.selfOnly) {
    after(() => notifyLeadershipOfMemberTask(created.id, userId));
  }
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}

// "<name> created a task for themselves" — delivered to the member's own
// Director (the Founder-assigned director_id from 0061), falling back to the
// Founders when nobody has been assigned to them yet, so this never lands
// nowhere. Goes through the admin client because the notifications table is
// Board-insert only and the member who triggered it is, by definition, not.
async function notifyLeadershipOfMemberTask(goalId: string, memberId: string) {
  const admin = createAdminClient();
  const [{ data: goal }, { data: member }] = await Promise.all([
    admin.from('goals').select('id, title, department').eq('id', goalId).single(),
    admin.from('profiles').select('name, director_id').eq('id', memberId).single(),
  ]);
  if (!goal) return;
  const memberName = member?.name ?? 'A team member';

  const recipientIds = new Set<string>();
  if (member?.director_id) recipientIds.add(member.director_id);
  else for (const id of FOUNDER_USER_IDS) recipientIds.add(id);
  recipientIds.delete(memberId);
  const ids = Array.from(recipientIds);
  if (!ids.length) return;

  const title = `${memberName} created a task`;
  const body = goal.title;
  await admin.from('notifications').insert(
    ids.map((user_id) => ({
      user_id,
      type: 'member_task_created' as NotificationType,
      title,
      body,
      href: `/goals?goal=${goal.id}`,
      goal_id: goal.id,
      department: goal.department ?? null,
    })),
  );
  after(() =>
    sendPush(ids, { title, body, url: `/goals?goal=${goal.id}` }, 'member_task_created'),
  );
}

export async function updateGoal(
  id: string,
  patch: Partial<{
    level: GoalLevel;
    title: string;
    description: string;
    due_date: string;
    department: string;
    // Multi-department goals: when provided, the primary (element 0) is also
    // written back into the single `department` column.
    departments: string[];
    status: 'inactive' | 'active' | 'achieved' | 'not_met';
    progress: number;
    parent_id: string | null;
  }>,
  assigneeIds?: string[],
  checklist?: ChecklistInput[],
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  // Same ownership rule as createGoal — an edit must not be able to strip a
  // task back down to no department or no assignee. Each half is checked only
  // when this call actually supplies it, so the status-only callers (which pass
  // neither) are untouched.
  const editedDepts =
    patch.departments ?? (patch.department === undefined ? null : [patch.department]);
  if (editedDepts && !editedDepts.some((d) => d.trim())) {
    return { ok: false, error: 'Pick a department for this task.' };
  }
  if (assigneeIds && assigneeIds.length === 0) {
    return { ok: false, error: 'Assign at least one member to this task.' };
  }
  // An executive edits the tasks they created, and only those — and an edit can
  // never hand the work to somebody else. RLS refuses both anyway; checking
  // here is what turns a silent refusal into a sentence the member can read.
  const actor = await taskActor(supabase, userId);
  if (actor.selfOnly) {
    const { data: existing } = await supabase
      .from('goals')
      .select('created_by')
      .eq('id', id)
      .single();
    if (!existing || existing.created_by !== userId) {
      return { ok: false, error: 'You can only edit tasks you created yourself.' };
    }
    if (assigneeIds) {
      const selfErr = selfAssignError(userId, assigneeIds);
      if (selfErr) return { ok: false, error: 'You can only assign this task to yourself.' };
    }
  }
  // When the goal has a checklist, its progress is owned by the trigger —
  // don't let a stale slider value from the form overwrite it.
  const finalPatch = { ...patch };
  if (checklist && checklist.length > 0) delete finalPatch.progress;
  // Keep the primary department column in sync with the departments array.
  if (finalPatch.departments && finalPatch.departments.length) {
    finalPatch.department = finalPatch.departments[0];
  }
  // Stamp the edit. This is the ONLY place that moves updated_at: a member
  // ticking a checklist item, the progress trigger and the deadline sweep all
  // leave it alone, so the card's "Edited" line means the task itself changed —
  // not that somebody did the day's work on it.
  const stamped = {
    ...finalPatch,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { error: updateError } = await supabase.from('goals').update(stamped).eq('id', id);
  if (updateError) return { ok: false, error: updateError.message };
  if (checklist) {
    await syncChecklist(supabase, id, checklist, userId);
  }
  if (assigneeIds) {
    const { data: goal } = await supabase
      .from('goals')
      .select('title')
      .eq('id', id)
      .single();
    await replaceAssigneesAndNotify(supabase, id, goal?.title ?? 'a task', assigneeIds, userId);
  }
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteGoal(id: string) {
  const { supabase } = await requireUser();
  await supabase.from('goals').delete().eq('id', id);
  revalidatePath('/goals');
}

// ── Bulk Goals cleanup (Board only; enforced by the goals RLS policies) ──────

// Soft-archive: hide the goals from every live view (cascade/dashboard/team/
// analytics) but keep the rows so they can be restored later. Reversible.
export async function archiveGoals(ids: string[]) {
  if (ids.length === 0) return;
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from('goals')
    .update({ archived_at: new Date().toISOString(), archived_by: userId })
    .in('id', ids);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
  revalidatePath('/dashboard');
}

// Restore archived goals back into the live cascade.
export async function restoreGoals(ids: string[]) {
  if (ids.length === 0) return;
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('goals')
    .update({ archived_at: null, archived_by: null })
    .in('id', ids);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
  revalidatePath('/dashboard');
}

// Permanently delete goals. By FK cascade this also removes their checklist
// items, per-member completions, work reports (+ reviews), assignees, pins and
// notifications. Child goals' parent_id is set null (they are NOT deleted).
// Irreversible — the UI exports a backup and requires a typed confirmation.
export async function deleteGoals(ids: string[]) {
  if (ids.length === 0) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.from('goals').delete().in('id', ids);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
  revalidatePath('/dashboard');
}

export async function saveCompany(mission: string, vision: string) {
  const { supabase, userId } = await requireUser();
  await supabase
    .from('company')
    .update({ mission, vision, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', 1);
  revalidatePath('/goals');
}

// Ticks / unticks a checklist item. Any member the goal is visible to may
// call this — the toggle_checklist_item DB function checks that and updates
// the row; the progress trigger then recomputes the goal's percentage.
export async function toggleChecklistItem(itemId: string, done: boolean) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc('toggle_checklist_item', {
    p_item_id: itemId,
    p_done: done,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
  revalidatePath('/dashboard');
}

// ---- personal checklist items (migration 0064) ----

// A member adds a step to their OWN list on a task they are a participant on —
// including a task a Director assigned them. The item is theirs alone: nobody
// else sees it, nobody else can tick it, and — deliberately — not even they can
// remove it afterwards. Once you have written down that you owe a piece of
// work, taking it back off the list is a Founder's or Director's call, which is
// why there is an add and a rename here but no delete.
//
// owner_id and created_by are both stamped server-side rather than accepted
// from the caller: the "checklist: board insert" policy in 0064 pins both to
// auth.uid(), so a request naming anyone else is refused by the database too.
// A rich-text field the member opened and left empty still comes back as markup
// ("<p><br></p>"). Store '' for those, so a blank description doesn't reopen the
// editor next time the step is edited and doesn't render an empty paragraph.
function normalizeRichText(html: string): string {
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return text ? html : '';
}

export async function addPersonalChecklistItem(
  goalId: string,
  label: string,
  description = '',
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  const text = label.trim();
  if (!text) return { ok: false, error: 'Give the step a name first.' };
  // Executives only. A Director or Manager assigned to the task edits its real
  // checklist instead — giving them a second, private list would split the
  // record of the same work in two. RLS is deliberately wider than this (it
  // allows any participant), so this action is where the rule actually lives.
  const actor = await taskActor(supabase, userId);
  if (!actor.selfOnly) {
    return {
      ok: false,
      error: 'Add this step to the task checklist itself — you can edit it directly.',
    };
  }

  // Sort new personal items after everything already on the task, so the
  // Board's own checklist keeps the order it was written in.
  const { data: last } = await supabase
    .from('goal_checklist_items')
    .select('sort_order')
    .eq('goal_id', goalId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextOrder = (last?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase.from('goal_checklist_items').insert({
    goal_id: goalId,
    label: text,
    description: normalizeRichText(description),
    sort_order: nextOrder,
    // A member's own step is a plain one-off: cadences and the Report Work gate
    // stay the Board's tools for the work they hand out.
    recurrence: 'once',
    recur_days: [],
    report_required: false,
    owner_id: userId,
    created_by: userId,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes('row-level security')
        ? 'You can only add steps to a task you are assigned to.'
        : error.message,
    };
  }
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}

// Fix a typo in your own step. Scoped to owner_id = the caller in both the
// query and the RLS policy, so this can only ever reach an item the member
// added themselves — never a Board-assigned one, and never a teammate's.
export async function updatePersonalChecklistItem(
  itemId: string,
  label: string,
  description = '',
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  const text = label.trim();
  if (!text) return { ok: false, error: 'Give the step a name first.' };
  const { error } = await supabase
    .from('goal_checklist_items')
    .update({ label: text, description: normalizeRichText(description) })
    .eq('id', itemId)
    .eq('owner_id', userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}

// ---- work reports (Report Work) ----

// A member submits (or edits) their work report for a checklist item on a given
// day. `reportDate` is the member's local (IST) calendar day so it lines up with
// the "due today" checklist logic. Upserts on (item_id, user_id, report_date) so
// re-submitting the same day edits the existing report. RLS limits writes to the
// caller's own rows.
//
// The upsert AND the checklist tick happen together in one DB function
// (submit_work_report) rather than as two separate client round-trips — that
// used to let the report save while the tick silently failed (or the reverse),
// so the member saw the completion celebration without the task actually
// ticking, and had to submit a second time to get it to register.
export async function submitWorkReport(
  itemId: string,
  body: string,
  reportDate: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return { ok: false, error: 'Invalid report date.' };
  }
  const { error } = await supabase.rpc('submit_work_report', {
    p_item_id: itemId,
    p_body: body,
    p_report_date: reportDate,
  });
  if (error) return { ok: false, error: error.message };
  // Ping reviewers on every submit — new reports and edits/resubmits alike — so
  // managers and the Board always see the latest version is ready to review.
  after(() => notifyReviewersOfReport(itemId, userId));
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}

// Tells the people who review a member's work — the Board plus the Manager(s) of
// the goal's department ONLY (department-wise) — that a report is ready to
// review. Goes through the admin client: a member can't write another user's
// notification under the is_board()-only notifications RLS. Best-effort.
async function notifyReviewersOfReport(itemId: string, submitterId: string) {
  const admin = createAdminClient();
  const { data: item } = await admin
    .from('goal_checklist_items')
    .select('goal_id')
    .eq('id', itemId)
    .single();
  if (!item) return;
  const { data: goal } = await admin
    .from('goals')
    .select('id, title, department')
    .eq('id', item.goal_id)
    .single();
  if (!goal) return;
  const { data: submitter } = await admin
    .from('profiles')
    .select('name')
    .eq('id', submitterId)
    .single();
  const memberName = submitter?.name ?? 'A team member';

  // Board (everything) + every Manager, regardless of which department they
  // head — managers are kept in the loop on all work reports across the company.
  const [{ data: board }, { data: managers }] = await Promise.all([
    admin.from('profiles').select('id').eq('role', 'board'),
    admin.from('profiles').select('id').eq('is_manager', true),
  ]);
  const recipientIds = new Set<string>([
    ...(board ?? []).map((p) => p.id),
    ...(managers ?? []).map((p) => p.id),
  ]);
  recipientIds.delete(submitterId); // never notify yourself
  const ids = Array.from(recipientIds);
  if (!ids.length) return;

  const title = 'Work report ready to review';
  const body = `${memberName} reported on “${goal.title}”`;

  // Debounce burst edits: a member resubmitting/editing the same report within
  // NOTIFY_DEBOUNCE_MINUTES should not re-ping every reviewer. Keyed on the goal
  // + the exact body (which carries this member's name), so a different member
  // reporting on the same goal still notifies. The first submit always pings.
  const debounceSinceISO = new Date(
    Date.now() - NOTIFY_DEBOUNCE_MINUTES * 60 * 1000,
  ).toISOString();
  const { data: recent } = await admin
    .from('notifications')
    .select('id')
    .eq('type', 'work_report_submitted')
    .eq('goal_id', goal.id)
    .eq('body', body)
    .gte('created_at', debounceSinceISO)
    .limit(1);
  if (recent && recent.length) return;

  await admin.from('notifications').insert(
    ids.map((user_id) => ({
      user_id,
      type: 'work_report_submitted' as const,
      title,
      body,
      href: `/goals?goal=${goal.id}`,
      goal_id: goal.id,
      department: goal.department ?? null,
    })),
  );
  after(() => sendPush(ids, { title, body, url: `/goals?goal=${goal.id}` }, 'work_report_submitted'));
}

// A Manager / Board Member rates (1-5) and comments a member's work report.
// One editable review per (report, reviewer) — re-reviewing edits in place. RLS
// limits this to the Board (any report) or a Manager whose managed department
// matches the report's goal. On success the report's owner is notified (and a
// 5-star review is flagged so the member's card can celebrate).
export async function submitWorkReportReview(
  reportId: string,
  stars: number,
  comment: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return { ok: false, error: 'Pick a rating from 1 to 5 stars.' };
  }
  const { error } = await supabase.from('goal_work_report_reviews').upsert(
    {
      report_id: reportId,
      reviewer_id: userId,
      stars,
      comment,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'report_id,reviewer_id' },
  );
  if (error) return { ok: false, error: error.message };
  after(() => notifyReportOwnerOfReview(reportId, userId, stars));
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  return { ok: true };
}

// Notifies the member whose report was just reviewed. Admin client (the reviewer
// can't write the member's notification row). A self-review (reviewer == owner)
// is silent. Best-effort.
async function notifyReportOwnerOfReview(
  reportId: string,
  reviewerId: string,
  stars: number,
) {
  const admin = createAdminClient();
  const { data: report } = await admin
    .from('goal_work_reports')
    .select('user_id, item_id')
    .eq('id', reportId)
    .single();
  if (!report || report.user_id === reviewerId) return;
  const { data: item } = await admin
    .from('goal_checklist_items')
    .select('goal_id')
    .eq('id', report.item_id)
    .single();
  const { data: goal } = item
    ? await admin.from('goals').select('id, title, department').eq('id', item.goal_id).single()
    : { data: null as { id: string; title: string; department: string | null } | null };
  const goalTitle = goal?.title ?? 'your task';
  const top = stars === 5;
  const title = top ? '⭐ Top marks on your work!' : 'Your work was reviewed';
  const body = top
    ? `You earned 5 stars on “${goalTitle}”.`
    : `${stars}/5 stars on “${goalTitle}”.`;
  // Deep-link straight to the reviewed goal so the member lands on the card
  // that now shows the reviewer's stars + comment (see MemberGoalFeedback).
  const href = goal ? `/goals?goal=${goal.id}` : '/goals';
  await admin.from('notifications').insert({
    user_id: report.user_id,
    type: 'work_report_reviewed' as const,
    title,
    body,
    href,
    goal_id: goal?.id ?? null,
    department: goal?.department ?? null,
  });
  after(() => sendPush(report.user_id, { title, body, url: href }, 'work_report_reviewed'));
}

// Board saves (or clears) a department's reporting template. Upserts the row so
// members see the latest guidance when they open the report editor.
export async function saveReportTemplate(department: string, body: string) {
  const { supabase, userId } = await requireBoard();
  const dept = department.trim();
  if (!dept) throw new Error('Missing department.');
  const { error } = await supabase
    .from('report_templates')
    .upsert(
      { department: dept, body, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'department' },
    );
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

// ---- goal templates (board only — shared library) ----

// Board saves a goal blueprint to the shared DB library. `checklist` is stored
// as JSONB (an array of TemplateChecklistRow shapes).
export async function createGoalTemplate(input: {
  name: string;
  level: GoalLevel;
  department: string;
  title: string;
  description: string;
  checklist: {
    label: string;
    description: string;
    recurrence: ChecklistRecurrence;
    recurDays: number[];
    reportRequired: boolean;
  }[];
}) {
  const { supabase, userId } = await requireBoard();
  const { error } = await supabase.from('goal_templates').insert({
    name: input.name,
    level: input.level,
    department: input.department,
    title: input.title,
    description: input.description,
    checklist: input.checklist,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

// Board removes a goal blueprint from the shared library.
export async function deleteGoalTemplate(id: string) {
  const { supabase } = await requireBoard();
  const { error } = await supabase.from('goal_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

// ── Per-user Goals navigation prefs (migration 0036) ────────────────────────
// Pins and saved views are private to the caller; RLS (user_id = auth.uid())
// is the real guard, we just stamp user_id so the row is owned correctly.

// Pin a goal to the top of the user's Goals browser.
export async function addGoalPin(goalId: string) {
  const { supabase, userId } = await requireUser();
  // Idempotent: re-pinning is a no-op (PK is (user_id, goal_id)).
  const { error } = await supabase
    .from('goal_pins')
    .upsert({ user_id: userId, goal_id: goalId }, { onConflict: 'user_id,goal_id' });
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

export async function removeGoalPin(goalId: string) {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from('goal_pins')
    .delete()
    .eq('user_id', userId)
    .eq('goal_id', goalId);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

// Save the current Goals browser state (view + grouping + sort + filters) as a
// named preset the user can re-apply later.
export async function createSavedView(name: string, config: GoalViewConfig) {
  const { supabase, userId } = await requireUser();
  const clean = name.trim();
  if (!clean) throw new Error('Give the view a name.');
  const { error } = await supabase
    .from('goal_saved_views')
    .insert({ user_id: userId, name: clean, config });
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

export async function deleteSavedView(id: string) {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from('goal_saved_views')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

// Board hand-off helper: a member's still-open (not-achieved) assigned goals,
// plus the active teammates they could be reassigned to. Used by the
// reassign-on-leave prompt and the offboarding hand-off so a person going on
// leave / leaving the org doesn't silently leave goals stranded.
export async function loadMemberGoalsForHandoff(memberId: string): Promise<{
  goals: { id: string; title: string; level: string; department: string; assigneeIds: string[] }[];
  members: { id: string; name: string; department: string; avatar_url: string | null }[];
  names: Record<string, string>;
}> {
  await requireBoard();
  const { supabase } = await requireUser();
  const { data: mine } = await supabase
    .from('goal_assignees')
    .select('goal_id')
    .eq('user_id', memberId);
  const goalIds = Array.from(new Set((mine ?? []).map((r) => r.goal_id)));
  if (goalIds.length === 0) return { goals: [], members: [], names: {} };

  const { data: goals } = await supabase
    .from('goals')
    .select('id, title, level, department, status')
    .in('id', goalIds)
    .neq('status', 'achieved')
    .neq('status', 'not_met'); // settled outcomes drop out of the live handoff
  const liveIds = (goals ?? []).map((g) => g.id);

  const { data: asg } = liveIds.length
    ? await supabase.from('goal_assignees').select('goal_id, user_id').in('goal_id', liveIds)
    : { data: [] as { goal_id: string; user_id: string }[] };
  const assigneeIdsByGoal: Record<string, string[]> = {};
  for (const a of asg ?? []) (assigneeIdsByGoal[a.goal_id] ??= []).push(a.user_id);

  // Active teammates (names + departments) via service role — profiles RLS would
  // otherwise hide other members' rows.
  const admin = createAdminClient();
  const { data: profs } = await admin
    .from('profiles')
    .select('id, name, department, avatar_url')
    .eq('is_active', true)
    .is('left_at', null);
  const members = (profs ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    department: p.department,
    avatar_url: p.avatar_url,
  }));
  const names: Record<string, string> = {};
  for (const p of profs ?? []) names[p.id] = p.name;

  return {
    goals: (goals ?? []).map((g) => ({
      id: g.id,
      title: g.title,
      level: g.level,
      department: g.department,
      assigneeIds: assigneeIdsByGoal[g.id] ?? [],
    })),
    members,
    names,
  };
}

// ---- notifications ----

// Dismisses one of the caller's notifications — the (×) button in the bell
// dropdown. A soft dismiss (dismissed_at), NOT a delete: the row has to stay
// so the daily sweeps (sweepMissedPunchOuts / sweepGoalDeadlines / etc. below)
// still see it and never mistake a dismissed-but-still-true reminder for a
// fresh one. Hard-deleting used to erase that memory, which is why clearing a
// reminder for a still-unfixed problem (an open punch session, say) made it
// come right back on the very next page load. RLS "update own" policy
// prevents touching another member's notifications.
export async function deleteNotification(id: string) {
  const { supabase, userId } = await requireUser();
  await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
}

// Dismisses ALL of the caller's notifications — the "Clear all" control in the
// bell and the Notifications page. Same soft-dismiss as deleteNotification,
// same reason. RLS scopes the update to the owner, so a member can only ever
// clear their own.
export async function clearNotifications() {
  const { supabase, userId } = await requireUser();
  await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('dismissed_at', null);
}

// Sets one channel (in-app bell or web-push) on/off for one notification type
// for the caller. Upsert keeps a single row per (user, type): on first change
// the unset channel takes its default (on); later changes touch only the named
// channel, leaving the other as stored. RLS scopes this to the owner.
export async function setNotificationPref(
  type: NotificationType,
  channel: 'in_app' | 'push',
  enabled: boolean,
) {
  const { supabase, userId } = await requireUser();
  await supabase
    .from('notification_prefs')
    .upsert(
      { user_id: userId, type, [channel]: enabled },
      { onConflict: 'user_id,type' },
    );
  revalidatePath('/settings');
}

// Marks the caller's notifications as read. Pass specific ids, or omit to
// mark every still-unread notification read. RLS scopes this to the owner.
export async function markNotificationsRead(ids?: string[]) {
  const { supabase, userId } = await requireUser();
  let q = supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId);
  q = ids && ids.length ? q.in('id', ids) : q.eq('is_read', false);
  await q;
}

// Posts a wish on a teammate's birthday card, or (when `parentId` is given) a
// reply. Re-checks that it's actually the celebrant's birthday today
// server-side — never trust the client on which day it is.
export async function sendBirthdayWish(celebrantId: string, message: string) {
  const { supabase, userId } = await requireUser();
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Write a message first.');
  if (trimmed.length > 240) throw new Error('Keep it under 240 characters.');

  const { data: bday } = await supabase
    .from('profiles')
    .select('date_of_birth')
    .eq('id', celebrantId)
    .single();
  if (!bday?.date_of_birth) throw new Error('Not a birthday today.');
  const today = parseDate(fmtDate(new Date()));
  const b = parseDate(bday.date_of_birth);
  if (b.getMonth() !== today.getMonth() || b.getDate() !== today.getDate()) {
    throw new Error('Not a birthday today.');
  }

  await supabase.from('birthday_wishes').insert({
    birthday_user_id: celebrantId,
    author_id: userId,
    message: trimmed,
  });
}

// The celebrant replies to one wish addressed to them. The reply is stored
// privately on that same row (reply_message/reply_created_at) and delivered
// to the original sender ONLY as a notification — it's never posted where
// anyone else can read it. RLS ("birthday_wishes: celebrant replies") backs
// the ownership check below.
export async function replyToBirthdayWish(wishId: string, message: string) {
  const { supabase, userId } = await requireUser();
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Write a reply first.');
  if (trimmed.length > 240) throw new Error('Keep it under 240 characters.');

  const { data: wish } = await supabase
    .from('birthday_wishes')
    .select('id, birthday_user_id, author_id')
    .eq('id', wishId)
    .single();
  if (!wish || wish.birthday_user_id !== userId) {
    throw new Error('You can only reply to wishes sent to you.');
  }

  await supabase
    .from('birthday_wishes')
    .update({ reply_message: trimmed, reply_created_at: new Date().toISOString() })
    .eq('id', wishId);

  const admin = createAdminClient();
  const { data: me } = await supabase.from('profiles').select('name').eq('id', userId).single();
  const title = `${me?.name ?? 'They'} replied to your birthday wish`;
  const href = '/dashboard';
  await admin.from('notifications').insert({
    user_id: wish.author_id,
    type: 'birthday_wish_reply',
    title,
    body: trimmed,
    href,
  });
  after(() => sendPush(wish.author_id, { title, body: trimmed, url: href }, 'birthday_wish_reply'));
}

// ---- leaves ----

// Human-friendly date range for a leave notification body.
function leaveRange(start: string, end: string, isHalfDay: boolean): string {
  if (start === end) return isHalfDay ? `${start} (half day)` : start;
  return `${start} – ${end}`;
}

export async function createLeave(input: {
  type: 'casual' | 'sick' | 'emergency' | 'wfh';
  startDate: string;
  endDate: string;
  reason: string;
  isHalfDay: boolean;
}) {
  const { supabase, userId } = await requireUser();
  const { data: created } = await supabase.from('leaves').insert({
    user_id: userId,
    type: input.type,
    start_date: input.startDate,
    end_date: input.endDate,
    reason: input.reason,
    is_half_day: input.isHalfDay,
    status: 'pending',
  }).select('id').single();
  const leaveHref = created ? `/leaves?leave=${created.id}` : '/leaves';

  // Notify the Founders only — not every Director — with a popup + chime via
  // Realtime. A Director can still open /leaves and act on a pending request
  // if they come across one (reviewLeave has no role check beyond "some kind
  // of Board Member"), but the proactive "you have something to review" ping
  // is deliberately scoped down to the two Founders. RLS only allows board
  // callers to insert into `notifications`; leaves are created by non-board
  // members too, so use the service-role client.
  const admin = createAdminClient();
  const { data: me } = await admin.from('profiles').select('name').eq('id', userId).single();
  // Never notify the requester about their own request — a Founder applying
  // for leave can't review it (see reviewLeave below), so pinging them to
  // "review" their own submission would be both noisy and wrong.
  const reviewers = (FOUNDER_USER_IDS as readonly string[])
    .filter((id) => id !== userId)
    .map((id) => ({ id }));
  if (reviewers.length) {
    const range = leaveRange(input.startDate, input.endDate, input.isHalfDay);
    const leaveTitle = `${me?.name ?? 'A teammate'} requested leave`;
    const leaveBody = `${input.type.toUpperCase()} · ${range}`;
    await admin.from('notifications').insert(
      reviewers.map((b) => ({
        user_id: b.id,
        type: 'leave_requested',
        title: leaveTitle,
        body: leaveBody,
        href: leaveHref,
      })),
    );
    const boardIds = reviewers.map((b) => b.id);
    after(() => sendPush(boardIds, { title: leaveTitle, body: leaveBody, url: leaveHref }, 'leave_requested'));
  }

  revalidatePath('/leaves');
  revalidatePath('/dashboard');
}

export async function reviewLeave(
  leaveId: string,
  status: 'approved' | 'rejected',
  note?: string,
) {
  const { supabase, userId } = await requireBoard();
  const founder = (FOUNDER_USER_IDS as readonly string[]).includes(userId);
  const comment = (note ?? '').trim();

  const { data: leave } = await supabase
    .from('leaves')
    .select('*')
    .eq('id', leaveId)
    .single();
  if (!leave) return;

  // A Board Member can never review their own leave request — accepting or
  // finalising your own time off isn't a real review. Someone else on the
  // Board (another Director, or the other Founder) has to do it.
  if (leave.user_id === userId) throw new Error('You cannot review your own leave request');

  // A Board Member who is NOT the Founder can only *accept* a request — that
  // records a pre-approval and pings the Founder for the final say. The
  // request stays pending until the Founder finalises it. (Rejections are
  // final for any Board Member.) The optional comment is stored either way.
  if (status === 'approved' && !founder) {
    await supabase
      .from('leaves')
      .update({
        pre_approved_by: userId,
        pre_approved_at: new Date().toISOString(),
        ...(comment ? { review_note: comment } : {}),
      })
      .eq('id', leaveId);

    const { data: acceptor } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .single();
    {
      // If the requester is themselves a Founder, they can't finalise their
      // own (now-accepted) leave — exclude them so only the OTHER Founder
      // gets pinged to act.
      const founderReviewers = (FOUNDER_USER_IDS as readonly string[]).filter(
        (id) => id !== leave.user_id,
      );
      const body = `Needs your final approval · ${(leave.type as string).toUpperCase()} · ${leaveRange(leave.start_date, leave.end_date, !!leave.is_half_day)}${comment ? ` · "${comment}"` : ''}`;
      const href = `/leaves?leave=${leaveId}`;
      const title = `${acceptor?.name ?? 'A Board Member'} accepted a leave`;
      await supabase.from('notifications').insert(
        founderReviewers.map((id) => ({
          user_id: id,
          type: 'leave_requested',
          title,
          body,
          href,
        })),
      );
      after(() => sendPush(
        founderReviewers,
        { title, body, url: href },
        'leave_requested',
      ));
    }

    revalidatePath('/leaves');
    revalidatePath('/dashboard');
    return;
  }

  // Founder finalising an approval, or any Board Member rejecting.
  await supabase
    .from('leaves')
    .update({ status, reviewed_by: userId, review_note: comment })
    .eq('id', leaveId);

  // Note: leave balances are derived per quarter from approved leaves
  // (see leaveUsage in queries.ts), so there is no stored counter to decrement.

  // Notify the requester, including the Board's comment when one was left.
  // Board calls this, so the regular RLS-scoped client can insert.
  const leaveTitle = status === 'approved' ? 'Your leave was approved' : 'Your leave was declined';
  const leaveBody = `${(leave.type as string).toUpperCase()} · ${leaveRange(leave.start_date, leave.end_date, !!leave.is_half_day)}${comment ? ` · "${comment}"` : ''}`;
  const reqHref = `/leaves?leave=${leaveId}`;
  await supabase.from('notifications').insert({
    user_id: leave.user_id,
    type: status === 'approved' ? 'leave_approved' : 'leave_rejected',
    title: leaveTitle,
    body: leaveBody,
    href: reqHref,
  });
  after(() => sendPush(
    leave.user_id,
    { title: leaveTitle, body: leaveBody, url: reqHref },
    status === 'approved' ? 'leave_approved' : 'leave_rejected',
  ));
  after(() => notifyByEmail([leave.user_id], {
    eventType: status === 'approved' ? 'leave_approved' : 'leave_rejected',
    title: leaveTitle,
    body: leaveBody,
    href: reqHref,
  }));

  revalidatePath('/leaves');
  revalidatePath('/dashboard');
}

// Founder-only: permanently delete a leave log. Other Board Members review
// requests; only the Founder may erase the record outright. Uses the
// service-role client (consistent with the other Founder-only deletions).
export async function deleteLeave(leaveId: string) {
  await requireFounder();
  const admin = createAdminClient();
  const { error } = await admin.from('leaves').delete().eq('id', leaveId);
  if (error) throw new Error(error.message);
  revalidatePath('/leaves');
  revalidatePath('/dashboard');
}

// ---- holidays (board only) ----

export async function createHoliday(date: string, name: string) {
  const { supabase } = await requireUser();
  await supabase.from('holidays').insert({ holiday_date: date, name });
  revalidatePath('/leaves');
}

export async function deleteHoliday(id: string) {
  const { supabase } = await requireUser();
  await supabase.from('holidays').delete().eq('id', id);
  revalidatePath('/leaves');
}

export async function updateHoliday(id: string, date: string, name: string) {
  const { supabase } = await requireUser();
  await supabase.from('holidays').update({ holiday_date: date, name }).eq('id', id);
  revalidatePath('/leaves');
}

// ---- profile / settings ----

// A member may edit only their own display name here. Department and role
// are board-controlled — RLS rejects any self-update that changes them.
export async function updateProfile(patch: { name?: string; date_of_birth?: string | null }) {
  const { supabase, userId } = await requireUser();
  if (patch.date_of_birth != null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date_of_birth)) {
    throw new Error('Invalid date.');
  }
  const update: { name?: string; date_of_birth?: string | null } = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.date_of_birth !== undefined) update.date_of_birth = patch.date_of_birth;
  await supabase.from('profiles').update(update).eq('id', userId);
  revalidatePath('/settings');
  revalidatePath('/dashboard');
}

export async function updatePassword(password: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

// ---- team accounts (board only) ----

// Creates a new account (team member or fellow Board Member). Uses the
// service-role admin client — supabase.auth.signUp() can't be used here
// because it would replace the board member's own session with the new
// user's session. The on_auth_user_created trigger turns the metadata into
// a profiles row.
export async function createTeamMember(input: {
  name: string;
  email: string;
  password: string;
  role: 'board' | 'fte' | 'pte' | 'intern';
  department: string;
  // Departments BESIDE the primary one (migration 0060) — a grouping label,
  // never a grant. Founder-only, matching setMemberDepartments().
  extraDepartments?: string[];
  internshipMonths?: number | null;
}): Promise<{ error?: string }> {
  // A Director may only hire INTO their own department, and may not mint
  // another Director — that's a structural change, Founders only (0058).
  let department = input.department.trim();
  // callerDepartment() returns null precisely for a Founder — they belong to
  // no department, which is also what makes them the unscoped one.
  let callerIsFounder = false;
  // A Director's scope is the people assigned to them (0061), so a Director who
  // creates an account must be assigned the new hire in the same breath —
  // otherwise they'd finish the form and immediately lose sight of it.
  let assignToDirector: string | null = null;
  const { userId: creatorId } = await requireBoard();
  try {
    const mine = await callerDepartment();
    callerIsFounder = mine == null;
    if (mine != null) {
      assignToDirector = creatorId;
      if (input.role === 'board') {
        return { error: 'Only a Founder can create a Director.' };
      }
      if (department && department !== mine) {
        return { error: 'You can only create accounts in your own department.' };
      }
      department = mine;
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!department) return { error: 'Pick a department.' };

  // Resolve the extras up front: a bad list should fail BEFORE the auth user
  // exists, not leave a half-configured account behind.
  const extras = Array.from(
    new Set((input.extraDepartments ?? []).map((d) => d.trim()).filter(Boolean)),
  ).filter((d) => d !== department);
  if (extras.length) {
    if (!callerIsFounder) {
      return { error: 'Only a Founder can put a member in more than one department.' };
    }
    const known = await knownDepartments();
    const unknown = extras.filter((d) => !known.has(d));
    if (unknown.length) {
      return {
        error: `Unknown department${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Create it in Team › Departments first.`,
      };
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    email_confirm: true,
    user_metadata: {
      name: input.name.trim(),
      role: input.role,
      department,
    },
  });
  if (error) return { error: error.message };

  // New hires are confirmed by the board the moment the board creates them.
  // joined_date is set explicitly to the IST calendar day — the column
  // default is the DB's UTC date, which during the IST evening lands a day
  // early (e.g. a 3-month tenure then ends on the 17th instead of the 18th).
  //
  // The profiles row is created by the on_auth_user_created trigger, which can
  // lag the createUser call. Poll for it (instead of a fixed sleep) so a slow
  // trigger can't make this patch silently update zero rows.
  const newUserId = data.user!.id;
  for (let waited = 0; waited < 5000; waited += 250) {
    const { data: row } = await admin.from('profiles').select('id').eq('id', newUserId).maybeSingle();
    if (row) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const patch: {
    confirmed_by_board: boolean;
    joined_date: string;
    internship_months?: number | null;
    departments?: string[];
    director_id?: string;
  } = {
    confirmed_by_board: true,
    joined_date: fmtDate(new Date()),
  };
  if (input.role === 'intern' && input.internshipMonths) {
    patch.internship_months = input.internshipMonths;
  }
  // Founders assign reports deliberately, from Manage member, so only a
  // Director's own hires are auto-assigned.
  if (assignToDirector) patch.director_id = assignToDirector;
  // The auth trigger only knows the primary department, so the extras are
  // applied here. This runs on the admin client, which the sync trigger's
  // Founder check lets through as trusted server-side code — the check that
  // matters already happened above.
  if (extras.length) patch.departments = [department, ...extras];
  await admin.from('profiles').update(patch).eq('id', newUserId);

  // No emails are sent at creation: the address entered above is only a login
  // username, not a real inbox. Transactional emails wait until the board
  // sets a Communication email in Team > Manage member.

  revalidatePath('/team');
  revalidatePath('/dashboard');
  return {};
}

// Board sets (or clears) an intern's tenure in months.
export async function setInternshipMonths(memberId: string, months: number | null) {
  const { supabase } = await requireMemberScope(memberId, { allowSelf: true });
  await supabase
    .from('profiles')
    .update({ internship_months: months && months > 0 ? months : null })
    .eq('id', memberId);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board corrects a member's onboard (joining) date. For interns this also
// shifts their tenure window, so the dashboard end date follows.
export async function setMemberOnboardDate(memberId: string, date: string) {
  const { supabase } = await requireMemberScope(memberId, { allowSelf: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.');
  await supabase.from('profiles').update({ joined_date: date }).eq('id', memberId);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board sets/corrects a member's date of birth (drives Age everywhere and the
// birthday reminder/wishing card).
export async function setMemberDateOfBirth(memberId: string, date: string) {
  const { supabase } = await requireMemberScope(memberId, { allowSelf: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.');
  await supabase.from('profiles').update({ date_of_birth: date }).eq('id', memberId);
  revalidatePath('/team');
  revalidatePath('/dashboard');
  revalidatePath('/settings');
}

// Board edits a member's department.
// Moving someone between departments moves them between SILOS (migration
// 0058), so it is a Founder-only structural change — a Director must not be
// able to pull an outsider into their own scope, or push a member out of it.
export async function updateMemberDepartment(memberId: string, department: string) {
  const { supabase, userId } = await requireFounder();
  guardFounderTarget(memberId, userId, { allowSelf: true });
  const dept = department.trim();
  if (!dept) throw new Error('Pick a department.');
  // The member is leaving the department both of their reporting lines live
  // in, so both have to go with them — the DB trigger rejects a
  // cross-department manager_id or director_id.
  await supabase
    .from('profiles')
    .update({ department: dept, manager_id: null, director_id: null })
    .eq('id', memberId);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// The set of department names the org actually knows about — the registered
// rows in `departments` plus any name still carried by a profile (some predate
// that table). Used to stop a department being invented outside its one
// deliberate home, Team › Departments.
async function knownDepartments(): Promise<Set<string>> {
  const { supabase } = await requireUser();
  const [{ data: registered }, { data: inUse }] = await Promise.all([
    supabase.from('departments').select('name'),
    supabase.from('profiles').select('department'),
  ]);
  return new Set(
    [
      ...(registered ?? []).map((d) => d.name),
      ...(inUse ?? []).map((p) => p.department),
    ]
      .map((n) => (n ?? '').trim())
      .filter(Boolean),
  );
}

// Founder sets the ADDITIONAL departments a member belongs to (migration 0060).
// The member's primary/home department is untouched — it comes from
// updateMemberDepartment above and stays element 0 of the stored array.
//
// Adding a department here grants nothing BY ITSELF — it only makes the member
// ELIGIBLE to be picked for that department's Director (setDirectorReports,
// 0061) or Manager (setManagerTeam, 0062). Nobody actually sees or manages
// the member differently until a Founder makes that pick. Founder-only, like
// every other structural edit.
export async function setMemberDepartments(memberId: string, extraDepartments: string[]) {
  const { supabase } = await requireFounder();
  // The Founders sit under NO department by design (0058) — giving them one
  // here, even as a label, would contradict the whole scope model.
  if (isFounderId(memberId)) {
    throw new Error('The Founder account belongs to no department.');
  }

  const { data: member } = await supabase
    .from('profiles')
    .select('id, department')
    .eq('id', memberId)
    .single();
  const primary = member?.department?.trim() || '';
  if (!member) throw new Error('Member not found.');
  if (!primary) {
    throw new Error('Set this member’s department first — extras sit alongside a primary one.');
  }

  // Normalise: trimmed, de-duplicated, never the primary (it is already the
  // head of the list, not an extra).
  const extras = Array.from(
    new Set(extraDepartments.map((d) => d.trim()).filter(Boolean)),
  ).filter((d) => d !== primary);

  const known = await knownDepartments();
  const unknown = extras.filter((d) => !known.has(d));
  if (unknown.length) {
    throw new Error(
      `Unknown department${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Create it in Team › Departments first.`,
    );
  }

  // The DB trigger re-derives element 0 from `department`, so sending the
  // primary here is belt-and-braces rather than load-bearing.
  const { error } = await supabase
    .from('profiles')
    .update({ departments: [primary, ...extras] })
    .eq('id', memberId);
  if (error) throw new Error(error.message);

  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board changes a member's role (permission level / employment type). The
// Founder is frozen, and a board member can't change their OWN role — that
// would let them accidentally demote themselves out of board access. Moving a
// member out of "intern" clears their internship tenure since it no longer
// applies.
// Who is a Director, who is a Manager, who is staff — the shape of the
// hierarchy itself — is the Founders' alone (migration 0058). A Director runs
// the department they were given; they cannot appoint their own peers.
export async function updateMemberRole(memberId: string, role: UserRole) {
  const { supabase, userId } = await requireFounder();
  guardFounderTarget(memberId, userId); // no allowSelf: never via this path
  if (memberId === userId) throw new Error('You cannot change your own role.');
  if (!['board', 'fte', 'pte', 'intern'].includes(role)) {
    throw new Error('Invalid role.');
  }
  const patch: {
    role: UserRole;
    internship_months?: null;
    director_id?: null;
    manager_id?: null;
  } = { role };
  if (role !== 'intern') patch.internship_months = null;
  // A Director reports to neither a Director nor a Manager, so promoting
  // someone clears both of their upward lines. (Demoting a Director releases
  // the people who reported to THEM — that side is handled by the
  // release_director_reports trigger in 0059.)
  if (role === 'board') {
    patch.director_id = null;
    patch.manager_id = null;
  }
  const { error } = await supabase.from('profiles').update(patch).eq('id', memberId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
  revalidatePath('/dashboard');
  revalidatePath('/analytics');
}

// ---- departments (board only) ----
//
// Departments aren't a table of their own — they're the distinct `department`
// string carried by each profile (and each goal). "Editing" a department
// therefore means renaming that string everywhere it appears, and "deleting"
// one is only allowed once nothing references it.

// Board renames a department across every member and goal that uses it.
// Renaming onto an existing name merges the two.
// Departments ARE the security boundaries (migration 0058), so renaming,
// merging or deleting one redraws the org chart — Founders only.
export async function renameDepartment(oldName: string, newName: string) {
  await requireFounder();
  const from = oldName.trim();
  const to = newName.trim();
  if (!from) throw new Error('Missing department to rename.');
  if (!to) throw new Error('Enter a new department name.');
  if (from === to) return;

  const { supabase } = await requireUser();
  const results = await Promise.all([
    supabase.from('profiles').update({ department: to }).eq('department', from),
    supabase.from('goals').update({ department: to }).eq('department', from),
    // Managers heading the renamed department must follow it, or every RLS
    // check comparing managed_department by name silently strips their powers.
    supabase.from('profiles').update({ managed_department: to }).eq('managed_department', from),
    supabase.from('department_apps').update({ department: to }).eq('department', from),
  ]);
  for (const r of results) {
    if (r.error) throw new Error(r.error.message);
  }

  // Multi-department goals also carry the name inside the departments array.
  const { data: multi } = await supabase
    .from('goals')
    .select('id, departments')
    .contains('departments', [from]);
  await Promise.all(
    (multi ?? []).map((g) => {
      const departments = [
        ...new Set(((g.departments ?? []) as string[]).map((d) => (d === from ? to : d))),
      ];
      return supabase.from('goals').update({ departments }).eq('id', g.id);
    }),
  );

  // …and so do multi-department members (0060). The primary column was already
  // renamed above; this catches the rows where `from` is an ADDITIONAL
  // department, which that update never touched. Rows where it was the primary
  // are handled by the sync trigger, so re-writing them here is harmless.
  const { data: multiMembers } = await supabase
    .from('profiles')
    .select('id, departments')
    .contains('departments', [from]);
  await Promise.all(
    (multiMembers ?? []).map((m) => {
      const departments = [
        ...new Set(((m.departments ?? []) as string[]).map((d) => (d === from ? to : d))),
      ];
      return supabase.from('profiles').update({ departments }).eq('id', m.id);
    }),
  );

  // Move the reporting template across; if the target department already has
  // one, keep the target's and drop the old (same merge rule as members/goals).
  const { data: targetTpl } = await supabase
    .from('report_templates')
    .select('department')
    .eq('department', to)
    .maybeSingle();
  if (targetTpl) {
    await supabase.from('report_templates').delete().eq('department', from);
  } else {
    await supabase.from('report_templates').update({ department: to }).eq('department', from);
  }

  // Carry the chosen colour over to the new name, then drop the old row.
  const { data: oldDept } = await supabase
    .from('departments')
    .select('color')
    .eq('name', from)
    .maybeSingle();
  await supabase
    .from('departments')
    .upsert({ name: to, ...(oldDept?.color ? { color: oldDept.color } : {}) });
  if (from !== to) await supabase.from('departments').delete().eq('name', from);

  revalidatePath('/team');
  revalidatePath('/dashboard');
  revalidatePath('/goals');
}

// Board creates an empty department. It exists as a row in `departments` with
// no members and no tasks yet — the Team page folds that table into its
// department list, so a brand-new one is immediately assignable and shows in
// Manage departments as "Unused" (and stays deletable until something uses it).
//
// Founder-only, matching rename/delete: adding a department is a structural
// change to the org, not a per-member edit.
export async function createDepartment(name: string) {
  await requireFounder();
  const dept = name.trim();
  if (!dept) throw new Error('Enter a department name.');

  const { supabase } = await requireUser();
  // Case-insensitive duplicate guard. The table's primary key is the exact
  // string, so "audit" and "Audit" would otherwise both insert and then read as
  // two departments that look identical everywhere they are listed.
  // ilike takes a PATTERN, so a name containing % or _ ("R&D_Ops") would match
  // far more than itself and wrongly report a clash — escape them first.
  const pattern = dept.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: clash } = await supabase
    .from('departments')
    .select('name')
    .ilike('name', pattern)
    .maybeSingle();
  if (clash) throw new Error(`"${clash.name}" already exists.`);
  // A department can also be in use via profiles without a row here (any
  // predating the departments table), so check the derived names too.
  const { data: inUse } = await supabase
    .from('profiles')
    .select('department')
    .ilike('department', pattern)
    .limit(1);
  if (inUse && inUse.length > 0) throw new Error(`"${dept}" already exists.`);

  const { error } = await supabase.from('departments').insert({ name: dept });
  if (error) throw new Error(error.message);

  revalidatePath('/team');
  revalidatePath('/dashboard');
  revalidatePath('/goals');
}

// Board dedicates (or recolours) a department's accent colour. Upserts the
// departments row; the colour is read app-wide via getDepartmentColors.
export async function setDepartmentColor(name: string, color: string) {
  await requireBoard();
  const dept = name.trim();
  if (!dept) throw new Error('Missing department.');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Enter a valid hex colour.');
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('departments')
    .upsert({ name: dept, color: color.toLowerCase() });
  if (error) throw new Error(error.message);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board deletes a department — permitted only when no member (active or
// former) and no goal still references it. We don't silently reassign anyone,
// so the caller must move people and goals out first (e.g. via rename).
export async function deleteDepartment(name: string) {
  await requireFounder();
  const dept = name.trim();
  if (!dept) throw new Error('Missing department to delete.');

  const { supabase } = await requireUser();
  const [{ count: memberCount }, { count: goalCount }] = await Promise.all([
    // Counts anyone LISTED under it, primary or additional (0060) — deleting a
    // department that is still someone's second one would leave a stale label
    // pointing at nothing.
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .contains('departments', [dept]),
    supabase
      .from('goals')
      .select('id', { count: 'exact', head: true })
      .eq('department', dept),
  ]);
  if ((memberCount ?? 0) > 0 || (goalCount ?? 0) > 0) {
    const parts = [];
    if (memberCount) parts.push(`${memberCount} member${memberCount > 1 ? 's' : ''}`);
    if (goalCount) parts.push(`${goalCount} task${goalCount > 1 ? 's' : ''}`);
    throw new Error(
      `Can't delete "${dept}": ${parts.join(' and ')} still use it. Reassign them first.`,
    );
  }

  // Nothing references it, so it has already vanished from every derived list;
  // drop its colour row too and revalidate any view that cached the old set.
  await supabase.from('departments').delete().eq('name', dept);
  revalidatePath('/team');
  revalidatePath('/dashboard');
  revalidatePath('/goals');
}

// ---- department apps (the Launchpad, board only) ----
//
// A department app is a registered link to an independently-deployed tool. The
// Board curates the list; RLS then shows each member only their department's
// active apps. Validation here keeps the registry clean (real http(s) URL, a
// name, a department that exists or the company-wide "all" sentinel).

// Normalises and validates the fields shared by create + update. `department`
// comes in as '' / 'all' for company-wide (stored as null) or a dept name.
// Max length for an inline image data URL (~900 KB of base64). Keeps rows small
// and stays under the server-action body limit; the framing popup exports a
// 512px image, which lands far below this.
const MAX_IMAGE_DATA_URL = 900_000;

function normalizeAppInput(input: {
  name: string;
  url: string;
  department: string | null;
  description?: string;
  icon?: string;
  image_url?: string | null;
}) {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) throw new Error('Enter a name for the app.');
  if (!url) throw new Error('Enter the app URL.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Enter a valid URL (including https://).');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The URL must start with http:// or https://.');
  }

  // Accept a framed image as a data URL or an external https image link, else
  // store nothing (the tile falls back to its glyph).
  const rawImg = (input.image_url ?? '').trim();
  let image_url: string | null = null;
  if (rawImg) {
    const okData = /^data:image\/(png|webp|jpeg|gif|svg\+xml);/i.test(rawImg);
    const okHttp = /^https?:\/\//i.test(rawImg);
    if (!okData && !okHttp) throw new Error('That image could not be read. Try another file.');
    if (rawImg.length > MAX_IMAGE_DATA_URL) {
      throw new Error('That image is too large. Use a smaller one (it is cropped to 512px).');
    }
    image_url = rawImg;
  }

  const rawDept = (input.department ?? '').trim();
  const department = rawDept === '' || rawDept.toLowerCase() === 'all' ? null : rawDept;
  return {
    name,
    url: parsed.toString(),
    department,
    description: (input.description ?? '').trim(),
    icon: (input.icon ?? '').trim() || 'monitor',
    image_url,
  };
}

// Board registers a new app. New apps sort to the end of their department.
export async function createDepartmentApp(input: {
  name: string;
  url: string;
  department: string | null;
  description?: string;
  icon?: string;
  image_url?: string | null;
}) {
  const { userId } = await requireBoard();
  const fields = normalizeAppInput(input);
  const { supabase } = await requireUser();

  // Place it after the current last app in the same department bucket.
  let lastQ = supabase.from('department_apps').select('sort_order');
  lastQ =
    fields.department === null
      ? lastQ.is('department', null)
      : lastQ.eq('department', fields.department);
  const { data: last } = await lastQ
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = (last?.sort_order ?? -1) + 1;

  const { error } = await supabase
    .from('department_apps')
    .insert({ ...fields, sort_order, created_by: userId });
  if (error) throw new Error(error.message);
  revalidatePath('/apps');
  revalidatePath('/dashboard');
}

// Board edits an existing app's details.
export async function updateDepartmentApp(
  id: string,
  input: {
    name: string;
    url: string;
    department: string | null;
    description?: string;
    icon?: string;
    image_url?: string | null;
  },
) {
  await requireBoard();
  const fields = normalizeAppInput(input);
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('department_apps')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/apps');
  revalidatePath('/dashboard');
}

// Board shows/hides an app without deleting it (keeps it registered).
export async function setDepartmentAppActive(id: string, isActive: boolean) {
  await requireBoard();
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from('department_apps')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/apps');
  revalidatePath('/dashboard');
}

// Board permanently removes an app from the registry.
export async function deleteDepartmentApp(id: string) {
  await requireBoard();
  const { supabase } = await requireUser();
  const { error } = await supabase.from('department_apps').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/apps');
  revalidatePath('/dashboard');
}

// ---- app click tracking ----

// Called client-side (fire-and-forget) when a member opens an app tile.
// Never throws so it never blocks the navigation. The Board reads the
// aggregated data via getAppAnalytics in app-analytics.ts.
export async function logAppClick(appId: string): Promise<void> {
  try {
    const { supabase, userId } = await requireUser();
    await supabase
      .from('department_app_clicks')
      .insert({ app_id: appId, user_id: userId });
  } catch {
    // Silently swallow — analytics loss is preferable to a broken tile.
  }
}

// Board edits a member's display name and/or login email. Changing the email
// updates the actual Supabase Auth account (via the service-role admin API)
// so the member signs in with the new address; profiles.email is the mirror.
export async function updateMemberIdentity(
  memberId: string,
  input: { name: string; email: string },
): Promise<{ error?: string }> {
  const { userId } = await requireBoard();

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { error: 'Name is required.' };
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return { error: 'Enter a valid email.' };

  // A Founder account is protected: only that SAME Founder may edit it — one
  // Founder may not use this board path to edit the OTHER Founder's account.
  // A Founder may freely change their own name/email — identity is keyed off
  // the immutable user id, so an email change never affects founder status.
  if (isFounderId(memberId) && userId !== memberId) {
    return { error: 'The Founder account is protected and cannot be changed.' };
  }

  // This action writes through the service-role client, which bypasses RLS —
  // so the department silo has to be checked explicitly here.
  try {
    await requireMemberScope(memberId, { allowSelf: true });
  } catch (e) {
    return { error: (e as Error).message };
  }

  const admin = createAdminClient();

  // Read the current auth email so we only touch Auth when the email changed.
  const { data: existing } = await admin.auth.admin.getUserById(memberId);
  const currentEmail = existing?.user?.email?.toLowerCase();

  if (email !== currentEmail) {
    const { error } = await admin.auth.admin.updateUserById(memberId, {
      email,
      email_confirm: true, // board-set — no re-confirmation needed
    });
    if (error) return { error: error.message };
  }

  await admin.from('profiles').update({ name, email }).eq('id', memberId);

  revalidatePath('/team');
  revalidatePath('/dashboard');
  return {};
}

// Board sets a member's daily target hours. Pass null to fall back to the
// role default.
export async function setMemberTargetHours(memberId: string, hours: number | null) {
  const { supabase } = await requireMemberScope(memberId, { allowSelf: true });
  await supabase
    .from('profiles')
    .update({ daily_target_hours: hours && hours > 0 ? hours : null })
    .eq('id', memberId);
  revalidatePath('/team');
  revalidatePath('/dashboard');
  revalidatePath('/analytics');
}

// Board marks a member as having left the organization: they are set
// inactive, their auth account is disabled (login blocked), and they are
// hidden from the team grid by default. Data is retained.
export async function markMemberLeft(memberId: string) {
  // The Founder can never be offboarded — by anyone. Checked before the scope
  // guard so the message names the real reason rather than the department.
  if (isFounderId(memberId)) {
    throw new Error('The Founder account cannot be offboarded.');
  }
  const { supabase, userId } = await requireMemberScope(memberId);
  if (memberId === userId) throw new Error('You cannot offboard yourself.');
  await supabase
    .from('profiles')
    .update({ is_active: false, left_at: new Date().toISOString() })
    .eq('id', memberId);
  // Disable the auth account so they can no longer sign in.
  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(memberId, { ban_duration: '876000h' }); // ~100 years
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board reverses an offboarding — member becomes active and can sign in again.
export async function reinstateMember(memberId: string) {
  const { supabase } = await requireMemberScope(memberId, { allowSelf: true });
  await supabase
    .from('profiles')
    .update({ is_active: true, left_at: null })
    .eq('id', memberId);
  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(memberId, { ban_duration: 'none' });
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Founder-only: permanently delete a member. Other Board Members can mark
// someone as left, but only the Founder may erase an account outright.
// Removing the auth user cascades and deletes profile + punches + logs + leaves.
export async function deleteMember(memberId: string) {
  const { userId } = await requireFounder();
  if (memberId === userId) throw new Error('You cannot delete your own account.');
  // The Founder account can never be deleted — not even by itself.
  if (isFounderId(memberId)) {
    throw new Error('The Founder account cannot be deleted.');
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(memberId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board sets a member's communication email — the real inbox transactional
// emails are delivered to (profiles.email is just a login username).
export async function updateCommuteEmail(memberId: string, email: string | null) {
  const { supabase, userId } = await requireBoard();
  guardFounderTarget(memberId, userId, { allowSelf: true });

  const clean = email?.trim() || null;
  await supabase
    .from('profiles')
    .update({ commute_email: clean })
    .eq('id', memberId);
  revalidatePath('/team');
  revalidatePath('/email');
}

// ---- transactional email controls (board only) ----

// Board flips the master switch or a per-event-type switch for transactional
// emails. Only the known boolean flags are accepted.
export async function setTransactionalSettings(patch: {
  enabled?: boolean;
  on_leave?: boolean;
  on_goal?: boolean;
  on_punch?: boolean;
}) {
  const { supabase, userId } = await requireBoard();
  const clean: Record<string, boolean> = {};
  for (const k of ['enabled', 'on_leave', 'on_goal', 'on_punch'] as const) {
    if (typeof patch[k] === 'boolean') clean[k] = patch[k]!;
  }
  if (Object.keys(clean).length === 0) return;
  await supabase
    .from('transactional_email_settings')
    .update({ ...clean, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', 1);
  revalidatePath('/email');
}

// Board mutes/unmutes transactional emails for a single member.
export async function setMemberTransactionalEnabled(memberId: string, enabled: boolean) {
  const { supabase } = await requireBoard();
  await supabase
    .from('profiles')
    .update({ transactional_emails_enabled: enabled })
    .eq('id', memberId);
  revalidatePath('/email');
}

export async function updateMemberJobTitle(memberId: string, jobTitle: string) {
  const { supabase } = await requireMemberScope(memberId, { allowSelf: true });
  await supabase
    .from('profiles')
    .update({ job_title: jobTitle.trim() })
    .eq('id', memberId);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// ---- department managers (board only) ----

// Board appoints a member as the Head (Manager) of a department. The Manager
// keeps their employment role; they simply gain manager powers over the team
// the Board picks for them (see setManagerTeam). One department per manager.
export async function setMemberAsManager(memberId: string, department: string) {
  const { supabase, userId } = await requireFounder();
  guardFounderTarget(memberId, userId);
  const dept = department.trim();
  if (!dept) throw new Error('Pick a department for this manager to head.');
  // A Manager heads the department they BELONG to — the two can't diverge, or
  // the manager would sit in one silo while leading another. Their own
  // manager_id is cleared: a Head of Department reports to the Director, not
  // to another manager, and a stale link would fail the consistency trigger
  // once the department moves.
  const { error } = await supabase
    .from('profiles')
    .update({
      is_manager: true,
      managed_department: dept,
      department: dept,
      manager_id: null,
    })
    .eq('id', memberId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board sets (or clears) a Manager's Role & Responsibilities — a formatted
// description shown atop their team view. Stored as HTML; sanitized on render
// via <RichText/>. Board-only; the Founder row is protected.
export async function setManagerResponsibilities(memberId: string, body: string) {
  const { supabase } = await requireMemberScope(memberId);
  const value = body.trim() === '' ? null : body;
  const { error } = await supabase
    .from('profiles')
    .update({ manager_responsibilities: value })
    .eq('id', memberId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
}

// Board removes a member's Manager status and detaches their whole team
// (clears manager_id on every member that pointed at them).
export async function unsetManager(memberId: string) {
  const { supabase, userId } = await requireFounder();
  guardFounderTarget(memberId, userId);
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase
      .from('profiles')
      .update({ is_manager: false, managed_department: null, manager_responsibilities: null })
      .eq('id', memberId),
    supabase.from('profiles').update({ manager_id: null }).eq('manager_id', memberId),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Board sets a manager's team to exactly `memberIds` — members are pointed at
// the manager via manager_id; anyone previously on the team but not in the new
// set is detached. Team members must belong to the department the manager heads.
export async function setManagerTeam(managerId: string, memberIds: string[]) {
  const { supabase } = await requireFounder();

  const { data: manager } = await supabase
    .from('profiles')
    .select('id, is_manager, managed_department')
    .eq('id', managerId)
    .single();
  if (!manager || !manager.is_manager || !manager.managed_department) {
    throw new Error('That member is not a Department Manager.');
  }

  const wanted = Array.from(new Set(memberIds)).filter((id) => id !== managerId);

  // Validate every picked member BELONGS TO the manager's department — primary
  // or additional (0060/0062, mirroring setDirectorReports' eligibility rule)
  // — and isn't the Founder. Pulled in one round-trip.
  if (wanted.length) {
    const { data: picks } = await supabase
      .from('profiles')
      .select('id, name, department, departments')
      .in('id', wanted);
    for (const p of picks ?? []) {
      if (isFounderId(p.id)) throw new Error('The Founder cannot be on a team.');
      if (!belongsToDepartment(p, manager.managed_department)) {
        throw new Error(
          `${p.name} doesn't belong to ${manager.managed_department}. Add ${manager.managed_department} to their departments in Manage member first.`,
        );
      }
    }
  }

  // Detach members no longer on the team, then attach the wanted set.
  let detach = supabase.from('profiles').update({ manager_id: null }).eq('manager_id', managerId);
  if (wanted.length) detach = detach.not('id', 'in', `(${wanted.join(',')})`);
  const { error: dErr } = await detach;
  if (dErr) throw new Error(dErr.message);

  if (wanted.length) {
    const { error: aErr } = await supabase
      .from('profiles')
      .update({ manager_id: managerId })
      .in('id', wanted);
    if (aErr) throw new Error(aErr.message);
  }

  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// Founder sets a Director's direct reports to exactly `memberIds` — the picked
// members get director_id = the Director; anyone previously reporting to them
// but not in the new set is detached.
//
// Since migration 0061 this IS the Director's scope, not merely a note about
// who answers to whom: assigning someone is what makes them visible and
// editable to that Director, and unticking them takes that away. A Director
// with an empty list sees only themselves.
//
// Eligibility reads the member's whole `departments` list (0060), so a member
// whose primary is GST can be handed to an Audit Director once Audit is on
// their list — without leaving GST. A member may hold this alongside a
// manager_id; the two lines are independent by design (see 0059).
export async function setDirectorReports(directorId: string, memberIds: string[]) {
  const { supabase } = await requireFounder();

  const { data: director } = await supabase
    .from('profiles')
    .select('id, role, department')
    .eq('id', directorId)
    .single();
  const dept = director?.department?.trim() || '';
  if (!director || director.role !== 'board' || isFounderId(director.id)) {
    throw new Error('Direct reports can only be assigned to a Director.');
  }
  if (!dept) {
    throw new Error('This Director has no department yet — set one before assigning reports.');
  }

  const wanted = Array.from(new Set(memberIds)).filter((id) => id !== directorId);

  // Validate the whole picked set in one round-trip: belongs to the Director's
  // department (primary or additional), and never another Director or a Founder.
  if (wanted.length) {
    const { data: picks } = await supabase
      .from('profiles')
      .select('id, name, role, department, departments')
      .in('id', wanted);
    for (const p of picks ?? []) {
      if (isFounderId(p.id)) throw new Error('A Founder does not report to a Director.');
      if (p.role === 'board') {
        throw new Error('A Director does not report to another Director.');
      }
      if (!belongsToDepartment(p, dept)) {
        throw new Error(
          `${p.name} doesn't belong to ${dept}. Add ${dept} to their departments in Manage member first.`,
        );
      }
    }
  }

  // Detach the ones no longer picked, then attach the wanted set.
  let detach = supabase.from('profiles').update({ director_id: null }).eq('director_id', directorId);
  if (wanted.length) detach = detach.not('id', 'in', `(${wanted.join(',')})`);
  const { error: dErr } = await detach;
  if (dErr) throw new Error(dErr.message);

  if (wanted.length) {
    const { error: aErr } = await supabase
      .from('profiles')
      .update({ director_id: directorId })
      .in('id', wanted);
    if (aErr) throw new Error(aErr.message);
  }

  revalidatePath('/team');
  revalidatePath('/dashboard');
}

// ---- change requests (manager → board) ----

const CHANGE_FIELD_LABEL: Record<ChangeRequestField, string> = {
  email: 'Login email',
  role: 'Role',
  job_title: 'Job title',
  daily_target_hours: 'Daily target hours',
};

// A Manager requests the Board change one field on a team member's account.
// Joining date is intentionally not requestable. Creates a pending request and
// notifies every Board member + the Founder. RLS guarantees the caller manages
// the member; we re-check here for a friendly error and to capture the current
// value for the Board's review.
export async function submitChangeRequest(
  memberId: string,
  field: ChangeRequestField,
  requestedValue: string,
): Promise<{ error?: string }> {
  const { supabase, userId, manager } = await requireManager();

  if (!CHANGE_FIELD_LABEL[field]) return { error: 'Unknown field.' };
  const value = requestedValue.trim();
  if (!value) return { error: 'Enter the value you want changed.' };

  // Confirm the member is on the caller's team and grab their current value.
  const { data: member } = await supabase
    .from('profiles')
    .select('id, name, manager_id, email, role, job_title, daily_target_hours')
    .eq('id', memberId)
    .single();
  if (!member || member.manager_id !== userId) {
    return { error: 'You can only request changes for your own team members.' };
  }

  // Validate the requested value per field.
  if (field === 'email' && !/^[^@]+@[^@]+\.[^@]+$/.test(value)) {
    return { error: 'Enter a valid email.' };
  }
  if (field === 'role' && !['fte', 'pte', 'intern'].includes(value)) {
    return { error: 'Pick a valid role.' };
  }
  if (field === 'daily_target_hours') {
    const n = Number(value);
    if (Number.isNaN(n) || n <= 0 || n > 24) {
      return { error: 'Enter hours between 1 and 24.' };
    }
  }

  const current: Record<ChangeRequestField, string | null> = {
    email: member.email,
    role: member.role,
    job_title: member.job_title || '',
    daily_target_hours:
      member.daily_target_hours != null ? String(member.daily_target_hours) : null,
  };

  const { error } = await supabase.from('change_requests').insert({
    manager_id: userId,
    member_id: memberId,
    field,
    current_value: current[field],
    requested_value: value,
  });
  if (error) return { error: error.message };

  // Notify every Board member (RLS blocks a non-board insert into notifications,
  // so use the service role — same pattern as leave requests).
  const admin = createAdminClient();
  const { data: boards } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'board')
    .eq('is_active', true);
  if (boards && boards.length) {
    const title = `${manager.name ?? 'A manager'} requested a change`;
    const body = `${member.name}: ${CHANGE_FIELD_LABEL[field]} → ${value}`;
    await admin.from('notifications').insert(
      boards.map((b) => ({
        user_id: b.id,
        type: 'leave_requested' as const,
        title,
        body,
        href: '/team/requests',
      })),
    );
    const boardIds = boards.map((b) => b.id);
    after(() => sendPush(boardIds, { title, body, url: '/team/requests' }));
  }

  revalidatePath('/team/requests');
  revalidatePath('/team');
  return {};
}

// Board approves a change request: applies the change with the SAME logic as a
// direct board edit, marks the request approved, and notifies the manager.
export async function approveChangeRequest(id: string): Promise<{ error?: string }> {
  const { supabase, userId } = await requireBoard();

  const { data: req } = await supabase
    .from('change_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (!req) return { error: 'Request not found.' };
  if (req.status !== 'pending') return { error: 'This request was already reviewed.' };

  const field = req.field as ChangeRequestField;
  const value = req.requested_value as string;

  // Apply via the existing board edit paths so all the same guards/side-effects
  // (auth email update, internship clearing, etc.) run.
  if (field === 'email') {
    const { data: m } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', req.member_id)
      .single();
    const res = await updateMemberIdentity(req.member_id, {
      name: m?.name ?? '',
      email: value,
    });
    if (res.error) return { error: res.error };
  } else if (field === 'role') {
    await updateMemberRole(req.member_id, value as UserRole);
  } else if (field === 'job_title') {
    await updateMemberJobTitle(req.member_id, value);
  } else if (field === 'daily_target_hours') {
    await setMemberTargetHours(req.member_id, Number(value));
  }

  await supabase
    .from('change_requests')
    .update({
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);

  await notifyChangeRequestResolved(req.manager_id, req.member_id, field, 'approved', '');

  revalidatePath('/team/requests');
  revalidatePath('/team');
  revalidatePath('/dashboard');
  return {};
}

// Board rejects a change request with an optional note; notifies the manager.
export async function rejectChangeRequest(
  id: string,
  note?: string,
): Promise<{ error?: string }> {
  const { supabase, userId } = await requireBoard();

  const { data: req } = await supabase
    .from('change_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (!req) return { error: 'Request not found.' };
  if (req.status !== 'pending') return { error: 'This request was already reviewed.' };

  await supabase
    .from('change_requests')
    .update({
      status: 'rejected',
      reviewed_by: userId,
      review_note: (note ?? '').trim(),
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);

  await notifyChangeRequestResolved(
    req.manager_id,
    req.member_id,
    req.field as ChangeRequestField,
    'rejected',
    (note ?? '').trim(),
  );

  revalidatePath('/team/requests');
  return {};
}

// Pings the manager that their request was approved/rejected. Board → any-user
// notification, so the RLS server client (board) may insert it directly.
async function notifyChangeRequestResolved(
  managerId: string,
  memberId: string,
  field: ChangeRequestField,
  outcome: 'approved' | 'rejected',
  note: string,
) {
  const admin = createAdminClient();
  const { data: member } = await admin
    .from('profiles')
    .select('name')
    .eq('id', memberId)
    .single();
  const title = `Change request ${outcome}`;
  const body = `${member?.name ?? 'A member'}: ${CHANGE_FIELD_LABEL[field]}${
    outcome === 'rejected' && note ? ` · "${note}"` : ''
  }`;
  await admin.from('notifications').insert({
    user_id: managerId,
    type: 'leave_requested',
    title,
    body,
    href: '/team/requests',
  });
  after(() => sendPush(managerId, { title, body, url: '/team/requests' }));
}

// ---- founder-only: punch corrections ----

// Founder edits anyone's punch session. Pass ISO timestamps; punch_out may
// be null to mark a session still in progress.
export async function updatePunch(
  punchId: string,
  punchIn: string,
  punchOut: string | null,
) {
  await requireFounder();
  const admin = createAdminClient();
  if (!punchIn) throw new Error('Punch-in is required.');
  if (punchOut && new Date(punchOut).getTime() < new Date(punchIn).getTime()) {
    throw new Error('Punch-out must be after punch-in.');
  }
  const { error } = await admin
    .from('punches')
    .update({ punch_in: punchIn, punch_out: punchOut })
    .eq('id', punchId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
  revalidatePath('/punch');
  revalidatePath('/dashboard');
}

// Founder deletes a punch session outright.
export async function deletePunch(punchId: string) {
  await requireFounder();
  const admin = createAdminClient();
  const { error } = await admin.from('punches').delete().eq('id', punchId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
  revalidatePath('/punch');
  revalidatePath('/dashboard');
}

// ---- punch time change requests (member-submitted, Founder-reviewed) ----

// A member requests a missed-punch fix or a day-status (leave) change for a
// past day. Nothing on `punches`/`leaves` changes until the Founder approves.
// Capped at MONTHLY_REQUEST_LIMIT non-withdrawn requests per calendar month.
export async function submitPunchChangeRequest(input: {
  workDate: string;
  requestType: 'missed_punch' | 'day_status';
  punchIn?: string;
  punchOut?: string;
  leaveType?: LeaveType;
  isHalfDay?: boolean;
  reason: string;
}): Promise<{ error?: string }> {
  const { supabase, userId } = await requireUser();

  const reason = input.reason.trim();
  if (!reason) return { error: 'Tell us briefly why you need this change.' };

  const today = fmtDate(new Date());
  if (!isWithinRequestWindow(input.workDate, today)) {
    return { error: 'You can only request a change for the current or previous month.' };
  }

  if (input.requestType === 'missed_punch') {
    if (!input.punchIn) return { error: 'Punch-in time is required.' };
    if (!input.punchOut) return { error: 'Punch-out time is required.' };
    if (new Date(input.punchOut).getTime() < new Date(input.punchIn).getTime()) {
      return { error: 'Punch-out must be after punch-in.' };
    }
  } else if (!input.leaveType) {
    return { error: 'Pick a leave type.' };
  }

  const { count: dupCount } = await supabase
    .from('punch_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('work_date', input.workDate)
    .eq('status', 'pending');
  if ((dupCount ?? 0) > 0) {
    return { error: 'You already have a pending request for this date.' };
  }

  const monthStartIso = new Date(istDayStartMs(`${monthKey(today)}-01`)).toISOString();
  const { data: monthRows } = await supabase
    .from('punch_change_requests')
    .select('status')
    .eq('user_id', userId)
    .gte('created_at', monthStartIso);
  const usedThisMonth = (monthRows ?? []).filter((r) =>
    countsTowardMonthlyLimit(r.status as 'pending' | 'approved' | 'rejected' | 'withdrawn'),
  ).length;
  if (usedThisMonth >= MONTHLY_REQUEST_LIMIT) {
    return { error: `You've used all ${MONTHLY_REQUEST_LIMIT} punch requests for this month.` };
  }

  const { error } = await supabase.from('punch_change_requests').insert({
    user_id: userId,
    work_date: input.workDate,
    request_type: input.requestType,
    requested_punch_in: input.requestType === 'missed_punch' ? input.punchIn : null,
    requested_punch_out:
      input.requestType === 'missed_punch' ? (input.punchOut ?? null) : null,
    requested_leave_type: input.requestType === 'day_status' ? input.leaveType : null,
    requested_is_half_day: input.requestType === 'day_status' ? !!input.isHalfDay : null,
    reason,
  });
  if (error) return { error: error.message };

  const admin = createAdminClient();
  const { data: me } = await admin.from('profiles').select('name').eq('id', userId).single();
  const title = `${me?.name ?? 'A teammate'} requested a punch change`;
  const body =
    input.requestType === 'missed_punch'
      ? `${fmtDateDMY(parseDate(input.workDate))} - missed punch`
      : `${fmtDateDMY(parseDate(input.workDate))} - ${(input.leaveType ?? '').toUpperCase()}${
          input.isHalfDay ? ' - half-day' : ''
        }`;
  const href = '/team/requests';
  // If the requester is themselves a Founder, they can't review their own
  // (now-pending) request — exclude them so only the OTHER Founder gets
  // pinged to act. Mirrors reviewLeave's founderReviewers filter below.
  const founderReviewers = (FOUNDER_USER_IDS as readonly string[]).filter((id) => id !== userId);
  if (founderReviewers.length) {
    await admin.from('notifications').insert(
      founderReviewers.map((id) => ({
        user_id: id,
        type: 'punch_change_requested',
        title,
        body,
        href,
      })),
    );
    after(() => sendPush(founderReviewers, { title, body, url: href }, 'punch_change_requested'));
    after(() =>
      notifyByEmail(founderReviewers, { eventType: 'punch_change_requested', title, body, href }),
    );
  }

  revalidatePath('/team/requests');
  revalidatePath('/punch');
  return {};
}

// A member withdraws their own still-pending request, freeing up their
// monthly slot. No-op notification (nobody needs telling).
export async function withdrawPunchChangeRequest(id: string): Promise<{ error?: string }> {
  const { supabase, userId } = await requireUser();
  const { data: req } = await supabase
    .from('punch_change_requests')
    .select('id, user_id, status')
    .eq('id', id)
    .single();
  if (!req || req.user_id !== userId) return { error: 'Request not found.' };
  if (req.status !== 'pending') return { error: 'This request was already reviewed.' };

  const { error } = await supabase
    .from('punch_change_requests')
    .update({ status: 'withdrawn' })
    .eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/punch');
  return {};
}

// Founder approves: applies the change to punches/leaves, marks the request
// approved, and notifies the member.
export async function approvePunchChangeRequest(id: string): Promise<{ error?: string }> {
  const { userId } = await requireFounder();
  const admin = createAdminClient();

  const { data: req } = await admin
    .from('punch_change_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (!req) return { error: 'Request not found.' };
  // A Founder can never approve their own punch request — accepting your own
  // correction isn't a real review. The other Founder has to do it. Mirrors
  // reviewLeave's identical self-check.
  if (req.user_id === userId) return { error: 'You cannot review your own punch request.' };
  if (req.status !== 'pending') return { error: 'This request was already reviewed.' };

  if (req.request_type === 'missed_punch') {
    const { error } = await admin.from('punches').insert({
      user_id: req.user_id,
      work_date: req.work_date,
      punch_in: req.requested_punch_in as string,
      punch_out: req.requested_punch_out,
    });
    if (error) return { error: error.message };
  } else {
    const { error } = await admin.from('leaves').insert({
      user_id: req.user_id,
      type: req.requested_leave_type as LeaveType,
      start_date: req.work_date,
      end_date: req.work_date,
      reason: req.reason,
      is_half_day: !!req.requested_is_half_day,
      status: 'approved',
      reviewed_by: userId,
    });
    if (error) return { error: error.message };
  }

  await admin
    .from('punch_change_requests')
    .update({ status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq('id', id);

  await notifyPunchChangeResolved(req.user_id, req.work_date, 'approved', '');

  revalidatePath('/team/requests');
  revalidatePath('/punch');
  revalidatePath('/leaves');
  revalidatePath('/team');
  revalidatePath('/dashboard');
  return {};
}

// Founder rejects with a required note; notifies the member.
export async function rejectPunchChangeRequest(
  id: string,
  note: string,
): Promise<{ error?: string }> {
  const { userId } = await requireFounder();
  const comment = note.trim();
  if (!comment) return { error: 'A note is required when rejecting a punch request.' };

  const admin = createAdminClient();
  const { data: req } = await admin
    .from('punch_change_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (!req) return { error: 'Request not found.' };
  // Same self-check as approve above — a rejection is still a review.
  if (req.user_id === userId) return { error: 'You cannot review your own punch request.' };
  if (req.status !== 'pending') return { error: 'This request was already reviewed.' };

  await admin
    .from('punch_change_requests')
    .update({
      status: 'rejected',
      reviewed_by: userId,
      review_note: comment,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);

  await notifyPunchChangeResolved(req.user_id, req.work_date, 'rejected', comment);

  revalidatePath('/team/requests');
  return {};
}

async function notifyPunchChangeResolved(
  memberId: string,
  workDate: string,
  outcome: 'approved' | 'rejected',
  note: string,
) {
  const admin = createAdminClient();
  const title = outcome === 'approved' ? 'Punch change approved' : 'Punch change declined';
  const body = `${fmtDateDMY(parseDate(workDate))}${note ? ` - "${note}"` : ''}`;
  const href = '/punch';
  await admin.from('notifications').insert({
    user_id: memberId,
    type: outcome === 'approved' ? 'punch_change_approved' : 'punch_change_rejected',
    title,
    body,
    href,
  });
  after(() =>
    sendPush(
      memberId,
      { title, body, url: href },
      outcome === 'approved' ? 'punch_change_approved' : 'punch_change_rejected',
    ),
  );
  after(() =>
    notifyByEmail([memberId], {
      eventType: outcome === 'approved' ? 'punch_change_approved' : 'punch_change_rejected',
      title,
      body,
      href,
    }),
  );
}

// ---- avatar (any member, own profile) ----

// Records the public URL of an uploaded avatar. The file upload itself
// happens client-side against Supabase Storage; this just saves the URL.
//
// Also sweeps the member's avatar folder so old photos don't pile up against
// the 1GB free Storage quota: every prior file is removed, keeping only the one
// just uploaded (or none, when the photo is being cleared). Best-effort — a
// failed cleanup never blocks saving the new URL.
export async function updateAvatarUrl(url: string | null) {
  const { supabase, userId } = await requireUser();
  await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);

  // Storage delete needs the service role so it works regardless of the bucket's
  // RLS policies. The member's files all live under a folder named after their id.
  const admin = createAdminClient();
  const keepName = url ? url.split('/').pop() ?? null : null;
  const { data: files } = await admin.storage.from('avatars').list(userId);
  if (files && files.length) {
    const stale = files
      .filter((f) => f.name !== keepName)
      .map((f) => `${userId}/${f.name}`);
    if (stale.length) await admin.storage.from('avatars').remove(stale);
  }

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/team');
}

export async function markTourSeen() {
  const { supabase, userId } = await requireUser();
  await supabase.from('profiles').update({ tour_seen: true }).eq('id', userId);
}

// ─── Task lock: member taps to reveal a custom-day task description ───────────

// Records the unlock and pings board + the goal's department manager.
// Idempotent: a second tap on the same item does nothing (UNIQUE constraint).
export async function unlockGoalItem(
  itemId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from('goal_item_unlocks').upsert(
    { item_id: itemId, user_id: userId },
    { onConflict: 'item_id,user_id', ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/goals');
  revalidatePath('/dashboard');
  after(() => notifyManagersOfUnlock(itemId, userId));
  return { ok: true };
}

async function notifyManagersOfUnlock(itemId: string, memberId: string) {
  const admin = createAdminClient();

  const { data: item } = await admin
    .from('goal_checklist_items')
    .select('label, goal_id')
    .eq('id', itemId)
    .single();
  if (!item) return;

  const { data: goal } = await admin
    .from('goals')
    .select('id, title, department')
    .eq('id', item.goal_id)
    .single();
  if (!goal) return;

  const { data: member } = await admin
    .from('profiles')
    .select('name')
    .eq('id', memberId)
    .single();
  const memberName = member?.name ?? 'A team member';

  // Board always notified; only the department's own manager(s) notified.
  const [{ data: board }, { data: managers }] = await Promise.all([
    admin.from('profiles').select('id').eq('role', 'board'),
    admin
      .from('profiles')
      .select('id')
      .eq('is_manager', true)
      .eq('managed_department', goal.department ?? ''),
  ]);
  const recipientIds = new Set<string>([
    ...(board ?? []).map((p: { id: string }) => p.id),
    ...(managers ?? []).map((p: { id: string }) => p.id),
  ]);
  recipientIds.delete(memberId);
  const ids = Array.from(recipientIds);
  if (!ids.length) return;

  const title = `${memberName} opened their task`;
  const body = `"${item.label}" · ${goal.title}`;

  await admin.from('notifications').insert(
    ids.map((user_id) => ({
      user_id,
      type: 'task_unlocked' as NotificationType,
      title,
      body,
      href: `/goals?goal=${goal.id}`,
      goal_id: goal.id,
      department: goal.department ?? null,
    })),
  );
  after(() => sendPush(ids, { title, body, url: `/goals?goal=${goal.id}` }, 'task_unlocked'));
}

// ---- Crash-page "Report to the team" ((app)/error.tsx) ----

// Any signed-in team member can hit this — a bug report isn't gated behind
// the transactional-email master switch the way member-facing notifications
// are (notifyByEmail), and it always goes to one fixed inbox rather than a
// recipient list, so it gets its own small, direct path instead of reusing
// that machinery. Still logged to transactional_email_logs (event_type
// 'bug_report', outside the closed TransactionalEventType union on purpose —
// that union is specifically "notifyByEmail-compatible" event types) so it
// shows up in the board's /email admin audit view like every other send.
const BUG_REPORT_TO = 'codewithnishit@gmail.com';

export async function reportError(input: {
  incidentCode: string;
  message: string;
  pageUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  const { data: me } = await supabase
    .from('profiles')
    .select('name, email, commute_email')
    .eq('id', userId)
    .single();
  const reporterName = me?.name || 'A team member';
  const reporterEmail = me?.commute_email || me?.email || 'unknown';

  const title = `Bug report - Incident #${input.incidentCode}`;
  const subject = `Bug report from ${reporterName} - Incident #${input.incidentCode}`;
  const body = [
    `Reported by: ${reporterName} (${reporterEmail})`,
    `Page: ${input.pageUrl}`,
    `Error: ${input.message || 'No message'}`,
  ].join('\n');

  const html = renderTransactionalEmail({ name: 'MCA', title, body, ctaUrl: input.pageUrl, ctaLabel: 'Open the page' });
  const text = transactionalPlainText({ name: 'MCA', title, body, ctaUrl: input.pageUrl, ctaLabel: 'Open the page' });

  const admin = createAdminClient();
  try {
    await sendMail({ to: BUG_REPORT_TO, from: '"Mahesh Chandra & Associates Dashboard" <sales@restrucai.com>', bcc: false, subject, html, text });
    await admin.from('transactional_email_logs').insert({
      recipient_id: null,
      recipient_email: BUG_REPORT_TO,
      recipient_name: 'MCA (Founder)',
      event_type: 'bug_report',
      subject,
      status: 'sent',
    });
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await admin.from('transactional_email_logs').insert({
      recipient_id: null,
      recipient_email: BUG_REPORT_TO,
      recipient_name: 'MCA (Founder)',
      event_type: 'bug_report',
      subject,
      status: 'failed',
      error_message: errorMessage,
    });
    return { ok: false, error: 'Could not send the report. Please try again or message the team directly.' };
  }
}
