import { describe, it, expect } from 'vitest';
import {
  MONTHLY_REQUEST_LIMIT,
  monthKey,
  isWithinRequestWindow,
  countsTowardMonthlyLimit,
  isForcedCorrection,
  summarizeMonthRequests,
  quotaTone,
} from './punch-requests';

describe('MONTHLY_REQUEST_LIMIT', () => {
  it('is 5', () => {
    expect(MONTHLY_REQUEST_LIMIT).toBe(5);
  });
});

describe('monthKey', () => {
  it('extracts YYYY-MM from a calendar date', () => {
    expect(monthKey('2026-07-24')).toBe('2026-07');
  });
});

describe('isWithinRequestWindow', () => {
  it('allows the current calendar month', () => {
    expect(isWithinRequestWindow('2026-07-10', '2026-07-24')).toBe(true);
  });

  it('allows the previous calendar month', () => {
    expect(isWithinRequestWindow('2026-06-30', '2026-07-24')).toBe(true);
  });

  it('rejects two months back', () => {
    expect(isWithinRequestWindow('2026-05-31', '2026-07-24')).toBe(false);
  });

  it('rejects a future date', () => {
    expect(isWithinRequestWindow('2026-08-01', '2026-07-24')).toBe(false);
  });

  it('handles the January rollover to the previous December', () => {
    expect(isWithinRequestWindow('2025-12-15', '2026-01-05')).toBe(true);
    expect(isWithinRequestWindow('2025-11-15', '2026-01-05')).toBe(false);
  });
});

describe('countsTowardMonthlyLimit', () => {
  it('counts pending, approved, and rejected', () => {
    expect(countsTowardMonthlyLimit('pending')).toBe(true);
    expect(countsTowardMonthlyLimit('approved')).toBe(true);
    expect(countsTowardMonthlyLimit('rejected')).toBe(true);
  });

  it('excludes withdrawn', () => {
    expect(countsTowardMonthlyLimit('withdrawn')).toBe(false);
  });
});

describe('isForcedCorrection', () => {
  it('is true only for forgot_punch_out', () => {
    expect(isForcedCorrection('forgot_punch_out')).toBe(true);
    expect(isForcedCorrection('missed_punch')).toBe(false);
    expect(isForcedCorrection('day_status')).toBe(false);
  });
});

describe('summarizeMonthRequests', () => {
  const req = (
    request_type: 'missed_punch' | 'day_status' | 'forgot_punch_out',
    status: 'pending' | 'approved' | 'rejected' | 'withdrawn',
    created_at: string,
  ) => ({ request_type, status, created_at });

  it('counts discretionary, non-withdrawn requests toward the cap', () => {
    const s = summarizeMonthRequests(
      [
        req('missed_punch', 'approved', '2026-09-03T05:00:00Z'),
        req('day_status', 'pending', '2026-09-10T05:00:00Z'),
        req('missed_punch', 'rejected', '2026-09-11T05:00:00Z'),
        req('missed_punch', 'withdrawn', '2026-09-12T05:00:00Z'),
        req('forgot_punch_out', 'pending', '2026-09-13T05:00:00Z'),
      ],
      '2026-09-27',
    );
    expect(s).toEqual({
      used: 3,
      left: 2,
      pending: 2,
      approved: 1,
      rejected: 1,
      withdrawn: 1,
      forced: 1,
      total: 5,
    });
  });

  it('ignores other months, using the IST calendar month of created_at', () => {
    const s = summarizeMonthRequests(
      [
        // 31 Aug 20:00 UTC is already 1 Sep in IST — counts toward September.
        req('missed_punch', 'pending', '2026-08-31T20:00:00Z'),
        // 31 Aug 10:00 UTC is still August in IST.
        req('missed_punch', 'pending', '2026-08-31T10:00:00Z'),
      ],
      '2026-09-27',
    );
    expect(s.used).toBe(1);
    expect(s.total).toBe(1);
  });

  it('never reports a negative number left', () => {
    const many = Array.from({ length: 7 }, () => req('missed_punch', 'approved', '2026-09-05T05:00:00Z'));
    expect(summarizeMonthRequests(many, '2026-09-27').left).toBe(0);
  });
});

describe('quotaTone', () => {
  it('is red at 0, amber at 1-2, green otherwise', () => {
    expect(quotaTone(0)).toBe('red');
    expect(quotaTone(1)).toBe('amber');
    expect(quotaTone(2)).toBe('amber');
    expect(quotaTone(3)).toBe('green');
    expect(quotaTone(5)).toBe('green');
  });
});
