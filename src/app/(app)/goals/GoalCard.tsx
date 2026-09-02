'use client';

// The Goals cascade card cluster, extracted verbatim from GoalsView to shrink
// that file: one GoalCard rendered at every tier, its recursive GoalNode
// wrapper, the Board's per-member checklist panel, the member's own report
// history, plus the small search-highlight helpers. No behaviour change.
import * as React from 'react';
import { Avatar, Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { GoalChecklist } from '@/components/GoalChecklist';
import {
  ReportReviewSection,
  WorkReportReviews,
  type ReviewerInfo,
} from '@/components/WorkReportReview';
import { CardConfetti } from '@/components/ChecklistCelebration';
import { RichText } from '@/components/RichTextEditor';
import {
  isDueToday,
  isCompletionCurrent,
  isCarriedOverDone,
  currentReport,
} from '@/lib/recurrence';
import { computeGoalProgress, itemBelongsTo } from '@/lib/goal-progress';
import { fmtDate, fmtShort, fmtDateDMY, fmtTime } from '@/lib/dates';
import {
  STATUS,
  LEVEL_META,
  LEVEL_WORD,
  plainText,
  isOverdue,
  isPastDue,
  dueUrgency,
  dueLine,
  goalDepts,
} from './goal-ui';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { canManageCard, type AssigneeChip, type PP, type CardCtx } from './card-context';
import type {
  Goal,
  GoalStatus,
  GoalChecklistItem,
  GoalChecklistCompletion,
  WorkReport,
  WorkReportReview,
} from '@/lib/types';

// Per-card quick actions (Board only): change status or reassign members
// without opening the full edit modal.
function GoalCardMenu({ goal, ctx }: { goal: Goal; ctx: CardCtx }) {
  const [open, setOpen] = React.useState(false);
  const currentIds = ctx.assigneeIdsByGoal[goal.id] ?? [];
  const [sel, setSel] = React.useState<string[]>(currentIds);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  // Members of any of this goal's departments are the reassignment pool.
  const goalDepartments = goalDepts(goal);
  const deptMembers = ctx.members.filter((m) => goalDepartments.includes(m.department));

  React.useEffect(() => {
    if (!open) return;
    setSel(ctx.assigneeIdsByGoal[goal.id] ?? []); // sync to latest on open
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const statuses: GoalStatus[] = ['active', 'inactive', 'achieved', 'not_met'];
  const dirty =
    sel.length !== currentIds.length || sel.some((id) => !currentIds.includes(id));

  return (
    <div className="gb-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Quick actions"
        title="Quick actions: status & reassign"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more-vertical" size={15} />
      </button>
      {open ? (
        <div className="gb-menu" role="menu">
          <div className="gb-menu-label">Set status</div>
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              className="gb-menu-item"
              onClick={() => {
                if (s !== goal.status) ctx.onSetStatus(goal, s);
                setOpen(false);
              }}
            >
              <span className={`badge ${STATUS[s].cls}`}>{STATUS[s].label}</span>
              {goal.status === s ? (
                <Icon name="check" size={13} style={{ marginLeft: 'auto', color: 'var(--color-green-primary)' }} />
              ) : null}
            </button>
          ))}
          {deptMembers.length > 0 ? (
            <>
              <div className="gb-menu-label">Assign · {goalDepartments.join(' · ')}</div>
              <div className="gb-menu-people">
                {deptMembers.map((m) => {
                  const on = sel.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`gb-menu-person${on ? ' on' : ''}`}
                      onClick={() =>
                        setSel((cur) => (on ? cur.filter((x) => x !== m.id) : [...cur, m.id]))
                      }
                    >
                      <span className="gb-menu-check" aria-hidden>
                        {on ? <Icon name="check" size={11} /> : null}
                      </span>
                      <Avatar name={m.name} size="sm" src={m.avatar_url} />
                      <span className="gb-menu-person-name">{m.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="gb-menu-foot">
                <Button
                  size="sm"
                  icon="check"
                  disabled={!dirty}
                  onClick={() => {
                    ctx.onReassign(goal, sel);
                    setOpen(false);
                  }}
                >
                  Save assignees
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// "Save as template" — a standalone action (not in the quick-actions menu,
// which is Board-only) so anyone who manages a task can add it to the shared
// template library: the Board, a Manager in scope, or an Executive over a task
// they created.
function SaveTemplateButton({ goal, ctx }: { goal: Goal; ctx: CardCtx }) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => ctx.onSaveTemplate(goal)}
      aria-label="Save task as template"
      title="Save as template"
    >
      <Icon name="copy" size={14} />
    </button>
  );
}

// Wraps occurrences of `query` (case-insensitive) in a goal title with <mark>.
function Highlighted({ text, query }: { text: string; query?: string }) {
  const q = query?.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={n++} className="gb-hl">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  return <>{out}</>;
}

// A one-line "why this matched" snippet — shown only when the search term hits
// the description but NOT the title (the title highlight already explains a
// title match). Works on plain text, so there's no HTML to corrupt.
function MatchSnippet({
  description,
  title,
  query,
}: {
  description: string;
  title: string;
  query?: string;
}) {
  const q = query?.trim();
  if (!q || title.toLowerCase().includes(q.toLowerCase())) return null;
  const text = plainText(description);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + q.length + 50);
  const before = (start > 0 ? '…' : '') + text.slice(start, idx);
  const after = text.slice(idx + q.length, end) + (end < text.length ? '…' : '');
  return (
    <div className="gb-match-snippet">
      <Icon name="search" size={11} />
      <span>
        {before}
        <mark className="gb-hl">{text.slice(idx, idx + q.length)}</mark>
        {after}
      </span>
    </div>
  );
}

// The "Assigned to" chip row.
function AssigneeRow({ assignees }: { assignees: AssigneeChip[] }) {
  if (assignees.length === 0) return null;
  return (
    <div className="gb-assignees">
      <span className="gb-assignees-label">
        <Icon name="users" size={13} />
        Assigned to
      </span>
      <div className="gb-assignee-chips">
        {assignees.map((a) => (
          <span className="gb-assignee-chip" key={a.id}>
            <Avatar name={a.name} size="sm" src={a.avatar_url} />
            <span>{a.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Member-only: persistent history of the member's own reports ────────────
// The inline "Report Work" editor is scoped to the item's CURRENT period, so it
// empties on the daily/weekly rollover — the member lost sight of what they had
// reported even though the Board could still see it (and any later review) for
// the item's whole period. This panel lives on the goal card and lists EVERY
// report the member has filed for this goal — date + body, newest first — so a
// member (e.g. an intern) can always see what they reported, a day or weeks on.
// Reviewer stars + comments are nested under the report they belong to, so
// feedback is never lost either; a new 5-star pops confetti once (remembered
// per-review in localStorage).
function MemberReportHistory({
  items,
  reportsByItem,
  reviewsByReport,
  reviewerById,
  currentUserId,
}: {
  items: GoalChecklistItem[];
  reportsByItem: Record<string, WorkReport[]>;
  reviewsByReport: Record<string, WorkReportReview[]>;
  reviewerById: Record<string, ReviewerInfo>;
  currentUserId: string;
}) {
  // Pair each of the member's own reports with its task, day, body and reviews.
  const entries = React.useMemo(() => {
    const out: {
      reportId: string;
      itemLabel: string;
      reportDate: string;
      body: string;
      reviews: WorkReportReview[];
    }[] = [];
    for (const it of items) {
      const myReports = (reportsByItem[it.id] ?? []).filter(
        (r) => r.user_id === currentUserId,
      );
      for (const rep of myReports) {
        out.push({
          reportId: rep.id,
          itemLabel: it.label,
          reportDate: rep.report_date,
          body: rep.body,
          reviews: reviewsByReport[rep.id] ?? [],
        });
      }
    }
    // Newest report first (report_date is YYYY-MM-DD → lexical sort works).
    out.sort((a, b) => b.reportDate.localeCompare(a.reportDate));
    return out;
  }, [items, reportsByItem, reviewsByReport, currentUserId]);

  const hasTop = entries.some((e) => e.reviews.some((r) => r.stars === 5));

  // Celebrate the FIRST time the member sees a new 5-star review — once.
  const [burst, setBurst] = React.useState(0);
  React.useEffect(() => {
    const fiveIds = entries.flatMap((e) =>
      e.reviews.filter((r) => r.stars === 5).map((r) => r.id),
    );
    if (!fiveIds.length) return;
    let unseen: string | undefined;
    try {
      unseen = fiveIds.find((id) => localStorage.getItem(`wr5seen:${id}`) !== '1');
      if (!unseen) return;
      localStorage.setItem(`wr5seen:${unseen}`, '1');
    } catch {
      return; // localStorage blocked — skip the celebration, never crash.
    }
    setBurst((b) => b + 1);
    const t = setTimeout(() => setBurst(0), 3000);
    return () => clearTimeout(t);
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className={`mgf${hasTop ? ' mgf-top' : ''}`}>
      <div className="mgf-head">
        <Icon name={hasTop ? 'star-filled' : 'edit'} size={13} />
        <span>{hasTop ? 'Top marks on your work' : 'Your reports'}</span>
      </div>
      {entries.map((e) => (
        <div className="mgf-entry" key={e.reportId}>
          <div className="mgf-entry-head">
            <span className="mgf-entry-date">{fmtShort(e.reportDate)}</span>
          </div>
          {/* Same Task → Report → Comment order every viewer sees. */}
          <div className="cl-section cl-section-task">
            <span className="cl-spine cl-spine-task">
              <Icon name="list" size={13} />
              <span className="cl-spine-text">Task</span>
            </span>
            <span className="mgf-entry-task">{e.itemLabel}</span>
          </div>
          <div className="cl-section cl-section-report">
            <span className="cl-spine cl-spine-report">
              <Icon name="edit" size={13} />
              <span className="cl-spine-text">Report</span>
            </span>
            {e.body ? (
              <RichText className="work-report-body" value={e.body} />
            ) : (
              <span className="work-report-empty">Submitted, no details.</span>
            )}
          </div>
          {e.reviews.length > 0 ? (
            <div className="cl-section cl-section-comment">
              <span className="cl-spine cl-spine-comment">
                <Icon name="star" size={13} />
                <span className="cl-spine-text">Comment</span>
              </span>
              <WorkReportReviews reviews={e.reviews} reviewerById={reviewerById} />
            </div>
          ) : null}
        </div>
      ))}
      {burst > 0 ? <CardConfetti key={burst} count={80} lifespanMs={2900} /> : null}
    </div>
  );
}

// One goal card, used at every tier of the breakdown.
export function GoalCard({
  goal,
  ctx,
  collapseToggle,
  extra,
}: {
  goal: Goal;
  ctx: CardCtx;
  collapseToggle?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const meta = LEVEL_META[goal.level];
  const st = STATUS[goal.status] ?? STATUS.active;
  // Card lifecycle state drives both the freeze and the card styling:
  //   • completed  → status achieved (green, settled look)
  //   • overdue    → past due & not achieved (red emphasis)
  // Either way, past the due date the checklist is "closed" (frozen).
  const completed = goal.status === 'achieved';
  // Worked on but fell short — a settled outcome with its own muted styling
  // (never the red "Overdue" emphasis, which isOverdue already suppresses).
  const notMet = goal.status === 'not_met';
  const overdue = isOverdue(goal);
  const closed = isPastDue(goal);
  // Graduated deadline-proximity look: approaching (4-7d) → urgent (1-3d) →
  // today (spotlight) → overdue (red, handled by gb-overdue above).
  const urgency = dueUrgency(goal);
  // Stable references so the progress useMemo below only recomputes on real
  // data changes (a bare `?? []` would make a new array every render).
  const items = React.useMemo(
    () => ctx.checklistsByGoal[goal.id] ?? [],
    [ctx.checklistsByGoal, goal.id],
  );
  const assigneeChips = React.useMemo(
    () => ctx.assigneesByGoal[goal.id] ?? [],
    [ctx.assigneesByGoal, goal.id],
  );
  const assigneeIds = React.useMemo(
    () => ctx.assigneeIdsByGoal[goal.id] ?? [],
    [ctx.assigneeIdsByGoal, goal.id],
  );
  const hasChecklist = items.length > 0;

  // Combined progress (items × assignees) + a per-person breakdown. The math
  // lives in one shared, tested helper that mirrors the DB progress trigger.
  const { pct, perPerson, dueCount } = React.useMemo(() => {
    const chipById = new Map(assigneeChips.map((c) => [c.id, c]));
    const base = computeGoalProgress({
      items,
      completionsByItem: ctx.completionsByItem,
      assigneeIds,
      perPersonIds: assigneeChips.map((c) => c.id),
      onLeave: ctx.onLeave,
      manualProgress: goal.progress,
      closed,
    });
    const perPerson: PP[] = base.perPerson.map((p) => ({
      ...chipById.get(p.id)!,
      done: p.done,
      total: p.total,
      onLeave: p.onLeave,
    }));
    return { pct: base.pct, perPerson, dueCount: base.dueCount };
  }, [items, ctx.completionsByItem, ctx.onLeave, assigneeIds, assigneeChips, goal.progress, closed]);

  const amAssignee = assigneeIds.includes(ctx.currentUserId);
  // A participant ticks/reports on this goal: a named assignee, or — for a
  // department goal with no explicit assignees — any visible member.
  const amParticipant = amAssignee || assigneeIds.length === 0;
  // Members tick their own list; a department goal (no assignees) lets any
  // visible member tick. The Board only ticks goals it is itself assigned to.
  const showMyChecklist = hasChecklist && amParticipant;
  const combined = hasChecklist && assigneeIds.length > 1;

  // ── Report Work ── per-item: the goal department's reporting template plus
  // today's date drive the inline report editors inside the checklist.
  const todayStr = fmtDate(new Date());
  const reportTemplate = ctx.reportTemplates[goal.department] ?? '';
  // Does any checklist item require a report? (drives the Board reports panel)
  const anyReportRequired = items.some((it) => it.report_required);

  return (
    <div
      data-goal-id={goal.id}
      className={`gb-card gb-${meta.tone}${overdue ? ' gb-overdue' : ''}${
        completed ? ' gb-completed' : ''
      }${notMet ? ' gb-notmet' : ''}${
        !overdue && !completed && !notMet && urgency !== 'normal' ? ` gb-due-${urgency}` : ''
      }${goal.id === ctx.flashId ? ' gb-flash' : ''}`}
    >
      {goal.id === ctx.flashId ? (
        <span className="gb-flash-pill" aria-hidden>
          <Icon name={ctx.flashReason === 'report' ? 'edit' : 'bell'} size={12} />
          {ctx.flashReason === 'report'
            ? 'Report your work here'
            : 'Opened from your notification'}
        </span>
      ) : null}
      <div className="gb-card-top">
        <span className="gb-level">{meta.label}</span>
        <span className={`badge ${st.cls}`}>{st.label}</span>
        {overdue ? <span className="badge badge-red">Overdue</span> : null}
        <span className="gb-due">{dueLine(goal)}</span>
        {(() => {
          const assigner = ctx.assignerByGoal[goal.id];
          if (!assigner) return null;
          // "Who handed this over" badge, top-right of the card — on every task
          // for every viewer, so the chain of responsibility is legible without
          // having to be the person it was handed to.
          if (assigner.selfAssigned) {
            return (
              <span
                className="gb-assigned-by gb-self-assigned"
                title={`${assigner.name} created this task for themselves`}
              >
                <Avatar name={assigner.name} size="sm" src={assigner.avatar_url} />
                <span className="gb-assigned-by-text">
                  <span className="gb-assigned-by-label">Self-assigned</span>
                  <span className="gb-assigned-by-name">
                    {assigner.id === ctx.currentUserId ? 'You' : assigner.name}
                  </span>
                </span>
              </span>
            );
          }
          return (
            <span className="gb-assigned-by" title={`Assigned by ${assigner.name}`}>
              <Avatar name={assigner.name} size="sm" src={assigner.avatar_url} />
              <span className="gb-assigned-by-text">
                <span className="gb-assigned-by-label">Assigned by</span>
                <span className="gb-assigned-by-name">
                  {assigner.id === ctx.currentUserId ? 'You' : assigner.name}
                </span>
              </span>
            </span>
          );
        })()}
        <span className="gb-card-tools">
          {(() => {
            const pinned = ctx.pinnedIds.has(goal.id);
            return (
              <button
                type="button"
                className={`icon-btn gb-pin-star${pinned ? ' active' : ''}`}
                onClick={() => ctx.onTogglePin(goal)}
                aria-pressed={pinned}
                aria-label={pinned ? 'Unpin task' : 'Pin task'}
                title={pinned ? 'Unpin from top' : 'Pin to top'}
              >
                <Icon name={pinned ? 'star-filled' : 'star'} size={14} />
              </button>
            );
          })()}
          {collapseToggle}
          {/* Edit is open to whoever manages this task — the Board and Managers
              over their scope, an Executive over the tasks they created. The
              tools beside it stay Board/Manager: duplicating and the quick
              reassign menu both exist to move work between people, which an
              executive never does, and archiving is a delete by another name. */}
          {canManageCard(goal, ctx) ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => ctx.onEdit(goal)}
              aria-label="Edit task"
              title="Edit task"
            >
              <Icon name="edit" size={14} />
            </button>
          ) : null}
          {ctx.canUseTemplates && canManageCard(goal, ctx) ? (
            <SaveTemplateButton goal={goal} ctx={ctx} />
          ) : null}
          {ctx.isBoard ? (
            <>
              <button
                type="button"
                className="icon-btn"
                onClick={() => ctx.onDuplicate(goal)}
                aria-label="Duplicate task"
                title="Duplicate task to reassign to another member"
              >
                <Icon name="copy" size={14} />
              </button>
              <GoalCardMenu goal={goal} ctx={ctx} />
              {ctx.canDelete ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => ctx.onDelete(goal)}
                  aria-label="Archive task"
                  title="Archive task"
                >
                  <Icon name="trash" size={14} />
                </button>
              ) : null}
            </>
          ) : null}
        </span>
      </div>
      <div className="gb-title">
        <Highlighted text={goal.title} query={ctx.highlight} />
      </div>
      <MatchSnippet description={goal.description} title={goal.title} query={ctx.highlight} />
      {goal.description ? (
        <div className="goal-desc">
          <RichText value={goal.description} />
        </div>
      ) : null}
      <div className="goal-progress gb-bar">
        <div className="goal-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="gb-card-foot">
        <span className="text-grey">{goalDepts(goal).join(' · ')}</span>
        <span className="fw-medium text-green">
          {pct}%{' '}
          {combined ? `· combined of ${assigneeIds.length} team members` : 'complete'}
        </span>
      </div>

      <GoalAuthorship goal={goal} ctx={ctx} />

      {assigneeChips.length > 0 ? <AssigneeRow assignees={assigneeChips} /> : null}

      {/* Per-person breakdown — each assignee's own progress today. */}
      {hasChecklist && perPerson.length > 0 && dueCount > 0 ? (
        <div className="gb-perperson">
          <span className="gb-perperson-head">
            <Icon name="users" size={13} />
            Per person · {dueCount} due today
          </span>
          {perPerson.map((p) =>
            p.onLeave ? (
              <div className="gb-pp-row gb-pp-onleave" key={p.id}>
                <Avatar name={p.name} size="sm" src={p.avatar_url} />
                <span className="gb-pp-name">{p.name}</span>
                <span className="badge badge-slate gb-onleave-badge">
                  <Icon name="plane" size={11} /> On leave
                </span>
              </div>
            ) : (
              <div className="gb-pp-row" key={p.id}>
                <Avatar name={p.name} size="sm" src={p.avatar_url} />
                <span className="gb-pp-name">{p.name}</span>
                <span className="gb-pp-bar">
                  <span
                    className="gb-pp-fill"
                    style={{ width: `${p.total ? Math.round((p.done * 100) / p.total) : 0}%` }}
                  />
                </span>
                <span className="gb-pp-count">
                  {p.done}/{p.total}
                </span>
              </div>
            ),
          )}
        </div>
      ) : null}

      {hasChecklist && dueCount === 0 ? (
        <div className="gb-nothing-due">
          {closed
            ? 'Checklist closed. The due date has passed.'
            : 'Nothing scheduled for today.'}
        </div>
      ) : null}

      {/* Member view: the tick-off checklist, with an inline "Report Work"
          editor under any item that requires a report before completion, plus a
          persistent history of the member's own reports (with any reviewer
          feedback nested) that survives the day/period rollover. */}
      {showMyChecklist ? (
        <>
          <GoalChecklist
            items={items}
            goalId={goal.id}
            // Self-added steps are an EXECUTIVE's tool: they have no other way
            // to shape their own workload, since they cannot edit a task a
            // Director assigned them. A Director or Manager who is also an
            // assignee already edits that task's real checklist, so handing
            // them a second, private list would only split the record in two.
            // Not once the task is closed either: past the due date the
            // checklist is frozen for everyone.
            canAddOwn={FEATURE_FLAGS.executiveTasks && ctx.selfManage && !closed}
            completionsByItem={ctx.completionsByItem}
            currentUserId={ctx.currentUserId}
            reportsByItem={ctx.reportsByItem}
            reportTemplate={reportTemplate}
            today={todayStr}
            closed={closed}
            openReportSignal={ctx.reportReq}
          />
          <MemberReportHistory
            items={items}
            reportsByItem={ctx.reportsByItem}
            reviewsByReport={ctx.reviewsByReport}
            reviewerById={ctx.reviewerById}
            currentUserId={ctx.currentUserId}
          />
        </>
      ) : null}

      {/* Board/Manager view: full per-member checklist status panel, with each
          member's work report and a rate + comment control under it. */}
      {ctx.isBoard && hasChecklist && assigneeChips.length > 0 ? (
        <BoardChecklistPanel
          items={items}
          completionsByItem={ctx.completionsByItem}
          assigneeChips={assigneeChips}
          dueCount={dueCount}
          onLeave={ctx.onLeave}
          reportsByItem={anyReportRequired ? ctx.reportsByItem : undefined}
          reviewsByReport={anyReportRequired ? ctx.reviewsByReport : undefined}
          reviewerById={ctx.reviewerById}
          currentUserId={ctx.currentUserId}
          closed={closed}
        />
      ) : null}

      {extra ? <div className="gb-extra">{extra}</div> : null}
    </div>
  );
}
// Who wrote this task, and when it was last really edited. Shown to everyone
// who can see the card, not just leadership: once anybody can create a task,
// "where did this come from" is a question every assignee has too.
//
// "Edited" reads off goals.updated_at, which only updateGoal / setGoalAssignees
// move (migration 0064). Ticking a checklist item and the progress trigger
// deliberately leave it alone — otherwise every card would claim it was edited
// each time somebody simply did the day's work on it. A task written before
// 0064, or never edited since, shows the "Added" half alone.
function GoalAuthorship({ goal, ctx }: { goal: Goal; ctx: CardCtx }) {
  const author = goal.created_by ? ctx.reviewerById[goal.created_by] : null;
  const editor = goal.updated_by ? ctx.reviewerById[goal.updated_by] : null;
  // Nothing to attribute: a legacy row with no creator recorded. Say nothing
  // rather than invent a name.
  if (!author && !goal.created_at) return null;
  const stamp = (iso: string) => `${fmtDateDMY(iso)} · ${fmtTime(iso)}`;
  return (
    <div className="gb-authorship">
      <span className="gb-authorship-item" title={`Created ${stamp(goal.created_at)}`}>
        <Icon name="plus" size={11} />
        Added by{' '}
        <strong>
          {author ? (author.id === ctx.currentUserId ? 'you' : author.name) : 'a former member'}
        </strong>{' '}
        · {stamp(goal.created_at)}
      </span>
      {goal.updated_at ? (
        // Just when, not by whom: the ask was for the modification TIME, and a
        // name here would compete with the "Added by" it sits beside. updated_by
        // is recorded all the same, so surfacing it later is a render change,
        // not a migration.
        <span
          className="gb-authorship-item"
          title={editor ? `Last edited by ${editor.name}` : 'Last edited'}
        >
          <Icon name="edit" size={11} />
          Edited · {stamp(goal.updated_at)}
        </span>
      ) : null}
    </div>
  );
}

// ─── Board-only: full per-member checklist status (read-only) ───────────────
// Shows every assignee with each of their checklist items ticked or pending —
// and, for items that require a work report, what that member reported today.
function BoardChecklistPanel({
  items,
  completionsByItem,
  assigneeChips,
  dueCount,
  onLeave,
  reportsByItem,
  reviewsByReport,
  reviewerById = {},
  currentUserId,
  closed = false,
}: {
  items: GoalChecklistItem[];
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  assigneeChips: AssigneeChip[];
  dueCount: number;
  onLeave: Set<string>;
  // itemId -> reports. Provided only when some item requires a report.
  reportsByItem?: Record<string, WorkReport[]>;
  // reportId -> reviews on it. Provided only when some item requires a report.
  reviewsByReport?: Record<string, WorkReportReview[]>;
  reviewerById?: Record<string, ReviewerInfo>;
  // The viewer (Board / Manager) — their own review is the one the form edits.
  currentUserId: string;
  // Past the due date: nothing is due, the checklist is shown read-only as a
  // final record of what each member completed.
  closed?: boolean;
}) {
  // A member's CURRENT report for an item — period/carry-over aware so the
  // report stays visible for exactly as long as the item reads "Done" (a Monday
  // task reported Monday keeps its report through the week, not just that day).
  const reportFor = (item: GoalChecklistItem, userId: string): WorkReport | null =>
    currentReport(
      (reportsByItem?.[item.id] ?? []).filter((r) => r.user_id === userId),
      item,
    );
  // Track which assignee sections are expanded. Default: all collapsed — each
  // open section renders every one of that member's checklist items (with
  // rich-text task descriptions, work-report bodies and a review control), and
  // on a founder's cascade that is a large amount of DOM to build up front. The
  // collapsed header still shows each member's done/due count and percentage,
  // so the at-a-glance read is intact; click a name to see the detail.
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  // Preview mode: simulate what the assigned member sees (lock boxes on
  // custom-recurrence descriptions). Board/manager only — read-only overlay.
  const [previewMode, setPreviewMode] = React.useState(false);

  const toggle = (uid: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });

  if (assigneeChips.length === 0 || items.length === 0) return null;

  // Pre-compute: for each item, which user IDs have a current completion?
  const doneByItem = new Map<string, Set<string>>();
  for (const it of items) {
    const set = new Set(
      (completionsByItem[it.id] ?? [])
        .filter((c) => isCompletionCurrent(it.recurrence, c.done_at))
        .map((c) => c.user_id),
    );
    doneByItem.set(it.id, set);
  }

  // Each member's section lists what THEY owe: the shared steps, plus the ones
  // they added for themselves (migration 0064). A teammate's self-added step
  // belongs in that teammate's section and nowhere else — which is also why the
  // counts below are per member rather than against one shared total.
  const itemsFor = (uid: string) => items.filter((it) => itemBelongsTo(it, uid));
  const dueFor = (uid: string) =>
    closed ? [] : itemsFor(uid).filter((it) => isDueToday(it));

  return (
    <div className="board-checklist-panel">
      <div className="board-checklist-head">
        <Icon name="users" size={13} />
        Team checklist status
        {closed ? (
          <span className="board-checklist-closed-badge">Closed</span>
        ) : dueCount > 0 ? (
          <span className="board-checklist-due-badge">{dueCount} due today</span>
        ) : null}
        <button
          className={`board-preview-toggle${previewMode ? ' active' : ''}`}
          onClick={() => setPreviewMode((v) => !v)}
          title={previewMode ? 'Exit member preview' : 'Preview as member'}
        >
          <Icon name="eye" size={12} />
          {previewMode ? 'Exit preview' : 'Preview as member'}
        </button>
      </div>
      {assigneeChips.map((chip) => {
        const isOpen = expanded.has(chip.id);
        const memberOnLeave = onLeave.has(chip.id);
        const memberItems = itemsFor(chip.id);
        const memberDue = dueFor(chip.id);
        const memberDone = memberDue.filter((it) => doneByItem.get(it.id)?.has(chip.id)).length;
        const pct = memberDue.length > 0 ? Math.round((memberDone * 100) / memberDue.length) : 0;
        return (
          <div key={chip.id} className={`board-cl-member${memberOnLeave ? ' board-cl-onleave' : ''}`}>
            <button
              type="button"
              className="board-cl-member-header"
              onClick={() => toggle(chip.id)}
              aria-expanded={isOpen}
            >
              <Avatar name={chip.name} size="sm" src={chip.avatar_url} />
              <span className="board-cl-member-name">{chip.name}</span>
              {memberOnLeave ? (
                <span className="badge badge-slate gb-onleave-badge">
                  <Icon name="plane" size={11} /> On leave
                </span>
              ) : (
                <>
                  <span className="board-cl-member-count">
                    {memberDone}/{memberDue.length}
                  </span>
                  <span className="board-cl-pct" style={{ color: pct === 100 ? 'var(--color-green-primary)' : undefined }}>
                    {pct}%
                  </span>
                </>
              )}
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={13} />
            </button>
            {isOpen ? (
              <div className="board-cl-items">
                {memberItems.map((it) => {
                  const due = closed ? false : isDueToday(it);
                  const done = doneByItem.get(it.id)?.has(chip.id) ?? false;
                  // On an off day, keep showing a tick if the member completed it
                  // on its most recent due day (carried over until next due day).
                  const carried =
                    !due &&
                    isCarriedOverDone(
                      it,
                      (completionsByItem[it.id] ?? []).find((c) => c.user_id === chip.id)?.done_at ??
                        null,
                    );
                  const isDone = (done && (it.recurrence === 'once' ? true : due)) || carried;
                  const doneAt = (completionsByItem[it.id] ?? []).find(
                    (c) => c.user_id === chip.id,
                  )?.done_at;
                  const report = it.report_required ? reportFor(it, chip.id) : null;
                  return (
                    <div
                      key={it.id}
                      className={`board-cl-item${
                        isDone ? ' board-cl-done' : ''
                      }${!due ? ' board-cl-notdue' : ''}${
                        it.owner_id ? ' board-cl-own' : ''
                      }`}
                    >
                      <span className="board-cl-tick" aria-hidden>
                        {isDone ? <Icon name="check" size={11} /> : null}
                      </span>
                      <span className="board-cl-label">
                        <span className="board-cl-title">
                          {it.label}
                          {/* Same tell the member sees on their own list, so a
                              Director reading this panel can separate the work
                              they assigned from the work the member took on. */}
                          {it.owner_id ? (
                            <span className="goal-check-own-badge">Self-added</span>
                          ) : null}
                        </span>
                        {/* When the step came into existence, on every row — the
                            same stamp the member sees on their own list. Inside
                            the label column so it wraps under the title rather
                            than competing with it for the row's width. */}
                        <span className={`goal-check-added${it.owner_id ? ' is-own' : ''}`}>
                          <span>Added{it.owner_id ? ` by ${chip.name}` : ''}</span>
                          <span className="goal-check-added-at">
                            {fmtDateDMY(it.created_at)} · {fmtTime(it.created_at)}
                          </span>
                        </span>
                        {/* For Report Work items, spine labels in the left gutter
                            separate the GIVEN task from the GOT submission. */}
                        {it.description ? (
                          it.report_required ? (
                            <div className="cl-section cl-section-task">
                              <span className="cl-spine cl-spine-task">
                                <Icon name="list" size={13} />
                                <span className="cl-spine-text">Task</span>
                              </span>
                              <RichText className="board-cl-desc" value={it.description} />
                            </div>
                          ) : (
                            <RichText className="board-cl-desc" value={it.description} />
                          )
                        ) : null}
                        {/* The Report box appears only once the member has actually
                            reported — an empty "no report yet" box was just noise
                            (the item's Pending tag already flags a missing report). */}
                        {it.report_required && report ? (
                          <>
                            <div className="cl-section cl-section-report">
                              <span className="cl-spine cl-spine-report">
                                <Icon name="edit" size={13} />
                                <span className="cl-spine-text">Report</span>
                              </span>
                              <span className="board-cl-report">
                                {report.body ? (
                                  <RichText className="board-cl-report-body" value={report.body} />
                                ) : (
                                  <span className="board-cl-report-empty">Submitted, no details.</span>
                                )}
                              </span>
                            </div>
                            {/* Comment — rate + comment this report. Existing reviews
                                from everyone show above the viewer's own editor. Kept
                                as its own labelled section so every viewer sees the
                                same Task → Report → Comment order. */}
                            <div className="cl-section cl-section-comment">
                              <span className="cl-spine cl-spine-comment">
                                <Icon name="star" size={13} />
                                <span className="cl-spine-text">Comment</span>
                              </span>
                              <div className="board-cl-review">
                                <ReportReviewSection
                                  reportId={report.id}
                                  reviews={reviewsByReport?.[report.id] ?? []}
                                  reviewerById={reviewerById ?? {}}
                                  currentUserId={currentUserId}
                                />
                              </div>
                            </div>
                          </>
                        ) : null}
                      </span>
                      {isDone ? (
                        <span className="board-cl-done-col">
                          <span className="board-cl-done-tag">Done</span>
                          {doneAt ? (
                            <span className="goal-check-completed-at" title={doneAt}>
                              <Icon name="check" size={10} />
                              {fmtDateDMY(doneAt)} · {fmtTime(doneAt)}
                            </span>
                          ) : null}
                        </span>
                      ) : closed ? (
                        <span className="board-cl-notdue-tag">Closed</span>
                      ) : !due ? (
                        <span className="board-cl-notdue-tag">Not due</span>
                      ) : memberOnLeave ? (
                        <span className="board-cl-notdue-tag">On leave</span>
                      ) : (
                        <span className="board-cl-pending-tag">Pending</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// A goal plus its descendant tier(s), with a collapse toggle.
export function GoalNode({
  goal,
  childrenByParent,
  ctx,
  collapsed,
  toggle,
}: {
  goal: Goal;
  childrenByParent: Map<string, Goal[]>;
  ctx: CardCtx;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const childLevel = LEVEL_META[goal.level].child;
  const children = childLevel
    ? (childrenByParent.get(goal.id) ?? []).filter((g) => g.level === childLevel)
    : [];
  const isOpen = !collapsed.has(goal.id);
  const childWord = childLevel ? LEVEL_WORD[childLevel] : '';

  return (
    <div className="gb-node">
      <GoalCard
        goal={goal}
        ctx={ctx}
        collapseToggle={
          children.length > 0 ? (
            <button
              type="button"
              className="gb-toggle"
              onClick={() => toggle(goal.id)}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={15} />
              {children.length} {childWord}
            </button>
          ) : null
        }
      />
      {isOpen && children.length > 0 ? (
        <div className="gb-children">
          {children.map((c) => (
            <GoalNode
              key={c.id}
              goal={c}
              childrenByParent={childrenByParent}
              ctx={ctx}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
