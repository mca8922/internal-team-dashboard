import { describe, it, expect } from 'vitest';
import type { Goal, GoalAssignee, Profile } from './types';

import { visibleGoals } from './goal-visibility';
import { FOUNDER_USER_IDS } from './roles';

const goal = (id: string, department: string, departments?: string[]) =>
  ({ id, department, departments: departments ?? [department], parent_id: null }) as Goal;
const assign = (goal_id: string, user_id: string) => ({ goal_id, user_id }) as GoalAssignee;
const person = (over: Partial<Profile>) =>
  ({ id: 'u1', role: 'fte', department: '', departments: [], ...over }) as Profile;

const ALL = [
  goal('mca', 'MCA'),
  goal('rbi', 'RBI'),
  goal('audit', 'Audit'),
  goal('gst', 'GST'),
  goal('multi', 'GST', ['GST', 'MCA']),
];

describe('visibleGoals — Director department scope', () => {
  it('gives a Founder every task, despite their empty department', () => {
    // Founders sit under NO department (0058), so a department rule would scope
    // them to nothing — their reach has to come from isFounder().
    const founder = person({ id: FOUNDER_USER_IDS[0], role: 'board' });
    expect(visibleGoals(ALL, [], founder).map((g) => g.id)).toEqual(
      ALL.map((g) => g.id),
    );
  });

  it('scopes a Director to the departments they are listed under', () => {
    // The bug: role === 'board' used to short-circuit to every task, so this
    // Director saw Audit and GST too.
    const rohit = person({ id: 'rohit', role: 'board', department: 'MCA', departments: ['MCA', 'RBI'] });
    expect(visibleGoals(ALL, [], rohit).map((g) => g.id).sort()).toEqual(
      ['mca', 'multi', 'rbi'], // 'multi' spans GST+MCA, so MCA reaches it
    );
  });

  it("still shows a Director a task assigned to them outside their departments", () => {
    const rohit = person({ id: 'rohit', role: 'board', department: 'MCA', departments: ['MCA'] });
    const seen = visibleGoals(ALL, [assign('audit', 'rohit')], rohit).map((g) => g.id);
    expect(seen).toContain('audit');
    expect(seen).not.toContain('gst');
  });

  it('does not let a Director see a department they merely share a task-mate with', () => {
    const dir = person({ id: 'd', role: 'board', department: 'MCA', departments: ['MCA'] });
    expect(visibleGoals(ALL, [assign('gst', 'someone-else')], dir).map((g) => g.id)).not.toContain(
      'gst',
    );
  });

  it('leaves the executive rule alone: assigned tasks only, not their department', () => {
    const exec = person({ id: 'e', role: 'fte', department: 'MCA', departments: ['MCA'] });
    expect(visibleGoals(ALL, [assign('audit', 'e')], exec).map((g) => g.id)).toEqual(['audit']);
  });
});
