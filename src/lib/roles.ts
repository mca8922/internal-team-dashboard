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

// "Director" is the current display name for the `role: 'board'` tier (same
// underlying permissions the app has always called "Board Member" — is_board()
// RLS, FOUNDER_USER_IDS, etc. are all unchanged, this only renames the label).
// fte/pte/intern double as both the old role value AND the new "Type" concept
// (see the Team "Manage member" modal), so their labels are unchanged.
export function roleLabel(role: UserRole): string {
  return (
    { board: 'Director', fte: 'Full-Time', pte: 'Part-Time', intern: 'Intern' }[role] || role
  );
}

// How to title someone who reviewed a work report: the Board are "Director",
// an appointed head of department is "Manager", everyone else falls back to
// their plain role label. Used on each rating/comment so the member sees WHO
// gave the feedback.
export function reviewerLabel(p: {
  role: UserRole;
  is_manager?: boolean | null;
}): string {
  if (p.role === 'board') return 'Director';
  if (p.is_manager) return 'Manager';
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

// ── Department scope ────────────────────────────────────────────────────────
// The department is the security boundary above the manager line (migration
// 0058). A Director is board-level scoped to exactly ONE department: the value
// in their own `department` field. Several Directors may share a department; a
// Director never spans two. A department with no Director is covered by the
// Founders alone.
//
// The Founders sit under NO department — their `department` is the empty
// string and their reach comes from isFounder(), not from a department. Blank
// therefore has to mean "matches nothing", or every unassigned account would
// silently see every other unassigned one.

// The sentinel stored in `profiles.department` for someone under no
// department. The column is NOT NULL, so "none" is the empty string.
export const NO_DEPARTMENT = '';

// A person's department, or null when they belong to none.
export function departmentOf(
  profile: { department?: string | null } | null | undefined,
): string | null {
  const d = profile?.department?.trim();
  return d ? d : null;
}

// A Director is board-level but NOT a Founder. Founders are board-level too,
// yet they are deliberately excluded: their power is org-wide, so treating
// them as a Director of their (empty) department would scope them to nothing.
export function isDirector(
  profile: { id: string; role: UserRole } | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.role === 'board' && !isFounder(profile);
}

// True when both people sit in the same, non-blank department.
export function sameDepartment(
  a: { department?: string | null } | null | undefined,
  b: { department?: string | null } | null | undefined,
): boolean {
  const da = departmentOf(a);
  return da != null && da === departmentOf(b);
}

// May `viewer` see `target` at all? Mirrors can_view_user() in migration 0058 —
// RLS is the real enforcement, this is for UI gating.
export function canViewMember(
  viewer: { id: string; role: UserRole; department?: string | null; is_manager?: boolean | null },
  target: { id: string; department?: string | null; manager_id?: string | null },
): boolean {
  if (isFounder(viewer)) return true;
  if (viewer.id === target.id) return true;
  if (isDirector(viewer) && sameDepartment(viewer, target)) return true;
  return isManager(viewer) && target.manager_id === viewer.id;
}

// May `viewer` EDIT `target`'s profile? Narrower than canViewMember: Managers
// get no write power (they raise change requests), and a Founder row is frozen
// against everyone but its own owner. Mirrors can_manage_user() in 0058.
export function canManageMember(
  viewer: { id: string; role: UserRole; department?: string | null },
  target: { id: string; department?: string | null },
): boolean {
  if (isFounder(target)) return viewer.id === target.id;
  if (isFounder(viewer)) return true;
  return isDirector(viewer) && sameDepartment(viewer, target);
}

// Structural changes — who is a Director, who heads which department, who
// reports to whom — are the Founders' alone. A Director runs the department
// they were given; they cannot widen it or appoint their own peers.
export function canRestructure(
  viewer: { id: string } | null | undefined,
): boolean {
  return isFounder(viewer);
}

// May `candidate` be made a direct report of `director`? Mirrors the rules the
// assert_hierarchy_consistent() trigger enforces in migration 0059:
//
//   * the director must actually be a Director (board, not a Founder)
//   * both sit in the SAME, non-blank department — a cross-department line
//     would point out of the silo 0058 established
//   * a Director never reports to another Director, a Founder to no one, and
//     nobody to themselves
//
// Deliberately says nothing about manager_id: a member may report to a Manager
// AND to their Director at once, so the two lines never exclude each other.
export function canReportToDirector(
  director: { id: string; role: UserRole; department?: string | null },
  candidate: {
    id: string;
    role: UserRole;
    department?: string | null;
    isActive?: boolean;
  },
): boolean {
  if (!isDirector(director)) return false;
  if (candidate.id === director.id) return false;
  if (isFounder(candidate)) return false;
  if (candidate.role === 'board') return false;
  if (candidate.isActive === false) return false;
  return sameDepartment(director, candidate);
}

