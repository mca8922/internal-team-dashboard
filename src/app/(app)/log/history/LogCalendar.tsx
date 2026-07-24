'use client';

// Month calendar of logged / missing / off days. Ported from page-log.jsx.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { fmtDate, isWeekend } from '@/lib/dates';

interface LoggedDay {
  date: string;
  mood: string;
  tags: string[];
}

export function LogCalendar({
  loggedDates,
  holidays,
  approvedLeaves,
  streak,
  avgEnergy,
}: {
  loggedDates: LoggedDay[];
  holidays: string[];
  approvedLeaves: { start: string; end: string }[];
  streak: number;
  avgEnergy: string;
}) {
  const router = useRouter();
  const [cursor, setCursor] = React.useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // Which tags the calendar is currently filtered to (OR — a day matches if
  // it carries any selected tag). Options are built from every logged day
  // across all months, not just the one in view, so switching months never
  // changes what's filterable out from under you.
  const [activeTags, setActiveTags] = React.useState<string[]>([]);

  const allTags = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of loggedDates) {
      for (const t of l.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [loggedDates]);

  const toggleTag = (t: string) =>
    setActiveTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const logMap = new Map<string, LoggedDay>(loggedDates.map((l) => [l.date, l]));
  const holidaySet = new Set(holidays);
  const onLeave = (ds: string) =>
    approvedLeaves.some((l) => ds >= l.start && ds <= l.end);

  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const leadingBlanks = (first.getDay() + 6) % 7;

  const cells: (Date | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++)
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));

  const today = fmtDate(new Date());
  const monthPrefix = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
  const totalLogged = loggedDates.filter((l) => l.date.startsWith(monthPrefix)).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Log history</h1>
          <div className="page-subtitle">Calendar view of every working day</div>
        </div>
        <div className="page-header-actions">
          <Button
            variant="secondary"
            icon="chevron-left"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
          />
          <div style={{ padding: '8px 12px', minWidth: 180, textAlign: 'center', fontWeight: 600 }}>
            {monthLabel}
          </div>
          <Button
            variant="secondary"
            icon="chevron-right"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
          />
        </div>
      </div>

      <div className="grid grid-3 gap-4 mb-6">
        <div className="card">
          <div className="card-subtitle">Logs this month</div>
          <div className="text-3xl fw-bold mt-1">
            {totalLogged} <span className="text-sm text-grey fw-light">/ {last.getDate()}</span>
          </div>
        </div>
        <div className="card">
          <div className="card-subtitle">Current streak</div>
          <div className="text-3xl fw-bold mt-1">{streak} 🔥</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Avg energy</div>
          <div className="text-3xl fw-bold mt-1">{avgEnergy}</div>
        </div>
      </div>

      <div className="card">
        {allTags.length > 0 ? (
          <div className="tagfilter-row">
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                className={`tagfilter-chip${activeTags.includes(t) ? ' active' : ''}`}
                onClick={() => toggleTag(t)}
              >
                {t}
              </button>
            ))}
            {activeTags.length > 0 ? (
              <button type="button" className="tagfilter-clear" onClick={() => setActiveTags([])}>
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 8 }}
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="cal-day-header">
              {d}
            </div>
          ))}
        </div>
        <div className="calendar">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="calendar-cell empty" />;
            const ds = fmtDate(d);
            const weekend = isWeekend(d);
            const holiday = holidaySet.has(ds);
            const leave = onLeave(ds);
            const hasLog = logMap.has(ds);
            const isToday = ds === today;
            const entry = logMap.get(ds);
            const tags = entry?.tags ?? [];
            const matchesFilter =
              activeTags.length === 0 || tags.some((t) => activeTags.includes(t));

            let cls = 'calendar-cell';
            if (isToday) cls += ' today';
            if (weekend || holiday || leave) cls += ' off';
            else if (hasLog) cls += ' logged';
            if (hasLog && !matchesFilter) cls += ' tag-dim';

            const clickable = !(weekend || holiday || leave);
            let dot: React.ReactNode = null;
            if (clickable) {
              if (hasLog)
                dot = (
                  <span
                    className="status-dot"
                    style={{ background: 'var(--color-green-primary)' }}
                  />
                );
              else if (d <= new Date())
                dot = (
                  <span className="status-dot" style={{ background: 'var(--color-red)' }} />
                );
            }
            return (
              <div
                key={i}
                className={cls}
                onClick={clickable ? () => router.push('/log?date=' + ds) : undefined}
              >
                <div className="flex items-center justify-between">
                  <span className="day-num">{d.getDate()}</span>
                  <span className="flex items-center gap-1">
                    {entry?.mood ? <span style={{ fontSize: 15 }}>{entry.mood}</span> : null}
                    {dot}
                  </span>
                </div>
                {holiday ? <div className="text-xs text-grey">🎉 Holiday</div> : null}
                {leave ? <div className="text-xs text-grey">Leave</div> : null}
                {weekend && !holiday ? <div className="text-xs text-grey">Off</div> : null}
                {tags.length ? (
                  <div className="cal-tags">
                    {tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className={`cal-tag${activeTags.includes(t) ? ' tag-match' : ''}`}
                        title={t}
                      >
                        {t}
                      </span>
                    ))}
                    {tags.length > 3 ? (
                      <span className="cal-tag cal-tag-more">+{tags.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-4 text-xs text-grey">
          <span className="flex items-center gap-1">
            <span className="dot dot-green" /> Logged
          </span>
          <span className="flex items-center gap-1">
            <span className="dot dot-red" /> Missing
          </span>
          <span className="flex items-center gap-1">
            <span className="dot dot-grey" /> Off / Leave
          </span>
        </div>
      </div>
    </div>
  );
}
