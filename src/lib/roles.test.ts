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
  departmentsOf,
  extraDepartmentsOf,
  belongsToDepartment,
} from './roles';
import type { UserRole } from './types';

const [RAJESH, DHARMESH] = FOUNDER_USER_IDS;

function person(
  id: string,
  role: UserRole,
  department: string,
  extra: {
    is_manager?: boolean;
    manager_id?: string | null;
    director_id?: string | null;
    departments?: string[];
  } = {},
) {
  return { id, role, department, ...extra };
}

// Two departments, each with a Director, a Manager and a staff member.
//
// Since 0061 a Director's reach is what the Founder ASSIGNED them, so the
// fixtures split the two cases deliberately: the Audit Manager is assigned to
// the Audit Director, the Audit staff member is NOT — they only report to the
// Manager. That gap is what pins the non-transitivity rule below.
const auditDirector = person('d-audit', 'board', 'Audit');
const auditManager = person('m-audit', 'fte', 'Audit', {
  is_manager: true,
  director_id: 'd-audit',
});
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

  it('scopes a Director to the people ASSIGNED to them', () => {
    expect(canViewMember(auditDirector, auditManager)).toBe(true);
    // Same department, but nobody assigned them — the department alone no
    // longer grants anything (migration 0061).
    expect(canViewMember(auditDirector, auditStaff)).toBe(false);
    // And still no reach into another department, at any level.
    expect(canViewMember(auditDirector, taxDirector)).toBe(false);
    expect(canViewMember(auditDirector, taxStaff)).toBe(false);
    expect(canViewMember(auditDirector, founder)).toBe(false);
  });

  it('is NOT transitive through an assigned Manager', () => {
    // auditManager is assigned to auditDirector and leads auditStaff, yet the
    // Director does not inherit sight of that team — each person is assigned
    // individually or not at all.
    expect(auditStaff.manager_id).toBe('m-audit');
    expect(canViewMember(auditDirector, auditManager)).toBe(true);
    expect(canViewMember(auditDirector, auditStaff)).toBe(false);
    // The Manager, meanwhile, does see them — so a Manager can legitimately
    // see someone their own Director cannot.
    expect(canViewMember(auditManager, auditStaff)).toBe(true);
  });

  it('gives a Director with no assignments nobody but themselves', () => {
    const lonely = person('d-new', 'board', 'Audit');
    expect(canViewMember(lonely, lonely)).toBe(true);
    expect(canViewMember(lonely, auditManager)).toBe(false);
    expect(canViewMember(lonely, auditStaff)).toBe(false);
  });

  it('lets a Director see someone assigned from ANOTHER department', () => {
    // Primary GST, also listed under Audit, and actually assigned to the Audit
    // Director — eligibility plus assignment is what grants the view.
    const lent = person('s-gst', 'fte', 'GST', {
      departments: ['GST', 'Audit'],
      director_id: 'd-audit',
    });
    expect(canViewMember(auditDirector, lent)).toBe(true);
    expect(canViewMember(taxDirector, lent)).toBe(false);
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

  it('scopes a Director to the people assigned to them', () => {
    expect(canManageMember(auditDirector, auditManager)).toBe(true);
    // Same department, unassigned — no write power either (0061).
    expect(canManageMember(auditDirector, auditStaff)).toBe(false);
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

  it('rejects anyone who belongs to no department of the Director’s', () => {
    expect(canReportToDirector(auditDirector, taxStaff)).toBe(false);
    expect(canReportToDirector(auditDirector, unassigned)).toBe(false);
  });

  it('accepts someone eligible via an ADDITIONAL department (0060 + 0061)', () => {
    // Primary GST, also listed under Audit. This is the case the whole
    // multi-department field exists to serve: assignable to the Audit Director
    // without being moved out of GST.
    const gstPerson = person('s-gst', 'fte', 'GST', { departments: ['GST', 'Audit'] });
    expect(canReportToDirector(auditDirector, gstPerson)).toBe(true);
    // Eligibility is one-directional: Audit on their list does not make them
    // assignable to a Tax Director.
    expect(canReportToDirector(taxDirector, gstPerson)).toBe(false);
  });

  it('never lets a Director without a department hold reports', () => {
    const homeless = person('d-none', 'board', '');
    expect(canReportToDirector(homeless, auditStaff)).toBe(false);
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

// Multi-department membership (migration 0060). The list never grants access on
// its own — it decides ELIGIBILITY to be assigned (0061). These tests pin down
// both halves: it opens the door, it does not walk through it.
describe('departmentsOf / extraDepartmentsOf / belongsToDepartment', () => {
  // Works primarily in Audit, also listed under Tax. Assigned to nobody.
  const crossover = { id: 's-cross', role: 'fte' as UserRole, department: 'Audit', departments: ['Audit', 'Tax'] };

  it('falls back to the primary alone for rows written before 0060', () => {
    expect(departmentsOf(auditStaff)).toEqual(['Audit']);
    expect(extraDepartmentsOf(auditStaff)).toEqual([]);
  });

  it('keeps the primary first and de-duplicates the rest', () => {
    expect(departmentsOf(crossover)).toEqual(['Audit', 'Tax']);
    // A stored array that repeats the primary, or arrives out of order, still
    // resolves to primary-first with no duplicates.
    expect(
      departmentsOf({ department: 'Audit', departments: ['Tax', 'Audit', ' Tax ', ''] }),
    ).toEqual(['Audit', 'Tax']);
  });

  it('reports the extras beside the primary', () => {
    expect(extraDepartmentsOf(crossover)).toEqual(['Tax']);
  });

  it('gives a Founder no departments at all', () => {
    expect(departmentsOf(founder)).toEqual([]);
    expect(belongsToDepartment(founder, 'Audit')).toBe(false);
  });

  it('matches on a primary or an additional department', () => {
    expect(belongsToDepartment(crossover, 'Audit')).toBe(true);
    expect(belongsToDepartment(crossover, 'Tax')).toBe(true);
    expect(belongsToDepartment(crossover, 'Legal')).toBe(false);
    // Blank matches nothing, same rule as departmentOf.
    expect(belongsToDepartment(crossover, '  ')).toBe(false);
  });

  it('does NOT grant access on its own — assignment does', () => {
    // Listed under Tax AND Audit, but assigned to nobody, so neither Director
    // can reach them. Being eligible is not being assigned.
    expect(canViewMember(taxDirector, crossover)).toBe(false);
    expect(canManageMember(taxDirector, crossover)).toBe(false);
    expect(canViewMember(auditDirector, crossover)).toBe(false);
    expect(canManageMember(auditDirector, crossover)).toBe(false);

    // …but both Directors could legitimately be given them.
    expect(canReportToDirector(auditDirector, crossover)).toBe(true);
    expect(canReportToDirector(taxDirector, crossover)).toBe(true);

    // Once assigned, exactly one of them can.
    const assigned = { ...crossover, director_id: 'd-tax' };
    expect(canViewMember(taxDirector, assigned)).toBe(true);
    expect(canManageMember(taxDirector, assigned)).toBe(true);
    expect(canViewMember(auditDirector, assigned)).toBe(false);
  });

  it('does NOT let a Director reach into a department they are only listed in', () => {
    // A Director listed under a second department gains no one: their reach is
    // their assignments, and a label creates none.
    const twoHatDirector = { ...auditDirector, departments: ['Audit', 'Tax'] };
    expect(canViewMember(twoHatDirector, taxStaff)).toBe(false);
    expect(canManageMember(twoHatDirector, taxStaff)).toBe(false);
  });

  it('is what makes a cross-department direct report possible at all', () => {
    // Without Tax on their list this candidate would be invisible to the Tax
    // Director's picker; with it they are offered, and only then assignable.
    const auditOnly = { ...crossover, departments: ['Audit'] };
    expect(canReportToDirector(taxDirector, auditOnly)).toBe(false);
    expect(canReportToDirector(taxDirector, crossover)).toBe(true);
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
