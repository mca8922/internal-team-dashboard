'use client';

// "Your day" — a focused, cross-goal list of everything the current user owes
// TODAY (due checklist items they haven't ticked yet), pulled from goals they're
// assigned to. Gives members (and any assigned board member) a single place to
// see and clear today's work instead of hunting through the cascade.
import * as React from 'react';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { BottomSparkle, CardConfetti } from './ChecklistCelebration';
import { toggleChecklistItem } from '@/lib/actions';
import { isDueToday, isCompletionCurrent, recurrenceLabel } from '@/lib/recurrence';
import { itemBelongsTo, deriveGoalStatus } from '@/lib/goal-progress';
import { fmtDate } from '@/lib/dates';
import type { Goal, GoalChecklistItem, GoalChecklistCompletion } from '@/lib/types';

export function MyTodayPanel({
  goals,
  checklistsByGoal,
  completionsByItem,
  assigneeIdsByGoal,
  currentUserId,
  reportLockedItemIds,
  onReportTask,
}: {
  goals: Goal[];
  checklistsByGoal: Record<string, GoalChecklistItem[]>;
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  assigneeIdsByGoal: Record<string, string[]>;
  currentUserId: string;
  // Checklist item ids that require a work report today before they can be
  // ticked. Ticking one here jumps the member to the goal card and opens that
  // item's report editor (see onReportTask).
  reportLockedItemIds?: Set<string>;
  // Jump to the goal card + open the report editor for a report-locked task.
  onReportTask?: (goalId: string, itemId: string) => void;
}) {
  const toast = useToast();
  const [, startTransition] = React.useTransition();
  // Items ticked optimistically this session (removed from the list at once).
  const [doneIds, setDoneIds] = React.useState<Set<string>>(new Set());
  // Nonce that replays the whole-card party-popper each time a task is ticked.
  const [celebrate, setCelebrate] = React.useState(0);
  React.useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(0), 2300); // matches the sweep + confetti
    return () => clearTimeout(t);
  }, [celebrate]);

  const myCompletion = React.useCallback(
    (itemId: string) =>
      (completionsByItem[itemId] ?? []).find((c) => c.user_id === currentUserId)?.done_at ?? null,
    [completionsByItem, currentUserId],
  );

  // Due-today, not-yet-done items on goals I'm responsible for.
  const items = React.useMemo(() => {
    const today = fmtDate(new Date());
    const out: { goalId: string; goalTitle: string; item: GoalChecklistItem }[] = [];
    for (const g of goals) {
      // Paused by the Board (Not-Active) — the task is on hold, so nothing it
      // owes belongs in today's list. deriveGoalStatus is the same one rule the
      // badges and filters read.
      if (deriveGoalStatus(g) === 'inactive') continue;
      // Past its due date the goal is closed — its checklist no longer recurs,
      // so nothing from it belongs in today's list. (ISO date string compare.)
      if (g.due_date && g.due_date < today) continue;
      const aids = assigneeIdsByGoal[g.id] ?? [];
      const mine = aids.includes(currentUserId) || aids.length === 0;
      if (!mine) continue;
      for (const it of checklistsByGoal[g.id] ?? []) {
        // A teammate's personal item (migration 0064) is on their list, not
        // mine — my own ones belong here exactly like an assigned step does.
        if (!itemBelongsTo(it, currentUserId)) continue;
        if (!isDueToday(it)) continue;
        if (isCompletionCurrent(it.recurrence, myCompletion(it.id))) continue;
        out.push({ goalId: g.id, goalTitle: g.title, item: it });
      }
    }
    return out;
  }, [goals, checklistsByGoal, assigneeIdsByGoal, currentUserId, myCompletion]);

  if (items.length === 0) return null;

  const visible = items.filter((x) => !doneIds.has(x.item.id));

  const tick = (goalId: string, itemId: string) => {
    // Report Work items: completing requires today's report. Jump the member to
    // the goal card and open that task's report editor so they can report right
    // away — instead of erroring on the server round-trip.
    if (reportLockedItemIds?.has(itemId)) {
      if (onReportTask) {
        onReportTask(goalId, itemId);
      } else {
        toast('Report your work on this task first, then tick it complete.', 'error');
      }
      return;
    }
    setDoneIds((s) => new Set(s).add(itemId));
    setCelebrate(Date.now()); // party-popper across the whole card
    startTransition(async () => {
      try {
        await toggleChecklistItem(itemId, true);
      } catch (e) {
        setDoneIds((s) => {
          const n = new Set(s);
          n.delete(itemId);
          return n;
        });
        toast((e as Error).message || 'Could not update the task.', 'error');
      }
    });
  };

  return (
    <div className="card my-today">
      <div className="my-today-head">
        <Icon name="check" size={15} />
        <span>Your day</span>
        <span className="my-today-count">
          {visible.length} {visible.length === 1 ? 'task' : 'tasks'} left
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="my-today-clear">All done for today. Nice work. 🎉</div>
      ) : (
        <div className="my-today-list">
          {visible.map((x) => (
            <label className="my-today-row" key={x.item.id}>
              <input type="checkbox" checked={false} onChange={() => tick(x.goalId, x.item.id)} />
              <span className="my-today-box" aria-hidden />
              <span className="my-today-label">
                <span className="my-today-task">{x.item.label}</span>
                <span className="my-today-goal">
                  {x.goalTitle}
                  {x.item.recurrence !== 'once' ? ` · ${recurrenceLabel(x.item)}` : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {celebrate ? <CardConfetti key={celebrate} /> : null}
      {celebrate ? <BottomSparkle key={`s-${celebrate}`} /> : null}
    </div>
  );
}
