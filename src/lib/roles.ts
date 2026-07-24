// Role helpers — ported from the prototype. RLS enforces these server-side;
// these are for UI gating only.

import type { UserRole } from '@/lib/types';

const FEATURES: Record<string, UserRole[]> = {
  viewTeam: ['board'],
  manageGoals: ['board'],
  teamAnalytics: ['board'],
  approveLeaves: ['board'],
  addEmployees: ['board'],
  setHolidays: ['board'],
  viewAllLogs: ['board'],
};

export function canAccess(role: UserRole, feature: string): boolean {
  if (!FEATURES[feature]) return true;
  return FEATURES[feature].includes(role);
}

export function roleLabel(role: UserRole): string {
  return (
    { board: 'Board Member', fte: 'Full-Time', pte: 'Part-Time', intern: 'Intern' }[role] || role
  );
}

// How to title someone who reviewed a work report: the Board are "Board Member",
// an appointed head of department is "Department Manager", everyone else falls
// back to their plain role label. Used on each rating/comment so the member sees
// WHO gave the feedback.
export function reviewerLabel(p: {
  role: UserRole;
  is_manager?: boolean | null;
}): string {
  if (p.role === 'board') return 'Board Member';
  if (p.is_manager) return 'Department Manager';
  return roleLabel(p.role);
}

// A Department Manager (Head of Department) is a normal employee the Board has
// appointed to head one department, with a Board-picked team. It's a flag on
// the profile, not a role — so isManager() is independent of UserRole. The
// Board itself is never treated as a "manager" in the UI (they already see
// everything), so this is false for board accounts.
export function isManager(
  profile: { role: UserRole; is_manager?: boolean | null } | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.role !== 'board' && !!profile.is_manager;
}

// Role-based default daily hours, used when the board hasn't set a
// per-member target.
export function roleDefaultHours(role: UserRole): number {
  return role === 'pte' ? 4 : 8;
}

// A member's effective daily target — the board-set value if present,
// otherwise the role default.
export function targetHours(member: {
  role: UserRole;
  daily_target_hours: number | null;
}): number {
  return member.daily_target_hours != null && member.daily_target_hours > 0
    ? member.daily_target_hours
    : roleDefaultHours(member.role);
}

// A standard working week (Mon–Fri) — used to roll a daily target up to a
// weekly one (e.g. a 2h/day member targets 10h/week).
export const WEEKLY_WORKING_DAYS = 5;

// A member's effective WEEKLY target = their daily target × a 5-day week.
export function weeklyTargetHours(member: {
  role: UserRole;
  daily_target_hours: number | null;
}): number {
  return targetHours(member) * WEEKLY_WORKING_DAYS;
}

// Weekly target from an already-resolved daily target (board value or the role
// default). Used where the daily figure is already in hand.
export function weeklyTargetFromDaily(dailyTarget: number): number {
  return dailyTarget * WEEKLY_WORKING_DAYS;
}

// The Founders own the company and have elevated powers above the Board:
// they alone may edit anyone's punch sessions and permanently delete an
// account. Identified by their IMMUTABLE Supabase user ids — never by email,
// which a Founder can freely change and which a board edit could otherwise
// tamper with to strip (or hijack) the keys. Two co-founders share this power
// equally; either one satisfies every Founder-only check.
export const FOUNDER_USER_IDS = [
  '21984019-ddda-42ac-9f10-191928c6c49e', // Rajesh Bohra
  '83d48348-eddf-4ec7-a72f-fdc1392beb59', // Dharmesh Bohra
] as const;

// The Founders' current login emails — informational only (seed scripts, copy).
// Identity is keyed off FOUNDER_USER_IDS, not these values.
export const FOUNDER_EMAILS = ['rajesh@mca.net.in', 'dharmesh@mca.net.in'];

export function isFounder(profile: { id: string } | null | undefined): boolean {
  if (!profile) return false;
  return (FOUNDER_USER_IDS as readonly string[]).includes(profile.id);
}

