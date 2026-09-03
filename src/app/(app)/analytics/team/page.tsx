// Team analytics — board-only org roll-ups.
import { redirect } from 'next/navigation';
import {
  getCurrentProfile,
  getAllProfiles,
  getManagedTeam,
  getAllPunches,
  getAllLogs,
  getLeaves,
  getGoals,
  getDepartmentColors,
  punchTotalMsForDate,
  logStreak,
  logHasContent,
} from '@/lib/queries';
import Link from 'next/link';
import { targetHours, isManager } from '@/lib/roles';
import { fmtDate, addDays, isWeekend, fmtShort, parseDate, daysBetween, GO_LIVE_DATE } from '@/lib/dates';
import { tierFor } from '@/lib/streak';
import { Avatar, Progress } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { LineChart } from '@/components/charts';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { DonutCard } from '@/components/DonutCard';
import { ManagerTeamAnalytics } from './ManagerTeamAnalytics';
import { type RangeMode } from './TeamRangeControl';
import { TeamAnalyticsShell } from './TeamAnalyticsShell';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { deriveGoalStatus } from '@/app/(app)/goals/goal-ui';

export const metadata = { title: 'Team analytics · Mahesh Chandra & Associates' };

export default async function TeamAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; m?: string }>;
}) {
  const viewer = (await getCurrentProfile())!;
  if (viewer.role !== 'board') {
    if (isManager(viewer)) return <ManagerTeamAnalytics managerId={viewer.id} department={viewer.managed_department ?? ''} />;
    redirect('/dashboard');
  }

  const today = new Date();
  const todayStr = fmtDate(today);
  const goLive = parseDate(GO_LIVE_DATE);

  // ── Time-range selection ────────────────────────────────────────────────
  // Presets (7/14/30 days, all time) are simple offsets from today. Month
  // reuses MonthStepper's exact ?m=YYYY-MM + current-month-clamp pattern
  // already used on Personal Analytics. Custom is a from/to pair, clamped to
  // [go-live, today] and to from <= to so a hand-edited URL can't produce a
  // nonsense range.
  const sp = await searchParams;
  const rangeMode: RangeMode =
    FEATURE_FLAGS.analyticsFilters &&
    (sp.range === '14' || sp.range === '30' || sp.range === 'all' || sp.range === 'custom' || sp.range === 'month')
      ? sp.range
      : '7';

  const curY = today.getFullYear();
  const curM = today.getMonth();
  let selY = curY;
  let selM = curM;
  if (FEATURE_FLAGS.analyticsFilters && rangeMode === 'month' && sp.m && /^\d{4}-\d{2}$/.test(sp.m)) {
    const [py, pm] = sp.m.split('-').map(Number);
    if (py && pm >= 1 && pm <= 12) {
      selY = py;
      selM = pm - 1;
    }
  }
  if (selY > curY || (selY === curY && selM > curM)) {
    selY = curY;
    selM = curM;
  }
  const isCurrentMonth = selY === curY && selM === curM;
  const monthValue = `${selY}-${String(selM + 1).padStart(2, '0')}`;
  const monthStartDate = new Date(selY, selM, 1);
  const monthEndDate = new Date(selY, selM + 1, 0);

  let rangeStart: Date;
  let rangeEnd: Date = today;
  let rangeLabel: string;
  switch (rangeMode) {
    case '14':
      rangeStart = addDays(today, -13);
      rangeLabel = 'last 14 days';
      break;
    case '30':
      rangeStart = addDays(today, -29);
      rangeLabel = 'last 30 days';
      break;
    case 'all':
      rangeStart = goLive;
      rangeLabel = 'all time';
      break;
    case 'month':
      rangeStart = monthStartDate;
      rangeEnd = isCurrentMonth ? today : monthEndDate;
      rangeLabel = monthStartDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      break;
    case 'custom': {
      let f = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? parseDate(sp.from) : addDays(today, -6);
      let t = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? parseDate(sp.to) : today;
      if (t > today) t = today;
      if (f > t) f = t;
      rangeStart = f;
      rangeEnd = t;
      rangeLabel = `${fmtShort(f)} – ${fmtShort(t)}`;
      break;
    }
    default:
      rangeStart = addDays(today, -6);
      rangeLabel = 'last 7 days';
  }
  if (rangeStart < goLive) rangeStart = goLive;
  const rangeDays = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
  const initialFrom = fmtDate(rangeStart);
  const initialTo = fmtDate(rangeEnd);

  const [profiles, punches, logs, allLogsEver, leaves, goals, deptColorMap] = await Promise.all([
    getAllProfiles(),
    getAllPunches(initialFrom),
    getAllLogs(initialFrom),
    // Unwindowed, for logStreak() below — a streak can run longer than any
    // fixed lookback (the same bug this fixed on the personal Dashboard), so
    // it needs each member's complete log history, not just the selected range.
    getAllLogs(),
    getLeaves(),
    getGoals(),
    getDepartmentColors(),
  ]);
  // Every member's own logs, grouped once instead of re-filtering the full
  // list per row.
  const logsByUser = new Map<string, typeof allLogsEver>();
  for (const l of allLogsEver) {
    const arr = logsByUser.get(l.user_id);
    if (arr) arr.push(l);
    else logsByUser.set(l.user_id, [l]);
  }
  const streakByUser = new Map(
    profiles.map((u) => [u.id, logStreak(logsByUser.get(u.id) ?? [])]),
  );

  // Per-user, per-day worked time, splitting any session that crosses midnight.
  const msFor = (userId: string, ds: string) =>
    punchTotalMsForDate(
      punches.filter((p) => p.user_id === userId),
      ds,
    );

  // Weekdays actually in range (stops at today for a range that would
  // otherwise reach into the future) — the shared denominator for log
  // completion, targets and top-performer comparisons.
  let weekdaysInRange = 0;
  for (let i = 0; i < rangeDays; i++) {
    const d = addDays(rangeStart, i);
    if (d > today) break;
    if (!isWeekend(d)) weekdaysInRange += 1;
  }
  const periodTargetByUser = new Map(
    profiles.map((u) => [u.id, targetHours(u) * weekdaysInRange]),
  );

  // total team hours in range
  let periodMs = 0;
  const depts: Record<string, number> = {};
  profiles.forEach((u) => {
    let dms = 0;
    for (let i = 0; i < rangeDays; i++) dms += msFor(u.id, fmtDate(addDays(rangeStart, i)));
    periodMs += dms;
    depts[u.department] = (depts[u.department] || 0) + dms;
  });
  const fallbackColors = [
    'var(--color-green-primary)',
    'var(--color-slate)',
    'var(--color-dark-grey)',
    'var(--color-green-darker)',
  ];
  const deptData = Object.entries(depts).map(([k, v], i) => ({
    label: k,
    value: v / 3.6e6,
    color: deptColorMap[k] ?? fallbackColors[i % fallbackColors.length],
  }));

  // log completion — every weekday in the selected range
  const logSet = new Set(
    logs.filter((l) => logHasContent(l.blocks)).map((l) => `${l.user_id}|${l.log_date}`),
  );
  let logged = 0;
  for (const u of profiles) {
    for (let i = 0; i < rangeDays; i++) {
      const d = addDays(rangeStart, i);
      if (d > today) break;
      if (isWeekend(d)) continue;
      if (logSet.has(`${u.id}|${fmtDate(d)}`)) logged += 1;
    }
  }
  const totalSlots = profiles.length * weekdaysInRange;

  const teamPeriodTarget = profiles.reduce((s, u) => s + (periodTargetByUser.get(u.id) ?? 0), 0);

  // top performers — hours + logged weekdays across the selected range
  const perf = profiles
    .map((u) => {
      let ms = 0;
      let logsN = 0;
      for (let i = 0; i < rangeDays; i++) {
        const d = addDays(rangeStart, i);
        if (d > today) break;
        const ds = fmtDate(d);
        ms += msFor(u.id, ds);
        if (!isWeekend(d) && logSet.has(`${u.id}|${ds}`)) logsN += 1;
      }
      return { u, hours: ms / 3.6e6, logs: logsN, periodTarget: periodTargetByUser.get(u.id) ?? 0 };
    })
    .sort((a, b) => b.hours - a.hours);

  // attendance — the selected range, capped to the most recent 60 days so
  // the trend line stays readable even when "All time" spans months.
  const attDays = Math.min(rangeDays, 60);
  const att: number[] = [];
  const attLabels: string[] = [];
  const attWeekend: boolean[] = [];
  for (let i = attDays - 1; i >= 0; i--) {
    const d = addDays(rangeEnd, -i);
    const ds = fmtDate(d);
    const p = new Set(punches.filter((x) => x.work_date === ds).map((x) => x.user_id)).size;
    att.push(p);
    attLabels.push(fmtShort(d));
    attWeekend.push(isWeekend(d));
  }
  const attLabel = rangeDays > attDays ? `last ${attDays} days` : rangeLabel;

  // ---- Goals analytics (all derived from the already-loaded goals) ----------
  // Goals are an evergreen snapshot (status/progress right now), not a
  // period roll-up — intentionally NOT affected by the range control above.
  const gTotal = goals.length;
  // Status is DERIVED from the checklist (deriveGoalStatus), never read off
  // the stored dropdown — otherwise these totals disagree with the badge on
  // the task itself.
  const gStatus = new Map(goals.map((g) => [g.id, deriveGoalStatus(g)]));
  const gByStatus = { active: 0, inactive: 0, achieved: 0, not_met: 0 } as Record<string, number>;
  for (const g of goals) {
    const s = gStatus.get(g.id)!;
    gByStatus[s] = (gByStatus[s] ?? 0) + 1;
  }
  const gOverdue = goals.filter(
    (g) =>
      gStatus.get(g.id) !== 'achieved' &&
      gStatus.get(g.id) !== 'not_met' &&
      g.due_date &&
      g.due_date < todayStr,
  ).length;
  const gCompletionRate = gTotal ? Math.round((gByStatus.achieved / gTotal) * 100) : 0;
  const gActive = goals.filter((g) => gStatus.get(g.id) === 'active');
  const gAvgProgress = gActive.length
    ? Math.round(gActive.reduce((s, g) => s + (g.progress || 0), 0) / gActive.length)
    : 0;
  const statusDonut = [
    { label: 'Active', value: gByStatus.active, color: 'var(--color-amber-text)' },
    { label: 'Completed', value: gByStatus.achieved, color: 'var(--color-green-primary)' },
    { label: 'Not met', value: gByStatus.not_met, color: 'var(--color-violet)' },
    { label: 'Not-Active', value: gByStatus.inactive, color: 'var(--color-slate)' },
  ].filter((d) => d.value > 0);

  type DeptGoals = {
    total: number;
    achieved: number;
    overdue: number;
    progressSum: number;
  };
  const gDept: Record<string, DeptGoals> = {};
  for (const g of goals) {
    const k = g.department || 'No department';
    const e = (gDept[k] ??= { total: 0, achieved: 0, overdue: 0, progressSum: 0 });
    e.total += 1;
    if (gStatus.get(g.id) === 'achieved') e.achieved += 1;
    if (
      gStatus.get(g.id) !== 'achieved' &&
      gStatus.get(g.id) !== 'not_met' &&
      g.due_date &&
      g.due_date < todayStr
    )
      e.overdue += 1;
    e.progressSum += g.progress || 0;
  }
  const gDeptRows = Object.entries(gDept)
    .map(([dept, e]) => ({ dept, ...e, avg: Math.round(e.progressSum / e.total) }))
    .sort((a, b) => b.total - a.total);

  // ── Individual heatmap ──────────────────────────────────────────────────
  // Per-day cells up to a month of range (readable as a single row); beyond
  // that (All time, or a long custom range) the grid switches to per-WEEK
  // aggregated cells so the table stays a sane width regardless of how far
  // back it goes, instead of growing one column per day forever.
  const heatCls = (h: number) =>
    h > 6 ? 'heat-cell h4' : h > 4 ? 'heat-cell h3' : h > 2 ? 'heat-cell h2' : h > 0 ? 'heat-cell h1' : 'heat-cell';
  // Weekly thresholds scaled up for a 7-day cell instead of a 1-day cell.
  const heatClsWeek = (h: number) =>
    h > 30 ? 'heat-cell h4' : h > 20 ? 'heat-cell h3' : h > 10 ? 'heat-cell h2' : h > 0 ? 'heat-cell h1' : 'heat-cell';
  const HEATMAP_DAY_CAP = 31;
  const useWeeklyHeatmap = rangeDays > HEATMAP_DAY_CAP;
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const heatCols: { label: string; sub: string; weekend: boolean; start: Date; span: number }[] =
    useWeeklyHeatmap
      ? (() => {
          const cols: { label: string; sub: string; weekend: boolean; start: Date; span: number }[] = [];
          let cursor = rangeStart;
          while (cursor <= rangeEnd) {
            const weekEnd = addDays(cursor, 6) > rangeEnd ? rangeEnd : addDays(cursor, 6);
            const span = daysBetween(cursor, weekEnd) + 1;
            cols.push({ label: fmtShort(cursor), sub: `${span}d`, weekend: false, start: cursor, span });
            cursor = addDays(cursor, 7);
          }
          return cols;
        })()
      : Array.from({ length: rangeDays }, (_, i) => {
          const d = addDays(rangeStart, i);
          return { label: DOW[d.getDay()], sub: fmtShort(d), weekend: isWeekend(d), start: d, span: 1 };
        });
  const heatRows = profiles.map((u) => {
    const cells = heatCols.map((col) => {
      let h = 0;
      for (let i = 0; i < col.span; i++) h += msFor(u.id, fmtDate(addDays(col.start, i))) / 3.6e6;
      return h;
    });
    return { u, cells, total: cells.reduce((a, b) => a + b, 0) };
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team analytics</h1>
          <div className="page-subtitle">Roll-ups across the org · {rangeLabel}</div>
        </div>
        <div className="page-header-actions">
          <Link href="/analytics" className="btn btn-secondary">
            <Icon name="arrow-left" size={15} /> Personal
          </Link>
        </div>
      </div>

      <TeamAnalyticsShell
        range={rangeMode}
        monthValue={monthValue}
        isCurrentMonth={isCurrentMonth}
        goLiveDate={GO_LIVE_DATE}
        todayStr={todayStr}
        initialFrom={initialFrom}
        initialTo={initialTo}
        contentKey={`${rangeMode}-${initialFrom}-${initialTo}`}
      >
      <div className="grid grid-4 gap-4 mb-6">
        <div className="card">
          <div className="card-subtitle">Team hours · {rangeLabel}</div>
          <div className="text-3xl fw-bold mt-1">
            <AnimatedNumber value={periodMs / 3.6e6} decimals={1} suffix="h" />
            <span className="text-grey" style={{ fontSize: 16, fontWeight: 600 }}>
              {' '}
              / {teamPeriodTarget}h
            </span>
          </div>
          <div className="text-xs text-grey mt-1">
            Target across {profiles.length} people
          </div>
        </div>
        <div className="card">
          <div className="card-subtitle">Log completion</div>
          <div className="text-3xl fw-bold mt-1">
            <AnimatedNumber value={totalSlots ? (logged / totalSlots) * 100 : 0} decimals={0} suffix="%" />
          </div>
          <div className="text-xs text-grey mt-1">
            {logged} / {totalSlots} slots
          </div>
        </div>
        <div className="card">
          <div className="card-subtitle">Pending leaves</div>
          <div className="text-3xl fw-bold mt-1">
            {leaves.filter((l) => l.status === 'pending').length}
          </div>
          <div className="text-xs text-grey mt-1">Awaiting your review</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Open tasks</div>
          <div className="text-3xl fw-bold mt-1">
            {
              goals.filter(
                (g) => gStatus.get(g.id) !== 'achieved' && gStatus.get(g.id) !== 'not_met',
              ).length
            }
          </div>
          <div className="text-xs text-grey mt-1">Active &amp; not-active, all tiers</div>
        </div>
      </div>

      {/* ── Goals analytics ── */}
      <div className="flex items-baseline gap-2 mb-3" style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Tasks</h2>
        <span className="text-xs text-grey">Execution across every department</span>
      </div>
      <div className="grid grid-5 gap-4 mb-6">
        <div className="card">
          <div className="card-subtitle">Total tasks</div>
          <div className="text-3xl fw-bold mt-1">{gTotal}</div>
          <div className="text-xs text-grey mt-1">All tiers</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Completion rate</div>
          <div className="text-3xl fw-bold mt-1">{gCompletionRate}%</div>
          <div className="text-xs text-grey mt-1">{gByStatus.achieved} completed</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Overdue</div>
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
        <div className="card">
          <div className="card-subtitle">Avg progress</div>
          <div className="text-3xl fw-bold mt-1">{gAvgProgress}%</div>
          <div className="text-xs text-grey mt-1">Active tasks</div>
        </div>
      </div>

      <div className="analytics-bottom-row mb-6">
        <div className="card analytics-donut-card">
          <div className="card-subtitle mb-4">Tasks by status</div>
          {statusDonut.length === 0 ? (
            <div className="text-grey text-sm">No tasks yet.</div>
          ) : (
            <DonutCard data={statusDonut} centerLabel="Total" centerValue={gTotal} />
          )}
        </div>
        <div className="card">
          <div className="card-subtitle mb-3">By department</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Department</th>
                <th style={{ textAlign: 'center' }}>Tasks</th>
                <th style={{ textAlign: 'center' }}>Done</th>
                <th style={{ textAlign: 'center' }}>Overdue</th>
                <th style={{ minWidth: 130 }}>Avg progress</th>
              </tr>
            </thead>
            <tbody>
              {gDeptRows.map((r) => (
                <tr key={r.dept}>
                  <td className="fw-medium">{r.dept}</td>
                  <td style={{ textAlign: 'center' }}>{r.total}</td>
                  <td style={{ textAlign: 'center' }}>{r.achieved}</td>
                  <td
                    style={{ textAlign: 'center', color: r.overdue ? 'var(--color-red)' : undefined }}
                  >
                    {r.overdue || '-'}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Progress value={r.avg} />
                      </div>
                      <span
                        className="text-xs text-grey"
                        style={{ minWidth: 30, textAlign: 'right' }}
                      >
                        {r.avg}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="analytics-bottom-row">
        <div className="card analytics-donut-card">
          <div className="card-subtitle mb-4">Hours by department</div>
          <DonutCard
            data={deptData.map((d) => ({ ...d, displayValue: `${d.value.toFixed(1)}h` }))}
            centerLabel="Total"
            centerValue={<AnimatedNumber value={periodMs / 3.6e6} decimals={0} suffix="h" />}
          />
        </div>
        <div className="card">
          <div className="card-subtitle mb-2">Attendance · {attLabel}</div>
          <LineChart key={`${initialFrom}-${initialTo}`} data={att} labels={attLabels} weekend={attWeekend} />
          <div className="text-xs text-grey mt-1">People punched in per day</div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-subtitle mb-3">
          Individual heatmap · {rangeLabel}
          {useWeeklyHeatmap ? (
            <span className="text-grey" style={{ fontWeight: 400 }}> · weekly totals</span>
          ) : null}
        </div>
        <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Person</th>
              {heatCols.map((col, i) => (
                <th
                  key={i}
                  className={col.weekend ? 'weekend-col' : undefined}
                  style={{ textAlign: 'center' }}
                >
                  {col.label}{' '}
                  <div style={{ fontSize: 9, color: 'var(--color-grey-text)' }}>
                    {col.sub}
                  </div>
                </th>
              ))}
              <th style={{ textAlign: 'right' }}>Total / target</th>
              <th style={{ textAlign: 'center' }}>Streak</th>
            </tr>
          </thead>
          <tbody>
            {heatRows.map(({ u, cells, total }) => {
              const streak = streakByUser.get(u.id) ?? 0;
              const tier = tierFor(streak);
              return (
                <tr key={u.id}>
                  <td className="fw-medium flex items-center gap-2">
                    <Avatar name={u.name} size="sm" src={u.avatar_url} /> {u.name}
                  </td>
                  {cells.map((h, i) => (
                    <td
                      key={i}
                      className={heatCols[i].weekend ? 'weekend-col' : undefined}
                      style={{ textAlign: 'center', padding: 4 }}
                    >
                      <div
                        className={useWeeklyHeatmap ? heatClsWeek(h) : heatCls(h)}
                        title={`${h.toFixed(1)}h`}
                        style={{
                          display: 'inline-block',
                          width: useWeeklyHeatmap ? 36 : 28,
                          height: 28,
                          borderRadius: 4,
                        }}
                      />
                    </td>
                  ))}
                  <td className="text-right fw-bold">
                    <AnimatedNumber value={total} decimals={1} suffix="h" />
                    <span className="text-grey" style={{ fontWeight: 600 }}>
                      {' '}
                      / {periodTargetByUser.get(u.id) ?? 0}h
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {streak > 0 ? (
                      <span
                        className="fw-bold"
                        style={{ color: tier.color, whiteSpace: 'nowrap' }}
                        title={tier.label ? `${tier.label} · ${streak} working days` : `${streak} working days`}
                      >
                        🔥 {streak}
                      </span>
                    ) : (
                      <span className="text-grey">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-subtitle mb-3">Top performers · {rangeLabel}</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Person</th>
              <th>Department</th>
              <th>Hours</th>
              <th>Logs</th>
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
                <td className="text-grey">{p.u.department}</td>
                <td>
                  <AnimatedNumber value={p.hours} decimals={1} suffix="h" />
                  <span className="text-grey"> / {p.periodTarget}h</span>
                </td>
                <td>{p.logs}/{weekdaysInRange}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </TeamAnalyticsShell>
    </div>
  );
}
