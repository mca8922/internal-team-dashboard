// Dashboard - the hero screen. Server Component: fetches everything, then
// hands interactive widgets to client children.
import Link from 'next/link';
import {
  getCurrentProfile,
  getAllProfiles,
  getPunches,
  getAllPunches,
  getGoals,
  getGoalAssignees,
  getRecentLogs,
  getLogs,
  getLeaves,
  getDepartmentColors,
  punchTotalMsForDate,
  punchStatus,
  activeOpenSession,
  logStreak,
  logHasContent,
  isOnLeave,
  visibleGoals,
  getBirthdayCelebrants,
} from '@/lib/queries';
import {
  fmtDate,
  weekNumber,
  fmtRelative,
  fmtFriendly,
  parseDate,
  addDays,
  addMonths,
  daysBetween,
  startOfWeek,
} from '@/lib/dates';
import { targetHours, roleLabel, isFounder, isManager } from '@/lib/roles';
import { LEVEL_META } from '@/app/(app)/goals/goal-ui';
import { Donut } from '@/components/ui';
import { ManagerBadge } from '@/components/ManagerBadge';
import { PunchWidget } from './PunchWidget';
import { StreakCard } from './StreakCard';
import { BlockRender } from '@/components/BlockEditor';
import { LeaveReviewRow } from './LeaveReviewRow';
import { BirthdayBanner } from './BirthdayBanner';
import type { Profile, UserRole } from '@/lib/types';
import { MilestoneReplayButton } from '@/components/MilestoneReplayButton';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Dashboard · Mahesh Chandra & Associates' };

function Greeting({
  name,
  joinedDate,
  role,
  internshipMonths,
  badge,
}: {
  name: string;
  joinedDate: string;
  role: UserRole;
  internshipMonths: number | null;
  badge?: React.ReactNode;
}) {
  const now = new Date();
  // Time-of-day greeting + date line are computed in IST so they are correct
  // regardless of the (UTC) server the app is deployed on.
  const h =
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        hour12: false,
      }).format(now),
    ) % 24;
  const greeting =
    h < 5
      ? 'Burning the midnight oil'
      : h < 12
        ? 'Good morning'
        : h < 17
          ? 'Good afternoon'
          : h < 21
            ? 'Good evening'
            : 'Working late';
  const dateLine = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
  const firstName = name.split(' ')[0];
  return (
    <div className="greeting-block">
      <div
        className="text-xs text-grey fw-medium greet-eyebrow"
        style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        {dateLine} · Week {weekNumber(now)}
      </div>
      <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
        <h1 className="text-3xl mt-1 greet-line">
          <span className="greet-hello">{greeting},</span>
          {/* Same bright shine sweep as "Execution Excellence" on Goals. */}
          <span className="text-shine">{firstName}</span>
        </h1>
        {badge}
      </div>
      <div className="text-xs text-grey mt-1 greet-since">
        Member since {fmtFriendly(parseDate(joinedDate))}
      </div>
      {FEATURE_FLAGS.dashboardExtras ? (
        <MilestoneReplayButton joinedDate={joinedDate} role={role} internshipMonths={internshipMonths} />
      ) : null}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-xs text-grey">{label}</div>
      <div className="text-3xl fw-bold mt-1" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const profile = (await getCurrentProfile())!;
  const isBoard = profile.role === 'board';
  const founder = isFounder(profile);
  const today = fmtDate(new Date());
  // Only fetch the punch history the dashboard actually uses (streak +
  // today). 40 days is plenty and keeps the payload small.
  const punchFrom = fmtDate(addDays(new Date(), -40));

  // One parallel batch for everything - the member queries AND the
  // board-only roll-up queries fire together (board queries used to wait
  // for round 1 to finish even though they did not depend on it).
  const [myPunches, myLogs, myAllLogs, allGoals, assignees, boardData] = await Promise.all([
    getPunches(profile.id, punchFrom),
    getRecentLogs(profile.id),
    // The streak can run longer than getRecentLogs' window (it used to get
    // silently cut short there once a streak passed 40 days) — logStreak
    // needs the complete history to walk all the way back to where it broke.
    getLogs(profile.id),
    getGoals(),
    getGoalAssignees(),
    isBoard
      ? Promise.all([
          getAllProfiles(),
          getAllPunches(today),
          getLeaves(),
          getDepartmentColors(),
        ])
      : Promise.resolve(null),
  ]);
  // Goals this member may see: assigned to them or their department
  // (the Board sees all).
  const goals = visibleGoals(allGoals, assignees, profile);

  // Birthday banner — gated behind notificationsFull, same tier as the rest
  // of the teammate-facing notification pipeline. Message privacy is enforced
  // server-side in getBirthdayCelebrants (see migration
  // 0056_birthday_privacy.sql), not just hidden in the UI.
  const celebrants = FEATURE_FLAGS.notificationsFull
    ? await getBirthdayCelebrants(profile.id)
    : [];

  // Department-manager badge accent — getDepartmentColors is React.cache()d and
  // already fetched by the layout this request, so this is effectively free.
  const isMgr = isManager(profile);
  const managedColor =
    isMgr && profile.managed_department
      ? (await getDepartmentColors())[profile.managed_department] ?? null
      : null;

  const todayPunches = myPunches.filter((p) => p.work_date === today);
  // A session that began late last night and is still running counts as being
  // on the clock today — so the button reads "Punch out", not "Punch in".
  const active = activeOpenSession(myPunches);
  const status = active ? 'in' : punchStatus(todayPunches);
  const crossMidnight = !!active && active.work_date !== today;
  // Total for today, splitting any session that crossed midnight so only the
  // minutes worked after 00:00 IST count toward today.
  const total = punchTotalMsForDate(myPunches, today);
  const streak = logStreak(myAllLogs);
  // Tasks landing in the current week (Mon–Sun), already scoped by visibleGoals
  // above. There is no Weekly TIER any more — the cascade runs Yearly →
  // Half-Yearly → Quarterly → Monthly → Daily — so "this week" is now a due-date
  // window across every tier, which is what the "Week N" label beside it means.
  const weekStart = fmtDate(startOfWeek(new Date()));
  const weekEnd = fmtDate(addDays(startOfWeek(new Date()), 6));
  const weekGoals = goals.filter(
    (g) =>
      !!g.due_date &&
      g.due_date >= weekStart &&
      g.due_date <= weekEnd &&
      g.status !== 'achieved' &&
      g.status !== 'not_met',
  );
  // Most recent logs that actually have content, newest first.
  const recentLogs = [...myLogs]
    .filter((l) => logHasContent(l.blocks))
    .sort((a, b) => b.log_date.localeCompare(a.log_date))
    .slice(0, 4);

  // Internship tenure progress - interns only, when the board has set it.
  let internship: {
    month: number;
    months: number;
    pct: number;
    daysLeft: number;
    startDate: string;
    endDate: string;
  } | null = null;
  if (profile.role === 'intern' && profile.internship_months) {
    const start = parseDate(profile.joined_date);
    const end = addMonths(start, profile.internship_months);
    const totalDays = Math.max(1, daysBetween(start, end));
    const elapsed = Math.min(totalDays, Math.max(0, daysBetween(start, new Date())));
    internship = {
      month: Math.min(
        profile.internship_months,
        Math.floor((elapsed / totalDays) * profile.internship_months) + 1,
      ),
      months: profile.internship_months,
      pct: Math.round((elapsed / totalDays) * 100),
      daysLeft: Math.max(0, totalDays - elapsed),
      startDate: profile.joined_date,
      endDate: fmtDate(end),
    };
  }

  // Board-only roll-ups.
  let board: {
    profiles: Profile[];
    punchedIn: number;
    onLeave: number;
    notYet: number;
    pending: number;
    flaggedPunch: Profile[];
    flaggedLog: Profile[];
    pendingLeaves: {
      id: string;
      userName: string;
      userAvatarUrl: string | null;
      type: string;
      range: string;
      preApproverName: string | null;
    }[];
    depts: { name: string; total: number; punched: number; color: string }[];
  } | null = null;

  if (isBoard && boardData) {
    const [profiles, allPunches, allLeaves, deptColors] = boardData;
    const todayAll = allPunches.filter((p) => p.work_date === today);
    const punchedSet = new Set(todayAll.map((p) => p.user_id));
    const punchedIn = profiles.filter((u) => punchedSet.has(u.id)).length;
    const onLeave = profiles.filter((u) => isOnLeave(allLeaves, u.id, today)).length;
    const notYet = profiles.filter(
      (u) => !punchedSet.has(u.id) && !isOnLeave(allLeaves, u.id, today),
    ).length;
    const pendingList = allLeaves.filter((l) => l.status === 'pending');
    // The "needs your review" widget below excludes the viewer's own request
    // — a Board Member can't review their own leave (see reviewLeave), so
    // showing it here with review buttons would be both wrong and useless.
    const reviewableList = pendingList.filter((l) => l.user_id !== profile.id);

    const depts: Record<string, { name: string; total: number; punched: number; color: string }> =
      {};
    profiles.forEach((u) => {
      if (!depts[u.department])
        depts[u.department] = {
          name: u.department,
          total: 0,
          punched: 0,
          color: deptColors[u.department] ?? 'var(--color-green-primary)',
        };
      depts[u.department].total += 1;
      if (punchedSet.has(u.id)) depts[u.department].punched += 1;
    });

    board = {
      profiles,
      punchedIn,
      onLeave,
      notYet,
      pending: pendingList.length,
      flaggedPunch: profiles.filter(
        (u) =>
          u.id !== profile.id && !punchedSet.has(u.id) && !isOnLeave(allLeaves, u.id, today),
      ),
      flaggedLog: [],
      pendingLeaves: reviewableList.slice(0, 3).map((l) => {
        const u = profiles.find((p) => p.id === l.user_id);
        const acc = l.pre_approved_by
          ? profiles.find((p) => p.id === l.pre_approved_by)
          : null;
        return {
          id: l.id,
          userName: u?.name ?? 'Unknown',
          userAvatarUrl: u?.avatar_url ?? null,
          type: l.type,
          range:
            l.start_date === l.end_date
              ? l.start_date
              : `${l.start_date} - ${l.end_date}`,
          preApproverName: l.pre_approved_by ? (acc?.name ?? 'A Board Member') : null,
        };
      }),
      depts: Object.values(depts),
    };
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 28 }}>
        <Greeting
          name={profile.name}
          joinedDate={profile.joined_date}
          role={profile.role}
          internshipMonths={profile.internship_months}
          badge={
            isMgr && profile.managed_department ? (
              <ManagerBadge department={profile.managed_department} accent={managedColor} />
            ) : null
          }
        />
        <div className="page-header-actions">
          {FEATURE_FLAGS.dailyLog ? (
            <Link href="/log" className="btn btn-secondary">
              Open today&apos;s log
            </Link>
          ) : null}
          <Link href="/punch" className="btn">
            Go to punch
          </Link>
        </div>
      </div>

      {/* align-items:start keeps each column at its natural height. Without it
          the grid stretches the shorter (left) column to match the taller
          right one, and CSS Grid then inflates each card to fill — leaving a
          dead blank area inside the short Punch card. */}
      <div
        className="grid grid-2fr1fr"
        style={{ gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}
      >
        <div className="grid gap-4">
          <PunchWidget
            initialStatus={status}
            initialTotalMs={total}
            sessionCount={todayPunches.length + (crossMidnight ? 1 : 0)}
            expectedHrs={targetHours(profile)}
            lastPunchIn={active?.punch_in ?? todayPunches[todayPunches.length - 1]?.punch_in ?? null}
            lastPunchOut={todayPunches[todayPunches.length - 1]?.punch_out ?? null}
          />

          {FEATURE_FLAGS.notificationsFull && celebrants.length > 0 ? (
            <BirthdayBanner celebrants={celebrants} viewerId={profile.id} />
          ) : null}

          {FEATURE_FLAGS.dashboardExtras && internship ? (
            <div className="card" style={{ borderLeft: '3px solid var(--color-green-primary)' }}>
              <div className="card-header">
                <div>
                  <div className="card-subtitle">Internship</div>
                  <div className="text-xs text-grey mt-1">
                    Month {internship.month} of {internship.months}
                  </div>
                </div>
                <span className="badge">
                  {internship.daysLeft === 0
                    ? 'Final day'
                    : `${internship.daysLeft} days left`}
                </span>
              </div>
              <div className="flex items-end gap-3 mt-2">
                <div className="text-3xl fw-bold">{internship.pct}%</div>
                <div className="text-sm text-grey mb-1">complete</div>
              </div>
              <div className="goal-progress">
                <div
                  className="goal-progress-fill"
                  style={{ width: `${internship.pct}%` }}
                />
              </div>
              <div className="text-xs text-grey mt-2">
                Onboarded {fmtFriendly(parseDate(internship.startDate))} · ends{' '}
                {fmtFriendly(parseDate(internship.endDate))}
              </div>
            </div>
          ) : null}

          {isBoard && board ? (
            <div className="card active-card">
              <div className="card-header">
                <div>
                  <div className="card-subtitle">Team pulse</div>
                  <div className="text-xs text-grey mt-1">
                    Live · {board.profiles.length} people
                  </div>
                </div>
                <span className="badge badge-slate">Board view</span>
              </div>
              <div className="grid grid-4 gap-3 mt-3">
                <Stat label="Punched in" value={board.punchedIn} color="var(--color-green-primary)" />
                <Stat label="On leave" value={board.onLeave} color="var(--color-amber-text)" />
                <Stat label="Not yet" value={board.notYet} color="var(--color-red)" />
                <Stat label="Pending reqs" value={board.pending} color="var(--color-slate)" />
              </div>
            </div>
          ) : null}

          <div className="card" data-tour="goals-card">
            <div className="card-header">
              <div>
                <div className="card-subtitle">This week&apos;s tasks</div>
                <div className="text-xs text-grey mt-1">
                  Week {weekNumber(new Date())} ·{' '}
                  {isBoard ? 'all tasks' : 'assigned to you'} · {weekGoals.length} active
                </div>
              </div>
              <span className="badge">Due this week</span>
            </div>
            {weekGoals.length === 0 ? (
              <div className="text-grey text-sm mt-2">
                {isBoard
                  ? 'No tasks due this week.'
                  : 'No tasks due this week for you.'}
              </div>
            ) : (
              <div className="grid gap-3">
                {weekGoals.map((g) => (
                  <div
                    key={g.id}
                    style={{ padding: 12, background: 'var(--color-green-light)', borderRadius: 8 }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="fw-medium">{g.title}</div>
                      <div className="text-xs fw-medium text-green">{g.progress || 0}%</div>
                    </div>
                    <div className="goal-progress">
                      <div className="goal-progress-fill" style={{ width: `${g.progress || 0}%` }} />
                    </div>
                    {/* The tier matters here now: this card used to list one
                        tier only (Weekly), so every row was alike. It spans all
                        tiers today, and a Yearly task reads very differently
                        from a Daily one. */}
                    <div className="text-xs text-grey mt-2">
                      {LEVEL_META[g.level].label} ·{' '}
                      {g.due_date ? `Due ${fmtRelative(parseDate(g.due_date))} · ` : ''}
                      {g.department}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isBoard && board ? (
            <div className="card">
              <div className="card-subtitle mb-4">Department check-in</div>
              <div className="flex items-center gap-6" style={{ flexWrap: 'wrap' }}>
                {board.depts.map((d) => {
                  const pct = d.total === 0 ? 0 : (d.punched / d.total) * 100;
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <div className="relative">
                        <Donut
                          data={[{ value: pct, color: d.color }]}
                          total={100}
                          size={56}
                          thickness={8}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {Math.round(pct)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-sm fw-medium">{d.name}</div>
                        <div className="text-xs text-grey">
                          {d.punched}/{d.total} in
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4">
          <StreakCard streak={streak} />

          <div className="card">
            <div className="card-subtitle mb-3">Quick actions</div>
            <div className="grid gap-2">
              <Link href="/punch" className="btn btn-secondary">Punch In/Out</Link>
              {FEATURE_FLAGS.dailyLog ? (
                <Link href="/log" className="btn btn-secondary">Log today&apos;s work</Link>
              ) : null}
              <Link href="/goals" className="btn btn-secondary">View tasks</Link>
              <Link href="/leaves" className="btn btn-secondary">Request leave</Link>
            </div>
          </div>

          {FEATURE_FLAGS.dailyLog ? (
            <div className="card">
              <div className="card-header">
                <div className="card-subtitle">Recent logs</div>
                <Link href="/log/history" className="text-green text-xs fw-medium">
                  View all →
                </Link>
              </div>
              {recentLogs.length === 0 ? (
                <div className="text-grey text-sm mt-2">
                  No logs yet. <Link href="/log" className="text-green">Write today&apos;s →</Link>
                </div>
              ) : (
                <div className="grid gap-3">
                  {recentLogs.map((l) => (
                    <Link
                      key={l.id}
                      href={'/log?date=' + l.log_date}
                      style={{
                        display: 'block',
                        padding: 10,
                        borderRadius: 8,
                        background: 'var(--color-bg)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm fw-medium">
                          {fmtRelative(parseDate(l.log_date))}
                        </div>
                        {l.mood ? <span style={{ fontSize: 16 }}>{l.mood}</span> : null}
                      </div>
                      <div
                        className="text-xs text-grey"
                        style={{ maxHeight: 36, overflow: 'hidden', marginTop: 2 }}
                      >
                        <BlockRender blocks={(l.blocks || []).slice(0, 1)} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {isBoard && board ? (
            <div className="card">
              <div className="card-header">
                <div className="card-subtitle">Pending leave requests</div>
                <Link href="/leaves" className="text-green text-xs fw-medium">
                  View all →
                </Link>
              </div>
              {board.pendingLeaves.length === 0 ? (
                <div className="text-grey text-sm mt-2">No leave requests need review.</div>
              ) : (
                <div className="grid gap-2">
                  {board.pendingLeaves.map((l) => (
                    <LeaveReviewRow key={l.id} {...l} isFounder={founder} />
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {FEATURE_FLAGS.dashboardExtras && isBoard && board ? (
            <div className="card">
              <div className="card-subtitle mb-3">Flagged members</div>
              {board.flaggedPunch.length === 0 ? (
                <div className="text-grey text-sm">Everyone is punched in.</div>
              ) : (
                <div>
                  <div className="text-xs fw-medium text-grey mb-2">Not punched in today</div>
                  {board.flaggedPunch.map((u) => (
                    <Link
                      key={u.id}
                      href={`/team/${u.id}`}
                      className="flex items-center gap-3 mb-2"
                    >
                      <span className="badge badge-red">No punch</span>
                      <div className="flex-1">
                        <div className="text-sm fw-medium">{u.name}</div>
                        <div className="text-xs text-grey">{roleLabel(u.role)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
