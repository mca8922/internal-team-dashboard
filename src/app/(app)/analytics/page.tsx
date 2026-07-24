// Personal analytics — hours, mood, streaks, leave usage. Server Component
// does all the aggregation; charts render on the client.
import {
  getCurrentProfile,
  getPunches,
  getLogs,
  getLeaves,
  getHolidays,
  punchTotalMsForDate,
  logStreak,
  leaveUsage,
  isOnLeave,
  isHoliday,
  leaveLabel,
} from '@/lib/queries';
import { fmtDate, addDays, startOfWeek, isWeekend, isWorkingDay, fmtWeekday, fmtShort, daysBetween, GO_LIVE_DATE, parseDate } from '@/lib/dates';
import Link from 'next/link';
import { weeklyTargetHours, isManager } from '@/lib/roles';
import { BarChart, LineChart, EnergyChart } from '@/components/charts';
import { Progress } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { AnalyticsExport } from './AnalyticsExport';
import { MonthStepper } from '@/components/MonthStepper';
import { WeekStepper } from '@/components/WeekStepper';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Analytics · reStrucAI' };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; w?: string }>;
}) {
  const profile = (await getCurrentProfile())!;
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  // Selected month for the "Daily hours" chart — defaults to the current month
  // and never the future. `?m=YYYY-MM` (set by the MonthStepper) drives it.
  const sp = await searchParams;
  const curY = today.getFullYear();
  const curM = today.getMonth(); // 0-based
  let selY = curY;
  let selM = curM;
  if (FEATURE_FLAGS.analyticsFilters && sp.m && /^\d{4}-\d{2}$/.test(sp.m)) {
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
  const selMonthStart = new Date(selY, selM, 1);
  const prevMonthStart = new Date(selY, selM - 1, 1);
  const selMonthValue = `${selY}-${String(selM + 1).padStart(2, '0')}`;

  // Selected week for "Hours per day" — same pattern as the month above, just
  // stepping by 7 days. `?w=YYYY-MM-DD` (the Monday of that week, set by
  // WeekStepper) drives it; defaults to the current week and never the future.
  const currentWeekStart = startOfWeek(today);
  let selWeekStart = currentWeekStart;
  if (FEATURE_FLAGS.analyticsFilters && sp.w && /^\d{4}-\d{2}-\d{2}$/.test(sp.w)) {
    selWeekStart = startOfWeek(parseDate(sp.w));
  }
  if (selWeekStart > currentWeekStart) selWeekStart = currentWeekStart;
  const isCurrentWeek = fmtDate(selWeekStart) === fmtDate(currentWeekStart);
  const selWeekValue = fmtDate(selWeekStart);

  // Reach back far enough for BOTH charts' ghost/overlay data — the month
  // chart's previous month, and the week chart's "last week" a full 7 days
  // before whichever week is selected (which can be much further back than
  // the current month once someone steps the week filter).
  const punchesFrom = fmtDate(
    new Date(Math.min(addDays(prevMonthStart, -2).getTime(), addDays(selWeekStart, -8).getTime())),
  );
  const [punches, logs, leaves, holidays] = await Promise.all([
    getPunches(profile.id, punchesFrom),
    getLogs(profile.id),
    getLeaves(profile.id),
    getHolidays(),
  ]);

  const hoursFor = (ds: string) =>
    Math.round((punchTotalMsForDate(punches, ds) / 3.6e6) * 10) / 10;

  // this week vs last
  const weekStart = selWeekStart;
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const thisWeek: number[] = [];
  const lastWeek: number[] = [];
  const weekWeekend: boolean[] = [];
  // Only "this week"'s own leave is marked — "last week" is a different
  // calendar date under the same column and isn't tracked here.
  const weekLeave: (string | null)[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    thisWeek.push(d > today ? 0 : hoursFor(fmtDate(d)));
    lastWeek.push(hoursFor(fmtDate(addDays(d, -7))));
    weekWeekend.push(isWeekend(d));
    weekLeave.push(leaveLabel(leaves, profile.id, fmtDate(d)));
  }
  const totalThisWeek = Math.round(thisWeek.reduce((a, b) => a + b, 0) * 10) / 10;
  const totalLastWeek = Math.round(lastWeek.reduce((a, b) => a + b, 0) * 10) / 10;
  const weekDelta = Math.round((totalThisWeek - totalLastWeek) * 10) / 10;
  // The "This week" stat tile up top has a fixed label, so its number must
  // always mean the TRUE current week — independent of the chart's browsable
  // selWeekStart below. When isCurrentWeek these are identical to
  // totalThisWeek/weekDelta anyway; they only diverge once someone actually
  // steps the chart back.
  let actualWeekTotal = 0;
  let actualLastWeekTotal = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(currentWeekStart, i);
    actualWeekTotal += d > today ? 0 : hoursFor(fmtDate(d));
    actualLastWeekTotal += hoursFor(fmtDate(addDays(d, -7)));
  }
  actualWeekTotal = Math.round(actualWeekTotal * 10) / 10;
  const actualWeekDelta = Math.round((actualWeekTotal - actualLastWeekTotal) * 10) / 10;
  // "This week" reads cleanly for the common case; a browsed-back week needs
  // its actual dates since "this/last" would otherwise be ambiguous.
  const selWeekLabel = isCurrentWeek
    ? 'This week'
    : `${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`;
  const lastWeekLabel = isCurrentWeek
    ? 'Last week'
    : `${fmtShort(addDays(weekStart, -7))} – ${fmtShort(addDays(weekStart, -1))}`;

  // On-time consistency (below) still measures the CURRENT month.
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  // Selected month vs the previous month (drawn as a ghost behind it). The
  // current month stops at today; a past month renders in full.
  const selDaysInMonth = new Date(selY, selM + 1, 0).getDate();
  const monthData: number[] = [];
  const prevMonthData: number[] = [];
  const monthLabels: string[] = [];
  const monthWeekend: boolean[] = [];
  // Only the selected month's own leave is marked, not the prior-month ghost.
  const monthLeave: (string | null)[] = [];
  for (let i = 0; i < selDaysInMonth; i++) {
    const d = addDays(selMonthStart, i);
    if (isCurrentMonth && d > today) break;
    monthData.push(hoursFor(fmtDate(d)));
    prevMonthData.push(hoursFor(fmtDate(addDays(prevMonthStart, i))));
    monthLabels.push(String(i + 1));
    monthWeekend.push(isWeekend(d));
    monthLeave.push(leaveLabel(leaves, profile.id, fmtDate(d)));
  }
  const selMonthName = selMonthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const prevMonthName = prevMonthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  // energy — last 14 days (raw 0–5 values; 0 = no log)
  const logMap = new Map(logs.map((l) => [l.log_date, l]));
  const energyData: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const ds = fmtDate(addDays(today, -i));
    energyData.push(logMap.get(ds)?.energy_level || 0);
  }

  // tags
  const tagFreq: Record<string, number> = {};
  logs.forEach((l) => (l.tags || []).forEach((t) => (tagFreq[t] = (tagFreq[t] || 0) + 1)));
  const tagEntries = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // streak + longest — both walk the full history (go-live → today), the
  // same range logStreak() itself uses. A fixed lookback (this used to be the
  // last 60 days) can end up SHORTER than an ongoing streak once that streak
  // outlives the window, which made "longest" read lower than "current" —
  // impossible, since a live streak is by definition its own longest run.
  const streak = logStreak(logs);
  const historyDays = daysBetween(GO_LIVE_DATE, today);
  let longest = 0;
  let run = 0;
  for (let i = historyDays; i >= 0; i--) {
    const d = addDays(today, -i);
    if (!isWorkingDay(d)) continue;
    const log = logMap.get(fmtDate(d));
    if (log && log.blocks && log.blocks.length) {
      run += 1;
      longest = Math.max(longest, run);
    } else run = 0;
  }

  // punch on-time consistency
  let totalDays = 0;
  let onTime = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const d = addDays(monthStart, i);
    if (d > today) break;
    if (isWeekend(d)) continue;
    const ds = fmtDate(d);
    if (isHoliday(holidays, ds)) continue;
    if (isOnLeave(leaves, profile.id, ds)) continue;
    totalDays += 1;
    const sessions = punches
      .filter((p) => p.work_date === ds)
      .sort((a, b) => a.punch_in.localeCompare(b.punch_in));
    if (sessions.length && new Date(sessions[0].punch_in).getHours() < 10) onTime += 1;
  }
  const consistency = totalDays ? Math.round((onTime / totalDays) * 100) : 0;

  // Quarterly leave balances, derived from approved leaves this quarter.
  const usage = leaveUsage(leaves);
  const leaveTypes = [
    { type: 'Casual', remaining: usage.remaining.casual, total: usage.allotment.casual },
    { type: 'Sick', remaining: usage.remaining.sick, total: usage.allotment.sick },
    { type: 'Emergency', remaining: usage.remaining.emergency, total: usage.allotment.emergency },
  ];
  const leaveUsed = usage.used.casual + usage.used.sick + usage.used.emergency;
  const leaveTotal = usage.allotment.casual + usage.allotment.sick + usage.allotment.emergency;

  // Daily hours for the month so far, ready for CSV export.
  const exportRows = monthData.map((hours, i) => ({
    date: fmtDate(addDays(selMonthStart, i)),
    hours,
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Your analytics</h1>
          <div className="page-subtitle">Hours, mood, and patterns over time</div>
        </div>
        <div className="page-header-actions">
          {profile.role === 'board' || isManager(profile) ? (
            <Link href="/analytics/team" className="btn btn-secondary">
              <Icon name="users" size={15} /> Team view
            </Link>
          ) : null}
          {FEATURE_FLAGS.analyticsFilters ? (
            <AnalyticsExport rows={exportRows} filename={`hours-${fmtDate(today)}`} />
          ) : null}
        </div>
      </div>

      {/* Stat cards */}
      <div className="analytics-stats-grid">
        <div className="card stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">This week</span>
            {actualWeekDelta !== 0 && (
              <span className={actualWeekDelta >= 0 ? 'stat-badge stat-badge-up' : 'stat-badge stat-badge-down'}>
                {actualWeekDelta >= 0 ? '↑' : '↓'} {Math.abs(actualWeekDelta)}h
              </span>
            )}
          </div>
          <div className="stat-card-value">
            {actualWeekTotal.toFixed(1)}h
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-grey-text)' }}>
              {' '}
              / {weeklyTargetHours(profile)}h
            </span>
          </div>
          <div className="stat-card-meta">
            Weekly target · last week {totalLastWeek.toFixed(1)}h
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Current streak</span>
          </div>
          <div className="stat-card-value">{streak} 🔥</div>
          <div className="stat-card-meta">Longest: {longest} days</div>
        </div>

        <div className="card stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Punch on-time</span>
            <span className={consistency >= 80 ? 'stat-badge stat-badge-up' : consistency >= 50 ? 'stat-badge stat-badge-neutral' : 'stat-badge stat-badge-down'}>
              {consistency >= 80 ? 'Great' : consistency >= 50 ? 'OK' : 'Low'}
            </span>
          </div>
          <div className="stat-card-value">{consistency}%</div>
          <div className="stat-card-meta">Before 10am</div>
        </div>

        <div className="card stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Leave used</span>
          </div>
          <div className="stat-card-value">{leaveUsed}</div>
          <div className="stat-card-meta">of {leaveTotal} this quarter ({usage.quarter.label})</div>
        </div>
      </div>

      {/* Main charts — bar (2fr) + energy line (1fr, only when Daily Log is on) */}
      <div
        className="analytics-chart-row"
        style={!FEATURE_FLAGS.dailyLog ? { gridTemplateColumns: '1fr' } : undefined}
      >
        <div className="card">
          <div className="card-header">
            <div className="card-subtitle">Hours per day · this week vs last</div>
            <div className="chart-header-controls">
              <div className="chart-legend">
                <span className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: 'var(--color-green-primary)' }} />
                  {selWeekLabel}
                </span>
                <span className="chart-legend-item">
                  <span className="chart-legend-dot" style={{ background: 'var(--color-green-light)', border: '1px solid var(--color-border)' }} />
                  {lastWeekLabel}
                </span>
              </div>
              {FEATURE_FLAGS.analyticsFilters ? (
                <WeekStepper value={selWeekValue} label={selWeekLabel} canNext={!isCurrentWeek} />
              ) : null}
            </div>
          </div>
          <BarChart key={selWeekValue} data={thisWeek} overlay={lastWeek} labels={dayLabels} weekend={weekWeekend} leave={weekLeave} />
        </div>
        {FEATURE_FLAGS.dailyLog ? (
          <div className="card">
            <div className="card-subtitle" style={{ marginBottom: 16 }}>Energy level · last 14 days</div>
            <EnergyChart data={energyData} />
          </div>
        ) : null}
      </div>

      {/* Monthly hours line chart — with a month filter + last-month ghost */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-subtitle">Daily hours</div>
          <div className="chart-header-controls">
            <div className="chart-legend">
              <span className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: 'var(--color-green-primary)' }} />
                {selMonthName}
              </span>
              <span className="chart-legend-item">
                <span className="chart-legend-dot chart-legend-dot-ghost" />
                {prevMonthName}
              </span>
            </div>
            {FEATURE_FLAGS.analyticsFilters ? (
              <MonthStepper value={selMonthValue} canNext={!isCurrentMonth} />
            ) : null}
          </div>
        </div>
        <LineChart key={selMonthValue} data={monthData} overlay={prevMonthData} labels={monthLabels} weekend={monthWeekend} leave={monthLeave} />
      </div>

      {/* Tag frequency (Daily Log only) + Leave summary */}
      <div
        className="analytics-bottom-row"
        style={!FEATURE_FLAGS.dailyLog ? { gridTemplateColumns: '1fr' } : undefined}
      >
        {FEATURE_FLAGS.dailyLog ? (
          <div className="card">
            <div className="card-subtitle" style={{ marginBottom: 12 }}>Tag frequency</div>
            {tagEntries.length === 0 ? (
              <div className="text-grey text-sm">No tags yet.</div>
            ) : (
              <div className="grid gap-2">
                {tagEntries.map(([t, n]) => (
                  <div key={t} className="flex items-center gap-2">
                    <div style={{ minWidth: 100 }}>
                      <span className="tag-chip">{t}</span>
                    </div>
                    <div className="flex-1">
                      <Progress value={(n / tagEntries[0][1]) * 100} />
                    </div>
                    <div className="text-xs text-grey" style={{ minWidth: 24, textAlign: 'right' }}>
                      {n}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <div className="card">
          <div className="card-subtitle" style={{ marginBottom: 12 }}>Leave summary</div>
          <div className="grid gap-3">
            {leaveTypes.map((l) => (
              <div key={l.type}>
                <div className="flex items-center justify-between text-sm" style={{ marginBottom: 6 }}>
                  <span className="fw-medium">{l.type}</span>
                  <span className="text-grey">
                    {l.remaining} / {l.total} left
                  </span>
                </div>
                <Progress value={(l.remaining / l.total) * 100} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
