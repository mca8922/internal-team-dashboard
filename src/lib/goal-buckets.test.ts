import { describe, it, expect } from 'vitest';
import { dueBucket, goalAncestors, goalPath } from './goal-buckets';
import type { Goal } from './types';

const NOW = new Date(2026, 5, 22, 10); // Mon 22 Jun 2026, 10:00

const goal = (over: Partial<Goal> = {}): Goal =>
  ({
    id: 'g',
    level: 'monthly',
    title: 't',
    description: '',
    due_date: null,
    department: '',
    status: 'active',
    progress: 0,
    sort_order: 0,
    parent_id: null,
    created_by: null,
    created_at: '',
    ...over,
  }) as Goal;

describe('dueBucket', () => {
  it('no due date → none', () => {
    expect(dueBucket(goal({ due_date: null }), NOW)).toBe('none');
  });
  it('past date → overdue', () => {
    expect(dueBucket(goal({ due_date: '2026-06-19' }), NOW)).toBe('overdue');
  });
  it('same day → today', () => {
    expect(dueBucket(goal({ due_date: '2026-06-22' }), NOW)).toBe('today');
  });
  it('within 6 days → week', () => {
    expect(dueBucket(goal({ due_date: '2026-06-23' }), NOW)).toBe('week');
    expect(dueBucket(goal({ due_date: '2026-06-28' }), NOW)).toBe('week');
  });
  it('7–30 days → month', () => {
    expect(dueBucket(goal({ due_date: '2026-06-29' }), NOW)).toBe('month');
    expect(dueBucket(goal({ due_date: '2026-07-22' }), NOW)).toBe('month');
  });
  it('beyond 30 days → later', () => {
    expect(dueBucket(goal({ due_date: '2026-08-01' }), NOW)).toBe('later');
  });
});

describe('goalAncestors / goalPath', () => {
  const yearly = goal({ id: 'y', level: 'yearly', parent_id: null });
  const monthly = goal({ id: 'm', level: 'monthly', parent_id: 'y' });
  const weekly = goal({ id: 'w', level: 'weekly', parent_id: 'm' });
  const all = [weekly, yearly, monthly];

  it('lists ancestors top-down, excluding self', () => {
    expect(goalAncestors(weekly, all).map((g) => g.id)).toEqual(['y', 'm']);
  });
  it('path includes self at the end, root first', () => {
    expect(goalPath(weekly, all).map((g) => g.id)).toEqual(['y', 'm', 'w']);
  });
  it('root goal has no ancestors', () => {
    expect(goalAncestors(yearly, all)).toEqual([]);
    expect(goalPath(yearly, all).map((g) => g.id)).toEqual(['y']);
  });
  it('tolerates a broken parent link', () => {
    const orphan = goal({ id: 'o', parent_id: 'missing' });
    expect(goalPath(orphan, [orphan]).map((g) => g.id)).toEqual(['o']);
  });
});
