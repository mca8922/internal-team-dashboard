// Department-scoped hierarchy (migration 0058). These mirror can_view_user()
// and can_manage_user() in SQL — RLS is the real enforcement, but the UI gates
// off these, so the two must agree.
import { describe, it, expect } from 'vitest';
import {
  FOUNDER_USER_IDS,
  isFounder,
  isDirector,
  departmentOf,
  sameDepartment,
  canViewMember,
  canManageMember,
  canRestructure,
  canReportToDirector,
} from './roles';
import type { UserRole } from './types';

const [RAJESH, DHARMESH] = FOUNDER_USER_IDS;

function person(
  id: string,
  role: UserRole,
  department: string,
  extra: { is_manager?: boolean; manager_id?: string | null } = {},
) {
  return { id, role, department, ...extra };
}

// Two departments, each with a Director, a Manager and a staff member.
const auditDirector = person('d-audit', 'board', 'Audit');
const auditManager = person('m-audit', 'fte', 'Audit', { is_manager: true });
const auditStaff = person('s-audit', 'intern', 'Audit', { manager_id: 'm-audit' });
const taxDirector = person('d-tax', 'board', 'Tax');
const taxStaff = person('s-tax', 'fte', 'Tax');
const founder = person(RAJESH, 'board', '');
const otherFounder = person(DHARMESH, 'board', '');
const unassigned = person('u-1', 'fte', '');

describe('isFounder / isDirector', () => {
  it('identifies founders by immutable user id', () => {
    expect(isFounder(founder)).toBe(true);
    expect(isFounder(auditDirector)).toBe(false);
  });

  it('excludes founders from isDirector — their reach is not department-bound', () => {
    expect(isDirector(auditDirector)).toBe(true);
    expect(isDirector(founder)).toBe(false);
    expect(isDirector(auditStaff)).toBe(false);
  });
});

describe('departmentOf / sameDepartment', () => {
  it('treats blank as no department', () => {
    expect(departmentOf(founder)).toBeNull();
    expect(departmentOf({ department: '   ' })).toBeNull();
    expect(departmentOf(auditStaff)).toBe('Audit');
  });

  it('never matches two blanks — unassigned is not a shared silo', () => {
    expect(sameDepartment(founder, otherFounder)).toBe(false);
    expect(sameDepartment(founder, unassigned)).toBe(false);
    expect(sameDepartment(auditDirector, auditStaff)).toBe(true);
    expect(sameDepartment(auditDirector, taxStaff)).toBe(false);
  });
});

describe('canViewMember', () => {
  it('lets a Founder see everyone, including the other Founder', () => {
    for (const t of [auditDirector, auditStaff, taxDirector, taxStaff, otherFounder]) {
      expect(canViewMember(founder, t)).toBe(true);
    }
  });

  it('scopes a Director to their own department', () => {
    expect(canViewMember(auditDirector, auditManager)).toBe(true);
    expect(canViewMember(auditDirector, auditStaff)).toBe(true);
    // The whole point: no reach into another department, at any level.
    expect(canViewMember(auditDirector, taxDirector)).toBe(false);
    expect(canViewMember(auditDirector, taxStaff)).toBe(false);
    expect(canViewMember(auditDirector, founder)).toBe(false);
  });

  it('keeps a Manager scoped to their own picked team', () => {
    expect(canViewMember(auditManager, auditStaff)).toBe(true);
    // A department peer who does not report to them stays hidden.
    expect(canViewMember(auditManager, auditDirector)).toBe(false);
    expect(canViewMember(auditManager, taxStaff)).toBe(false);
  });

  it('always lets someone see themselves', () => {
    expect(canViewMember(taxStaff, taxStaff)).toBe(true);
    expect(canViewMember(unassigned, unassigned)).toBe(true);
  });

  it('gives plain staff no view of anyone else', () => {
    expect(canViewMember(auditStaff, auditManager)).toBe(false);
    expect(canViewMember(auditStaff, taxStaff)).toBe(false);
  });
});

describe('canManageMember', () => {
  it('freezes a Founder row against everyone but its own owner', () => {
    expect(canManageMember(founder, otherFounder)).toBe(false);
    expect(canManageMember(otherFounder, founder)).toBe(false);
    expect(canManageMember(founder, founder)).toBe(true);
    expect(canManageMember(auditDirector, founder)).toBe(false);
  });

  it('lets a Founder manage every non-Founder', () => {
    expect(canManageMember(founder, taxStaff)).toBe(true);
    expect(canManageMember(founder, auditDirector)).toBe(true);
  });

  it('scopes a Director to their own department', () => {
    expect(canManageMember(auditDirector, auditStaff)).toBe(true);
    expect(canManageMember(auditDirector, taxStaff)).toBe(false);
  });

  it('grants a Manager no write power — they raise change requests instead', () => {
    expect(canManageMember(auditManager, auditStaff)).toBe(false);
  });

  it('gives an unassigned account no reach over another unassigned one', () => {
    const otherUnassigned = person('u-2', 'board', '');
    expect(canManageMember(otherUnassigned, unassigned)).toBe(false);
  });
});

describe('canReportToDirector', () => {
  it('accepts a same-department manager or staff member', () => {
    expect(canReportToDirector(auditDirector, auditManager)).toBe(true);
    expect(canReportToDirector(auditDirector, auditStaff)).toBe(true);
  });

  it('rejects anyone outside the Director’s department', () => {
    expect(canReportToDirector(auditDirector, taxStaff)).toBe(false);
    expect(canReportToDirector(auditDirector, unassigned)).toBe(false);
  });

  it('never lets a Director report to another Director', () => {
    // Both sit in Audit, so only the role rule can reject this.
    expect(canReportToDirector(auditDirector, taxDirector)).toBe(false);
    const auditDirector2 = person('d-audit-2', 'board', 'Audit');
    expect(canReportToDirector(auditDirector, auditDirector2)).toBe(false);
  });

  it('rejects self-assignment and Founders', () => {
    expect(canReportToDirector(auditDirector, auditDirector)).toBe(false);
    expect(canReportToDirector(auditDirector, { ...founder, department: 'Audit' })).toBe(false);
  });

  it('requires the assigner to actually be a Director', () => {
    expect(canReportToDirector(auditManager, auditStaff)).toBe(false);
    // A Founder is board-level but belongs to no department, so they hold no
    // reports of their own — they assign other people's.
    expect(canReportToDirector(founder, auditStaff)).toBe(false);
  });

  it('skips inactive members', () => {
    expect(
      canReportToDirector(auditDirector, { ...auditStaff, isActive: false }),
    ).toBe(false);
  });

  it('is independent of manager_id — both lines may be held at once', () => {
    // auditStaff already reports to auditManager; that must not block the
    // direct line to the Director.
    expect(auditStaff.manager_id).toBe('m-audit');
    expect(canReportToDirector(auditDirector, auditStaff)).toBe(true);
  });
});

describe('canRestructure', () => {
  it('reserves role / department / reporting changes for the Founders', () => {
    expect(canRestructure(founder)).toBe(true);
    expect(canRestructure(otherFounder)).toBe(true);
    expect(canRestructure(auditDirector)).toBe(false);
    expect(canRestructure(auditManager)).toBe(false);
    expect(canRestructure(null)).toBe(false);
  });
});
