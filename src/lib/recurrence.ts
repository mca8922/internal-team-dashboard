// Checklist recurrence helpers — shared by the goal form (board) and the
// checklist tick UI (members). A recurring item resets each period: a member's
// completion counts as done only while it was stamped inside the current cycle.
//
// Completion is now INDEPENDENT per assignee — these helpers take a single
// `doneAt` (one member's completion) rather than a flag on the item.
import { parseDate } from './dates';
import type { ChecklistRecurrence, GoalChecklistItem, GoalLevel } from './types';

// Options for the recurrence picker, in display order.
export const RECURRENCE_OPTIONS: { value: ChecklistRecurrence; label: string }[] = [
  { value: 'once', label: 'One-time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom days' },
];

// Cadences that make sense for each goal tier. A Yearly goal wouldn't carry a
// daily checklist (that's what a Daily goal is for), so the picker hides
// finer-than-tier options. Editing an existing item with an out-of-range
// cadence snaps it down to a valid one in the form.
const RECURRENCE_BY_LEVEL: Record<GoalLevel, ChecklistRecurrence[]> = {
  yearly: ['once', 'yearly', 'monthly'],
  monthly: ['once', 'monthly', 'weekly'],
  weekly: ['once', 'weekly', 'weekdays', 'daily', 'custom'],
  daily: ['once', 'daily'],
};

export function recurrenceOptionsForLevel(
  level: GoalLevel,
): { value: ChecklistRecurrence; label: string }[] {
  const allowed = new Set(RECURRENCE_BY_LEVEL[level]);
  return RECURRENCE_OPTIONS.filter((o) => allowed.has(o.value));
}

// Short label for the badge shown beside a recurring item.
export const RECURRENCE_LABEL: Record<ChecklistRecurrence, string> = {
  once: 'One-time',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  custom: 'Custom',
};

// Weekday picker model — 0=Sun..6=Sat. `short` is the chip label.
export const WEEKDAYS: { value: number; short: string; label: string }[] = [
  { value: 1, short: 'M', label: 'Mon' },
  { value: 2, short: 'T', label: 'Tue' },
  { value: 3, short: 'W', label: 'Wed' },
  { value: 4, short: 'T', label: 'Thu' },
  { value: 5, short: 'F', label: 'Fri' },
  { value: 6, short: 'S', label: 'Sat' },
  { value: 0, short: 'S', label: 'Sun' },
];

// Human cadence string for a card badge, e.g. "Mon · Wed · Fri" for a custom
// item or "Daily" for the rest.
export function recurrenceLabel(
  item: Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>,
): string {
  if (item.recurrence !== 'custom') return RECURRENCE_LABEL[item.recurrence];
  const days = (item.recur_days ?? [])
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.label)
    .filter(Boolean);
  return days.length ? days.join(' · ') : 'Custom';
}

// Midnight at the start of the current recurrence period, in local time.
// `now` is injectable so progress/due logic can be tested deterministically.
export function periodStart(rec: ChecklistRecurrence, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (rec === 'weekly') {
    const mondayOffset = (d.getDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0, ...
    d.setDate(d.getDate() - mondayOffset);
  } else if (rec === 'monthly') {
    d.setDate(1);
  } else if (rec === 'yearly') {
    d.setMonth(0, 1);
  }
  // daily / weekdays / custom / once -> today 00:00
  return d;
}

// Is this checklist item expected TODAY? Day-scoped cadences (weekdays, custom)
// are only due on their weekdays; everything else is due through its period.
export function isDueToday(
  item: Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>,
  now: Date = new Date(),
): boolean {
  const dow = now.getDay(); // 0=Sun..6=Sat
  if (item.recurrence === 'weekdays') return dow >= 1 && dow <= 5;
  if (item.recurrence === 'custom') return (item.recur_days ?? []).includes(dow);
  return true;
}

// Midnight of the most recent day (on/before `now`) this DAY-SCOPED item was
// due. Lets the UI keep a completed item ticked on its off-days until the next
// due day (e.g. a Monday task stays ticked Tue–Sun). Returns null for always-due
// cadences (they're handled by isDueToday/isCompletionCurrent instead).
export function lastDueStart(
  item: Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>,
  now: Date = new Date(),
): Date | null {
  if (item.recurrence !== 'weekdays' && item.recurrence !== 'custom') return null;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const dow = d.getDay();
    const due =
      item.recurrence === 'weekdays' ? dow >= 1 && dow <= 5 : (item.recur_days ?? []).includes(dow);
    if (due) return d;
    d.setDate(d.getDate() - 1);
  }
  return null;
}

// Display-only: should a NOT-due day-scoped item still show as ticked because it
// was completed on its most recent due day? Keeps a Monday task visibly done
// through the week without affecting today's tally or progress.
export function isCarriedOverDone(
  item: Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>,
  doneAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!doneAt) return false;
  const ls = lastDueStart(item, now);
  return !!ls && new Date(doneAt) >= ls;
}

// Does a member's completion (its done_at) fall inside the item's current
// period? A one-time item stays done forever; a recurring one only while its
// done_at sits in the current day / week / month / year.
export function isCompletionCurrent(
  recurrence: ChecklistRecurrence,
  doneAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!doneAt) return false;
  if (recurrence === 'once') return true;
  return new Date(doneAt) >= periodStart(recurrence, now);
}

// Cadences whose task description is hidden behind a tap-to-unlock lock until
// the member reveals it. Custom-day items were the original case; daily and
// weekdays items get the same one-time reveal ritual so the task "unlocks as
// the day comes". The unlock is persisted per (item, member), so once tapped it
// stays open across refreshes and days (see goal_item_unlocks).
export const LOCKABLE_RECURRENCES: ChecklistRecurrence[] = ['custom', 'daily', 'weekdays'];

export function isLockableRecurrence(recurrence: ChecklistRecurrence): boolean {
  return LOCKABLE_RECURRENCES.includes(recurrence);
}

// The member's CURRENT work report for a Report Work item — the one that should
// be shown to the Board/managers (and the member) alongside the item's done
// state. Report visibility must track the SAME window the tick does, otherwise a
// reported item can read "Done" while its report has vanished:
//   • period item (daily/weekly/monthly/yearly) → this period's report
//   • day-scoped item (weekdays/custom)         → the report filed on its most
//     recent due day, carried over until the next due day (like the tick)
//   • one-time item                             → its latest report, forever
// Returns the newest matching report, or null. Pass already user-filtered rows.
export function currentReport<T extends { report_date: string }>(
  reports: T[],
  item: Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>,
  now: Date = new Date(),
): T | null {
  if (reports.length === 0) return null;
  let start: Date | null;
  if (item.recurrence === 'once') start = new Date(0);
  else if (item.recurrence === 'weekdays' || item.recurrence === 'custom')
    start = lastDueStart(item, now);
  else start = periodStart(item.recurrence, now);
  if (!start) return null;
  const cutoff = start;
  const inWindow = reports.filter((r) => parseDate(r.report_date) >= cutoff);
  if (inWindow.length === 0) return null;
  // report_date is YYYY-MM-DD, so a lexical compare picks the newest.
  return inWindow.reduce((a, b) => (a.report_date >= b.report_date ? a : b));
}
