// Shared notification sectioning — the single source of truth for how the bell
// (NotificationsBell) and the full Notifications page (NotificationsHistory)
// group notifications into role-aware sections.
//
// The grouping is role-aware:
//   - Board   : Needs action -> one section per Department -> Company
//               -> Personal. Department sections surface which team is active.
//   - Manager : Your team (their members' work reports) -> Personal.
//   - Member  : not sectioned (isSectioned === false) — a flat list reads better
//               than a single "Personal" group.
//
// A notification's department comes from the `department` column, populated for
// goal-related events at insert time (see lib/actions.ts). Null-department
// events (leave, punch, milestones) fall into Company / Personal.
import type { NotificationType } from './types';

export interface NotifViewer {
  isBoard: boolean;
  isManager: boolean;
}

export type SectionKind =
  | 'pinned' // device reminders (avatar/password) — always on top, undismissable
  | 'needs_action'
  | 'department'
  | 'team'
  | 'company'
  | 'personal';

export interface SectionDef {
  id: string;
  label: string;
  kind: SectionKind;
  department: string | null; // set for 'department' sections — drives the accent
}

// Lower rank renders first. Departments + team share rank 2; departments then
// sort alphabetically by label via compareSections.
const RANK: Record<SectionKind, number> = {
  pinned: 0,
  needs_action: 1,
  department: 2,
  team: 2,
  company: 3,
  personal: 4,
};

// Pre-built singleton sections shared across both consumers.
export const PINNED_SECTION: SectionDef = { id: 'pinned', label: 'Reminders', kind: 'pinned', department: null };
export const NEEDS_SECTION: SectionDef = { id: 'needs_action', label: 'Needs action', kind: 'needs_action', department: null };
export const TEAM_SECTION: SectionDef = { id: 'team', label: 'Your team', kind: 'team', department: null };
export const COMPANY_SECTION: SectionDef = { id: 'company', label: 'Company', kind: 'company', department: null };
export const PERSONAL_SECTION: SectionDef = { id: 'personal', label: 'Personal', kind: 'personal', department: null };

// Types that are about the viewer themselves (vs. about the team / company).
const PERSONAL_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'goal_assigned',
  'goal_due_soon',
  'work_report_reviewed',
  'leave_approved',
  'leave_rejected',
  'punch_missing',
  'work_anniversary',
  'birthday',
  'birthday_wish_reply',
  'punch_change_approved',
  'punch_change_rejected',
]);

// Regular members keep the flat list — sectioning only helps Board / Managers,
// who receive notifications spanning multiple teams.
export function isSectioned(v: NotifViewer): boolean {
  return v.isBoard || v.isManager;
}

function deptSection(dept: string): SectionDef {
  return { id: 'dept:' + dept, label: dept, kind: 'department', department: dept };
}

// Maps one stored notification to the section it belongs in for this viewer.
// Department sections only ever hold work_report_submitted (the only "about the
// team" row a reviewer receives that carries a department); a board member's own
// goal/review rows are addressed to them and land in Personal.
export function classifyNotif(
  type: NotificationType,
  department: string | null,
  v: NotifViewer,
): SectionDef {
  if (v.isBoard) {
    if (type === 'leave_requested' || type === 'punch_change_requested') return NEEDS_SECTION;
    if (type === 'work_report_submitted') return department ? deptSection(department) : COMPANY_SECTION;
    if (PERSONAL_TYPES.has(type)) return PERSONAL_SECTION;
    return COMPANY_SECTION;
  }
  // Manager (non-board): their members' reports vs. everything personal.
  if (type === 'work_report_submitted') return TEAM_SECTION;
  return PERSONAL_SECTION;
}

// Orders sections for display: by rank, then department sections alphabetically.
export function compareSections(a: SectionDef, b: SectionDef): number {
  const r = RANK[a.kind] - RANK[b.kind];
  if (r !== 0) return r;
  return a.label.localeCompare(b.label);
}
