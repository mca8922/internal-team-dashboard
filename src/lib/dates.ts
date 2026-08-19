// Date / duration helpers — ported from the prototype's lib.js.
//
// Mahesh Chandra & Associates operates in IST. The app is deployed on Vercel, whose servers
// run in UTC — so "today" MUST be computed in IST, otherwise late-evening
// IST falls on the previous UTC calendar day and the dashboard, punches,
// streaks etc. all read stale ("yesterday's") data. Every calendar-day
// helper below resolves the date in Asia/Kolkata.

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_TZ = 'Asia/Kolkata';

// The Y/M/D of an instant, as seen in IST.
function istParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), day: get('day') };
}

// Midnight (00:00) of the given instant's IST calendar day, returned as a
// Date whose local Y/M/D match that IST day. Used as a stable day anchor
// for date math; only the calendar date is meaningful, not the clock time.
export function startOfDay(d: Date | string = new Date()): Date {
  const { y, m, day } = istParts(new Date(d));
  return new Date(y, m - 1, day);
}

// YYYY-MM-DD of the given instant in IST. This is THE definition of a
// calendar day across the app (punch work_date, log_date, "today", etc.).
export function fmtDate(d: Date | string): string {
  const { y, m, day } = istParts(new Date(d));
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDate(s: string | Date): Date {
  if (s instanceof Date) return s;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Age in whole years as of `on` (defaults to now), given a YYYY-MM-DD date of
// birth — subtracts a year if this year's birthday hasn't occurred yet.
export function calcAge(dob: string, on: Date = new Date()): number {
  const birth = parseDate(dob);
  let age = on.getFullYear() - birth.getFullYear();
  const beforeBirthdayThisYear =
    on.getMonth() < birth.getMonth() ||
    (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

// Epoch ms at 00:00 IST of a given calendar day (YYYY-MM-DD). IST is a fixed
// UTC+05:30 offset with no DST, so the wall-clock midnight maps to one exact
// instant. Used to split a punch session across the IST midnight boundary so
// time worked is attributed to the correct calendar day(s).
export function istDayStartMs(ds: string): number {
  return Date.parse(`${ds}T00:00:00+05:30`);
}

export function addDays(d: Date | string, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Day-of-week (0=Sun … 6=Sat) of the instant's IST calendar day.
export function istWeekday(d: Date | string): number {
  return startOfDay(d).getDay();
}

export function isWeekend(d: Date | string): boolean {
  const dy = istWeekday(d);
  return dy === 0 || dy === 6;
}

// Short weekday name (Mon, Tue …) of the instant's IST calendar day. Used to
// label exported rows so weekends are identifiable in the CSV.
export function fmtWeekday(d: Date | string): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][istWeekday(d)];
}

export function addMonths(d: Date | string, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

// Mahesh Chandra & Associates go-live date — Wednesday 29 July 2026. Nothing before this
// counts as a working day for streaks or the missing-log check, and (see
// clampToGoLive below) nothing before it is fetched by any history query
// either — nothing was deleted, it's just outside what the dashboard shows.
export const GO_LIVE_DATE = '2026-07-29';

// Raises a query's "from" date up to GO_LIVE_DATE when it would otherwise
// reach further back — nothing before go-live is ever shown, no matter how
// wide the caller's own window is. Pass undefined for "no lower bound
// requested"; the floor still applies. Plain string comparison is exact here
// because both are YYYY-MM-DD, which sorts lexically the same as
// chronologically.
export function clampToGoLive(fromDate?: string): string {
  return !fromDate || fromDate < GO_LIVE_DATE ? GO_LIVE_DATE : fromDate;
}

// Mahesh Chandra & Associates official working days are Monday–Friday, 9 AM–6 PM.
// A "working day" is a weekday (IST) on or after go-live.
export function isWorkingDay(d: Date | string): boolean {
  const day = istWeekday(d);
  if (day === 0 || day === 6) return false;
  return fmtDate(d) >= GO_LIVE_DATE;
}

// DD-MM-YYYY — matches the topbar clock format.
// DD-MM-YYYY in IST — matches the topbar clock.
export function fmtDateDMY(d: Date | string): string {
  // en-GB gives DD/MM/YYYY ordering; swap the separator to dashes.
  return new Date(d)
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })
    .replace(/\//g, '-');
}

// Mahesh Chandra & Associates operates in IST — all clock displays are pinned to this zone so
// they read the same regardless of the viewer's device timezone.
const IST = 'Asia/Kolkata';

// Short time, e.g. "3:41 PM" (IST).
export function fmtTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: IST,
  });
}

// Hour of day (0-23) in IST — use this instead of Date#getHours(), which
// resolves in the server's own timezone (UTC on Vercel) and silently shifts
// "before 11am" checks by 5:30.
export function istHour(d: Date | string): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: IST,
    }).format(new Date(d))
  );
  return hour % 24; // ICU renders midnight as "24" in some environments
}

// Full time, e.g. "03:41:46 AM IST".
export function fmtTimeFull(d: Date | string): string {
  const t = new Date(d).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: IST,
  });
  return `${t} IST`;
}

export function fmtFriendly(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function fmtShort(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtRelative(d: Date | string): string {
  const days = daysBetween(d, new Date());
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  if (days > 1 && days < 7) return `${days} days ago`;
  return fmtShort(d);
}

// Relative "time ago" for a recent instant, with minute / hour precision:
// "just now", "8m ago", "3h ago", "Yesterday", "4 days ago", "May 3".
// Used for last-seen labels. The duration part is timezone independent;
// the day rollover uses the IST-aware daysBetween.
export function fmtSince(d: Date | string): string {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const days = daysBetween(d, new Date());
  if (days >= 1) {
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return fmtShort(d);
  }
  return `${Math.floor(mins / 60)}h ago`;
}

export function durationMs(ms: number): string {
  if (!ms || ms < 0) return '0h 0m';
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return `${h}h ${m}m`;
}

export function durationHours(ms: number): number {
  return Math.round((ms / (60 * 60 * 1000)) * 10) / 10;
}

// ---- punch time-math ----
// Lives here (not queries.ts, which pulls in the server-only Supabase client)
// so a client component — PunchConsole, specifically — can import it
// directly. queries.ts re-exports these for its Server Component callers.

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

export function punchTotalMs(sessions: { punch_in: string; punch_out: string | null }[]): number {
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

export function weekNumber(d: Date | string): number {
  // Anchor on the IST calendar day so the ISO-week number is correct.
  const x = startOfDay(d);
  x.setDate(x.getDate() + 4 - (x.getDay() || 7));
  const yearStart = new Date(x.getFullYear(), 0, 1);
  return Math.ceil(((x.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

export function startOfWeek(d: Date | string = new Date()): Date {
  const x = startOfDay(d);
  const dy = x.getDay();
  return addDays(x, -((dy + 6) % 7)); // Monday
}
