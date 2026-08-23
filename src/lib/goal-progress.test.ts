import { describe, it, expect } from 'vitest';
import { computeGoalProgress } from './goal-progress';
import type { ChecklistRecurrence, GoalChecklistItem, GoalChecklistCompletion } from './types';

const MON = new Date(2026, 5, 15, 10); // Monday

const item = (id: string, recurrence: ChecklistRecurrence = 'daily', recur_days: number[] = []) =>
  ({ id, recurrence, recur_days }) as GoalChecklistItem;
// A PERSONAL item (migration 0064) — one member added it to their own list, so
// only they owe it.
const own = (id: string, owner_id: string, recurrence: ChecklistRecurrence = 'daily') =>
  ({ id, owner_id, recurrence, recur_days: [] }) as unknown as GoalChecklistItem;
const comp = (item_id: string, user_id: string, done_at = MON.toISOString()) =>
  ({ item_id, user_id, done_at }) as GoalChecklistCompletion;

describe('computeGoalProgress', () => {
  it('uses manual progress when there is no checklist', () => {
    const r = computeGoalProgress({
      items: [],
      completionsByItem: {},
      assigneeIds: [],
      manualProgress: 42,
      now: MON,
    });
    expect(r).toEqual({ pct: 42, dueCount: 0, perPerson: [] });
  });

  it('freezes when closed: nothing due, holds the stored progress', () => {
    const items = [item('a'), item('b')];
    // Live completions exist, but a closed goal must ignore them and not reset
    // to 0 — it holds the final stored snapshot instead.
    const completionsByItem = { a: [comp('a', 'u1'), comp('a', 'u2')] };
    const r = computeGoalProgress({
      items,
      completionsByItem,
      assigneeIds: ['u1', 'u2'],
      manualProgress: 75,
      closed: true,
      now: MON,
    });
    expect(r.dueCount).toBe(0);
    expect(r.pct).toBe(75);
    expect(r.perPerson).toEqual([
      { id: 'u1', onLeave: false, done: 0, total: 0 },
      { id: 'u2', onLeave: false, done: 0, total: 0 },
    ]);
  });

  it('computes (items × assignees) — half done is 50%', () => {
    const items = [item('a'), item('b')];
    // both assignees finished 'a', neither finished 'b'
    const completionsByItem = { a: [comp('a', 'u1'), comp('a', 'u2')] };
    const r = computeGoalProgress({
      items,
      completionsByItem,
      assigneeIds: ['u1', 'u2'],
      now: MON,
    });
    expect(r.dueCount).toBe(2);
    expect(r.pct).toBe(50); // 2 done / (2 items × 2 people)
  });

  it('excludes on-leave members from the denominator', () => {
    const items = [item('a')];
    const completionsByItem = { a: [comp('a', 'u1')] }; // u1 done, u2 not
    // u2 present → 1 / (1 × 2) = 50%
    expect(
      computeGoalProgress({ items, completionsByItem, assigneeIds: ['u1', 'u2'], now: MON }).pct,
    ).toBe(50);
    // u2 on leave → only u1 counts → 1 / 1 = 100%
    const r = computeGoalProgress({
      items,
      completionsByItem,
      assigneeIds: ['u1', 'u2'],
      onLeave: new Set(['u2']),
      now: MON,
    });
    expect(r.pct).toBe(100);
    expect(r.perPerson.find((p) => p.id === 'u2')?.onLeave).toBe(true);
  });

  it('ignores items that are not due today', () => {
    const items = [item('a', 'weekdays'), item('b', 'custom', [6])]; // 'b' only due Saturday
    const r = computeGoalProgress({ items, completionsByItem: {}, assigneeIds: ['u1'], now: MON });
    expect(r.dueCount).toBe(1); // only the weekdays item counts on a Monday
  });

  it('charges a personal item to its owner alone', () => {
    // One shared item both owe, plus one item u1 added for themselves. u1 owes
    // 2, u2 still owes only the 1 they were assigned.
    const items = [item('a'), own('mine', 'u1')];
    const r = computeGoalProgress({
      items,
      completionsByItem: {},
      assigneeIds: ['u1', 'u2'],
      now: MON,
    });
    expect(r.perPerson.find((p) => p.id === 'u1')?.total).toBe(2);
    expect(r.perPerson.find((p) => p.id === 'u2')?.total).toBe(1);
    expect(r.pct).toBe(0);
  });

  it('counts a personal item in the combined % without inflating teammates', () => {
    // Denominator is 3 (u1 owes 2, u2 owes 1), not 4 as the old items×people
    // formula gave. Both tick the shared item; u1's own item is still pending.
    const items = [item('a'), own('mine', 'u1')];
    const completionsByItem = { a: [comp('a', 'u1'), comp('a', 'u2')] };
    const r = computeGoalProgress({
      items,
      completionsByItem,
      assigneeIds: ['u1', 'u2'],
      now: MON,
    });
    expect(r.pct).toBe(67); // 2 of 3
  });

  it("never credits a teammate's tick on someone else's personal item", () => {
    const items = [own('mine', 'u1')];
    // A stray completion by u2 (the DB refuses these; belt and braces here).
    const completionsByItem = { mine: [comp('mine', 'u2')] };
    const r = computeGoalProgress({
      items,
      completionsByItem,
      assigneeIds: ['u1', 'u2'],
      now: MON,
    });
    expect(r.pct).toBe(0);
    expect(r.perPerson.find((p) => p.id === 'u2')?.total).toBe(0);
  });

  it('skips personal items on a department goal with no assignees', () => {
    // Nobody to attribute them to — mirrors recompute_goal_progress.
    const items = [item('a'), own('mine', 'u1')];
    const completionsByItem = { a: [comp('a', 'u9')] };
    const r = computeGoalProgress({ items, completionsByItem, assigneeIds: [], now: MON });
    expect(r.pct).toBe(100); // the one shared item is done
  });

  it('reports per-person done/total for every assignee', () => {
    const items = [item('a')];
    const completionsByItem = { a: [comp('a', 'u1')] };
    const r = computeGoalProgress({
      items,
      completionsByItem,
      assigneeIds: ['u1', 'u2'],
      now: MON,
    });
    expect(r.perPerson).toHaveLength(2);
    expect(r.perPerson.find((p) => p.id === 'u1')?.done).toBe(1);
    expect(r.perPerson.find((p) => p.id === 'u2')?.done).toBe(0);
  });
});
