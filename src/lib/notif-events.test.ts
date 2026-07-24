import { describe, it, expect } from 'vitest';
import { eventAllowed } from './notif-events';

const BASE = { on_leave: true, on_goal: true, on_punch: true };

describe('eventAllowed', () => {
  it('gates goal_assigned on on_goal', () => {
    expect(eventAllowed({ ...BASE, on_goal: false }, 'goal_assigned')).toBe(false);
    expect(eventAllowed(BASE, 'goal_assigned')).toBe(true);
  });

  it('gates punch_missing and the punch-change events on on_punch', () => {
    const off = { ...BASE, on_punch: false };
    expect(eventAllowed(off, 'punch_missing')).toBe(false);
    expect(eventAllowed(off, 'punch_change_requested')).toBe(false);
    expect(eventAllowed(off, 'punch_change_approved')).toBe(false);
    expect(eventAllowed(off, 'punch_change_rejected')).toBe(false);
    expect(eventAllowed(BASE, 'punch_change_requested')).toBe(true);
  });

  it('falls back to on_leave for leave events', () => {
    const off = { ...BASE, on_leave: false };
    expect(eventAllowed(off, 'leave_approved')).toBe(false);
    expect(eventAllowed(off, 'leave_rejected')).toBe(false);
  });
});
