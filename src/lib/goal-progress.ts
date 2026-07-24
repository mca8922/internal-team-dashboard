// Single source of truth for a goal's *combined* checklist progress on the
// client. This deliberately mirrors the database trigger
// `recompute_goal_progress()` (supabase/migrations/0013) so the live card bar
// and the stored `goals.progress` agree — with ONE intentional difference:
//
//   • The DB value (`goals.progress`, shown on the pinboard, dashboard and
//     analytics) is event-driven and NOT leave-aware.
//   • This client computation (the detailed GoalCard bar + per-person rows) can
//     additionally exclude members on approved leave today, so their untouched
//     items neither count as pending nor drag the %.
//
// The formula (matching the DB): progress = round(doneUnits * 100 / totalUnits)
// where totalUnits = (items due today) × (active assignees) and a completion
// only counts while it sits in the item's current period (a one-time item stays
// done forever; a daily item resets each day; weekly each week; etc.).
//
// `now` is injectable so this is fully unit-testable (see goal-progress.test.ts).
import { isDueToday, isCompletionCurrent } from './recurrence';
import type { GoalChecklistItem, GoalChecklistCompletion } from './types';

export interface PersonProgress {
  id: string;
  done: number;
  total: number;
  onLeave: boolean;
}

export interface GoalProgress {
  pct: number;
  dueCount: number;
  perPerson: PersonProgress[];
}

export interface GoalProgressInput {
  items: GoalChecklistItem[];
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  // Drives the combined % (mirrors the DB's goal_assignees set).
  assigneeIds: string[];
  // IDs to break down individually; defaults to assigneeIds. (GoalCard passes
  // the resolved assignee-chip ids so each row can show a name + avatar.)
  perPersonIds?: string[];
  // Members on approved leave today — excluded from the combined % and flagged.
  onLeave?: ReadonlySet<string>;
  // Used only when the goal has no checklist (the manual progress slider).
  manualProgress?: number;
  // Goal is past its due date: recurring items stop restarting, nothing is
  // "due today", and progress freezes at its last value (the stored snapshot
  // passed via manualProgress). See isPastDue in GoalsView.
  closed?: boolean;
  now?: Date;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

export function computeGoalProgress({
  items,
  completionsByItem,
  assigneeIds,
  perPersonIds,
  onLeave,
  manualProgress = 0,
  closed = false,
  now = new Date(),
}: GoalProgressInput): GoalProgress {
  // Past the due date the checklist is frozen: no new period starts, nothing is
  // due, and the bar holds the goal's final stored progress instead of resetting
  // to 0 (which a recompute against the now-empty current period would give).
  if (closed) {
    const ids = perPersonIds ?? assigneeIds;
    return {
      pct: clampPct(manualProgress || 0),
      dueCount: 0,
      perPerson: ids.map((id) => ({ id, onLeave: !!onLeave?.has(id), done: 0, total: 0 })),
    };
  }
  if (items.length === 0) {
    return { pct: clampPct(manualProgress || 0), dueCount: 0, perPerson: [] };
  }

  const dueItems = items.filter((it) => isDueToday(it, now));

  // itemId -> set of users with a CURRENT (period-aware) completion.
  const done = new Map<string, Set<string>>();
  for (const it of items) {
    const set = new Set(
      (completionsByItem[it.id] ?? [])
        .filter((c) => isCompletionCurrent(it.recurrence, c.done_at, now))
        .map((c) => c.user_id),
    );
    done.set(it.id, set);
  }

  // Members on leave today don't owe work — drop them from the denominator.
  const activeAssigneeIds = onLeave
    ? assigneeIds.filter((id) => !onLeave.has(id))
    : assigneeIds;

  let doneUnits = 0;
  let totalUnits = 0;
  if (activeAssigneeIds.length > 0) {
    totalUnits = dueItems.length * activeAssigneeIds.length;
    for (const it of dueItems) {
      const set = done.get(it.id)!;
      for (const uid of activeAssigneeIds) if (set.has(uid)) doneUnits++;
    }
  } else {
    // No explicit assignees (a department goal): one shared completion per item.
    totalUnits = dueItems.length;
    for (const it of dueItems) if ((done.get(it.id)?.size ?? 0) > 0) doneUnits++;
  }
  const pct = totalUnits > 0 ? Math.round((doneUnits * 100) / totalUnits) : 0;

  const ids = perPersonIds ?? assigneeIds;
  const perPerson: PersonProgress[] = ids.map((id) => ({
    id,
    onLeave: !!onLeave?.has(id),
    done: dueItems.filter((it) => done.get(it.id)?.has(id)).length,
    total: dueItems.length,
  }));

  return { pct, dueCount: dueItems.length, perPerson };
}
