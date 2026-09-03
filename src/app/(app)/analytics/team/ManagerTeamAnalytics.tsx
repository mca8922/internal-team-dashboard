// Department Manager's team analytics — scoped to the manager's picked team
// and the department they head. Mirrors the Board's team analytics but with NO
// log-derived metrics (managers never see team logs) and no individual leave.
import Link from 'next/link';
import {
  getManagedTeam,
  getAllPunches,
  getGoals,
  getDepartmentColors,
  punchTotalMsForDate,
} from '@/lib/queries';
import { weeklyTargetHours } from '@/lib/roles';
import { fmtDate, addDays, startOfWeek, fmtShort, isWeekend } from '@/lib/dates';
import { Avatar, Donut, Progress } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { LineChart } from '@/components/charts';
import { deriveGoalStatus } from '@/app/(app)/goals/goal-ui';

export async function ManagerTeamAnalytics({
  managerId,
  department,
}: {
  managerId: string;
  department: string;
}) {
  const today = new Date();
  const weekStart = startOfWeek(today);
  const recentFrom = fmtDate(addDays(weekStart, -7));

  const [team, punches, goals, deptColorMap] = await Promise.all([
    getManagedTeam(managerId),
    getAllPunches(recentFrom), // RLS scopes to the manager's team (+ self)
    getGoals(),
    getDepartmentColors(),
  ]);

  // The roll-up is the TEAM only (exclude the manager themselves — their own
  // numbers live on the personal Analytics page).
  const profiles = team.filter((u) => u.id !== managerId);
  const teamIds = new Set(profiles.map((u) => u.id));
  const teamPunches = punches.filter((p) => teamIds.has(p.user_id));
  const deptGoals = goals.filter((g) => (g.department || '') === department);
  const accent = deptColorMap[department] ?? 'var(--color-green-primary)';

  const msFor = (userId: string, ds: string) =>
    punchTotalMsForDate(
      teamPunches.filter((p) => p.user_id === userId),
      ds,
    );

  // Team hours this week.
  let weekMs = 0;
  profiles.forEach((u) => {
    for (let i = 0; i < 7; i++) weekMs += msFor(u.id, fmtDate(addDays(weekStart, i)));
  });
  const teamWeeklyTarget = profiles.reduce((s, u) => s + weeklyTargetHours(u), 0);

  // Top performers (hours only — no log column).
  const perf = profiles
    .map((u) => {
      let ms = 0;
      for (let i = 0; i < 7; i++) ms += msFor(u.id, fmtDate(addDays(weekStart, i)));
      return { u, hours: ms / 3.6e6, weeklyTarget: weeklyTargetHours(u) };
    })
    .sort((a, b) => b.hours - a.hours);

  // Attendance last 14 days.
  const att: number[] = [];
  const attLabels: string[] = [];
  const attWeekend: boolean[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const ds = fmtDate(d);
    const p = new Set(teamPunches.filter((x) => x.work_date === ds).map((x) => x.user_id)).size;
    att.push(p);
    attLabels.push(fmtShort(d));
    attWeekend.push(isWeekend(d));
  }

  // Goals (this department).
  const todayStr = fmtDate(today);
  const gTotal = deptGoals.length;
  // Status is DERIVED from the checklist (deriveGoalStatus), never read off
  // the stored dropdown — otherwise these totals disagree with the badge on
  // the task itself.
  const gStatus = new Map(deptGoals.map((g) => [g.id, deriveGoalStatus(g)]));
  const gByStatus = { active: 0, inactive: 0, achieved: 0, not_met: 0 } as Record<string, number>;
  for (const g of deptGoals) {
    const s = gStatus.get(g.id)!;
    gByStatus[s] = (gByStatus[s] ?? 0) + 1;
  }
  const gOverdue = deptGoals.filter(
    (g) =>
      gStatus.get(g.id) !== 'achieved' &&
      gStatus.get(g.id) !== 'not_met' &&
      g.due_date &&
      g.due_date < todayStr,
  ).length;
  const gCompletionRate = gTotal ? Math.round((gByStatus.achieved / gTotal) * 100) : 0;
  const gActive = deptGoals.filter((g) => gStatus.get(g.id) === 'active');
  const gAvgProgress = gActive.length
    ? Math.round(gActive.reduce((s, g) => s + (g.progress || 0), 0) / gActive.length)
    : 0;
  const statusDonut = [
    { label: 'Active', value: gByStatus.active, color: 'var(--color-amber-text)' },
    { label: 'Completed', value: gByStatus.achieved, color: 'var(--color-green-primary)' },
    { label: 'Not met', value: gByStatus.not_met, color: 'var(--color-violet)' },
    { label: 'Not-Active', value: gByStatus.inactive, color: 'var(--color-slate)' },
  ].filter((d) => d.value > 0);

  const heatCls = (h: number) =>
    h > 6 ? 'heat-cell h4' : h > 4 ? 'heat-cell h3' : h > 2 ? 'heat-cell h2' : h > 0 ? 'heat-cell h1' : 'heat-cell';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team analytics</h1>
          <div className="page-subtitle">
            {department} department · {profiles.length} team member
            {profiles.length === 1 ? '' : 's'} · last 7 days
          </div>
        </div>
        <div className="page-header-actions">
          <Link href="/analytics" className="btn btn-secondary">
            <Icon name="arrow-left" size={15} /> Personal
          </Link>
        </div>
      </div>

      <div className="grid grid-5 gap-4 mb-6">
        <div className="card">
          <div className="card-subtitle">Team hours · this week</div>
          <div className="text-3xl fw-bold mt-1">
            {(weekMs / 3.6e6).toFixed(1)}h
            <span className="text-grey" style={{ fontSize: 16, fontWeight: 600 }}>
              {' '}/ {teamWeeklyTarget}h
            </span>
          </div>
          <div className="text-xs text-grey mt-1">Weekly target across your team</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Open tasks</div>
          <div className="text-3xl fw-bold mt-1">
            {
              deptGoals.filter(
                (g) => gStatus.get(g.id) !== 'achieved' && gStatus.get(g.id) !== 'not_met',
              ).length
            }
          </div>
          <div className="text-xs text-grey mt-1">In {department}</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Completion rate</div>
          <div className="text-3xl fw-bold mt-1">{gCompletionRate}%</div>
          <div className="text-xs text-grey mt-1">{gByStatus.achieved} completed</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Overdue tasks</div>
          <div
            className="text-3xl fw-bold mt-1"
            style={{ color: gOverdue ? 'var(--color-red)' : undefined }}
          >
            {gOverdue}
          </div>
          <div className="text-xs text-grey mt-1">Past due, not done</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Not met</div>
          <div
            className="text-3xl fw-bold mt-1"
            style={{ color: gByStatus.not_met ? 'var(--color-violet)' : undefined }}
          >
            {gByStatus.not_met}
          </div>
          <div className="text-xs text-grey mt-1">Worked on, missed target</div>
        </div>
      </div>

      <div className="analytics-bottom-row mb-6">
        <div className="card">
          <div className="card-subtitle mb-4">Tasks by status</div>
          {statusDonut.length === 0 ? (
            <div className="text-grey text-sm">No tasks in this department yet.</div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="relative">
                <Donut data={statusDonut} size={160} thickness={26} />
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                  <div className="text-center">
                    <div className="text-xs text-grey">Total</div>
                    <div className="text-xl fw-bold">{gTotal}</div>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                {statusDonut.map((d) => (
                  <div key={d.label} className="flex items-center gap-2 text-sm">
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: d.color, borderRadius: 2 }} />
                    <span className="fw-medium">{d.label}</span>
                    <span className="text-grey">{d.value}</span>
                  </div>
                ))}
              </div>
              <div className="ml-auto text-right">
                <div className="card-subtitle">Avg progress</div>
                <div className="text-2xl fw-bold">{gAvgProgress}%</div>
                <div className="text-xs text-grey">Active tasks</div>
              </div>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-subtitle mb-2">Attendance · last 14 days</div>
          <LineChart data={att} labels={attLabels} weekend={attWeekend} />
          <div className="text-xs text-grey mt-1">Team members punched in per day</div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-subtitle mb-3">Individual heatmap · this week</div>
        {profiles.length === 0 ? (
          <div className="text-grey text-sm">No team members yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Person</th>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                  const d = addDays(weekStart, i);
                  return (
                    <th
                      key={i}
                      className={isWeekend(d) ? 'weekend-col' : undefined}
                      style={{ textAlign: 'center' }}
                    >
                      {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][i]}
                      <div style={{ fontSize: 9, color: 'var(--color-grey-text)' }}>{fmtShort(d)}</div>
                    </th>
                  );
                })}
                <th style={{ textAlign: 'right' }}>Total / target</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((u) => {
                let total = 0;
                const cells = [0, 1, 2, 3, 4, 5, 6].map((i) => {
                  const h = msFor(u.id, fmtDate(addDays(weekStart, i))) / 3.6e6;
                  total += h;
                  return h;
                });
                return (
                  <tr key={u.id}>
                    <td className="fw-medium flex items-center gap-2">
                      <Avatar name={u.name} size="sm" src={u.avatar_url} /> {u.name}
                    </td>
                    {cells.map((h, i) => (
                      <td
                        key={i}
                        className={isWeekend(addDays(weekStart, i)) ? 'weekend-col' : undefined}
                        style={{ textAlign: 'center', padding: 4 }}
                      >
                        <div
                          className={heatCls(h)}
                          title={`${h.toFixed(1)}h`}
                          style={{ display: 'inline-block', width: 28, height: 28, borderRadius: 4 }}
                        />
                      </td>
                    ))}
                    <td className="text-right fw-bold">
                      {total.toFixed(1)}h
                      <span className="text-grey" style={{ fontWeight: 600 }}> / {weeklyTargetHours(u)}h</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {profiles.length > 0 ? (
        <div className="card mt-4" style={{ borderTop: `2px solid ${accent}` }}>
          <div className="card-subtitle mb-3">Top performers · this week</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Person</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {perf.slice(0, 5).map((p, i) => (
                <tr key={p.u.id}>
                  <td className="text-grey fw-medium">{i + 1}</td>
                  <td className="fw-medium flex items-center gap-2">
                    <Avatar name={p.u.name} size="sm" src={p.u.avatar_url} />
                    {p.u.name}
                  </td>
                  <td>
                    {p.hours.toFixed(1)}h
                    <span className="text-grey"> / {p.weeklyTarget}h</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
