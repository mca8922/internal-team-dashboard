import { describe, it, expect } from 'vitest';
import {
  classifyNotif,
  compareSections,
  isSectioned,
  type NotifViewer,
} from './notif-sections';

const BOARD: NotifViewer = { isBoard: true, isManager: false };
const MANAGER: NotifViewer = { isBoard: false, isManager: true };
const MEMBER: NotifViewer = { isBoard: false, isManager: false };

describe('isSectioned', () => {
  it('sections the bell for board and managers, flat for plain members', () => {
    expect(isSectioned(BOARD)).toBe(true);
    expect(isSectioned(MANAGER)).toBe(true);
    expect(isSectioned(MEMBER)).toBe(false);
  });
});

describe('classifyNotif — board', () => {
  it('routes a team work report to its department section', () => {
    expect(classifyNotif('work_report_submitted', 'Design', BOARD)).toMatchObject({
      kind: 'department',
      department: 'Design',
      id: 'dept:Design',
    });
  });

  it('routes leave requests to Needs action', () => {
    expect(classifyNotif('leave_requested', null, BOARD).kind).toBe('needs_action');
  });

  it("keeps the board member's own goal/review rows in Personal", () => {
    expect(classifyNotif('goal_assigned', 'Design', BOARD).kind).toBe('personal');
    expect(classifyNotif('work_report_reviewed', 'Design', BOARD).kind).toBe('personal');
  });

  it('falls back to Company for a department-less work report', () => {
    expect(classifyNotif('work_report_submitted', null, BOARD).kind).toBe('company');
  });

  it('routes punch change requests to Needs action', () => {
    expect(classifyNotif('punch_change_requested', null, BOARD).kind).toBe('needs_action');
  });

  it('keeps punch change decisions in Personal', () => {
    expect(classifyNotif('punch_change_approved', null, BOARD).kind).toBe('personal');
    expect(classifyNotif('punch_change_rejected', null, BOARD).kind).toBe('personal');
  });
});

describe('classifyNotif — manager', () => {
  it('routes team work reports to Your team, everything else to Personal', () => {
    expect(classifyNotif('work_report_submitted', 'Design', MANAGER).kind).toBe('team');
    expect(classifyNotif('goal_assigned', 'Design', MANAGER).kind).toBe('personal');
    expect(classifyNotif('leave_approved', null, MANAGER).kind).toBe('personal');
  });
});

describe('compareSections', () => {
  it('orders Needs action -> departments (A-Z) -> Company -> Personal', () => {
    const sections = [
      classifyNotif('goal_assigned', null, BOARD), // personal
      classifyNotif('work_report_submitted', null, BOARD), // company
      classifyNotif('work_report_submitted', 'Social Media', BOARD),
      classifyNotif('work_report_submitted', 'Design', BOARD),
      classifyNotif('leave_requested', null, BOARD), // needs_action
    ];
    const labels = [...sections].sort(compareSections).map((s) => s.label);
    expect(labels).toEqual([
      'Needs action',
      'Design',
      'Social Media',
      'Company',
      'Personal',
    ]);
  });
});
