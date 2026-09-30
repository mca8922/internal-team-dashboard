//
// Pure, dependency-free helpers for the punch-time-change-request feature —
// no Supabase import, so the monthly-limit and date-window rules are unit
// testable directly (see punch-requests.test.ts). Consumed by both the
// server actions (src/lib/actions.ts) and the client-side request card
// (src/app/(app)/punch/PunchRequestsCard.tsx).
import { fmtDate } from './dates';
import type { PunchChangeRequestStatus, PunchChangeRequestType } from './types';

export const MONTHLY_REQUEST_LIMIT = 5;

// A 'forgot_punch_out' request is a forced correction: the member cannot punch
// in again until they file it, so it must not be blocked by the monthly cap or
// the current/previous-month window that the two discretionary request types
// obey. It records the member's own account of when they left, not a dispute.
export function isForcedCorrection(type: PunchChangeRequestType): boolean {
  return type === 'forgot_punch_out';
}

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

// Monthly roll-up of one member's punch change requests, for the Punch page
// quota chip and the Team Analytics per-member table. `used` / `left` follow
// exactly the cap the server action enforces (forced corrections and withdrawn
// requests are free); the per-status counts cover every request raised this
// month, forced ones included, so the Board sees the whole picture.
export interface MonthlyRequestSummary {
  used: number;
  left: number;
  pending: number;
  approved: number;
  rejected: number;
  withdrawn: number;
  forced: number;
  total: number;
}

// `created_at` is an instant; the month it counts toward is its IST calendar
// month — the same boundary submitPunchChangeRequest uses for the cap.
export function summarizeMonthRequests(
  requests: { request_type: PunchChangeRequestType; status: PunchChangeRequestStatus; created_at: string }[],
  today: string,
): MonthlyRequestSummary {
  const thisMonth = monthKey(today);
  const s: MonthlyRequestSummary = {
    used: 0,
    left: MONTHLY_REQUEST_LIMIT,
    pending: 0,
    approved: 0,
    rejected: 0,
    withdrawn: 0,
    forced: 0,
    total: 0,
  };
  for (const r of requests) {
    if (monthKey(fmtDate(r.created_at)) !== thisMonth) continue;
    s.total += 1;
    s[r.status] += 1;
    if (isForcedCorrection(r.request_type)) s.forced += 1;
    else if (countsTowardMonthlyLimit(r.status)) s.used += 1;
  }
  s.left = Math.max(0, MONTHLY_REQUEST_LIMIT - s.used);
  return s;
}

// Tone for the "X of 5 left" chip: plenty → green, last one or two → amber,
// none → red (the member must contact the Founder directly).
export function quotaTone(left: number): 'green' | 'amber' | 'red' {
  if (left <= 0) return 'red';
  if (left <= 2) return 'amber';
  return 'green';
}
