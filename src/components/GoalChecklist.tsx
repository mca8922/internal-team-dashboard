'use client';

// "Your checklist" — the tick-off list each member completes on their own.
// Completion is INDEPENDENT per assignee, so this only ever shows/edits the
// CURRENT user's ticks. Each toggle calls toggle_checklist_item, which records
// the caller's own completion and recomputes the goal's combined progress.
//
// Cadence-aware: an item is only tickable on the days it is due (a "Custom
// days" item shows e.g. Mon · Wed · Fri and is disabled on other days); a
// recurring item becomes to-do again at the start of each new period.
//
// Two kinds of item share the list (migration 0064). The ASSIGNED ones came
// from a Director or Manager and are owed by everyone on the task. The
// SELF-ADDED ones the member wrote for themselves: they show only here, on the
// owner's own list, styled apart so it's never in doubt which work was handed
// over and which was volunteered. A self-added step can be renamed but not
// removed — committing to a piece of work is not something you take back
// yourself; a Founder or Director does that.
import * as React from 'react';
import { Icon } from './Icon';
import { RichText, RichTextEditor } from './RichTextEditor';
import { WorkReportPanel } from './WorkReportPanel';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import {
  toggleChecklistItem,
  addPersonalChecklistItem,
  updatePersonalChecklistItem,
} from '@/lib/actions';
import { itemBelongsTo, itemCounts, completionCounts } from '@/lib/goal-progress';
import { BottomSparkle, CardConfetti } from './ChecklistCelebration';
import { isDueToday, isCompletionCurrent, isCarriedOverDone, currentReport, recurrenceLabel } from '@/lib/recurrence';
import { fmtDateDMY, fmtTime } from '@/lib/dates';
import type {
  GoalChecklistItem,
  GoalChecklistCompletion,
  WorkReport,
} from '@/lib/types';

// The form a member writes their own step in — used both for a new step and for
// editing one they already added. Title plus a rich-text description, the same
// pair the Board's checklist editor produces, so a member's own note can carry
// bold, lists and links rather than being one flat line.
//
// The description starts collapsed: most steps are a title and nothing else, and
// an always-open editor would turn a short list into a wall of toolbars.
function StepEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  saveLabel,
  titlePlaceholder = 'Step title',
  autoFocus = false,
}: {
  value: { label: string; description: string };
  onChange: (v: { label: string; description: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveLabel: string;
  titlePlaceholder?: string;
  autoFocus?: boolean;
}) {
  // Open on mount when there is already a description to show (editing an
  // existing step), otherwise wait to be asked.
  const [descShown, setDescShown] = React.useState(() => !isBlankHtml(value.description));
  return (
    <div className="goal-check-own-editor">
      <div className="goal-check-own-editor-row">
        <input
          className="input"
          autoFocus={autoFocus}
          placeholder={titlePlaceholder}
          value={value.label}
          disabled={saving}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          onKeyDown={(e) => {
            // Enter saves from the title line only — inside the description
            // Enter has to stay a newline.
            if (e.key === 'Enter') onSave();
            if (e.key === 'Escape') onCancel();
          }}
          aria-label="Step title"
        />
      </div>
      {descShown ? (
        <div className="goal-check-own-editor-desc">
          <RichTextEditor
            value={value.description}
            onChange={(html) => onChange({ ...value, description: html })}
            placeholder="Add any detail — what done looks like, links, notes."
            ariaLabel="Step description"
          />
        </div>
      ) : (
        <button
          type="button"
          className="checklist-desc-toggle"
          onClick={() => setDescShown(true)}
          disabled={saving}
        >
          <Icon name="plus" size={11} />
          Add description
        </button>
      )}
      <div className="goal-check-own-editor-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={onSave}
          disabled={saving || !value.label.trim()}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// An empty rich-text value is not always the empty string — the editor emits
// things like "<p><br></p>" for a description someone opened and left blank.
function isBlankHtml(html: string): boolean {
  return !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

export function GoalChecklist({
  items: allItems,
  completionsByItem,
  currentUserId,
  goalId,
  canAddOwn = false,
  reportsByItem = {},
  reportTemplate = '',
  today,
  closed = false,
  openReportSignal = null,
}: {
  items: GoalChecklistItem[];
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  currentUserId: string;
  // The task these items hang off — needed to file a new self-added step.
  goalId: string;
  // May this member write their own steps onto this task? False once the task
  // is closed, or on the read-only previews the Board uses.
  canAddOwn?: boolean;
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
  // External request (e.g. from the "Your day" panel) to open a specific item's
  // report editor. The nonce makes each request re-fire even for the same item.
  openReportSignal?: { itemId: string; n: number } | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [, startTransition] = React.useTransition();
  // Only what THIS member owes: the shared steps plus their own. A teammate's
  // self-added step never appears here, and never lengthens this list's tally.
  const items = React.useMemo(
    () => allItems.filter((it) => itemBelongsTo(it, currentUserId)),
    [allItems, currentUserId],
  );
  // Item ids with an in-flight toggle — their optimistic value must survive a
  // background refresh (realtime fires router.refresh() often, and an older
  // server snapshot would otherwise clobber a tick that hasn't round-tripped).
  const pending = React.useRef<Set<string>>(new Set());

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

  // A step being written. `draft` is the new-step composer (null when closed);
  // `editing` is the same shape pointed at an existing step of the member's own.
  // Both carry a title AND a rich-text description, the same pair the Board's
  // checklist editor writes — a member describing their own work should not be
  // limited to a single unformatted line.
  type StepDraft = { label: string; description: string };
  const EMPTY_DRAFT: StepDraft = { label: '', description: '' };
  const [draft, setDraft] = React.useState<StepDraft | null>(null);
  const [editing, setEditing] = React.useState<(StepDraft & { id: string }) | null>(null);
  const [saving, setSaving] = React.useState(false);

  // File a new step onto MY list. Nothing optimistic here: the row has to come
  // back from the server with its real id before it can be ticked, and a failed
  // insert (an RLS refusal on a task I'm not on) must not leave a ghost behind.
  const submitDraft = async () => {
    if (!draft || saving) return;
    const text = draft.label.trim();
    if (!text) return;
    setSaving(true);
    try {
      const res = await addPersonalChecklistItem(goalId, text, draft.description);
      if (!res.ok) {
        toast(res.error || 'Could not add that step.', 'error');
        return;
      }
      // Stay open and cleared, so several steps can be written in one go.
      setDraft(EMPTY_DRAFT);
      toast('Step added to your list');
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async () => {
    if (!editing || saving) return;
    const text = editing.label.trim();
    if (!text) return;
    setSaving(true);
    try {
      const res = await updatePersonalChecklistItem(editing.id, text, editing.description);
      if (!res.ok) {
        toast(res.error || 'Could not save that step.', 'error');
        return;
      }
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

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

  // A task with no steps at all still shows the composer when the member may
  // write their own — that is exactly when they have something to add.
  if (items.length === 0 && !canAddOwn) return null;

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

  // Past the due date the checklist is FROZEN, not emptied: every step counts
  // and any completion the member ever recorded still reads as done, so this
  // header shows the same final tally the Board's per-member panel and the
  // card's % do. (itemCounts / completionCounts are that shared rule; `mine`
  // is this component's optimistic copy of the member's own completions.)
  const countedItems = items.filter((it) => itemCounts(it, closed));
  const done = countedItems.filter((it) =>
    closed ? completionCounts(it, mine[it.id], true) : isChecked(it),
  ).length;

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

  // A "Report Work" item's report was just submitted: the server (see
  // submit_work_report in actions.ts) already ticked the item in the SAME
  // transaction as the report save, so this only mirrors that locally — no
  // second toggleChecklistItem round-trip. Two separate calls here is exactly
  // what used to let the celebration fire while the actual tick silently
  // failed, requiring a second submit to "take". Then play the party popper
  // over the whole box — once.
  const onReportSubmitted = (it: GoalChecklistItem) => {
    if (isDueToday(it) && !isChecked(it)) {
      setMine((cur) => ({ ...cur, [it.id]: new Date().toISOString() }));
    }
    setCelebrate({ id: it.id, n: Date.now() });
  };

  return (
    <div className={`goal-checklist${closed ? ' goal-checklist-closed' : ''}`}>
      <div className="goal-checklist-head">
        <Icon name={closed ? 'lock' : 'check'} size={13} />
        <span>
          {closed
            ? `Checklist closed · ${done}/${countedItems.length} completed`
            : `Your checklist · ${done}/${countedItems.length} today`}
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
          ? completionCounts(it, mine[it.id], true)
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
        // A step this member wrote for themselves reads differently from one a
        // Director handed them, so it says so — on everyone's screen, not just
        // the author's (the Board's per-member panel styles it the same way).
        const isOwn = !!it.owner_id;
        const rowEl = (
          <label
            className={`goal-check-row${checked ? ' done' : ''}${due ? '' : ' not-due'}${
              isOwn ? ' goal-check-own' : ''
            }`}
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
              <span className="goal-check-title">
                {it.label}
                {isOwn ? <span className="goal-check-own-badge">Self-added</span> : null}
              </span>
              {it.description ? (
                <RichText className="goal-check-desc" value={it.description} />
              ) : null}
              {/* When this step came into existence, on every row — assigned or
                  self-added. created_at has been on the table since 0009, so
                  the steps that predate all of this carry it too. */}
              <span className={`goal-check-added${isOwn ? ' is-own' : ''}`}>
                {/* Label and timestamp are separate spans, not bare text: the
                    container is a wrapping flex row, so loose text nodes would
                    each become their own flex item and the date could break
                    mid-value. */}
                <span>Added{isOwn ? ' by you' : ''}</span>
                <span className="goal-check-added-at">
                  {fmtDateDMY(it.created_at)} · {fmtTime(it.created_at)}
                </span>
                {isOwn && !closed ? (
                  <button
                    type="button"
                    className="goal-check-own-rename"
                    // Inside a <label>: without this, the click would fall
                    // through to the checkbox and tick the item.
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditing({
                        id: it.id,
                        label: it.label,
                        description: it.description || '',
                      });
                    }}
                  >
                    <Icon name="edit" size={10} />
                    Edit
                  </button>
                ) : null}
              </span>
            </span>
            {checked && mine[it.id] ? (
              <span className="goal-check-completed-at" title={mine[it.id]!}>
                <Icon name="check" size={10} />
                {fmtDateDMY(mine[it.id]!)} · {fmtTime(mine[it.id]!)}
              </span>
            ) : null}
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
            {/* Edit in place — title and description both. Only ever reachable
                on a self-added step; an assigned one has no Edit button to open
                it, and there is no delete here for either kind. */}
            {editing?.id === it.id ? (
              <StepEditor
                value={editing}
                onChange={(v) => setEditing({ ...v, id: it.id })}
                onSave={submitEdit}
                onCancel={() => setEditing(null)}
                saving={saving}
                saveLabel="Save"
              />
            ) : null}
          </div>
        );
      })}
      {/* Add your own step. Deliberately no delete anywhere in this component:
          once a member has written down work they owe, only a Founder or
          Director takes it back off the list. */}
      {canAddOwn ? (
        <div className="goal-check-add">
          {draft === null ? (
            <button
              type="button"
              className="goal-check-add-trigger"
              onClick={() => setDraft(EMPTY_DRAFT)}
            >
              <Icon name="plus" size={12} />
              Add your own step
            </button>
          ) : (
            <StepEditor
              value={draft}
              onChange={setDraft}
              onSave={submitDraft}
              onCancel={() => setDraft(null)}
              saving={saving}
              saveLabel="Add step"
              titlePlaceholder="What else are you doing on this task?"
              autoFocus
            />
          )}
          <p className="goal-check-add-note">
            Only you see the steps you add. You can edit one, but removing it is a
            Director&rsquo;s call.
          </p>
        </div>
      ) : null}
    </div>
  );
}
