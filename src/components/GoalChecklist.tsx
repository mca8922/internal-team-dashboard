'use client';

// "Your checklist" — the tick-off list each member completes on their own.
// Completion is INDEPENDENT per assignee, so this only ever shows/edits the
// CURRENT user's ticks. Each toggle calls toggle_checklist_item, which records
// the caller's own completion and recomputes the goal's combined progress.
//
// Cadence-aware: an item is only tickable on the days it is due (a "Custom
// days" item shows e.g. Mon · Wed · Fri and is disabled on other days); a
// recurring item becomes to-do again at the start of each new period.
import * as React from 'react';
import { Icon } from './Icon';
import { RichText } from './RichTextEditor';
import { WorkReportPanel } from './WorkReportPanel';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { toggleChecklistItem } from '@/lib/actions';
import { BottomSparkle, CardConfetti } from './ChecklistCelebration';
import { isDueToday, isCompletionCurrent, isCarriedOverDone, currentReport, recurrenceLabel, isLockableRecurrence } from '@/lib/recurrence';
import { ClickableLockBox, StaticLockBox } from './TaskLockBox';
import type {
  GoalChecklistItem,
  GoalChecklistCompletion,
  WorkReport,
} from '@/lib/types';

export function GoalChecklist({
  items,
  completionsByItem,
  currentUserId,
  reportsByItem = {},
  reportTemplate = '',
  today,
  closed = false,
  unlockedItemIds = new Set<string>(),
  openReportSignal = null,
}: {
  items: GoalChecklistItem[];
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  currentUserId: string;
  // itemId -> [work report, ...]. For a "Report Work" item, ticking is locked
  // until the current user has a report for today.
  reportsByItem?: Record<string, WorkReport[]>;
  // The goal department's reporting template (HTML) — prefilled when reporting.
  reportTemplate?: string;
  // The member's local calendar day (YYYY-MM-DD) reports are filed under.
  today: string;
  // Goal is past its due date: the list is frozen — read-only, nothing due,
  // no new period starts. Shows each item's last completion as a record.
  closed?: boolean;
  // item ids the current member has already tapped open (from DB + optimistic).
  unlockedItemIds?: Set<string>;
  // External request (e.g. from the "Your day" panel) to open a specific item's
  // report editor. The nonce makes each request re-fire even for the same item.
  openReportSignal?: { itemId: string; n: number } | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [, startTransition] = React.useTransition();
  // Item ids with an in-flight toggle — their optimistic value must survive a
  // background refresh (realtime fires router.refresh() often, and an older
  // server snapshot would otherwise clobber a tick that hasn't round-tripped).
  const pending = React.useRef<Set<string>>(new Set());

  // Optimistic unlock set: starts from the server-fetched prop and grows as
  // the member taps lock boxes open (before the server round-trip completes).
  const [localUnlocked, setLocalUnlocked] = React.useState<Set<string>>(
    () => new Set(unlockedItemIds),
  );
  // Keep in sync when the server prop updates (e.g. realtime refresh).
  React.useEffect(() => {
    setLocalUnlocked((cur) => {
      const next = new Set(unlockedItemIds);
      for (const id of cur) next.add(id); // keep optimistic additions
      return next;
    });
  }, [unlockedItemIds]);

  // Local mirror of MY completion timestamp per item, so a tick feels instant.
  const initial = React.useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const it of items) {
      const mine = (completionsByItem[it.id] || []).find((c) => c.user_id === currentUserId);
      m[it.id] = mine ? mine.done_at : null;
    }
    return m;
  }, [items, completionsByItem, currentUserId]);
  const [mine, setMine] = React.useState(initial);
  // Re-sync from the server, but keep optimistic values for in-flight items.
  React.useEffect(() => {
    setMine((cur) => {
      const next = { ...initial };
      for (const id of pending.current) next[id] = cur[id];
      return next;
    });
  }, [initial]);

  // The item currently playing its completion celebration (in-card sweep +
  // confetti). `n` is a nonce so re-ticking the same item replays the effect.
  const [celebrate, setCelebrate] = React.useState<{ id: string; n: number } | null>(null);
  React.useEffect(() => {
    if (!celebrate) return;
    // Report Work items get the big 3-second box popper; a normal row tick gets
    // the shorter sweep + confetti.
    const it = items.find((i) => i.id === celebrate.id);
    const ms = it?.report_required ? 3400 : 2300;
    const t = setTimeout(() => setCelebrate(null), ms);
    return () => clearTimeout(t);
  }, [celebrate, items]);

  // Per-item "open the report editor" nonces — bumped when a blocked tick asks
  // the member to report first.
  const [reportSignals, setReportSignals] = React.useState<Record<string, number>>({});
  const askToReport = (itemId: string) =>
    setReportSignals((s) => ({ ...s, [itemId]: (s[itemId] ?? 0) + 1 }));

  // An external request (from the "Your day" panel) to open a specific item's
  // report editor. The nonce ref makes this fire exactly once per request, so a
  // background refresh that re-creates `items` can't re-open the editor.
  const lastReportSig = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!openReportSignal || lastReportSig.current === openReportSignal.n) return;
    if (!items.some((it) => it.id === openReportSignal.itemId)) return;
    lastReportSig.current = openReportSignal.n;
    setReportSignals((s) => ({
      ...s,
      [openReportSignal.itemId]: (s[openReportSignal.itemId] ?? 0) + 1,
    }));
  }, [openReportSignal, items]);

  if (items.length === 0) return null;

  // The current user's CURRENT report for an item — period/carry-over aware, so
  // a submitted report stays visible to the member for as long as the item reads
  // "Done" (the SAME window the Board/managers see via currentReport), not just
  // the calendar day it was filed. Gates that item's tick and feeds the "already
  // reported" editor state.
  const myCurrentReport = (item: GoalChecklistItem): WorkReport | null =>
    currentReport(
      (reportsByItem[item.id] ?? []).filter((r) => r.user_id === currentUserId),
      item,
    );

  const isChecked = (it: GoalChecklistItem) =>
    isDueToday(it) && isCompletionCurrent(it.recurrence, mine[it.id]);

  const dueItems = closed ? [] : items.filter((it) => isDueToday(it));
  const done = dueItems.filter(isChecked).length;

  // Apply the tick/untick: optimistic update + the server round-trip.
  const commit = (it: GoalChecklistItem, next: boolean) => {
    // Celebrate when completing (not un-ticking). For "Report Work" items the
    // celebration is owned by the report submit (see onReportSubmitted) so it
    // covers the whole box and plays exactly once — don't double-fire here.
    if (next && !it.report_required) setCelebrate({ id: it.id, n: Date.now() });
    pending.current.add(it.id);
    setMine((cur) => ({ ...cur, [it.id]: next ? new Date().toISOString() : null }));
    startTransition(async () => {
      try {
        await toggleChecklistItem(it.id, next);
      } catch (e) {
        setMine((cur) => ({ ...cur, [it.id]: initial[it.id] })); // revert just this item
        toast((e as Error).message || 'Could not update the checklist.', 'error');
      } finally {
        pending.current.delete(it.id);
      }
    });
  };

  // Is THIS item's tick locked behind a missing report for the current period?
  const isReportLocked = (it: GoalChecklistItem) =>
    it.report_required && !myCurrentReport(it);

  const toggle = (it: GoalChecklistItem) => {
    if (closed || !isDueToday(it)) return;
    const next = !isChecked(it);
    // Report-work gate: completing requires today's report first. (Un-ticking
    // stays allowed so a misclick can always be undone.)
    if (next && isReportLocked(it)) {
      toast('Report your work first, then tick this task complete.', 'error');
      askToReport(it.id);
      return;
    }
    // Unticking undoes finished work — guard against a misclick first.
    if (!next) {
      confirm({
        title: 'Unmark this task?',
        message: `“${it.label}” will go back to to-do for today. You can tick it again anytime.`,
        confirmLabel: 'Unmark',
        icon: 'refresh',
      }).then((ok) => {
        if (ok) commit(it, false);
      });
      return;
    }
    commit(it, true);
  };

  // A "Report Work" item's report was just submitted: tick the item (if due and
  // not already done) and play the party popper over the whole box — once.
  const onReportSubmitted = (it: GoalChecklistItem) => {
    if (isDueToday(it) && !isChecked(it)) commit(it, true);
    setCelebrate({ id: it.id, n: Date.now() });
  };

  return (
    <div className={`goal-checklist${closed ? ' goal-checklist-closed' : ''}`}>
      <div className="goal-checklist-head">
        <Icon name={closed ? 'lock' : 'check'} size={13} />
        <span>
          {closed
            ? 'Checklist closed. The due date has passed.'
            : `Your checklist · ${done}/${dueItems.length} today`}
        </span>
      </div>
      {items.map((it) => {
        // Past the due date nothing is due; show each item's last completion as
        // a read-only record (ticked if the member ever completed it).
        const due = closed ? false : isDueToday(it);
        // On a due day: normal tick. On an off day: keep the checkmark if it was
        // done on its most recent due day (display only — today's tally above is
        // unaffected).
        const checked = closed
          ? !!mine[it.id]
          : due
            ? isChecked(it)
            : isCarriedOverDone(it, mine[it.id]);
        const partying = celebrate?.id === it.id;
        const reportLocked = due && isReportLocked(it);
        const myReport = it.report_required ? myCurrentReport(it) : null;
        // A "Report Work" item due today is one complete box: row + report editor.
        const hasReportBox = it.report_required && due;
        // The tick row (the assigned task). Extracted so a Report Work item can
        // wrap it with a "Task" spine while a plain item renders it bare.
        const rowEl = (
          <label
            className={`goal-check-row${checked ? ' done' : ''}${due ? '' : ' not-due'}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!due}
              onChange={() => toggle(it)}
            />
            <span className="goal-check-box" aria-hidden>
              {checked ? <Icon name="check" size={12} /> : null}
            </span>
            <span className="goal-check-label">
              <span className="goal-check-title">{it.label}</span>
              {it.description ? (
                isLockableRecurrence(it.recurrence) && !localUnlocked.has(it.id) ? (
                  // Description is always rendered underneath; the lock is an
                  // absolute overlay that flies away when the member taps it.
                  // Due today → tap to reveal; off day → read-only "available on"
                  // lock so the description never leaks before its day.
                  <span className="task-lock-wrap">
                    <RichText className="goal-check-desc" value={it.description} />
                    {due ? (
                      <ClickableLockBox
                        item={it}
                        onUnlocked={() =>
                          setLocalUnlocked((s) => new Set([...s, it.id]))
                        }
                      />
                    ) : (
                      <StaticLockBox item={it} />
                    )}
                  </span>
                ) : (
                  <RichText className="goal-check-desc" value={it.description} />
                )
              ) : null}
            </span>
            {reportLocked ? (
              <span className="goal-check-recur" title="Report your work to unlock">
                <Icon name="lock" size={11} />
                Report to tick
              </span>
            ) : it.recurrence !== 'once' ? (
              <span className="goal-check-recur" title={due ? 'Due today' : 'Not due today'}>
                <Icon name="clock" size={11} />
                {recurrenceLabel(it)}
              </span>
            ) : null}
            {/* Normal items celebrate on the row itself. Report Work items
                celebrate over the whole box on submit (rendered below). */}
            {partying && !it.report_required ? <CardConfetti key={celebrate!.n} /> : null}
            {partying && !it.report_required ? <BottomSparkle key={`s-${celebrate!.n}`} /> : null}
          </label>
        );
        return (
          <div
            key={it.id}
            className={`goal-check-item-wrap${hasReportBox ? ' has-report' : ''}${
              hasReportBox && checked ? ' done' : ''
            }`}
          >
            {hasReportBox ? (
              <>
                {/* Spine labels in the left gutter separate what was GIVEN (the
                    assigned task) from what was GOT (the submitted report). */}
                <div className="cl-section cl-section-task">
                  <span className="cl-spine cl-spine-task">
                    <Icon name="list" size={13} />
                    <span className="cl-spine-text">Task</span>
                  </span>
                  {rowEl}
                </div>
                <div className="cl-section cl-section-report">
                  <span className="cl-spine cl-spine-report">
                    <Icon name="edit" size={13} />
                    <span className="cl-spine-text">Report</span>
                  </span>
                  <WorkReportPanel
                    itemId={it.id}
                    templateBody={reportTemplate}
                    existingBody={myReport ? myReport.body : null}
                    reportDate={today}
                    openSignal={reportSignals[it.id] ?? 0}
                    onSubmitted={() => onReportSubmitted(it)}
                  />
                </div>
              </>
            ) : (
              rowEl
            )}
            {/* Party popper over the whole box — fires once, on report submit.
                Bigger + ~3 seconds for the full celebration. */}
            {partying && it.report_required ? (
              <CardConfetti key={celebrate!.n} count={70} lifespanMs={2900} />
            ) : null}
            {partying && it.report_required ? (
              <BottomSparkle key={`s-${celebrate!.n}`} durationMs={2900} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
