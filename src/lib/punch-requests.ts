//
// Pure, dependency-free helpers for the punch-time-change-request feature —
// no Supabase import, so the monthly-limit and date-window rules are unit
// testable directly (see punch-requests.test.ts). Consumed by both the
// server actions (src/lib/actions.ts) and the client-side request card
// (src/app/(app)/punch/PunchRequestsCard.tsx).
import type { PunchChangeRequestStatus } from './types';

export const MONTHLY_REQUEST_LIMIT = 5;

// YYYY-MM of a YYYY-MM-DD calendar date string.
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

// True when `workDate` falls in the current or previous calendar month,
// relative to `today` (both YYYY-MM-DD). Members may only request a change
// for a day recent enough to verify.
export function isWithinRequestWindow(workDate: string, today: string): boolean {
  const [ty, tm] = today.split('-').map(Number);
  const prevYear = tm === 1 ? ty - 1 : ty;
  const prevMonth = tm === 1 ? 12 : tm - 1;
  const curr = `${ty}-${String(tm).padStart(2, '0')}`;
  const prev = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const wm = monthKey(workDate);
  return wm === curr || wm === prev;
}

// Only these statuses count toward the monthly cap — a withdrawn request
// frees up its slot for a new one.
export function countsTowardMonthlyLimit(status: PunchChangeRequestStatus): boolean {
  return status !== 'withdrawn';
}
