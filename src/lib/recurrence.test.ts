import { describe, it, expect } from 'vitest';
import {
  isDueToday,
  isCompletionCurrent,
  isCarriedOverDone,
  currentReport,
  recurrenceLabel,
} from './recurrence';
import type { ChecklistRecurrence, GoalChecklistItem } from './types';

// Fixed reference days (local time). 2026-06-15 is a Monday.
const MON = new Date(2026, 5, 15, 10);
const TUE = new Date(2026, 5, 16, 10);
const WED = new Date(2026, 5, 17, 10);
const SAT = new Date(2026, 5, 20, 10);

const mk = (recurrence: ChecklistRecurrence, recur_days: number[] = []) =>
  ({ recurrence, recur_days }) as Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>;

describe('currentReport (report stays visible as long as the item reads done)', () => {
  const r = (report_date: string) => ({ report_date });

  it('daily: only today’s report counts', () => {
    expect(currentReport([r('2026-06-15')], mk('daily'), MON)?.report_date).toBe('2026-06-15');
    // yesterday’s daily report is no longer current today
    expect(currentReport([r('2026-06-14')], mk('daily'), MON)).toBeNull();
  });

  it('custom (Mon): report filed Monday is carried through the week', () => {
    const monItem = mk('custom', [1]);
    // Reported Monday, viewed Tue/Sat — still the current report (carried over).
    expect(currentReport([r('2026-06-15')], monItem, TUE)?.report_date).toBe('2026-06-15');
    expect(currentReport([r('2026-06-15')], monItem, SAT)?.report_date).toBe('2026-06-15');
    // A report from the PREVIOUS Monday is not current this week.
    expect(currentReport([r('2026-06-08')], monItem, WED)).toBeNull();
  });

  it('weekly: any report this week counts; picks the newest', () => {
    const weekly = mk('weekly');
    expect(
      currentReport([r('2026-06-15'), r('2026-06-17')], weekly, SAT)?.report_date,
    ).toBe('2026-06-17');
  });

  it('once: the latest report counts forever', () => {
    expect(currentReport([r('2020-01-01')], mk('once'), MON)?.report_date).toBe('2020-01-01');
  });

  it('no reports → null', () => {
    expect(currentReport([], mk('daily'), MON)).toBeNull();
  });
});

describe('isDueToday', () => {
  it('once/daily/weekly/monthly/yearly are due every day', () => {
    for (const r of ['once', 'daily', 'weekly', 'monthly', 'yearly'] as const) {
      expect(isDueToday(mk(r), MON)).toBe(true);
      expect(isDueToday(mk(r), SAT)).toBe(true);
    }
  });

  it('weekdays are due Mon–Fri only', () => {
    expect(isDueToday(mk('weekdays'), MON)).toBe(true);
    expect(isDueToday(mk('weekdays'), SAT)).toBe(false);
  });

  it('custom is due only on its chosen weekdays', () => {
    const mwf = mk('custom', [1, 3, 5]); // Mon · Wed · Fri
    expect(isDueToday(mwf, MON)).toBe(true);
    expect(isDueToday(mwf, WED)).toBe(true);
    expect(isDueToday(mwf, TUE)).toBe(false);
  });
});

describe('isCompletionCurrent', () => {
  it('a missing completion is never current', () => {
    expect(isCompletionCurrent('daily', null, MON)).toBe(false);
    expect(isCompletionCurrent('daily', undefined, MON)).toBe(false);
  });

  it('a one-time item stays done forever', () => {
    expect(isCompletionCurrent('once', '2020-01-01T00:00:00.000Z', MON)).toBe(true);
  });

  it('a daily item resets each day', () => {
    expect(isCompletionCurrent('daily', MON.toISOString(), MON)).toBe(true);
    expect(isCompletionCurrent('daily', new Date(2026, 5, 14, 10).toISOString(), MON)).toBe(false);
  });

  it('a weekly item counts a completion from earlier the same week', () => {
    // now = Wed; done on Mon (same week) → still current
    expect(isCompletionCurrent('weekly', MON.toISOString(), WED)).toBe(true);
    // done last Friday (previous week) → not current
    expect(isCompletionCurrent('weekly', new Date(2026, 5, 12, 10).toISOString(), WED)).toBe(false);
  });
});

describe('isCarriedOverDone (off-day display)', () => {
  const monItem = mk('custom', [1]); // Monday only

  it('keeps a Monday task ticked on later days of the week', () => {
    // done Monday, viewing Tuesday → still shows done
    expect(isCarriedOverDone(monItem, MON.toISOString(), TUE)).toBe(true);
    expect(isCarriedOverDone(monItem, MON.toISOString(), SAT)).toBe(true);
  });

  it("doesn't carry a completion from a previous week", () => {
    const lastMon = new Date(2026, 5, 8, 10).toISOString(); // previous Monday
    expect(isCarriedOverDone(monItem, lastMon, TUE)).toBe(false);
  });

  it('resets at the next due day (Mon·Wed·Fri)', () => {
    const mwf = mk('custom', [1, 3, 5]);
    // done Monday, viewing Wednesday (a due day) → not carried (Wed expects its own)
    expect(isCarriedOverDone(mwf, MON.toISOString(), WED)).toBe(false);
    // done Monday, viewing Tuesday → carried
    expect(isCarriedOverDone(mwf, MON.toISOString(), TUE)).toBe(true);
  });
});

describe('recurrenceLabel', () => {
  it('joins custom weekday names', () => {
    expect(recurrenceLabel({ recurrence: 'custom', recur_days: [1, 3, 5] })).toBe('Mon · Wed · Fri');
  });
  it('falls back to the static label for non-custom', () => {
    expect(recurrenceLabel({ recurrence: 'weekdays', recur_days: [] })).toBe('Weekdays');
  });
});
