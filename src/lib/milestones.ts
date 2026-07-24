// Tenure-milestone engine — pure, shared by the in-app celebration (client) and
// the daily anniversary sweep (server). A member's milestone day is the
// recurring day-of-month of their joining date (clamped for short months);
// `months` is the whole-month count since they joined. Intensity scales to
// tenure: an intern's every-month moment is "grand"; a full-timer's plain month
// is "gentle", quarter "medium", year "grand".
//
// `now` is injectable so this is fully unit-testable. All calendar math goes
// through fmtDate() so it resolves in IST consistently on the UTC server too.
import { fmtDate } from './dates';
import type { Profile } from './types';

export type MilestoneTier = 'gentle' | 'medium' | 'grand';
export type MilestoneKind = 'monthly' | 'quarterly' | 'yearly' | 'intern' | 'intern-final';

export interface Milestone {
  months: number;
  tier: MilestoneTier;
  kind: MilestoneKind;
  key: string; // per-occasion id (e.g. "m3") — combined with the user id for "seen"
  label: string; // "Month 3 of 3" · "1 year" · "6 months"
  internshipMonths: number | null;
}

type MemberLike = Pick<Profile, 'role' | 'joined_date' | 'internship_months'>;

function lastDayOfMonth(year: number, month1: number): number {
  // month1 is 1-based; day 0 of the next month = last day of this month.
  return new Date(year, month1, 0).getDate();
}

// Whole months from joining to `now`, on the IST calendar. 0 = same month.
export function monthsSinceJoin(joinedDate: string, now: Date = new Date()): number {
  const [jy, jm] = joinedDate.split('-').map(Number);
  const [ty, tm] = fmtDate(now).split('-').map(Number);
  return (ty - jy) * 12 + (tm - jm);
}

// Is `now` the member's recurring join-day-of-month (clamped to short months)?
export function isMilestoneDay(joinedDate: string, now: Date = new Date()): boolean {
  const jd = Number(joinedDate.split('-')[2]);
  const [ty, tm, td] = fmtDate(now).split('-').map(Number);
  return td === Math.min(jd, lastDayOfMonth(ty, tm));
}

function labelFor(kind: MilestoneKind, months: number, internshipMonths: number | null): string {
  if (kind === 'yearly') {
    const y = Math.round(months / 12);
    return `${y} year${y > 1 ? 's' : ''}`;
  }
  if (kind === 'intern' || kind === 'intern-final') return `Month ${months} of ${internshipMonths}`;
  return `${months} month${months > 1 ? 's' : ''}`;
}

// The milestone (if any) for this member today. Null on non-milestone days,
// before the first month, or when there's no joining date.
export function milestoneForToday(member: MemberLike, now: Date = new Date()): Milestone | null {
  if (!member.joined_date) return null;
  if (!isMilestoneDay(member.joined_date, now)) return null;
  const months = monthsSinceJoin(member.joined_date, now);
  if (months < 1) return null;

  const internshipMonths = member.internship_months ?? null;
  let kind: MilestoneKind;
  let tier: MilestoneTier;
  if (internshipMonths && months <= internshipMonths) {
    kind = months === internshipMonths ? 'intern-final' : 'intern';
    tier = 'grand';
  } else if (months % 12 === 0) {
    kind = 'yearly';
    tier = 'grand';
  } else if (months % 3 === 0) {
    kind = 'quarterly';
    tier = 'medium';
  } else {
    kind = 'monthly';
    tier = 'gentle';
  }

  return {
    months,
    tier,
    kind,
    key: `m${months}`,
    label: labelFor(kind, months, internshipMonths),
    internshipMonths,
  };
}

// A milestone gets a bell/push ping unless it's the lightest (gentle) tier.
export function milestonePings(m: Milestone): boolean {
  return m.tier !== 'gentle';
}
