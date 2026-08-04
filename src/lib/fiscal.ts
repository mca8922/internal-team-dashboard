// Indian financial-year helpers for the task cascade.
//
// Mahesh Chandra & Associates runs on the FY Apr–Mar convention, so a task's
// half-year and quarter are anchored to April, not January:
//
//   FY 2026-27  =  1 Apr 2026 → 31 Mar 2027
//   H1 Apr–Sep   H2 Oct–Mar
//   Q1 Apr–Jun   Q2 Jul–Sep   Q3 Oct–Dec   Q4 Jan–Mar
//
// Every calendar day is resolved in IST (via dates.ts) so a late-evening IST
// date near a quarter boundary doesn't slip into the previous period on a
// UTC server.
import { startOfDay, fmtDate } from './dates';
import type { GoalLevel } from './types';

// The calendar year the financial year STARTS in. Jan–Mar belong to the FY that
// opened the previous April, so they count back a year.
export function fiscalYearStart(d: Date | string = new Date()): number {
  const x = startOfDay(d);
  return x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1;
}

// "2026-27" — the label used across Indian statutory filings.
export function fiscalYearLabel(d: Date | string = new Date()): string {
  const y = fiscalYearStart(d);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

// Months since the start of the financial year, 0 (April) … 11 (March).
function fiscalMonthIndex(d: Date | string): number {
  return (startOfDay(d).getMonth() + 9) % 12;
}

// 1 = H1 (Apr–Sep), 2 = H2 (Oct–Mar).
export function fiscalHalf(d: Date | string = new Date()): 1 | 2 {
  return fiscalMonthIndex(d) < 6 ? 1 : 2;
}

// 1 = Q1 (Apr–Jun) … 4 = Q4 (Jan–Mar).
export function fiscalQuarter(d: Date | string = new Date()): 1 | 2 | 3 | 4 {
  return (Math.floor(fiscalMonthIndex(d) / 3) + 1) as 1 | 2 | 3 | 4;
}

// The last calendar day of the period `level` covers around `d`. Used to
// pre-fill a task's due date so a Quarterly task defaults to its quarter-end
// rather than an arbitrary "a week from now".
export function periodEnd(level: GoalLevel, d: Date | string = new Date()): Date {
  const x = startOfDay(d);
  const fyStart = fiscalYearStart(x);
  switch (level) {
    // 31 March of the FY's closing year.
    case 'yearly':
      return new Date(fyStart + 1, 2, 31);
    // 30 September (H1) or 31 March (H2).
    case 'half_yearly':
      return fiscalHalf(x) === 1 ? new Date(fyStart, 8, 30) : new Date(fyStart + 1, 2, 31);
    // Last day of the quarter's third month — day 0 of the NEXT month.
    case 'quarterly': {
      const endFiscalMonth = fiscalQuarter(x) * 3; // 3, 6, 9 or 12
      return new Date(fyStart, 3 + endFiscalMonth, 0);
    }
    // Last day of the calendar month.
    case 'monthly':
      return new Date(x.getFullYear(), x.getMonth() + 1, 0);
    case 'daily':
      return x;
  }
}

// Same as periodEnd, as the YYYY-MM-DD the date inputs and `goals.due_date` use.
export function periodEndDate(level: GoalLevel, d: Date | string = new Date()): string {
  return fmtDate(periodEnd(level, d));
}

// Human hint shown beside the due-date field, e.g. "Q2 · Jul–Sep · FY 2026-27".
// Null for tiers that don't map onto a financial period.
export function periodLabel(level: GoalLevel, d: Date | string = new Date()): string | null {
  const fy = `FY ${fiscalYearLabel(d)}`;
  switch (level) {
    case 'yearly':
      return `Apr–Mar · ${fy}`;
    case 'half_yearly':
      return fiscalHalf(d) === 1 ? `H1 · Apr–Sep · ${fy}` : `H2 · Oct–Mar · ${fy}`;
    case 'quarterly': {
      const q = fiscalQuarter(d);
      const months = ['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'][q - 1];
      return `Q${q} · ${months} · ${fy}`;
    }
    case 'monthly':
      return `${startOfDay(d).toLocaleDateString('en-US', { month: 'long' })} · ${fy}`;
    case 'daily':
      return null;
  }
}
