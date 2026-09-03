import { describe, it, expect } from 'vitest';
import { computeGoalProgress, deriveGoalStatus } from './goal-progress';
import type {
  ChecklistRecurrence,
  Goal,
  GoalChecklistItem,
  GoalChecklistCompletion,
} from './types';

const MON = new Date(2026, 5, 15, 10); // Monday
const LAST_WEEK = new Date(2026, 5, 8, 10).toISOString();

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
    expect(r.pct).toBe(42);
    expect(r.dueCount).toBe(0);
    expect(r.perPerson).toEqual([]);
    // null = nothing to measure, which is what keeps the status manual.
    expect(r.completionPct).toBeNull();
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

  it('counts an item ONCE on a task with no assignees, however many people tick it', () => {
    // The bug that wrote 100% onto a task with items nobody had touched: four
    // completion ROWS over three items used to read 4/4. Three of four items
    // done is 75%, whoever did them.
    const items = [item('a', 'once'), item('b', 'once'), item('c', 'once'), item('d', 'once')];
    const completionsByItem = {
      a: [comp('a', 'u1'), comp('a', 'u2')], // same step, two people
      b: [comp('b', 'u1')],
      c: [comp('c', 'u2')],
      // 'd' untouched
    };
    const r = computeGoalProgress({ items, completionsByItem, assigneeIds: [], now: MON });
    expect(r.pct).toBe(75);
  });

  it('multi-assignee partial completion: one member done, two not', () => {
    // Rohit finished both steps; his two teammates have not started. 2 of 6.
    const items = [item('a', 'once'), item('b', 'once')];
    const completionsByItem = {
      a: [comp('a', 'rohit')],
      b: [comp('b', 'rohit')],
    };
    const r = computeGoalProgress({
      items,
      completionsByItem,
      assigneeIds: ['rohit', 'u2', 'u3'],
      now: MON,
    });
    expect(r.pct).toBe(33);
    expect(r.perPerson.find((p) => p.id === 'rohit')).toMatchObject({ done: 2, total: 2 });
    expect(r.perPerson.find((p) => p.id === 'u2')).toMatchObject({ done: 0, total: 2 });
  });

  describe('past due (closed)', () => {
    it('freezes the tally instead of emptying it — never 0/0', () => {
      // Every step done, by both members, but the due date has passed. The old
      // behaviour returned 0/0 for everyone and held a stale stored number.
      const items = [item('a', 'once'), item('b', 'once')];
      const completionsByItem = {
        a: [comp('a', 'u1'), comp('a', 'u2')],
        b: [comp('b', 'u1'), comp('b', 'u2')],
      };
      const r = computeGoalProgress({
        items,
        completionsByItem,
        assigneeIds: ['u1', 'u2'],
        manualProgress: 33, // a contradictory stored value must not win
        closed: true,
        now: MON,
      });
      expect(r.frozen).toBe(true);
      expect(r.pct).toBe(100);
      expect(r.dueCount).toBe(2);
      expect(r.perPerson).toEqual([
        { id: 'u1', onLeave: false, done: 2, total: 2 },
        { id: 'u2', onLeave: false, done: 2, total: 2 },
      ]);
    });

    it('keeps counting steps that are not due today, and completions from an earlier period', () => {
      // A Saturday-only step and a daily step ticked last week: live they are
      // invisible, frozen they are the record of what happened.
      const items = [item('sat', 'custom', [6]), item('day', 'daily')];
      const completionsByItem = {
        sat: [comp('sat', 'u1', LAST_WEEK)],
        day: [comp('day', 'u1', LAST_WEEK)],
      };
      const live = computeGoalProgress({
        items,
        completionsByItem,
        assigneeIds: ['u1'],
        now: MON,
      });
      expect(live.dueCount).toBe(1); // only the daily step is due on a Monday
      // Today's row: the daily step is pending again, last week's tick is spent.
      expect(live.perPerson[0]).toMatchObject({ done: 0, total: 1 });
      // The headline is the completion tally, which does NOT reset per period.
      expect(live.pct).toBe(100);

      const frozen = computeGoalProgress({
        items,
        completionsByItem,
        assigneeIds: ['u1'],
        closed: true,
        now: MON,
      });
      expect(frozen.dueCount).toBe(2);
      expect(frozen.pct).toBe(100);
      expect(frozen.perPerson[0]).toMatchObject({ done: 2, total: 2 });
    });

    it('a partly-done frozen checklist reports what was actually completed', () => {
      const items = [item('a', 'once'), item('b', 'once'), item('c', 'once')];
      const completionsByItem = { a: [comp('a', 'u1')], b: [comp('b', 'u1')] };
      const r = computeGoalProgress({
        items,
        completionsByItem,
        assigneeIds: ['u1'],
        closed: true,
        now: MON,
      });
      expect(r.pct).toBe(67);
      expect(r.perPerson[0]).toMatchObject({ done: 2, total: 3 });
    });

    it('still falls back to manual progress when there is no checklist at all', () => {
      const r = computeGoalProgress({
        items: [],
        completionsByItem: {},
        assigneeIds: ['u1'],
        manualProgress: 60,
        closed: true,
        now: MON,
      });
      expect(r.pct).toBe(60);
      expect(r.completionPct).toBeNull();
    });
  });
});

describe('deriveGoalStatus', () => {
  // Only the fields the derivation reads.
  const goal = (over: Partial<Goal>): Goal =>
    ({
      id: 'g1',
      status: 'active',
      progress: 0,
      checklist_units: 4,
      due_date: null,
      ...over,
    }) as Goal;
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const lastWeek = () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  };

  it('Completed once the checklist is 100%, whatever the stored status says', () => {
    expect(deriveGoalStatus(goal({ progress: 100, due_date: tomorrow() }))).toBe('achieved');
    expect(deriveGoalStatus(goal({ status: 'active', progress: 100 }))).toBe('achieved');
    // Past due but finished is still Completed, not Not met.
    expect(deriveGoalStatus(goal({ progress: 100, due_date: lastWeek() }))).toBe('achieved');
  });

  it('Not met when the due date passed short of 100%', () => {
    expect(deriveGoalStatus(goal({ progress: 33, due_date: lastWeek() }))).toBe('not_met');
    // Even if someone marked it Completed by hand — the bug this replaces.
    expect(deriveGoalStatus(goal({ status: 'achieved', progress: 33, due_date: lastWeek() }))).toBe(
      'not_met',
    );
  });

  it('Active while it is open and unfinished', () => {
    expect(deriveGoalStatus(goal({ progress: 50, due_date: tomorrow() }))).toBe('active');
    expect(deriveGoalStatus(goal({ progress: 0, due_date: null }))).toBe('active');
    // A stored "Completed" the checklist does not back up is not Completed.
    expect(deriveGoalStatus(goal({ status: 'achieved', progress: 50, due_date: tomorrow() }))).toBe(
      'active',
    );
  });

  it('Not-Active stays manual and outranks everything', () => {
    expect(deriveGoalStatus(goal({ status: 'inactive', progress: 100 }))).toBe('inactive');
    expect(deriveGoalStatus(goal({ status: 'inactive', progress: 0, due_date: lastWeek() }))).toBe(
      'inactive',
    );
  });

  it('keeps the stored status on a task with no checklist to measure', () => {
    const manual = { checklist_units: 0, progress: 40 };
    expect(deriveGoalStatus(goal({ ...manual, status: 'achieved' }))).toBe('achieved');
    expect(deriveGoalStatus(goal({ ...manual, status: 'not_met', due_date: lastWeek() }))).toBe(
      'not_met',
    );
    expect(deriveGoalStatus(goal({ ...manual, status: 'active', due_date: lastWeek() }))).toBe(
      'active',
    );
  });

  it('takes a live completion % over the stored one', () => {
    // What GoalCard passes so a tick re-badges the card immediately.
    expect(deriveGoalStatus(goal({ progress: 0, due_date: tomorrow() }), 100)).toBe('achieved');
    expect(deriveGoalStatus(goal({ progress: 100, due_date: lastWeek() }), 50)).toBe('not_met');
    // An explicit null means "no checklist", so the stored status stands.
    expect(deriveGoalStatus(goal({ status: 'achieved', progress: 0 }), null)).toBe('achieved');
  });
});
