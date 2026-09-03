// Single source of truth for a goal's *combined* checklist progress on the
// client. This deliberately mirrors the database trigger
// `recompute_goal_progress()` (supabase/migrations/0068) so the live card bar
// and the stored `goals.progress` agree — with ONE intentional difference:
//
//   • The DB value (`goals.progress`, shown on the pinboard, dashboard and
//     analytics) is event-driven and NOT leave-aware.
//   • This client computation (the detailed GoalCard bar + per-person rows) can
//     additionally exclude members on approved leave today, so their untouched
//     items neither count as pending nor drag the %.
//
// TWO tallies come out of the same core, and every surface must use the one
// that matches what it is showing:
//
//   • COMPLETION (`completionPct`, the card's headline % and the DB's
//     `goals.progress`) counts EVERY checklist item and any completion the
//     owed member has ever recorded. It is what "is this task done?" means, so
//     it is also what the derived status reads (see deriveGoalStatus in
//     goal-ui.ts). It never resets when a recurring item rolls into a new
//     period, and it never empties when the due date passes.
//   • TODAY (`perPerson` / `dueCount` while the goal is open) counts only the
//     items due today and only completions inside the item's current period —
//     the day's work, which is what the per-person rows are about.
//
// PAST DUE the checklist is FROZEN, not emptied: `closed` switches the today
// tally over to the completion one, so the member header, the Board's
// per-member panel and the card all report the same final record of what was
// actually completed instead of 0/0.
//
// The formula: progress = round(doneUnits * 100 / totalUnits), where totalUnits
// sums, over the active assignees, the items each one actually owes:
//
//   totalUnits = (counted shared items) × (active assignees)
//              + (counted personal items whose owner is an active assignee)
//
// A PERSONAL item (owner_id set — migration 0064) is one a member added to
// their own list. It belongs to that member alone, so it lengthens their row
// and moves the combined %, and leaves every teammate's denominator untouched.
// An item with owner_id null is shared and owed by everyone, which is what
// every item written before 0064 is.
//
// `now` is injectable so this is fully unit-testable (see goal-progress.test.ts).
import { isDueToday, isCompletionCurrent } from './recurrence';
import { parseDate, daysBetween } from './dates';
import type { Goal, GoalStatus, GoalChecklistItem, GoalChecklistCompletion } from './types';

export interface PersonProgress {
  id: string;
  done: number;
  total: number;
  onLeave: boolean;
}

export interface GoalProgress {
  // Headline %: the completion tally, or the manual slider on a task with no
  // checklist.
  pct: number;
  // The completion tally on its own — null when the task has no checklist to
  // measure, which is the signal that its status stays manual.
  completionPct: number | null;
  // How many items the current tally covers: due today while the goal is open,
  // the whole checklist once it is frozen.
  dueCount: number;
  perPerson: PersonProgress[];
  // Is this the frozen (past-due) tally rather than today's?
  frozen: boolean;
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
  // Goal is past its due date: the checklist is frozen, so nothing new is due
  // and every surface reports the final record of what was completed. See
  // isPastDue in goal-ui.ts.
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

// ── The two rules every checklist surface shares ───────────────────────────
// Keeping these here (rather than re-deriving `isDueToday` / `isCompletionCurrent`
// per panel) is what stops a header saying 0/0 while the rows beneath it read
// "Done": the header and the rows ask the same two questions.

// Is this item part of the tally? Frozen (past due, or the completion tally):
// the whole checklist counts. Live: only what is due today.
export function itemCounts(
  item: Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>,
  frozen: boolean,
  now: Date = new Date(),
): boolean {
  return frozen || isDueToday(item, now);
}

// Does this completion count towards the tally? Frozen: any completion ever
// recorded is the final record. Live: only one stamped inside the item's
// current period (a one-time item stays done forever; a daily item resets).
export function completionCounts(
  item: Pick<GoalChecklistItem, 'recurrence'>,
  doneAt: string | null | undefined,
  frozen: boolean,
  now: Date = new Date(),
): boolean {
  if (!doneAt) return false;
  return frozen || isCompletionCurrent(item.recurrence, doneAt, now);
}

interface Tally {
  // null when there is nothing to measure (no counted units at all).
  pct: number | null;
  counted: number;
  perPerson: PersonProgress[];
}

function runTally(
  { items, completionsByItem, assigneeIds, perPersonIds, onLeave }: GoalProgressInput,
  frozen: boolean,
  now: Date,
): Tally {
  const counted = items.filter((it) => itemCounts(it, frozen, now));

  // itemId -> set of users whose completion counts.
  const done = new Map<string, Set<string>>();
  for (const it of counted) {
    done.set(
      it.id,
      new Set(
        (completionsByItem[it.id] ?? [])
          .filter((c) => completionCounts(it, c.done_at, frozen, now))
          .map((c) => c.user_id),
      ),
    );
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
      for (const it of counted) {
        if (!itemBelongsTo(it, uid)) continue;
        totalUnits++;
        if (done.get(it.id)!.has(uid)) doneUnits++;
      }
    }
  } else {
    // No explicit assignees (a department goal): the item counts once, done if
    // ANY teammate completed it — deduplicated per item, so two people ticking
    // the same step is still one unit of work. Personal items have no assignee
    // to attribute them to here, so — exactly as recompute_goal_progress does —
    // they sit this calculation out.
    const shared = counted.filter((it) => !it.owner_id);
    totalUnits = shared.length;
    for (const it of shared) if ((done.get(it.id)?.size ?? 0) > 0) doneUnits++;
  }

  const ids = perPersonIds ?? assigneeIds;
  const perPerson: PersonProgress[] = ids.map((id) => {
    // Someone's row counts only the items on THEIR list — a teammate's personal
    // item is neither owed nor shown as outstanding here.
    const owed = counted.filter((it) => itemBelongsTo(it, id));
    return {
      id,
      onLeave: !!onLeave?.has(id),
      done: owed.filter((it) => done.get(it.id)?.has(id)).length,
      total: owed.length,
    };
  });

  return {
    pct: totalUnits > 0 ? Math.round((doneUnits * 100) / totalUnits) : null,
    counted: counted.length,
    perPerson,
  };
}

export function computeGoalProgress(input: GoalProgressInput): GoalProgress {
  const { items, manualProgress = 0, closed = false, now = new Date() } = input;
  if (items.length === 0) {
    return {
      pct: clampPct(manualProgress || 0),
      completionPct: null,
      dueCount: 0,
      perPerson: [],
      frozen: closed,
    };
  }

  // What the task is worth overall — the whole checklist, every completion
  // ever recorded. Drives the headline % and the derived status.
  const completion = runTally(input, true, now);
  // What is owed right now. Past the due date that IS the completion tally:
  // the checklist is frozen, not emptied.
  const live = closed ? completion : runTally(input, false, now);

  return {
    pct: completion.pct === null ? clampPct(manualProgress || 0) : clampPct(completion.pct),
    completionPct: completion.pct,
    dueCount: live.counted,
    perPerson: live.perPerson,
    frozen: closed,
  };
}

// ── The one status derivation ──────────────────────────────────────────────
// Re-exported from goals/goal-ui.ts, which is where the rest of the Goals
// display helpers live; it sits HERE because it reads the completion tally
// above and belongs to the same rule.

// Past its due date (whatever the status). The whole due day still counts as
// open; from the next day on the goal's checklist is "closed" (frozen).
export const isGoalPastDue = (g: Pick<Goal, 'due_date'>): boolean => {
  if (!g.due_date) return false;
  return daysBetween(new Date(), parseDate(g.due_date)) < 0;
};

// A task's status is a FACT about its checklist, not a dropdown someone
// remembered to update:
//
//   Not-Active — paused by the Board. The only manual state left, so it wins.
//   Completed  — every unit of the checklist is done (completion = 100%).
//   Not met    — past the due date and still short of 100%.
//   Active     — open and not yet complete.
//
// A task with NO checklist has nothing to measure, so it keeps the status the
// Board set by hand alongside the manual progress slider — that is the
// pre-existing behaviour and it is deliberately preserved.
//
// `completionPct` defaults to the stored `goals.progress`, which
// recompute_goal_progress keeps as exactly this tally (migration 0068).
// Surfaces holding live checklist data (GoalCard) pass computeGoalProgress()'s
// `completionPct` instead, so a tick re-badges the card immediately.
export function deriveGoalStatus(g: Goal, completionPct?: number | null): GoalStatus {
  if (g.status === 'inactive') return 'inactive';
  const pct =
    completionPct === undefined ? ((g.checklist_units ?? 0) > 0 ? g.progress : null) : completionPct;
  if (pct === null) return g.status; // no checklist → the Board's own call stands
  if (pct >= 100) return 'achieved';
  if (isGoalPastDue(g)) return 'not_met';
  return 'active';
}
