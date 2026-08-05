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

// ── Director scope ──────────────────────────────────────────────────────────
// A Director's scope is the people the Founder ASSIGNED to them — the members
// carrying their id in `director_id` (migration 0061). It is not their
// department: two Directors may share one and hold entirely different teams,
// and a Director with no assignments sees only themselves.
//
// The department did not stop mattering, it changed job. It now decides who is
// ELIGIBLE to be assigned (canReportToDirector below), reading the member's
// whole `departments` list, so someone can be handed to a Director outside
// their primary department without being moved out of it.
//
// The Founders sit under NO department — their `department` is the empty
// string and their reach comes from isFounder(), not from a department. Blank
// therefore has to mean "matches nothing", or every unassigned account would
// silently be eligible to every other unassigned one.

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

// ── Multi-department membership (migration 0060) ────────────────────────────
// A member may be LISTED under several departments. `department` stays the
// primary/home one and `departments` holds the full list with the primary
// first.
//
// The list is still not an access grant on its own: canViewMember /
// canManageMember below never read it. What it decides (since 0061) is
// ELIGIBILITY — putting "Audit" on someone whose primary is "GST" makes them
// assignable to an Audit Director in canReportToDirector(). Nobody sees them
// until the Founder actually makes that assignment.

// Every department a person is listed under, primary first, normalised
// (trimmed, de-duplicated, blanks dropped). Falls back to the primary alone
// for rows written before 0060.
export function departmentsOf(
  profile: { department?: string | null; departments?: string[] | null } | null | undefined,
): string[] {
  const primary = departmentOf(profile);
  const rest = (profile?.departments ?? []).map((d) => d?.trim()).filter((d): d is string => !!d);
  return Array.from(new Set([...(primary ? [primary] : []), ...rest]));
}

// The departments BESIDE the primary — what the "Multi department" section in
// Manage member edits, and what the Team card shows as extra chips.
export function extraDepartmentsOf(
  profile: { department?: string | null; departments?: string[] | null } | null | undefined,
): string[] {
  const primary = departmentOf(profile);
  return departmentsOf(profile).filter((d) => d !== primary);
}

// Is this person listed under `dept` at all — primary or additional? For
// grouping and filtering only; never for an access decision (use
// canViewMember/canManageMember, which are primary-only by design).
export function belongsToDepartment(
  profile: { department?: string | null; departments?: string[] | null } | null | undefined,
  dept: string,
): boolean {
  const d = dept.trim();
  return d !== '' && departmentsOf(profile).includes(d);
}

// True when both people sit in the same, non-blank department.
export function sameDepartment(
  a: { department?: string | null } | null | undefined,
  b: { department?: string | null } | null | undefined,
): boolean {
  const da = departmentOf(a);
  return da != null && da === departmentOf(b);
}

// May `viewer` see `target` at all? Mirrors can_view_user() in migration 0061 —
// RLS is the real enforcement, this is for UI gating.
//
// A Director's scope is the people ASSIGNED to them (director_id), NOT their
// department — 0061 replaced 0058's department arm. Deliberately not transitive:
// directing a Manager does not hand over that Manager's team, which is assigned
// separately if it should be visible.
export function canViewMember(
  viewer: { id: string; role: UserRole; department?: string | null; is_manager?: boolean | null },
  target: { id: string; manager_id?: string | null; director_id?: string | null },
): boolean {
  if (isFounder(viewer)) return true;
  if (viewer.id === target.id) return true;
  if (isDirector(viewer) && target.director_id === viewer.id) return true;
  return isManager(viewer) && target.manager_id === viewer.id;
}

// May `viewer` EDIT `target`'s profile? Narrower than canViewMember: Managers
// get no write power (they raise change requests), and a Founder row is frozen
// against everyone but its own owner. Mirrors can_manage_user() in 0061.
export function canManageMember(
  viewer: { id: string; role: UserRole; department?: string | null },
  target: { id: string; director_id?: string | null },
): boolean {
  if (isFounder(target)) return viewer.id === target.id;
  if (isFounder(viewer)) return true;
  return isDirector(viewer) && target.director_id === viewer.id;
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
// assert_hierarchy_consistent() trigger enforces, as amended by migration 0061:
//
//   * the director must actually be a Director (board, not a Founder)
//   * the candidate must BELONG TO the Director's department — primary or
//     additional (0060). This is the one place the multi-department list
//     changes an outcome: it is what lets a GST person be assigned to an Audit
//     Director without leaving GST.
//   * a Director never reports to another Director, a Founder to no one, and
//     nobody to themselves
//
// Since 0061 this is also the ACCESS decision, not just a reporting record —
// assigning someone is what makes them visible to that Director.
//
// Deliberately says nothing about manager_id: a member may report to a Manager
// AND to their Director at once, so the two lines never exclude each other.
export function canReportToDirector(
  director: { id: string; role: UserRole; department?: string | null },
  candidate: {
    id: string;
    role: UserRole;
    department?: string | null;
    departments?: string[] | null;
    isActive?: boolean;
  },
): boolean {
  if (!isDirector(director)) return false;
  if (candidate.id === director.id) return false;
  if (isFounder(candidate)) return false;
  if (candidate.role === 'board') return false;
  if (candidate.isActive === false) return false;
  const dept = departmentOf(director);
  return dept != null && belongsToDepartment(candidate, dept);
}

