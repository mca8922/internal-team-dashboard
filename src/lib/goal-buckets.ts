// Goals navigation helpers — used by the Table view's due-date grouping and by
// the breadcrumb / "jump to goal" actions. Kept framework-free and `now`-
// injectable so the buckets and path logic are unit-testable.
//
// Date math mirrors GoalsView's daysToDue/isOverdue (IST-correct via dates.ts),
// so a goal lands in the same bucket the cascade badges already imply.
import { parseDate, daysBetween } from './dates';
import type { Goal } from './types';

export type DueBucket = 'overdue' | 'today' | 'week' | 'month' | 'later' | 'none';

// Display order + labels for the Table view's group headers.
export const BUCKET_META: { key: DueBucket; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
];

// Which timeline bucket a goal falls into. Overdue is by date only (the whole
// due day still counts as "today"); a Completed goal past its date is still
// reported as overdue here — callers that care about status filter separately.
export function dueBucket(goal: Pick<Goal, 'due_date'>, now: Date = new Date()): DueBucket {
  if (!goal.due_date) return 'none';
  const d = daysBetween(now, parseDate(goal.due_date)); // >0 = days until due
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 6) return 'week';
  if (d <= 30) return 'month';
  return 'later';
}

// The chain of ancestor goals (via parent_id), from the top-level ancestor down
// to — but NOT including — `goal`. Used for breadcrumbs. Guards against cycles.
export function goalAncestors(goal: Goal, all: Goal[]): Goal[] {
  const byId = new Map(all.map((g) => [g.id, g]));
  const chain: Goal[] = [];
  const seen = new Set<string>([goal.id]);
  let pid = goal.parent_id;
  while (pid && !seen.has(pid)) {
    const parent = byId.get(pid);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parent.id);
    pid = parent.parent_id;
  }
  return chain;
}

// Full path top-level ancestor → goal (inclusive). The first element is the
// goal's yearly root (what the cascade selects); the rest are nodes to expand.
export function goalPath(goal: Goal, all: Goal[]): Goal[] {
  return [...goalAncestors(goal, all), goal];
}
