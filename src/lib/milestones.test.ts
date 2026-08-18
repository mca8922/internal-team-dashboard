import { describe, it, expect } from 'vitest';
import {
  monthsSinceJoin,
  isMilestoneDay,
  milestoneForToday,
  milestonePings,
} from './milestones';
import type { Profile } from './types';

// IST-anchored instants (noon IST) so fmtDate() resolves the same calendar day
// regardless of the machine's timezone.
const ist = (d: string) => new Date(`${d}T12:00:00+05:30`);
const member = (p: Partial<Profile>): Pick<Profile, 'role' | 'joined_date' | 'internship_months'> => ({
  role: 'fte',
  joined_date: '2026-05-18',
  internship_months: null,
  ...p,
});

describe('monthsSinceJoin', () => {
  it('counts whole months on the join day-of-month', () => {
    expect(monthsSinceJoin('2026-05-18', ist('2026-05-18'))).toBe(0);
    expect(monthsSinceJoin('2026-05-18', ist('2026-06-18'))).toBe(1);
    expect(monthsSinceJoin('2026-05-18', ist('2026-08-18'))).toBe(3);
    expect(monthsSinceJoin('2026-05-18', ist('2027-05-18'))).toBe(12);
  });
});

describe('isMilestoneDay', () => {
  it('matches the recurring join day-of-month', () => {
    expect(isMilestoneDay('2026-05-18', ist('2026-06-18'))).toBe(true);
    expect(isMilestoneDay('2026-05-18', ist('2026-06-17'))).toBe(false);
  });
  it('clamps to the last day in shorter months', () => {
    // joined the 31st → the 28th is the milestone day in (non-leap) February
    expect(isMilestoneDay('2026-01-31', ist('2026-02-28'))).toBe(true);
    expect(isMilestoneDay('2026-01-31', ist('2026-02-27'))).toBe(false);
  });
});

describe('milestoneForToday — full/part-timer tiers', () => {
  it('plain month is gentle (no ping)', () => {
    const m = milestoneForToday(member({}), ist('2026-07-18')); // 2 months
    expect(m?.kind).toBe('monthly');
    expect(m?.tier).toBe('gentle');
    expect(milestonePings(m!)).toBe(false);
  });
  it('quarter is medium with a ping', () => {
    const m = milestoneForToday(member({}), ist('2026-08-18')); // 3 months
    expect(m?.kind).toBe('quarterly');
    expect(milestonePings(m!)).toBe(true);
  });
  it('year is grand with a ping', () => {
    const m = milestoneForToday(member({}), ist('2027-05-18')); // 12 months
    expect(m?.kind).toBe('yearly');
    expect(m?.tier).toBe('grand');
    expect(m?.label).toBe('1 year');
    expect(milestonePings(m!)).toBe(true);
  });
  it('quarter past a year labels as years + months', () => {
    const m = milestoneForToday(member({}), ist('2027-08-18')); // 15 months
    expect(m?.kind).toBe('quarterly');
    expect(m?.label).toBe('1 year 3 months');
  });
  it('long tenure labels in years + months, not raw months', () => {
    const m = milestoneForToday(member({ joined_date: '1992-10-16' }), ist('2026-08-16')); // 406 months
    expect(m?.months).toBe(406);
    expect(m?.label).toBe('33 years 10 months');
  });
});

describe('milestoneForToday — interns', () => {
  const intern = member({ role: 'intern', internship_months: 3 });
  it('every month is grand with a ping', () => {
    const m1 = milestoneForToday(intern, ist('2026-06-18')); // month 1
    expect(m1?.kind).toBe('intern');
    expect(m1?.tier).toBe('grand');
    expect(m1?.label).toBe('Month 1 of 3');
    expect(milestonePings(m1!)).toBe(true);
  });
  it('the final month is the send-off', () => {
    const m3 = milestoneForToday(intern, ist('2026-08-18')); // month 3 == N
    expect(m3?.kind).toBe('intern-final');
    expect(m3?.tier).toBe('grand');
    expect(milestonePings(m3!)).toBe(true);
  });
});

describe('milestoneForToday — none', () => {
  it('returns null on a non-milestone day and on the join day itself', () => {
    expect(milestoneForToday(member({}), ist('2026-06-17'))).toBeNull(); // not the day
    expect(milestoneForToday(member({}), ist('2026-05-18'))).toBeNull(); // month 0
  });
});
