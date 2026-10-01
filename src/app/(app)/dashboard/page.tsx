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
  getLogs,
  getLeaves,
  getDepartmentColors,
  punchTotalMsForDate,
  punchStatus,
  activeOpenSession,
  streakHealth,
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
  punchTotalMs,
} from '@/lib/dates';
import { targetHours, roleLabel, isFounder, isManager } from '@/lib/roles';
import { LEVEL_META, deriveGoalStatus } from '@/app/(app)/goals/goal-ui';
import { ManagerBadge } from '@/components/ManagerBadge';
import { PunchWidget } from './PunchWidget';
import { StreakCard } from '@/components/StreakCard';
import { TeamPulse } from '@/components/TeamPulse';
import type { TeamPulseData, PulseWorking, PulseAway, PulseRequest } from '@/components/TeamPulse';
import { LeaveReviewRow } from './LeaveReviewRow';
import { BirthdayBanner } from './BirthdayBanner';
import type { Profile, Punch, UserRole } from '@/lib/types';
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

// Department check-in — Board only, right column (Phase 3). Replaces the
// donut-per-department row: a bar per department reads at any width, from a
// 1/3 desktop column down to a phone, where a row of 56px donuts wrapped
// unpredictably. Rows arrive sorted lowest check-in first.
function DepartmentCheckIn({
  depts,
}: {
  depts: { name: string; total: number; punched: number; color: string }[];
}) {
  const total = depts.reduce((n, d) => n + d.total, 0);
  const punched = depts.reduce((n, d) => n + d.punched, 0);
  const overall = total === 0 ? 0 : Math.round((punched / total) * 100);
  return (
    <div className="card dept-card">
      <div className="card-header">
        <div>
          <div className="card-subtitle">Department check-in</div>
          <div className="dept-total">
            <strong>{punched}</strong> of <strong>{total}</strong> punched in today
          </div>
        </div>
        <span className="dept-total-pct">{overall}%</span>
      </div>
      {depts.length === 0 ? (
        <div className="dept-empty">No departments yet.</div>
      ) : (
        <div className="dept-list">
          {depts.map((d) => {
            const pct = d.total === 0 ? 0 : Math.round((d.punched / d.total) * 100);
            const tone = pct === 100 ? 'full' : pct === 0 ? 'none' : pct < 50 ? 'low' : 'ok';
            return (
              <div
                key={d.name}
                className="dept-row"
                data-tone={tone}
                role="group"
                aria-label={`${d.name}: ${d.punched} of ${d.total} punched in, ${pct}%`}
              >
                <div className="dept-row-head">
                  <span className="dept-row-dot" style={{ background: d.color }} aria-hidden />
                  <span className="dept-row-name">{d.name}</span>
                  <span className="dept-row-count">
                    <span>
                      <b>{d.punched}</b>/{d.total}
                    </span>
                    <span className="dept-row-pct">{pct}%</span>
                  </span>
                </div>
                <div className="dept-row-track" aria-hidden>
                  <div className="dept-row-fill" style={{ width: `${pct}%`, background: d.color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  // Birthday banner — gated behind notificationsFull, same tier as the rest
  // of the teammate-facing notification pipeline. Message privacy is enforced
  // server-side in getBirthdayCelebrants (see migration
  // 0056_birthday_privacy.sql), not just hidden in the UI. It depends on none of
  // the other queries, so it rides the same parallel batch instead of running
  // as a separate serial round-trip afterwards.
  const [myPunches, myAllLogs, allGoals, assignees, boardData, celebrants] =
    await Promise.all([
      getPunches(profile.id, punchFrom),
      // The streak can run longer than getRecentLogs' 40-day window (it used to
      // get silently cut short there) — logStreak needs the complete history to
      // walk all the way back to where it broke.
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
      FEATURE_FLAGS.notificationsFull
        ? getBirthdayCelebrants(profile.id)
        : Promise.resolve([] as Awaited<ReturnType<typeof getBirthdayCelebrants>>),
    ]);
  // Goals this member may see: assigned to them or their department
  // (the Board sees all).
  const goals = visibleGoals(allGoals, assignees, profile);

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
  // Phase 3: the Dashboard shows the streak card only while a streak is live
  // (1+ days) — 'safe', or 'at_risk' when today's log is still owed and it
  // ends at midnight. At 0 (never started, or just broken) the card is not
  // rendered at all; the Daily Log page is where a lost streak is reported.
  const health = streakHealth(myAllLogs);
  const showStreak = FEATURE_FLAGS.dailyLog && health.streak >= 1;
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
      // Settled is a fact about the checklist, not the stored dropdown —
      // deriveGoalStatus is the one rule the cards and filters use too.
      deriveGoalStatus(g) !== 'achieved' &&
      deriveGoalStatus(g) !== 'not_met',
  );
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
    pendingLeaves: {
      id: string;
      userName: string;
      userAvatarUrl: string | null;
      type: string;
      range: string;
      preApproverName: string | null;
    }[];
    depts: { name: string; total: number; punched: number; color: string }[];
    // Everything the Team pulse card needs to name the people behind each
    // number, not just count them. See components/TeamPulse.tsx.
    pulse: TeamPulseData;
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

    // --- Team pulse roster -------------------------------------------------
    // Same four buckets as the counts above, but carrying the people. Built
    // from data already in hand (today's punches, leaves, dept colours), so
    // the richer card costs no extra query. Ported from reStrucAI.
    const pulsePerson = (u: Profile) => ({
      id: u.id,
      name: u.name,
      avatarUrl: u.avatar_url,
      department: u.department,
      deptColor: deptColors[u.department] ?? 'var(--color-green-primary)',
      jobTitle: u.job_title || roleLabel(u.role),
    });

    const sessionsOf = new Map<string, Punch[]>();
    todayAll.forEach((p) => {
      const list = sessionsOf.get(p.user_id);
      if (list) list.push(p);
      else sessionsOf.set(p.user_id, [p]);
    });

    const working: PulseWorking[] = profiles
      .filter((u) => punchedSet.has(u.id))
      .map((u) => {
        // getAllPunches orders by punch_in, so the last row is the most recent.
        const sessions = sessionsOf.get(u.id) ?? [];
        const open = sessions.find((s) => !s.punch_out) ?? null;
        const closed = sessions.filter((s) => s.punch_out);
        return {
          ...pulsePerson(u),
          // Only the finished stretches are fixed; the open one is sent as a
          // start time and ticks on the client.
          openSince: open ? open.punch_in : null,
          closedMs: punchTotalMs(closed),
          lastOut: closed.length > 0 ? closed[closed.length - 1].punch_out : null,
          sessions: sessions.length,
        };
      })
      .sort((a, b) => Number(Boolean(b.openSince)) - Number(Boolean(a.openSince)));

    const away: PulseAway[] = profiles.flatMap((u) => {
      const l = allLeaves.find(
        (x) =>
          x.user_id === u.id &&
          x.status === 'approved' &&
          today >= x.start_date &&
          today <= x.end_date,
      );
      if (!l) return [];
      return [
        {
          ...pulsePerson(u),
          leaveType: l.type,
          halfDay: l.is_half_day,
          startDate: l.start_date,
          endDate: l.end_date,
        },
      ];
    });

    // Includes the viewer like anyone else, so this always matches `notYet`.
    // This list replaces the old "Flagged members" card.
    const idle = profiles
      .filter((u) => !punchedSet.has(u.id) && !isOnLeave(allLeaves, u.id, today))
      .map(pulsePerson);

    const requests: PulseRequest[] = pendingList
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .flatMap((l) => {
        const u = profiles.find((p) => p.id === l.user_id);
        if (!u) return [];
        const acc = l.pre_approved_by
          ? profiles.find((p) => p.id === l.pre_approved_by)
          : null;
        return [
          {
            ...pulsePerson(u),
            reqId: l.id,
            leaveType: l.type,
            halfDay: l.is_half_day,
            startDate: l.start_date,
            endDate: l.end_date,
            // Same count the Leaves page uses: half-day = 0.5, otherwise
            // inclusive calendar days.
            days: l.is_half_day ? 0.5 : daysBetween(l.start_date, l.end_date) + 1,
            askedAt: l.created_at,
            preApprovedBy: l.pre_approved_by ? (acc?.name ?? 'A Board Member') : null,
          },
        ];
      });

    board = {
      profiles,
      punchedIn,
      onLeave,
      notYet,
      pending: pendingList.length,
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
      // Lowest check-in first — the department that needs a look surfaces at
      // the top instead of wherever it happened to sit in the roster.
      depts: Object.values(depts).sort((a, b) => {
        const pctA = a.total === 0 ? 0 : a.punched / a.total;
        const pctB = b.total === 0 ? 0 : b.punched / b.total;
        return pctA - pctB || a.name.localeCompare(b.name);
      }),
      pulse: {
        // Summed from the buckets rather than profiles.length, so the bar
        // always fills exactly even if a bucket's rule changes.
        headcount: working.length + away.length + idle.length,
        // Stamped here so the card's first client render matches SSR before
        // its own clock takes over.
        nowMs: Date.now(),
        working,
        away,
        idle,
        requests,
      },
    };
  }

  // The right column only exists when it has something to show. For a member
  // with no live streak it would be empty, so the main column takes the full
  // width instead of leaving a blank third of the page.
  const hasSide = showStreak || !!board;

  return (
    <div>
      {/* Phase 3: the "Open today's log" / "Go to punch" buttons that sat to
          the right of the greeting are gone — both pages are one click away in
          the sidebar, and the punch card below has its own button. */}
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
      </div>

      {/* align-items:start keeps each column at its natural height. Without it
          the grid stretches the shorter (left) column to match the taller
          right one, and CSS Grid then inflates each card to fill — leaving a
          dead blank area inside the short Punch card. */}
      <div
        className={hasSide ? 'grid grid-2fr1fr' : 'grid'}
        style={{ gridTemplateColumns: hasSide ? '2fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}
      >
        <div className="grid gap-4" style={{ minWidth: 0 }}>
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

          {board ? <TeamPulse data={board.pulse} /> : null}

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
        </div>

        {/* Right column (Phase 3): Quick actions, Recent logs and Flagged
            members are gone — the last now lives in Team pulse's "Not yet"
            chip. What's left: the streak (only while live), then the Board's
            Department check-in and leave inbox. */}
        {hasSide ? (
          <div className="grid gap-4" style={{ minWidth: 0 }}>
            {showStreak ? (
              <StreakCard streak={health.streak} state={health.state} />
            ) : null}

            {board ? <DepartmentCheckIn depts={board.depts} /> : null}

            {board ? (
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
