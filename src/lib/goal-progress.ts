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
// The formula (matching the DB): progress = round(doneUnits * 100 / totalUnits),
// where a completion only counts while it sits in the item's current period (a
// one-time item stays done forever; a daily item resets each day; weekly each
// week; etc.) and totalUnits sums, over the active assignees, the items each
// one actually owes:
//
//   totalUnits = (shared items due today) × (active assignees)
//              + (personal items due today whose owner is an active assignee)
//
// A PERSONAL item (owner_id set — migration 0064) is one a member added to
// their own list. It belongs to that member alone, so it lengthens their row
// and moves the combined %, and leaves every teammate's denominator untouched.
// An item with owner_id null is shared and owed by everyone, which is what
// every item written before 0064 is.
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

// Does `userId` owe this item? Shared items are owed by everyone on the task;
// a personal item only by the member who added it. Exported because the
// checklist UI has to filter the same way it counts — one rule, one place.
export function itemBelongsTo(
  item: { owner_id?: string | null },
  userId: string,
): boolean {
  return !item.owner_id || item.owner_id === userId;
}

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
    // Each assignee owes the shared items plus their OWN personal ones, so the
    // denominator is summed per person rather than multiplied across everyone.
    for (const uid of activeAssigneeIds) {
      for (const it of dueItems) {
        if (!itemBelongsTo(it, uid)) continue;
        totalUnits++;
        if (done.get(it.id)!.has(uid)) doneUnits++;
      }
    }
  } else {
    // No explicit assignees (a department goal): one shared completion per item.
    // Personal items have no assignee to attribute them to here, so — exactly as
    // recompute_goal_progress does — they sit this calculation out.
    const shared = dueItems.filter((it) => !it.owner_id);
    totalUnits = shared.length;
    for (const it of shared) if ((done.get(it.id)?.size ?? 0) > 0) doneUnits++;
  }
  const pct = totalUnits > 0 ? Math.round((doneUnits * 100) / totalUnits) : 0;

  const ids = perPersonIds ?? assigneeIds;
  const perPerson: PersonProgress[] = ids.map((id) => {
    // Someone's row counts only the items on THEIR list — a teammate's personal
    // item is neither owed nor shown as outstanding here.
    const owed = dueItems.filter((it) => itemBelongsTo(it, id));
    return {
      id,
      onLeave: !!onLeave?.has(id),
      done: owed.filter((it) => done.get(it.id)?.has(id)).length,
      total: owed.length,
    };
  });

  return { pct, dueCount: dueItems.length, perPerson };
}
