// Team page — board-only grid of everyone with live punch status,
// plus per-member management (department, target hours, offboarding).
import { redirect } from 'next/navigation';
import {
  getCurrentProfile,
  getAllProfiles,
  getManagedTeam,
  getAllPunches,
  getAllLogs,
  getLeaves,
  getOnLeaveUserIdsToday,
  getGoals,
  getDepartmentColors,
  punchTotalMsForDate,
  punchStatus,
  activeOpenSession,
  isOnLeave,
} from '@/lib/queries';
import {
  fmtDate,
  addDays,
  startOfWeek,
  durationHours,
  fmtDateDMY,
  fmtTime,
} from '@/lib/dates';
import { roleDefaultHours, targetHours, isFounder, isManager } from '@/lib/roles';
import { TeamGrid, type TeamMember } from './TeamGrid';
import { ManagerTeamView, type ManagerTeamMember } from './ManagerTeamView';
import type { Profile } from '@/lib/types';

export const metadata = { title: 'Team · Mahesh Chandra & Associates' };

export default async function TeamPage() {
  const profile = (await getCurrentProfile())!;
  // Department Managers get a scoped, read-only-ish team view (no logs, edits
  // go through change requests). Everyone else who isn't Board is sent home.
  if (profile.role !== 'board') {
    if (isManager(profile)) return <ManagerTeamPage profile={profile} />;
    redirect('/dashboard');
  }

  const weekStart = startOfWeek(new Date());
  // Pull a wider punch window so "last seen" can reach back beyond this
  // week; the weekly + today slices below still filter by work_date.
  const punchFrom = fmtDate(addDays(new Date(), -90));
  const [profiles, punches, logs, leaves, goals, deptColors] = await Promise.all([
    getAllProfiles({ includeInactive: true }),
    getAllPunches(punchFrom),
    getAllLogs(),
    getLeaves(),
    getGoals(),
    getDepartmentColors(),
  ]);

  // How many goals are tagged to each department — feeds the "delete only when
  // unused" guard in the manage-departments UI.
  const goalDeptCounts: Record<string, number> = {};
  for (const g of goals) {
    const d = (g.department || '').trim();
    if (d) goalDeptCounts[d] = (goalDeptCounts[d] || 0) + 1;
  }

  const today = fmtDate(new Date());

  const members: TeamMember[] = profiles.map((u) => {
    const userPunches = punches.filter((p) => p.user_id === u.id);
    const todaySessions = userPunches.filter((p) => p.work_date === today);
    const onLeave = isOnLeave(leaves, u.id, today);
    // Today's worked time, splitting any midnight-crossing session.
    const todayMs = punchTotalMsForDate(userPunches, today);

    // "Done for today" only counts once a member has worked at least 60% of
    // their daily target — punching out a few minutes in doesn't mark them
    // done. Under that threshold (but punched out) they read as a short day.
    const doneThresholdMs = targetHours(u) * 0.6 * 60 * 60 * 1000;
    // A still-running session that began late last night counts as on the clock
    // today, so the board sees the same live status the member sees.
    const raw = activeOpenSession(userPunches) ? 'in' : punchStatus(todaySessions);
    const status: TeamMember['status'] = onLeave
      ? 'leave'
      : raw === 'in'
        ? 'in'
        : raw === 'complete'
          ? todayMs >= doneThresholdMs
            ? 'complete'
            : 'short'
          : 'not-started';

    let weeklyMs = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      if (d > new Date()) break;
      weeklyMs += punchTotalMsForDate(userPunches, fmtDate(d));
    }

    const userLogDates = logs
      .filter((l) => l.user_id === u.id && l.blocks && l.blocks.length)
      .map((l) => l.log_date)
      .sort();
    const lastLog = userLogDates.length ? userLogDates[userLogDates.length - 1] : null;

    // Last seen — the most recent punch activity (a punch-out, or the
    // punch-in of a still-open session). If they are on the clock now,
    // that is reported as "Active now" instead.
    let lastSeenMs: number | null = null;
    for (const p of punches) {
      if (p.user_id !== u.id) continue;
      const t = p.punch_out || p.punch_in;
      if (!t) continue;
      const ms = new Date(t).getTime();
      if (lastSeenMs == null || ms > lastSeenMs) lastSeenMs = ms;
    }
    // Board wants the exact moment of last activity, not a relative phrase —
    // "Last seen 20-05-2026 · 3:41 PM" is easier to cross-reference than
    // "Last seen yesterday" when reviewing attendance.
    const lastSeenLabel =
      status === 'in'
        ? 'Active now'
        : lastSeenMs == null
          ? 'No recent activity'
          : `Last seen ${fmtDateDMY(new Date(lastSeenMs))} · ${fmtTime(new Date(lastSeenMs))}`;

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      commuteEmail: u.commute_email,
      role: u.role,
      department: u.department,
      deptColor: deptColors[u.department] ?? null,
      avatarUrl: u.avatar_url,
      isActive: u.is_active,
      leftAt: u.left_at,
      targetHours: u.daily_target_hours,
      roleDefaultHours: roleDefaultHours(u.role),
      internshipMonths: u.internship_months,
      joinedDate: u.joined_date,
      dateOfBirth: u.date_of_birth,
      jobTitle: u.job_title || '',
      isFounder: isFounder(u),
      isManager: !!u.is_manager,
      managedDepartment: u.managed_department,
      managerId: u.manager_id,
      managerResponsibilities: u.manager_responsibilities,
      directorId: u.director_id,
      status,
      todayMs,
      weeklyHours: durationHours(weeklyMs),
      lastLog,
      lastSeenLabel,
    };
  });

  return (
    <TeamGrid
      members={members}
      currentUserId={profile.id}
      viewerIsFounder={isFounder(profile)}
      viewerDepartment={profile.department ?? ''}
      goalDeptCounts={goalDeptCounts}
      deptColors={deptColors}
    />
  );
}

// ── Department Manager team view ──────────────────────────────────────────────
// A Manager sees ONLY their picked team (members whose manager_id = them), with
// punch-based status and analytics but NO daily-log information. Leave status is
// the bare "on leave today" fact (no leave details) — same exposure the rest of
// the app uses. Per-member edits are requests, handled inside ManagerTeamView.
async function ManagerTeamPage({ profile }: { profile: Profile }) {
  const weekStart = startOfWeek(new Date());
  const punchFrom = fmtDate(addDays(new Date(), -90));
  const [team, punches, deptColors, onLeaveToday] = await Promise.all([
    getManagedTeam(profile.id),
    getAllPunches(punchFrom), // RLS scopes to the manager's team (+ self)
    getDepartmentColors(),
    getOnLeaveUserIdsToday(),
  ]);

  const today = fmtDate(new Date());
  const onLeaveSet = new Set(onLeaveToday);

  const members: ManagerTeamMember[] = team.map((u) => {
    const userPunches = punches.filter((p) => p.user_id === u.id);
    const todaySessions = userPunches.filter((p) => p.work_date === today);
    const onLeave = onLeaveSet.has(u.id);
    const todayMs = punchTotalMsForDate(userPunches, today);
    const doneThresholdMs = targetHours(u) * 0.6 * 60 * 60 * 1000;
    const raw = activeOpenSession(userPunches) ? 'in' : punchStatus(todaySessions);
    const status: ManagerTeamMember['status'] = onLeave
      ? 'leave'
      : raw === 'in'
        ? 'in'
        : raw === 'complete'
          ? todayMs >= doneThresholdMs
            ? 'complete'
            : 'short'
          : 'not-started';

    let weeklyMs = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      if (d > new Date()) break;
      weeklyMs += punchTotalMsForDate(userPunches, fmtDate(d));
    }

    let lastSeenMs: number | null = null;
    for (const p of userPunches) {
      const t = p.punch_out || p.punch_in;
      if (!t) continue;
      const ms = new Date(t).getTime();
      if (lastSeenMs == null || ms > lastSeenMs) lastSeenMs = ms;
    }
    const lastSeenLabel =
      status === 'in'
        ? 'Active now'
        : lastSeenMs == null
          ? 'No recent activity'
          : `Last seen ${fmtDateDMY(new Date(lastSeenMs))} · ${fmtTime(new Date(lastSeenMs))}`;

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department,
      deptColor: deptColors[u.department] ?? null,
      avatarUrl: u.avatar_url,
      jobTitle: u.job_title || '',
      targetHours: u.daily_target_hours,
      roleDefaultHours: roleDefaultHours(u.role),
      status,
      todayMs,
      weeklyHours: durationHours(weeklyMs),
      lastSeenLabel,
    };
  });

  return (
    <ManagerTeamView
      department={profile.managed_department ?? ''}
      deptColor={deptColors[profile.managed_department ?? ''] ?? null}
      responsibilities={profile.manager_responsibilities ?? ''}
      members={members}
    />
  );
}
