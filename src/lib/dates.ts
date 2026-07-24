// Date / duration helpers — ported from the prototype's lib.js.
//
// reStrucAI operates in IST. The app is deployed on Vercel, whose servers
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

// reStrucAI go-live date — Monday 18 May 2026. Nothing before this counts
// as a working day for streaks or the missing-log check.
export const GO_LIVE_DATE = '2026-05-18';

// reStrucAI official working days are Monday–Friday, 9 AM–6 PM.
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

// reStrucAI operates in IST — all clock displays are pinned to this zone so
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
