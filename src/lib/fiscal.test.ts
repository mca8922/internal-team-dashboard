import { describe, it, expect } from 'vitest';
import {
  fiscalYearStart,
  fiscalYearLabel,
  fiscalHalf,
  fiscalQuarter,
  periodEndDate,
  periodLabel,
} from './fiscal';

// The FY runs Apr–Mar, so every boundary case below is about a date NOT falling
// in the calendar year you'd naively expect.
describe('fiscalYearStart / fiscalYearLabel', () => {
  it('April opens a new financial year', () => {
    expect(fiscalYearStart('2026-04-01')).toBe(2026);
    expect(fiscalYearLabel('2026-04-01')).toBe('2026-27');
  });
  it('March still belongs to the FY that opened last April', () => {
    expect(fiscalYearStart('2027-03-31')).toBe(2026);
    expect(fiscalYearLabel('2027-03-31')).toBe('2026-27');
  });
  it('January–March count back a year', () => {
    expect(fiscalYearStart('2027-01-01')).toBe(2026);
  });
  it('pads the closing year across a century roll', () => {
    expect(fiscalYearLabel('2099-05-01')).toBe('2099-00');
  });
});

describe('fiscalHalf', () => {
  it('Apr–Sep is H1', () => {
    expect(fiscalHalf('2026-04-01')).toBe(1);
    expect(fiscalHalf('2026-09-30')).toBe(1);
  });
  it('Oct–Mar is H2', () => {
    expect(fiscalHalf('2026-10-01')).toBe(2);
    expect(fiscalHalf('2027-03-31')).toBe(2);
  });
});

describe('fiscalQuarter', () => {
  it('maps each month to its FY quarter', () => {
    expect(fiscalQuarter('2026-04-01')).toBe(1); // Apr–Jun
    expect(fiscalQuarter('2026-06-30')).toBe(1);
    expect(fiscalQuarter('2026-07-01')).toBe(2); // Jul–Sep
    expect(fiscalQuarter('2026-10-01')).toBe(3); // Oct–Dec
    expect(fiscalQuarter('2027-01-01')).toBe(4); // Jan–Mar
    expect(fiscalQuarter('2027-03-31')).toBe(4);
  });
});

describe('periodEndDate', () => {
  it('yearly closes on 31 March of the FY, whichever side of Jan you ask from', () => {
    expect(periodEndDate('yearly', '2026-04-01')).toBe('2027-03-31');
    expect(periodEndDate('yearly', '2027-02-14')).toBe('2027-03-31');
  });
  it('half-yearly closes on 30 Sep (H1) or 31 Mar (H2)', () => {
    expect(periodEndDate('half_yearly', '2026-05-20')).toBe('2026-09-30');
    expect(periodEndDate('half_yearly', '2026-11-05')).toBe('2027-03-31');
  });
  it('quarterly closes on the last day of the quarter', () => {
    expect(periodEndDate('quarterly', '2026-04-15')).toBe('2026-06-30');
    expect(periodEndDate('quarterly', '2026-08-02')).toBe('2026-09-30');
    expect(periodEndDate('quarterly', '2026-11-30')).toBe('2026-12-31');
    expect(periodEndDate('quarterly', '2027-02-01')).toBe('2027-03-31');
  });
  it('monthly closes on the last day of the calendar month, leap years included', () => {
    expect(periodEndDate('monthly', '2026-04-10')).toBe('2026-04-30');
    expect(periodEndDate('monthly', '2028-02-10')).toBe('2028-02-29');
  });
  it('daily is the day itself', () => {
    expect(periodEndDate('daily', '2026-06-11')).toBe('2026-06-11');
  });
});

describe('periodLabel', () => {
  it('names the quarter and its months', () => {
    expect(periodLabel('quarterly', '2026-08-02')).toBe('Q2 · Jul–Sep · FY 2026-27');
  });
  it('names the half', () => {
    expect(periodLabel('half_yearly', '2026-11-05')).toBe('H2 · Oct–Mar · FY 2026-27');
  });
  it('has nothing to say about a single day', () => {
    expect(periodLabel('daily', '2026-06-11')).toBeNull();
  });
});
