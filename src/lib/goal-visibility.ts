// Who can SEE which task.
//
// Split out of queries.ts — which imports the Supabase server client at module
// load and so cannot be pulled into Vitest or plain Node — exactly as
// notif-events.ts was split out of notify-email.ts, so this rule is directly
// unit testable. queries.ts re-exports visibleGoals from here; nothing imports
// both.
//
// This is the UI half of the rule. The real enforcement is the
// "goals: read scoped" RLS policy in migration 0065 — keep the two in step.
import { isFounder, departmentsOf } from './roles';
import type { Goal, GoalAssignee, Profile } from './types';

// Every department a task is filed under. `departments` (migration 0060) is the
// full list and `department` the primary; rows written before 0060 have only
// the latter.
export function goalDepartments(g: Goal): string[] {
  return g.departments && g.departments.length ? g.departments : [g.department];
}

// Goals visible to a member.
//
//   • FOUNDERS see the whole company. Their reach comes from being a Founder,
//     not from a department — they sit under none (migration 0058 sets their
//     department to ''), so any department test would scope them to nothing.
//
//   • A DIRECTOR sees the tasks of the departments they are listed under —
//     primary or additional — plus anything assigned to them personally, so a
//     task handed to them from outside those departments never goes missing off
//     their own checklist. Before migration 0065 this function opened with
//     `if (profile.role === 'board') return goals`, and a Director read all 228
//     tasks across every department.
//
//     Deliberately a DIFFERENT rule from the one governing which PEOPLE a
//     Director sees: canViewMember() scopes that by director_id (0061), on
//     purpose. Tasks are scoped by department at the client's request. The two
//     are allowed to disagree, and they do — a Director with no director_id
//     reports at all must still see their departments' work.
//
//   • Everyone else: a goal counts if it (or any ancestor) is assigned directly
//     to them. Including descendants of a visible goal means an assigned yearly
//     goal also surfaces its half-yearly/quarterly children in the focus view. A
//     goal with no assignees is hidden — department-tagging alone does not grant
//     visibility here.
export function visibleGoals(
  goals: Goal[],
  assignees: GoalAssignee[],
  profile: Profile,
): Goal[] {
  if (isFounder(profile)) return goals;

  const assignedIds = new Set(
    assignees.filter((a) => a.user_id === profile.id).map((a) => a.goal_id),
  );

  if (profile.role === 'board') {
    const mine = departmentsOf(profile);
    return goals.filter(
      (g) => assignedIds.has(g.id) || goalDepartments(g).some((d) => mine.includes(d)),
    );
  }

  const byId = new Map(goals.map((g) => [g.id, g]));

  // Directly visible: explicitly assigned to me.
  const directlyVisible = (g: Goal) => assignedIds.has(g.id);

  // A goal is visible if it, or any ancestor up the parent chain, is
  // directly visible.
  const isVisible = (g: Goal): boolean => {
    let cur: Goal | undefined = g;
    const seen = new Set<string>(); // guard against cyclic parent_id
    while (cur && !seen.has(cur.id)) {
      if (directlyVisible(cur)) return true;
      seen.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };

  return goals.filter(isVisible);
}
