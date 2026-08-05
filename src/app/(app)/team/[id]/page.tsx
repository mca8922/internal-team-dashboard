// Employee detail — board-only deep dive into one teammate. Mirrors the
// member's own /analytics page (hours, energy, streaks, on-time, tags, leave)
// plus a full read-only log reader, scoped to this person.
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getProfile,
  getPunches,
  getLogs,
  getLeaves,
  getHolidays,
  punchTotalMsForDate,
  punchStatus,
  logStreak,
  leaveUsage,
  isOnLeave,
  isHoliday,
  leaveLabel,
} from '@/lib/queries';
import {
  fmtDate,
  addDays,
  startOfWeek,
  fmtShort,
  fmtFriendly,
  fmtDateDMY,
  fmtTime,
  parseDate,
  isWeekend,
} from '@/lib/dates';
import {
  roleLabel,
  isFounder,
  isManager,
  weeklyTargetHours,
  extraDepartmentsOf,
} from '@/lib/roles';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { Progress } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { BarChart, LineChart } from '@/components/charts';
import { MonthStepper } from '@/components/MonthStepper';
import { FounderPunchEditor } from './FounderPunchEditor';
import { MemberLogs } from './MemberLogs';
import { PresenceLine } from './PresenceLine';
import { AvatarLightbox } from '@/components/AvatarLightbox';

export const metadata = { title: 'Employee · Mahesh Chandra & Associates' };

// Tag frequency + Work logs are both derived from Daily Log entries, which is
// gated off in this phase (FEATURE_FLAGS.dailyLog) — nobody can write a log,
// so these would only ever show an empty state anyway. Rather than hide the
// cards outright, show a locked placeholder (same lock-icon + badge language
// as the Founder-only punch-corrections card below) so it reads as "coming
// back later", not "broken/missing".
function LockedCard({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-subtitle">
            <Icon name="lock" size={14} /> {title}
          </div>
          <div className="text-xs text-grey mt-1">{blurb}</div>
        </div>
        <span className="badge badge-slate">Phase 2</span>
      </div>
    </div>
  );
}

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const viewer = (await getCurrentProfile())!;
  const { id } = await params;
  const u = await getProfile(id);
  if (!u) notFound();

  // Board sees everyone; a Department Manager sees only their own team members,
  // and never their daily logs or individual leave. Anyone else is sent home.
  const viewerIsBoard = viewer.role === 'board';
  const viewerIsManager = isManager(viewer) && u.manager_id === viewer.id;
  if (!viewerIsBoard && !viewerIsManager) redirect('/dashboard');
  // Log- and leave-derived sections are Board-only — a Manager never sees them.
  const canSeeLogs = viewerIsBoard;
  const canSeeLeave = viewerIsBoard;

  const today = new Date();
  const todayStr = fmtDate(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  // Selected month for the "Daily hours" chart (defaults to the current month,
  // never the future). `?m=YYYY-MM` (from the MonthStepper) drives it.
  const sp = await searchParams;
  const curY = today.getFullYear();
  const curM = today.getMonth();
  let selY = curY;
  let selM = curM;
  if (sp.m && /^\d{4}-\d{2}$/.test(sp.m)) {
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

  // Wide punch window so "last seen" can reach back; also reach the previous
  // month of whatever month is selected, so the chart can ghost it in.
  const punchFrom = [fmtDate(addDays(today, -90)), fmtDate(addDays(prevMonthStart, -2))]
    .sort()
    .shift()!;
  const [punches, logs, leaves, holidays] = await Promise.all([
    getPunches(u.id, punchFrom),
    getLogs(u.id),
    getLeaves(u.id),
    getHolidays(),
  ]);

  const hoursFor = (ds: string) =>
    Math.round((punchTotalMsForDate(punches, ds) / 3.6e6) * 10) / 10;

  // ---- last seen (most recent punch activity) ----
  const todaySessions = punches.filter((p) => p.work_date === todayStr);
  const onTheClock = punchStatus(todaySessions) === 'in';
  let lastSeenMs: number | null = null;
  for (const p of punches) {
    const t = p.punch_out || p.punch_in;
    if (!t) continue;
    const ms = new Date(t).getTime();
    if (lastSeenMs == null || ms > lastSeenMs) lastSeenMs = ms;
  }
  const lastSeenLabel = onTheClock
    ? 'Active now'
    : lastSeenMs == null
      ? 'No recent activity'
      : `${fmtDateDMY(new Date(lastSeenMs))} · ${fmtTime(new Date(lastSeenMs))}`;

  // ---- this week vs last (bar) ----
  const weekStart = startOfWeek(today);
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
    weekLeave.push(leaveLabel(leaves, u.id, fmtDate(d)));
  }
  const totalThisWeek = thisWeek.reduce((a, b) => a + b, 0);
  const totalLastWeek = lastWeek.reduce((a, b) => a + b, 0);

  // ---- daily hours: selected month vs previous month ghost (line) ----
  // daysInMonth (current month) is still used by the on-time consistency stat.
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const selDaysInMonth = new Date(selY, selM + 1, 0).getDate();
  const monthData: number[] = [];
  const prevMonthData: number[] = [];
  const monthLabels: string[] = [];
  const monthWeekend: boolean[] = [];
  // Only the selected month's own leave is marked, not the prior-month ghost.
  const monthLeave: (string | null)[] = [];
  for (let i = 0; i < selDaysInMonth; i++) {
    const d = addDays(selMonthStart, i);
    if (isCurrentMonth && d > today) {
      monthData.push(0);
      monthLabels.push('');
    } else {
      monthData.push(hoursFor(fmtDate(d)));
      monthLabels.push(String(i + 1));
    }
    prevMonthData.push(hoursFor(fmtDate(addDays(prevMonthStart, i))));
    monthWeekend.push(isWeekend(d));
    monthLeave.push(leaveLabel(leaves, u.id, fmtDate(d)));
  }
  const selMonthName = selMonthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const prevMonthName = prevMonthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  // ---- energy, last 14 days (line) ----
  const logMap = new Map(logs.map((l) => [l.log_date, l]));
  const energyData: number[] = [];
  const energyLabels: string[] = [];
  const energyLeave: (string | null)[] = [];
  for (let i = 13; i >= 0; i--) {
    const ds = fmtDate(addDays(today, -i));
    energyData.push(logMap.get(ds)?.energy_level || 0);
    energyLabels.push(fmtShort(parseDate(ds)));
    energyLeave.push(leaveLabel(leaves, u.id, ds));
  }
  // Average over logged days only (0 = no log), shown in the chart centre.
  const energyLogged = energyData.filter((v) => v > 0);
  const energyAvg = energyLogged.length
    ? energyLogged.reduce((a, b) => a + b, 0) / energyLogged.length
    : 0;

  // ---- tag frequency ----
  const tagFreq: Record<string, number> = {};
  logs.forEach((l) => (l.tags || []).forEach((t) => (tagFreq[t] = (tagFreq[t] || 0) + 1)));
  const tagEntries = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // ---- streak + longest (last 60 days) ----
  const streak = logStreak(logs);
  let longest = 0;
  let run = 0;
  for (let i = 60; i >= 0; i--) {
    const d = addDays(today, -i);
    if (isWeekend(d)) continue;
    const log = logMap.get(fmtDate(d));
    if (log && log.blocks && log.blocks.length) {
      run += 1;
      longest = Math.max(longest, run);
    } else run = 0;
  }

  // ---- punch on-time consistency (this month) ----
  let totalDays = 0;
  let onTime = 0;
  for (let i = 0; i < daysInMonth; i++) {
    const d = addDays(monthStart, i);
    if (d > today) break;
    if (isWeekend(d)) continue;
    const ds = fmtDate(d);
    if (isHoliday(holidays, ds)) continue;
    if (isOnLeave(leaves, u.id, ds)) continue;
    totalDays += 1;
    const sessions = punches
      .filter((p) => p.work_date === ds)
      .sort((a, b) => a.punch_in.localeCompare(b.punch_in));
    if (sessions.length && new Date(sessions[0].punch_in).getHours() < 10) onTime += 1;
  }
  const consistency = totalDays ? Math.round((onTime / totalDays) * 100) : 0;

  // ---- leave (quarterly, derived from this member's approved leaves) ----
  const usage = leaveUsage(leaves);
  const leaveTypes = [
    { type: 'Casual', remaining: usage.remaining.casual, total: usage.allotment.casual },
    { type: 'Sick', remaining: usage.remaining.sick, total: usage.allotment.sick },
    { type: 'Emergency', remaining: usage.remaining.emergency, total: usage.allotment.emergency },
  ];
  const leaveUsed = usage.used.casual + usage.used.sick + usage.used.emergency;

  // ---- 30-day punch heatmap ----
  const heat: { ds: string; hours: number; leave: string | null }[] = [];
  for (let i = 29; i >= 0; i--) {
    const ds = fmtDate(addDays(today, -i));
    heat.push({ ds, hours: hoursFor(ds), leave: leaveLabel(leaves, u.id, ds) });
  }
  const heatCls = (h: number) =>
    h > 7
      ? 'heat-cell h4'
      : h > 5
        ? 'heat-cell h3'
        : h > 2
          ? 'heat-cell h2'
          : h > 0
            ? 'heat-cell h1'
            : 'heat-cell';

  // ---- logs with content, newest first, for the reader ----
  const logDates = logs
    .filter((l) => l.blocks && l.blocks.length)
    .sort((a, b) => b.log_date.localeCompare(a.log_date));

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/team" className="btn btn-ghost btn-sm">
            <Icon name="arrow-left" size={14} />
            Back to team
          </Link>
          <div className="flex items-center gap-4 mt-3">
            <AvatarLightbox
              name={u.name}
              avatarUrl={u.avatar_url}
              roleBadge={isFounder(u) ? 'Founder' : u.role === 'board' ? 'Director' : null}
              jobTitle={u.job_title || null}
              department={u.department}
              joinedLabel={fmtFriendly(parseDate(u.joined_date))}
              online={onTheClock}
              lastSeenLabel={lastSeenLabel}
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="page-title">{u.name}</h1>
                {isFounder(u) ? (
                  <span className="badge badge-black">Founder</span>
                ) : u.role === 'board' ? (
                  <span className="badge badge-black">Director</span>
                ) : null}
              </div>
              <div className="page-subtitle">
                {isFounder(u) ? 'Founder' : roleLabel(u.role)}
                {u.job_title ? ` · ${u.job_title}` : ''} · {u.department} · joined{' '}
                {fmtFriendly(parseDate(u.joined_date))}
              </div>
              {/* Departments beyond the primary (migration 0060), in the same
                  chip pattern the team card uses. Labelled "Also in" so the
                  primary named above stays the one that reads as theirs — it
                  is the only one scope follows. */}
              {extraDepartmentsOf(u).length > 0 ? (
                <div className="dept-chip-row mt-1">
                  <span className="text-xs text-grey">Also in</span>
                  {extraDepartmentsOf(u).map((d) => (
                    <span key={d} className="dept-chip">
                      {d}
                    </span>
                  ))}
                </div>
              ) : null}
              <PresenceLine
                userId={u.id}
                onTheClock={onTheClock}
                lastSeenLabel={lastSeenLabel}
              />
            </div>
          </div>
        </div>
      </div>

      {/* stat cards — same set as the member's own /analytics */}
      <div className="grid grid-4 gap-4 mb-6">
        <div className="card">
          <div className="card-subtitle">This week</div>
          <div className="text-3xl fw-bold mt-1">
            {totalThisWeek.toFixed(1)}h
            <span className="text-grey" style={{ fontSize: 16, fontWeight: 600 }}>
              {' '}
              / {weeklyTargetHours(u)}h
            </span>
          </div>
          <div className="text-xs text-grey mt-1">
            Weekly target · last week {totalLastWeek.toFixed(1)}h
          </div>
        </div>
        {canSeeLogs ? (
          <div className="card">
            <div className="card-subtitle">Current streak</div>
            <div className="text-3xl fw-bold mt-1">{streak} 🔥</div>
            <div className="text-xs text-grey mt-1">Longest: {longest} days</div>
          </div>
        ) : null}
        <div className="card">
          <div className="card-subtitle">Punch on-time</div>
          <div className="text-3xl fw-bold mt-1">{consistency}%</div>
          <div className="text-xs text-grey mt-1">Before 10am</div>
        </div>
        {canSeeLeave ? (
          <div className="card">
            <div className="card-subtitle">Leave used</div>
            <div className="text-3xl fw-bold mt-1">{leaveUsed}</div>
            <div className="text-xs text-grey mt-1">
              this quarter ({usage.quarter.label})
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={`grid${canSeeLogs ? ' grid-2fr1fr' : ''}`}
        style={{ gridTemplateColumns: canSeeLogs ? '2fr 1fr' : '1fr', gap: 16 }}
      >
        <div className="card">
          <div className="card-header">
            <div className="card-subtitle">Hours per day · this week vs last</div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    background: 'var(--color-green-primary)',
                    borderRadius: 2,
                  }}
                />
                This week
              </span>
              <span className="flex items-center gap-1">
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    background: 'var(--color-green-light)',
                    borderRadius: 2,
                  }}
                />
                Last week
              </span>
            </div>
          </div>
          <BarChart data={thisWeek} overlay={lastWeek} labels={dayLabels} weekend={weekWeekend} leave={weekLeave} />
        </div>
        {canSeeLogs ? (
          <div className="card">
            <div className="card-subtitle mb-2">Energy level · last 14 days</div>
            <LineChart
              data={energyData}
              labels={energyLabels}
              leave={energyLeave}
              centerValue={energyLogged.length ? energyAvg.toFixed(1) : '-'}
              centerCaption="avg energy"
            />
          </div>
        ) : null}
      </div>

      <div className="card mt-4">
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
            <MonthStepper value={selMonthValue} canNext={!isCurrentMonth} />
          </div>
        </div>
        <LineChart key={selMonthValue} data={monthData} overlay={prevMonthData} labels={monthLabels} weekend={monthWeekend} leave={monthLeave} />
      </div>

      <div className="card mt-4">
        <div className="card-subtitle mb-3">Punch heatmap · last 30 days</div>
        <div className="flex items-end gap-1" style={{ flexWrap: 'wrap' }}>
          {heat.map((c) => (
            <div
              key={c.ds}
              className={`${heatCls(c.hours)}${isWeekend(c.ds) ? ' weekend-cell' : ''}${c.leave ? ' leave-cell' : ''}`}
              title={
                c.leave
                  ? `${c.ds} · ${c.leave}`
                  : `${c.ds} · ${c.hours.toFixed(1)}h${isWeekend(c.ds) ? ' · weekend' : ''}`
              }
              style={{ width: 22, height: 22, borderRadius: 3 }}
            />
          ))}
        </div>
      </div>

      {canSeeLogs || canSeeLeave ? (
      <div
        className={`grid${canSeeLogs && canSeeLeave ? ' grid-2col-even' : ''}`}
        style={{
          gridTemplateColumns: canSeeLogs && canSeeLeave ? '1fr 1fr' : '1fr',
          gap: 16,
          marginTop: 16,
        }}
      >
        {canSeeLogs ? (
          FEATURE_FLAGS.dailyLog ? (
            <div className="card">
              <div className="card-subtitle mb-3">Tag frequency</div>
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
          ) : (
            <LockedCard
              title="Tag frequency"
              blurb={`Unlocks with Daily Log — tags ${u.name.split(' ')[0]} uses most often.`}
            />
          )
        ) : null}
        {canSeeLeave ? (
        <div className="card">
          <div className="card-subtitle mb-3">Leave summary</div>
          <div className="grid gap-3">
            {leaveTypes.map((l) => (
              <div key={l.type}>
                <div className="flex items-center justify-between text-sm">
                  <span className="fw-medium">{l.type}</span>
                  <span className="text-grey">
                    {l.remaining} / {l.total} left
                  </span>
                </div>
                <Progress value={(l.remaining / l.total) * 100} />
              </div>
            ))}
            {leaves.length > 0 && (
              <div className="text-xs text-grey mt-1">
                Recent: {leaves[0].type} · {fmtShort(parseDate(leaves[0].start_date))} ·{' '}
                {leaves[0].status}
              </div>
            )}
          </div>
        </div>
        ) : null}
      </div>
      ) : null}

      {canSeeLogs ? (
        <div className="mt-4">
          {FEATURE_FLAGS.dailyLog ? (
            <MemberLogs logs={logDates} />
          ) : (
            <LockedCard
              title="Work logs"
              blurb={`Unlocks with Daily Log — ${u.name.split(' ')[0]}'s full log history.`}
            />
          )}
        </div>
      ) : null}

      {isFounder(viewer) ? (
        <FounderPunchEditor
          memberName={u.name}
          punches={punches.map((p) => ({
            id: p.id,
            work_date: p.work_date,
            punch_in: p.punch_in,
            punch_out: p.punch_out,
          }))}
        />
      ) : null}
    </div>
  );
}
