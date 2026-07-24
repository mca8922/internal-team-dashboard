import { describe, it, expect } from 'vitest';
import {
  MONTHLY_REQUEST_LIMIT,
  monthKey,
  isWithinRequestWindow,
  countsTowardMonthlyLimit,
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
