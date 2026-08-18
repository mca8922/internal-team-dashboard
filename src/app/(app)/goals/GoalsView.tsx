'use client';

// Goals — a systematic, workflow-style breakdown view.
//
// Mission & Vision sit at the top (the "why"). Below, the org's goals are
// shown as a navigable tree: pick a top-tier goal and see how it breaks down
// into Half-Yearly → Quarterly → Monthly → Daily, with tree lines so the parent →
// child workflow is obvious at a glance.
//
// The Board adds and edits everything from ONE "Add Goal" button (no separate
// Manage page). Checklist completion is independent per assignee, so a card
// shows a combined progress bar (items × assignees) plus a per-person
// breakdown, and each member ticks only their own list.
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { EmptyState, Avatar, Button, Modal, Field } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { GoalChecklist } from '@/components/GoalChecklist';
import {
  ReportReviewSection,
  WorkReportReviews,
  type ReviewerInfo,
} from '@/components/WorkReportReview';
import { CardConfetti } from '@/components/ChecklistCelebration';
import { MyTodayPanel } from '@/components/MyTodayPanel';
import { RichText, RichTextEditor } from '@/components/RichTextEditor';
import { GoalForm, type AssignableMember, type GoalSubmit, type ChecklistRow } from './GoalForm';
import {
  createGoal,
  updateGoal,
  deleteGoal,
  saveCompany,
  setGoalAssignees,
  saveReportTemplate,
  createGoalTemplate,
  deleteGoalTemplate,
  addGoalPin,
  removeGoalPin,
} from '@/lib/actions';
import { isDueToday, isCompletionCurrent, isCarriedOverDone, currentReport } from '@/lib/recurrence';
import { computeGoalProgress } from '@/lib/goal-progress';
import { type GoalTemplate } from '@/lib/goal-templates';
import { fmtDate, fmtShort, fmtDateDMY, fmtTime } from '@/lib/dates';
import {
  STATUS,
  LEVEL_META,
  LEVEL_ORDER,
  LEVEL_WORD,
  PARENT_LEVEL,
  plainText,
  daysToDue,
  isOverdue,
  isPastDue,
  dueWithin,
  dueLine,
  goalDepts,
  goalInDept,
} from './goal-ui';
import { goalPath } from '@/lib/goal-buckets';
import { GoalsTable } from './GoalsTable';
import { GoalsCanvas } from './GoalsCanvas';
import { GoalCommandPalette } from './GoalCommandPalette';
import { SavedViewsMenu } from './SavedViewsMenu';
import { GoalsCleanup } from './GoalsCleanup';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import type {
  Goal,
  GoalLevel,
  GoalStatus,
  GoalChecklistItem,
  GoalChecklistCompletion,
  WorkReport,
  WorkReportReview,
  UserRole,
  SavedView,
  GoalViewConfig,
  GoalGrouping,
  GoalSortKey,
} from '@/lib/types';

// A member assigned to a goal — just what a card chip needs to render.
export interface AssigneeChip {
  id: string;
  name: string;
  avatar_url: string | null;
}

// Who assigned a goal to the current viewer — drives the "Assigned by" badge.
export interface AssignerInfo {
  name: string;
  avatar_url: string | null;
}

// Shared bag of data every card/node needs, threaded down the tree.
interface CardCtx {
  checklistsByGoal: Record<string, GoalChecklistItem[]>;
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  assigneesByGoal: Record<string, AssigneeChip[]>;
  assigneeIdsByGoal: Record<string, string[]>;
  // itemId -> [work report, ...] (all members' reports for that checklist item).
  reportsByItem: Record<string, WorkReport[]>;
  // reportId -> [review, ...] (Manager/Board ratings + comments on each report).
  reviewsByReport: Record<string, WorkReportReview[]>;
  // reviewerId -> identity (name/avatar/role) to label each review.
  reviewerById: Record<string, ReviewerInfo>;
  // goalId -> who assigned this goal to the CURRENT viewer (if anyone).
  assignerByGoal: Record<string, AssignerInfo>;
  // department -> reporting template (HTML) shown to members when reporting.
  reportTemplates: Record<string, string>;
  currentUserId: string;
  // isBoard here means "can manage goals" — true for the Board AND for a
  // Department Manager over their own department. canDelete / canAdmin stay
  // Board-only (delete a goal; edit mission/vision, templates).
  isBoard: boolean;
  canDelete: boolean;
  canAdmin: boolean;
  members: AssignableMember[];
  // User IDs on approved leave today — excluded from "due" progress and badged.
  onLeave: Set<string>;
  onEdit: (g: Goal) => void;
  onDuplicate: (g: Goal) => void;
  onDelete: (g: Goal) => void;
  onSetStatus: (g: Goal, status: GoalStatus) => void;
  onReassign: (g: Goal, userIds: string[]) => void;
  onSaveTemplate: (g: Goal) => void;
  // Active search term — when set, matching text in a goal title is highlighted.
  highlight?: string;
  // Per-user pinned goal ids + a toggle, so a card can show/flip its ★.
  pinnedIds: Set<string>;
  onTogglePin: (g: Goal) => void;
  // Goal id to briefly highlight after a jump, plus why (drives the pill text).
  flashId: string | null;
  flashReason: 'notif' | 'report';
  // Request to open a specific checklist item's report editor (from "Your day").
  reportReq: { itemId: string; n: number } | null;
}

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
          {ctx.canAdmin ? (
            <>
              <div className="gb-menu-divider" />
              <button
                type="button"
                className="gb-menu-item"
                onClick={() => {
                  ctx.onSaveTemplate(goal);
                  setOpen(false);
                }}
              >
                <Icon name="copy" size={14} />
                <span>Save as template</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
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
function GoalCard({
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
      }${notMet ? ' gb-notmet' : ''}${goal.id === ctx.flashId ? ' gb-flash' : ''}`}
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
          // Modern "who handed you this goal" badge, top-right of the card.
          return (
            <span className="gb-assigned-by" title={`Assigned by ${assigner.name}`}>
              <Avatar name={assigner.name} size="sm" src={assigner.avatar_url} />
              <span className="gb-assigned-by-text">
                <span className="gb-assigned-by-label">Assigned by</span>
                <span className="gb-assigned-by-name">{assigner.name}</span>
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
          {ctx.isBoard ? (
            <>
              <button
                type="button"
                className="icon-btn"
                onClick={() => ctx.onEdit(goal)}
                aria-label="Edit task"
                title="Edit task"
              >
                <Icon name="edit" size={14} />
              </button>
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
interface PP extends AssigneeChip {
  done: number;
  total: number;
  onLeave: boolean;
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
  // Track which assignee sections are expanded. Default: all expanded.
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(assigneeChips.map((a) => a.id)),
  );
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

  const dueItems = closed ? [] : items.filter((it) => isDueToday(it));
  const allItems = items; // show all items (due + not-due) for full picture

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
        const memberDone = dueItems.filter((it) => doneByItem.get(it.id)?.has(chip.id)).length;
        const pct =
          dueItems.length > 0 ? Math.round((memberDone * 100) / dueItems.length) : 0;
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
                    {memberDone}/{dueItems.length}
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
                {allItems.map((it) => {
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
                      }${!due ? ' board-cl-notdue' : ''}`}
                    >
                      <span className="board-cl-tick" aria-hidden>
                        {isDone ? <Icon name="check" size={11} /> : null}
                      </span>
                      <span className="board-cl-label">
                        <span className="board-cl-title">{it.label}</span>
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
function GoalNode({
  goal,
  goals,
  ctx,
  collapsed,
  toggle,
}: {
  goal: Goal;
  goals: Goal[];
  ctx: CardCtx;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const childLevel = LEVEL_META[goal.level].child;
  const children = childLevel
    ? goals.filter((g) => g.level === childLevel && g.parent_id === goal.id)
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
              goals={goals}
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

// A lightweight search box for members (just a filter over their own goals).
function MemberSearchBar({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (s: string) => void;
}) {
  return (
    <div className="gb-member-search">
      <div className="gb-toolbar-search">
        <Icon name="search" size={15} />
        <input
          className="gb-toolbar-input"
          placeholder="Search your tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="gb-toolbar-x"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// A searchable "filter by assignee" dropdown. Swapped in for a plain <select>
// because the member list can run into the dozens — a type-to-filter search
// box inside the panel keeps picking one person fast regardless of team size.
function AssigneeFilterPicker({
  members,
  value,
  onChange,
}: {
  members: AssignableMember[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const sorted = React.useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sorted.filter((m) => m.name.toLowerCase().includes(q)) : sorted;
  }, [sorted, search]);
  const selected = value !== 'all' ? sorted.find((m) => m.id === value) : undefined;

  React.useEffect(() => {
    if (!open) return;
    setSearch('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="gb-assignee-picker" ref={wrapRef}>
      <button
        type="button"
        className={`select gb-toolbar-assignee gb-assignee-picker-trigger${selected ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by assignee"
      >
        <Icon name={selected ? 'user' : 'users'} size={14} />
        <span className="gb-assignee-picker-label">{selected ? selected.name : 'Everyone'}</span>
        <span className={`gb-assignee-picker-chevron${open ? ' up' : ''}`}>
          <Icon name="chevron-down" size={13} />
        </span>
      </button>
      {open ? (
        <div className="gb-assignee-picker-menu" role="listbox">
          <div className="gb-assignee-picker-search">
            <Icon name="search" size={13} />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered.length === 1) choose(filtered[0].id);
              }}
            />
          </div>
          <div className="gb-assignee-picker-list">
            <button
              type="button"
              className={`gb-assignee-picker-item${value === 'all' ? ' on' : ''}`}
              onClick={() => choose('all')}
            >
              <Icon name="users" size={14} />
              <span className="gb-assignee-picker-item-name">Everyone</span>
              {value === 'all' ? <Icon name="check" size={13} /> : null}
            </button>
            {filtered.length > 0 ? <div className="gb-assignee-picker-divider" /> : null}
            {filtered.length === 0 ? (
              <div className="gb-assignee-picker-empty">No one matches “{search}”.</div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`gb-assignee-picker-item${value === m.id ? ' on' : ''}`}
                  onClick={() => choose(m.id)}
                >
                  <span className="gb-assignee-picker-item-name">{m.name}</span>
                  {value === m.id ? <Icon name="check" size={13} /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Board management toolbar: search + department + status filters ──────────
function BoardGoalsToolbar({
  query,
  setQuery,
  dept,
  setDept,
  status,
  setStatus,
  due,
  setDue,
  assignee,
  setAssignee,
  departments,
  members,
  filtersActive,
  onClear,
}: {
  query: string;
  setQuery: (s: string) => void;
  dept: string;
  setDept: (s: string) => void;
  status: 'all' | GoalStatus;
  setStatus: (s: 'all' | GoalStatus) => void;
  due: 'all' | 'overdue' | 'week';
  setDue: (s: 'all' | 'overdue' | 'week') => void;
  assignee: string;
  setAssignee: (s: string) => void;
  departments: string[];
  members: AssignableMember[];
  filtersActive: boolean;
  onClear: () => void;
}) {
  const statusChips: { value: 'all' | GoalStatus; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: STATUS.active.label },
    { value: 'inactive', label: STATUS.inactive.label },
    { value: 'achieved', label: STATUS.achieved.label },
    { value: 'not_met', label: STATUS.not_met.label },
  ];
  return (
    <div className="gb-toolbar">
      <div className="gb-toolbar-search">
        <Icon name="search" size={15} />
        <input
          className="gb-toolbar-input"
          placeholder="Search tasks by title or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="gb-toolbar-x"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
      <select
        className="select gb-toolbar-dept"
        value={dept}
        onChange={(e) => setDept(e.target.value)}
        aria-label="Filter by department"
      >
        <option value="all">All departments</option>
        {departments.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        className="select gb-toolbar-due"
        value={due}
        onChange={(e) => setDue(e.target.value as 'all' | 'overdue' | 'week')}
        aria-label="Filter by due date"
      >
        <option value="all">Any due date</option>
        <option value="overdue">Overdue</option>
        <option value="week">Due this week</option>
      </select>
      <AssigneeFilterPicker members={members} value={assignee} onChange={setAssignee} />
      <div className="gb-status-filter" role="group" aria-label="Filter by status">
        {statusChips.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`gb-status-chip${status === s.value ? ' active' : ''}`}
            onClick={() => setStatus(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {filtersActive ? (
        <button type="button" className="gb-toolbar-clear" onClick={onClear}>
          <Icon name="x" size={13} /> Clear
        </button>
      ) : null}
    </div>
  );
}

// ── Board health strip: at-a-glance counts that double as quick filters ─────
function BoardHealthStrip({
  counts,
  onStatus,
  onOverdue,
}: {
  counts: {
    total: number;
    active: number;
    inactive: number;
    achieved: number;
    overdue: number;
    notMet: number;
  };
  onStatus: (s: GoalStatus) => void;
  onOverdue: () => void;
}) {
  return (
    <div className="gb-health">
      <div className="gb-health-tile">
        <span className="gb-health-num">{counts.total}</span>
        <span className="gb-health-lbl">Total tasks</span>
      </div>
      <button type="button" className="gb-health-tile amber" onClick={() => onStatus('active')}>
        <span className="gb-health-num">{counts.active}</span>
        <span className="gb-health-lbl">{STATUS.active.label}</span>
      </button>
      <button type="button" className="gb-health-tile red" onClick={onOverdue}>
        <span className="gb-health-num">{counts.overdue}</span>
        <span className="gb-health-lbl">Overdue</span>
      </button>
      <button type="button" className="gb-health-tile green" onClick={() => onStatus('achieved')}>
        <span className="gb-health-num">{counts.achieved}</span>
        <span className="gb-health-lbl">{STATUS.achieved.label}</span>
      </button>
      <button type="button" className="gb-health-tile violet" onClick={() => onStatus('not_met')}>
        <span className="gb-health-num">{counts.notMet}</span>
        <span className="gb-health-lbl">{STATUS.not_met.label}</span>
      </button>
      <button type="button" className="gb-health-tile slate" onClick={() => onStatus('inactive')}>
        <span className="gb-health-num">{counts.inactive}</span>
        <span className="gb-health-lbl">{STATUS.inactive.label}</span>
      </button>
    </div>
  );
}

// ── Board management results: matching goals grouped by department ──────────
function BoardGoalsResults({
  groups,
  total,
  ctx,
  onClear,
}: {
  groups: [string, Goal[]][];
  total: number;
  ctx: CardCtx;
  onClear: () => void;
}) {
  if (total === 0) {
    return (
      <EmptyState
        icon="search"
        title="No tasks match"
        hint="Try a different search, department or status, or clear the filters."
      />
    );
  }
  return (
    <div className="gb-results">
      <div className="gb-results-head">
        <span className="gb-results-count">
          {total} task{total !== 1 ? 's' : ''} · {groups.length} department
          {groups.length !== 1 ? 's' : ''}
        </span>
        <button type="button" className="gb-results-clear" onClick={onClear}>
          Clear filters
        </button>
      </div>
      {groups.map(([dept, gs]) => {
        const active = gs.filter((g) => g.status === 'active').length;
        const achieved = gs.filter((g) => g.status === 'achieved').length;
        const inactive = gs.filter((g) => g.status === 'inactive').length;
        const notMet = gs.filter((g) => g.status === 'not_met').length;
        return (
          <div key={dept} className="gb-dept-group">
            <div className="gb-dept-head">
              <span className="gb-dept-name">
                <Icon name="building" size={15} />
                {dept}
                <span className="gb-dept-count">{gs.length}</span>
              </span>
              <span className="gb-dept-tally">
                {active > 0 ? (
                  <span className={`badge ${STATUS.active.cls}`}>{active} {STATUS.active.label}</span>
                ) : null}
                {achieved > 0 ? (
                  <span className={`badge ${STATUS.achieved.cls}`}>
                    {achieved} {STATUS.achieved.label}
                  </span>
                ) : null}
                {notMet > 0 ? (
                  <span className={`badge ${STATUS.not_met.cls}`}>
                    {notMet} {STATUS.not_met.label}
                  </span>
                ) : null}
                {inactive > 0 ? (
                  <span className={`badge ${STATUS.inactive.cls}`}>
                    {inactive} {STATUS.inactive.label}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="grid gap-3">
              {gs.map((g) => (
                <GoalCard key={g.id} goal={g} ctx={ctx} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The goal being added / edited / duplicated. For a duplicate there is no `id`
// (it saves as a brand-new goal), so the copied assignees + checklist travel on
// the `_seed*` fields; `_duplicate` just tweaks the modal copy.
type EditingState = Partial<Goal> & {
  level: GoalLevel;
  _duplicate?: boolean;
  _template?: boolean;
  _seedAssignees?: string[];
  _seedChecklist?: ChecklistRow[];
};

// One department's reporting-template editor inside the "Report templates"
// modal. Members of that department see this template prefilled when they open
// the work-report editor, so they report in a consistent shape.
function ReportTemplateEditorRow({
  department,
  initialBody,
}: {
  department: string;
  initialBody: string;
}) {
  const toast = useToast();
  const [body, setBody] = React.useState(initialBody);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setBody(initialBody), [initialBody]);
  const dirty = body !== initialBody;

  const save = async () => {
    setSaving(true);
    try {
      await saveReportTemplate(department, body);
      toast(`Saved ${department} template`);
    } catch (e) {
      toast((e as Error).message || 'Could not save the template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rt-tpl-row">
      <div className="rt-tpl-head">
        <Icon name="building" size={14} />
        <span className="rt-tpl-dept">{department}</span>
      </div>
      <RichTextEditor
        value={body}
        onChange={setBody}
        placeholder="e.g. 1) What I shipped today  2) Numbers / impact  3) Blockers"
        ariaLabel={`${department} reporting template`}
      />
      <div className="rt-tpl-actions">
        <Button size="sm" icon="check" onClick={save} disabled={!dirty} loading={saving}>
          Save template
        </Button>
      </div>
    </div>
  );
}

export function GoalsView({
  goals,
  allGoals,
  archivedGoals,
  mission,
  vision,
  isBoard,
  canDelete,
  canAdmin,
  viewerRole,
  tenureMonths,
  currentUserId,
  checklistsByGoal,
  completionsByItem,
  assigneesByGoal,
  assigneeIdsByGoal,
  reportsByItem,
  reviewsByReport,
  reviewerById,
  assignerByGoal,
  reportTemplates,
  goalTemplates,
  onLeaveUserIds,
  members,
  departments,
  pinnedGoalIds,
  savedViews,
}: {
  goals: Goal[];
  allGoals: Goal[];
  archivedGoals: Goal[];
  mission: string;
  vision: string;
  isBoard: boolean;
  canDelete: boolean;
  canAdmin: boolean;
  viewerRole: UserRole;
  tenureMonths: number | null;
  currentUserId: string;
  checklistsByGoal: Record<string, GoalChecklistItem[]>;
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  assigneesByGoal: Record<string, AssigneeChip[]>;
  assigneeIdsByGoal: Record<string, string[]>;
  reportsByItem: Record<string, WorkReport[]>;
  reviewsByReport: Record<string, WorkReportReview[]>;
  reviewerById: Record<string, ReviewerInfo>;
  assignerByGoal: Record<string, AssignerInfo>;
  reportTemplates: Record<string, string>;
  goalTemplates: GoalTemplate[];
  onLeaveUserIds: string[];
  members: AssignableMember[];
  departments: string[];
  pinnedGoalIds: string[];
  savedViews: SavedView[];
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const onLeave = React.useMemo(() => new Set(onLeaveUserIds), [onLeaveUserIds]);
  // While duplicating there is no source id to read assignees/checklist from,
  // so the seed (copied from the source goal) rides along on the editing state
  // and feeds the form's initial props below.
  const [editing, setEditing] = React.useState<EditingState | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [mvOpen, setMvOpen] = React.useState(false);
  // Goal templates (shared DB blueprints) come in as a prop; the modal lists them.
  const [tplOpen, setTplOpen] = React.useState(false);
  // Department reporting-templates editor (Report Work items).
  const [rtOpen, setRtOpen] = React.useState(false);
  // Goals cleanup (Board only): bulk export + archive/delete of past goals.
  const [cleanupOpen, setCleanupOpen] = React.useState(false);
  const [mvDraft, setMvDraft] = React.useState({ mission, vision });
  React.useEffect(() => setMvDraft({ mission, vision }), [mission, vision]);

  const topLabel =
    viewerRole === 'intern' && tenureMonths ? `${tenureMonths}-Month Task` : 'Yearly Task';

  const { yearly, halfYearly, subYearly, unlinked } = React.useMemo(() => {
    const byLevel = (lvl: GoalLevel) => goals.filter((g) => g.level === lvl);
    const yearly = byLevel('yearly');
    // Everything below the top tier, in cascade order — used for the flat list
    // shown when there's no yearly root to hang the tree off.
    const subYearly: Goal[] = LEVEL_ORDER.filter((l) => l !== 'yearly').flatMap(byLevel);

    // Goals not reachable from a visible top-tier goal — surfaced separately so
    // nothing a member is allowed to see ever gets hidden. A goal is linked only
    // when its parent exists AND sits on the tier directly above it, so a stale
    // cross-tier link (e.g. Monthly still pointing at a Yearly) is caught too.
    const idsByLevel = new Map<GoalLevel, Set<string>>(
      LEVEL_ORDER.map((l) => [l, new Set(byLevel(l).map((g) => g.id))]),
    );
    const unlinked = subYearly.filter((g) => {
      const parentLevel = PARENT_LEVEL[g.level];
      if (!g.parent_id || !parentLevel) return true;
      return !idsByLevel.get(parentLevel)!.has(g.parent_id);
    });

    return { yearly, halfYearly: byLevel('half_yearly'), subYearly, unlinked };
  }, [goals]);

  const [selId, setSelId] = React.useState(yearly[0]?.id ?? '');
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  // Pin card tapped → open a readable popup of the full goal.
  const [peek, setPeek] = React.useState<Goal | null>(null);

  // ── Navigation-at-scale state (Board/Manager) ──────────────────────────────
  // Cascade (hierarchy) vs Table (flat, scannable) vs Canvas (one-shot,
  // whole-tree-at-a-glance) view. Remember the last choice per-device; the
  // DB-backed saved views carry the full preset.
  const [viewMode, setViewMode] = React.useState<'cascade' | 'table' | 'canvas'>('cascade');
  React.useEffect(() => {
    const saved = window.localStorage.getItem('goals.viewMode');
    // The pan/zoom canvas is built for a mouse + wide viewport. Don't
    // auto-restore it on a phone-sized screen; cascade reads fine there and
    // the view switcher still lets someone deliberately open canvas.
    const isNarrow = window.matchMedia('(max-width: 768px)').matches;
    if (saved === 'canvas' && isNarrow) return;
    if (saved === 'table' || saved === 'cascade' || saved === 'canvas') setViewMode(saved);
  }, []);
  const chooseView = (v: 'cascade' | 'table' | 'canvas') => {
    setViewMode(v);
    window.localStorage.setItem('goals.viewMode', v);
  };
  // Table grouping + sort (also captured by saved views).
  const [grouping, setGrouping] = React.useState<GoalGrouping>('due');
  const [sort, setSort] = React.useState<{ key: GoalSortKey; dir: 'asc' | 'desc' }>({
    key: 'due',
    dir: 'asc',
  });
  // The goal last jumped to (table row / palette) — drives the breadcrumb.
  const [focused, setFocused] = React.useState<Goal | null>(null);
  // Quick-jump command palette (Cmd/Ctrl+K).
  const [cmdkOpen, setCmdkOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pinned goals (per-user, DB-backed) with optimistic toggling.
  const [pinned, setPinned] = React.useState<Set<string>>(() => new Set(pinnedGoalIds));
  React.useEffect(() => setPinned(new Set(pinnedGoalIds)), [pinnedGoalIds]);
  const togglePin = React.useCallback(
    (g: Goal) => {
      const wasPinned = pinned.has(g.id);
      setPinned((prev) => {
        const n = new Set(prev);
        if (wasPinned) n.delete(g.id);
        else n.add(g.id);
        return n;
      });
      (wasPinned ? removeGoalPin(g.id) : addGoalPin(g.id)).catch((e) => {
        setPinned((prev) => {
          const n = new Set(prev); // revert on failure
          if (wasPinned) n.add(g.id);
          else n.delete(g.id);
          return n;
        });
        toast((e as Error).message || 'Could not update the pin.', 'error');
      });
    },
    [pinned, toast],
  );

  // After a "jump to goal" (from the table or palette) scroll the card into view.
  const [scrollTo, setScrollTo] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!scrollTo) return;
    const el = document.querySelector(`[data-goal-id="${scrollTo}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setScrollTo(null);
  }, [scrollTo, viewMode]);

  // Goal to briefly ring-highlight after a deep-link jump — cleared after the
  // pulse so it can re-trigger on a later notification.
  const [flashId, setFlashId] = React.useState<string | null>(null);
  const [flashReason, setFlashReason] = React.useState<'notif' | 'report'>('notif');
  React.useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 3600);
    return () => clearTimeout(t);
  }, [flashId]);

  // Request to open a specific item's report editor (bumped from "Your day").
  const [reportReq, setReportReq] = React.useState<{ itemId: string; n: number } | null>(null);

  const [showScrollTop, setShowScrollTop] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Board management filters: search + department + status. When any is
  // active the page switches from the cascade view to a flat, department-grouped
  // results list so the Board can manage goals across every team at once. ──
  const [query, setQuery] = React.useState('');
  const [deptFilter, setDeptFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<'all' | GoalStatus>('all');
  const [dueFilter, setDueFilter] = React.useState<'all' | 'overdue' | 'week'>('all');
  const [assigneeFilter, setAssigneeFilter] = React.useState<string>('all');
  const filtersActive =
    query.trim() !== '' ||
    deptFilter !== 'all' ||
    statusFilter !== 'all' ||
    dueFilter !== 'all' ||
    assigneeFilter !== 'all';
  const filtering = isBoard && filtersActive;
  const clearFilters = () => {
    setQuery('');
    setDeptFilter('all');
    setStatusFilter('all');
    setDueFilter('all');
    setAssigneeFilter('all');
  };

  // Shared filter predicate — used both by the flat board-results list and to
  // dim non-matching nodes on the One-Shot canvas (which keeps every node on
  // screen so the tree structure stays intact).
  const isMatch = React.useCallback(
    (g: Goal) => {
      const q = query.trim().toLowerCase();
      if (deptFilter !== 'all' && !goalInDept(g, deptFilter)) return false;
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (dueFilter === 'overdue' && !isOverdue(g)) return false;
      if (dueFilter === 'week' && !dueWithin(g, 6)) return false;
      if (assigneeFilter !== 'all' && !(assigneeIdsByGoal[g.id] ?? []).includes(assigneeFilter))
        return false;
      if (q) {
        const hay = `${g.title} ${plainText(g.description)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    },
    [query, deptFilter, statusFilter, dueFilter, assigneeFilter, assigneeIdsByGoal],
  );

  const results = React.useMemo(() => {
    if (!filtering) return [] as Goal[];
    return goals
      .filter(isMatch)
      .sort((a, b) => {
        // Overdue first, then soonest due date, then tier, then title.
        if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
        const da = daysToDue(a);
        const db = daysToDue(b);
        if (da !== db) return (da ?? Infinity) - (db ?? Infinity);
        return (
          LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
          a.title.localeCompare(b.title)
        );
      });
  }, [filtering, goals, isMatch]);

  // At-a-glance counts for the board health strip.
  const healthCounts = React.useMemo(
    () => ({
      total: goals.length,
      active: goals.filter((g) => g.status === 'active').length,
      inactive: goals.filter((g) => g.status === 'inactive').length,
      achieved: goals.filter((g) => g.status === 'achieved').length,
      notMet: goals.filter((g) => g.status === 'not_met').length,
      overdue: goals.filter(isOverdue).length,
    }),
    [goals],
  );

  // Group results under a department header (with a per-status tally) so the
  // Board can scan one team at a time.
  const resultGroups = React.useMemo(() => {
    const m = new Map<string, Goal[]>();
    for (const g of results) {
      const key = g.department?.trim() || 'Unassigned';
      const arr = m.get(key);
      if (arr) arr.push(g);
      else m.set(key, [g]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [results]);

  // Checklist items that still need today's work report before they can be
  // ticked — used to guide ticks from the "Your day" panel to the goal card.
  const reportLockedItemIds = React.useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(checklistsByGoal)) {
      for (const it of list) {
        if (!it.report_required) continue;
        // Period/carry-over aware so this matches the checklist's tick-gate: a
        // report filed for the item's current window keeps it unlocked (a weekly
        // report doesn't re-lock the item every day of the week).
        const reported = currentReport(
          (reportsByItem[it.id] ?? []).filter((r) => r.user_id === currentUserId),
          it,
        );
        if (!reported) s.add(it.id);
      }
    }
    return s;
  }, [checklistsByGoal, reportsByItem, currentUserId]);

  const sel = yearly.find((g) => g.id === selId) ?? yearly[0] ?? null;

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Ids of goals that have at least one child (the only nodes a cascade can
  // collapse). Drives Collapse-all / Expand-all.
  const parentIds = React.useMemo(() => {
    const withChildren = new Set<string>();
    for (const g of goals) if (g.parent_id) withChildren.add(g.parent_id);
    return [...withChildren];
  }, [goals]);
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(parentIds));

  // Jump to a goal from the table or the command palette: switch to the cascade,
  // select its yearly root, expand the whole path to it, then scroll it in.
  const jumpToGoal = React.useCallback(
    (g: Goal) => {
      const path = goalPath(g, goals);
      const root = path[0];
      chooseView('cascade');
      clearFilters();
      if (root?.level === 'yearly') setSelId(root.id);
      setCollapsed((c) => {
        const n = new Set(c);
        for (const node of path) n.delete(node.id); // open every ancestor
        return n;
      });
      setFocused(g);
      setCmdkOpen(false);
      setScrollTo(g.id);
    },
    // chooseView/clearFilters are stable enough for this handler
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goals],
  );

  // From the "Your day" panel: a member tapped a task that needs a work report
  // first. Jump to its goal card, ring it, and open that item's report editor so
  // they can report right there instead of hunting for the card.
  const openReportForTask = React.useCallback(
    (goalId: string, itemId: string) => {
      const target = goals.find((g) => g.id === goalId);
      if (target) jumpToGoal(target);
      setFlashReason('report');
      setFlashId(goalId);
      setReportReq({ itemId, n: Date.now() });
    },
    [goals, jumpToGoal],
  );

  // Deep-link from a notification: `/goals?goal=<id>` jumps straight to that
  // goal's card (expanding its path + scrolling it in) and rings it. Driven by
  // useSearchParams so it fires even when the bell is clicked while ALREADY on
  // this page (a client-side query change doesn't remount us) — the previous
  // window.location read only ran on mount and silently missed those clicks.
  const searchParams = useSearchParams();
  const goalParam = searchParams.get('goal');
  const handledGoalRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!goalParam) return;
    if (handledGoalRef.current === goalParam) return; // already handled this one
    const target = goals.find((g) => g.id === goalParam);
    if (!target) return; // not loaded / not visible to this viewer yet
    handledGoalRef.current = goalParam;
    jumpToGoal(target);
    setFlashReason('notif');
    setFlashId(goalParam);
    // Strip the param so a later refresh/back doesn't re-jump. replaceState is
    // invisible to useSearchParams, so it won't retrigger this effect; the ref
    // guards the same-value case too.
    const url = new URL(window.location.href);
    url.searchParams.delete('goal');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [goalParam, goals, jumpToGoal]);

  // The live Goals-browser state, as a saveable preset.
  const currentConfig: GoalViewConfig = {
    view: viewMode,
    grouping,
    sort,
    query,
    dept: deptFilter,
    status: statusFilter,
    due: dueFilter,
    assignee: assigneeFilter,
  };
  const applyView = (cfg: GoalViewConfig) => {
    chooseView(cfg.view ?? 'cascade');
    setGrouping(cfg.grouping ?? 'due');
    setSort(cfg.sort ?? { key: 'due', dir: 'asc' });
    setQuery(cfg.query ?? '');
    setDeptFilter(cfg.dept ?? 'all');
    setStatusFilter(cfg.status ?? 'all');
    setDueFilter(cfg.due ?? 'all');
    setAssigneeFilter(cfg.assignee ?? 'all');
  };

  const submitGoal = async (data: GoalSubmit) => {
    setSubmitting(true);
    try {
      if (data.id) {
        const res = await updateGoal(
          data.id,
          {
            level: data.level,
            title: data.title,
            description: data.description,
            due_date: data.dueDate,
            department: data.department,
            departments: data.departments,
            status: data.status,
            progress: data.progress,
            parent_id: data.parentId,
          },
          data.assigneeIds,
          data.checklist,
        );
        // A rejected save keeps the form open with the task's edits intact so
        // the missing department/assignee can be filled in and re-submitted.
        if (!res.ok) {
          toast(res.error || 'Could not save the task.', 'error');
          return;
        }
        toast('Task updated');
      } else {
        const res = await createGoal({
          level: data.level,
          title: data.title,
          description: data.description,
          dueDate: data.dueDate,
          department: data.department,
          departments: data.departments,
          status: data.status,
          progress: data.progress,
          parentId: data.parentId,
          assigneeIds: data.assigneeIds,
          checklist: data.checklist,
        });
        if (!res.ok) {
          toast(res.error || 'Could not create the task.', 'error');
          return;
        }
        toast('Task created');
      }
      setEditing(null);
    } catch (e) {
      toast((e as Error).message || 'Could not save the task.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (g: Goal) => {
    const ok = await confirm({
      title: 'Archive this task?',
      message: 'The task is removed from the cascade. This cannot be undone.',
      confirmLabel: 'Archive task',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    try {
      await deleteGoal(g.id);
      toast('Task archived');
    } catch (e) {
      toast((e as Error).message || 'Could not archive the task.', 'error');
    }
  };

  const saveMv = async () => {
    setSubmitting(true);
    try {
      await saveCompany(mvDraft.mission, mvDraft.vision);
      toast('Mission & vision saved');
      setMvOpen(false);
    } catch (e) {
      toast((e as Error).message || 'Could not save.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const ctx: CardCtx = {
    checklistsByGoal,
    completionsByItem,
    assigneesByGoal,
    assigneeIdsByGoal,
    reportsByItem,
    reviewsByReport,
    reviewerById,
    assignerByGoal,
    reportTemplates,
    currentUserId,
    isBoard,
    canDelete,
    canAdmin,
    members,
    onLeave,
    // Highlight search matches anywhere a query is active (board results or a
    // member searching their own goals).
    highlight: query.trim(),
    pinnedIds: pinned,
    onTogglePin: togglePin,
    flashId,
    flashReason,
    reportReq,
    onSetStatus: async (g, status) => {
      try {
        const res = await updateGoal(g.id, { status });
        if (!res.ok) {
          toast(res.error || 'Could not update the status.', 'error');
          return;
        }
        toast(`Marked “${g.title}” ${STATUS[status].label}`);
      } catch (e) {
        toast((e as Error).message || 'Could not update the status.', 'error');
      }
    },
    onReassign: async (g, userIds) => {
      try {
        const res = await setGoalAssignees(g.id, userIds);
        if (!res.ok) {
          toast(res.error || 'Could not update assignees.', 'error');
          return;
        }
        toast('Assignees updated');
      } catch (e) {
        toast((e as Error).message || 'Could not update assignees.', 'error');
      }
    },
    onSaveTemplate: async (g) => {
      try {
        await createGoalTemplate({
          name: g.title,
          level: g.level,
          department: g.department,
          title: g.title,
          description: g.description,
          checklist: (checklistsByGoal[g.id] ?? []).map((it) => ({
            label: it.label,
            description: it.description || '',
            recurrence: it.recurrence,
            recurDays: it.recur_days || [],
            reportRequired: it.report_required,
          })),
        });
        toast(`Saved “${g.title}” as a template`);
      } catch (e) {
        toast((e as Error).message || 'Could not save the template.', 'error');
      }
    },
    onEdit: (g) => setEditing(g),
    onDuplicate: (g) =>
      setEditing({
        // No id → saves as a new goal. Copy the content; reset progress so the
        // copy starts fresh, and seed the source's assignees + checklist so the
        // Board only has to tweak who it's for.
        level: g.level,
        title: `${g.title} (Copy)`,
        description: g.description,
        due_date: g.due_date,
        department: g.department,
        departments: g.departments,
        status: g.status,
        progress: 0,
        parent_id: g.parent_id,
        _duplicate: true,
        _seedAssignees: assigneeIdsByGoal[g.id] ?? [],
        _seedChecklist: (checklistsByGoal[g.id] ?? []).map((it) => ({
          // Intentionally no `id` — these become new checklist rows on the copy.
          label: it.label,
          description: it.description || '',
          recurrence: it.recurrence,
          recurDays: it.recur_days || [],
          reportRequired: it.report_required,
        })),
      }),
    onDelete: archive,
  };

  const header = (
    <div className="page-header">
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
          <h1 className="page-title">Tasks</h1>
          <span className="page-title" style={{ color: 'var(--color-grey-text)', fontWeight: 400, fontStyle: 'italic' }}>
            We Believe in{' '}
            <span className="text-shine page-title" style={{ fontStyle: 'normal' }}>
              Execution Excellence
            </span>
          </span>
        </div>
        {/* The cascade, as a breadcrumb. Each step carries its own trailing
            arrow inside a nowrap span, so on a narrow screen the line wraps
            BETWEEN steps instead of stranding an arrow at the start of a line
            or splitting "Half-Yearly" across two. */}
        <div className="page-subtitle gb-cascade-path">
          {['Mission', 'Vision', topLabel.replace(' Task', ''), 'Half-Yearly', 'Quarterly', 'Monthly', 'Daily'].map(
            (step, i, all) => (
              <span key={step} className="gb-cascade-step">
                {step}
                {i < all.length - 1 ? <span aria-hidden="true"> → </span> : null}
              </span>
            ),
          )}
        </div>
      </div>
      {isBoard ? (
        <div className="page-header-actions">
          {canAdmin ? (
            <>
              <Button variant="secondary" icon="edit" onClick={() => setMvOpen(true)}>
                Mission &amp; vision
              </Button>
              <Button variant="secondary" icon="copy" onClick={() => setTplOpen(true)}>
                Templates
              </Button>
              <Button variant="secondary" icon="edit" onClick={() => setRtOpen(true)}>
                Report templates
              </Button>
            </>
          ) : null}
          {FEATURE_FLAGS.goalsCleanup && canDelete ? (
            <Button variant="secondary" icon="archive" onClick={() => setCleanupOpen(true)}>
              Clean up
            </Button>
          ) : null}
          {/* Monthly is the default new-task tier: it's the lowest tier that
              still groups work, so it's what the Board reaches for most. */}
          <Button icon="plus" onClick={() => setEditing({ level: 'monthly' })}>
            Add Task
          </Button>
        </div>
      ) : null}
    </div>
  );

  // "Your day" — the current user's due-today tasks across all their goals.
  // Self-hides when there's nothing due; useful to members and assigned board.
  const myToday = (
    <MyTodayPanel
      goals={goals}
      checklistsByGoal={checklistsByGoal}
      completionsByItem={completionsByItem}
      assigneeIdsByGoal={assigneeIdsByGoal}
      currentUserId={currentUserId}
      reportLockedItemIds={reportLockedItemIds}
      onReportTask={openReportForTask}
    />
  );

  const missionVision = (
    <div className="mv-grid">
      <div className="card mission-card">
        <div className="mv-label mission-label">Mission</div>
        <div className="mv-text goal-desc">
          {mission || <span className="mv-empty">Not set yet.</span>}
        </div>
      </div>
      <div className="card vision-card">
        <div className="mv-label text-green">Vision</div>
        <div className="mv-text goal-desc">
          {vision || <span className="text-grey">Not set yet.</span>}
        </div>
      </div>
    </div>
  );

  // Navigation controls — the Cascade/Table/One-Shot view switch + "Jump to
  // goal" quick-jump. Available to members too (they only ever see their own
  // goals); Saved Views stays a Board management feature. Extracted so both the
  // main cascade return and the no-yearly flat return can render it.
  const navControls = (
    <div className="gb-nav-controls">
      <div className="gb-viewswitch" role="group" aria-label="Tasks view">
        <button
          type="button"
          className={`gb-viewswitch-btn${viewMode === 'cascade' ? ' active' : ''}`}
          onClick={() => chooseView('cascade')}
          aria-pressed={viewMode === 'cascade'}
        >
          <Icon name="layers" size={14} /> Cascade
        </button>
        <button
          type="button"
          className={`gb-viewswitch-btn${viewMode === 'table' ? ' active' : ''}`}
          onClick={() => chooseView('table')}
          aria-pressed={viewMode === 'table'}
        >
          <Icon name="list" size={14} /> Table
        </button>
        <button
          type="button"
          className={`gb-viewswitch-btn${viewMode === 'canvas' ? ' active' : ''}`}
          onClick={() => chooseView('canvas')}
          aria-pressed={viewMode === 'canvas'}
          title="Whole task tree on one screen. Zoom and pan, no scrolling"
        >
          <Icon name="network" size={14} /> One-Shot
        </button>
      </div>
      <button type="button" className="gb-cmdk-trigger" onClick={() => setCmdkOpen(true)}>
        <Icon name="search" size={14} /> Jump to task
        <kbd className="gb-kbd">Ctrl K</kbd>
      </button>
      {isBoard ? (
        <SavedViewsMenu
          views={savedViews}
          current={currentConfig}
          onApply={applyView}
          onError={(m) => toast(m, 'error')}
        />
      ) : null}
    </div>
  );

  const commandPalette = (
    <GoalCommandPalette
      open={cmdkOpen}
      goals={goals}
      onClose={() => setCmdkOpen(false)}
      onJump={jumpToGoal}
    />
  );

  const modals = (
    <>
      <Modal
        open={!!editing}
        onClose={() => (submitting ? null : setEditing(null))}
        disableBackdropClose
        title={
          editing?._template
            ? 'New task from template'
            : editing?._duplicate
              ? 'Duplicate task'
              : editing && editing.id
                ? 'Edit task'
                : 'Add task'
        }
        subtitle={
          editing?._template
            ? 'Prefilled from your template. Pick the assignees and due date, then save.'
            : editing?._duplicate
              ? 'A fresh copy. Change the assignees (and anything else), then save.'
              : 'One form for every tier: Yearly, Half-Yearly, Quarterly, Monthly or Daily.'
        }
        width={620}
      >
        {editing ? (
          <GoalForm
            key={editing.id || (editing._duplicate ? 'dup' : editing._template ? 'tpl' : 'new')}
            initial={editing}
            parents={allGoals}
            departments={departments}
            members={members}
            multiDept={canAdmin}
            initialAssignees={
              editing._duplicate || editing._template
                ? editing._seedAssignees ?? []
                : editing.id
                  ? assigneeIdsByGoal[editing.id] || []
                  : []
            }
            initialChecklist={
              editing._duplicate || editing._template
                ? editing._seedChecklist ?? []
                : editing.id
                  ? (checklistsByGoal[editing.id] || []).map((it) => ({
                      id: it.id,
                      label: it.label,
                      description: it.description || '',
                      recurrence: it.recurrence,
                      recurDays: it.recur_days || [],
                      reportRequired: it.report_required,
                    }))
                  : []
            }
            onSubmit={submitGoal}
            onCancel={() => setEditing(null)}
            submitting={submitting}
          />
        ) : null}
      </Modal>

      <Modal
        open={mvOpen}
        onClose={() => (submitting ? null : setMvOpen(false))}
        title="Mission & vision"
        subtitle="The timeless why and this year's destination."
      >
        <div className="grid gap-3">
          <Field label="Mission (timeless)">
            <textarea
              className="textarea"
              rows={2}
              value={mvDraft.mission}
              onChange={(e) => setMvDraft((c) => ({ ...c, mission: e.target.value }))}
            />
          </Field>
          <Field label="Vision (this year)">
            <textarea
              className="textarea"
              rows={2}
              value={mvDraft.vision}
              onChange={(e) => setMvDraft((c) => ({ ...c, vision: e.target.value }))}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setMvOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button icon="check" onClick={saveMv} disabled={submitting}>
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        title="Task templates"
        subtitle="Reusable blueprints. Spin up a task, then pick its assignees."
        width={520}
      >
        {goalTemplates.length === 0 ? (
          <EmptyState
            icon="copy"
            title="No templates yet"
            hint="On any task, open the ⋮ menu and choose “Save as template”. It’ll show up here for the whole Board to reuse."
          />
        ) : (
          <div className="gb-tpl-list">
            {goalTemplates.map((t) => (
              <div key={t.id} className="gb-tpl-row">
                <div className="gb-tpl-main">
                  <div className="gb-tpl-name">{t.name}</div>
                  <div className="gb-tpl-meta">
                    {LEVEL_META[t.level].label}
                    {t.department ? ` · ${t.department}` : ''} · {t.checklist.length} checklist item
                    {t.checklist.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    setEditing({
                      level: t.level,
                      title: t.title,
                      description: t.description,
                      department: t.department,
                      status: 'active',
                      progress: 0,
                      _template: true,
                      _seedAssignees: [],
                      _seedChecklist: t.checklist.map((c) => ({ ...c })),
                    });
                    setTplOpen(false);
                  }}
                >
                  Use
                </Button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Delete template"
                  title="Delete template"
                  onClick={async () => {
                    try {
                      await deleteGoalTemplate(t.id);
                    } catch (e) {
                      toast((e as Error).message || 'Could not delete the template.', 'error');
                    }
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={rtOpen}
        onClose={() => setRtOpen(false)}
        title="Report templates"
        subtitle="The shape members should follow when they report work, one per department. Shown prefilled when a member reports on a Report Work task."
        width={560}
      >
        {departments.length === 0 ? (
          <EmptyState
            icon="building"
            title="No departments yet"
            hint="Add members with departments first. Each department gets its own reporting template."
          />
        ) : (
          <div className="rt-tpl-list">
            {departments.map((d) => (
              <ReportTemplateEditorRow
                key={d}
                department={d}
                initialBody={reportTemplates[d] ?? ''}
              />
            ))}
          </div>
        )}
      </Modal>

      {FEATURE_FLAGS.goalsCleanup ? (
        <GoalsCleanup
          open={cleanupOpen}
          onClose={() => setCleanupOpen(false)}
          goals={allGoals}
          archivedGoals={archivedGoals}
          assigneesByGoal={assigneesByGoal}
          checklistsByGoal={checklistsByGoal}
        />
      ) : null}

      <Modal
        open={!!peek}
        onClose={() => setPeek(null)}
        title={peek?.title ?? ''}
        width={560}
      >
        {peek ? (
          <div className="gb-peek">
            <span className={`badge ${STATUS[peek.status].cls}`} style={{ alignSelf: 'flex-start' }}>
              {STATUS[peek.status].label}
            </span>
            {peek.description ? (
              <div className="gb-peek-desc">
                <RichText value={peek.description} />
              </div>
            ) : (
              <p className="gb-peek-empty">No description yet.</p>
            )}
            {(() => {
              const pct = peek.progress ?? 0;
              const C = 2 * Math.PI * 26; // ring circumference (r=26)
              const milestones = halfYearly.filter((h) => h.parent_id === peek.id).length;
              return (
                <div className="gb-peek-summary">
                  <div className="gb-peek-ring" role="img" aria-label={`${pct}% complete`}>
                    <svg viewBox="0 0 64 64">
                      <circle className="gb-peek-ring-track" cx="32" cy="32" r="26" />
                      <circle
                        className="gb-peek-ring-fill"
                        cx="32"
                        cy="32"
                        r="26"
                        style={{ strokeDasharray: C, strokeDashoffset: C * (1 - pct / 100) }}
                      />
                    </svg>
                    <span className="gb-peek-ring-pct">{pct}%</span>
                  </div>
                  <div className="gb-peek-meta">
                    <div className="gb-peek-meta-row">
                      <Icon name="flag" size={15} />
                      <span>
                        <strong>{milestones}</strong> milestone{milestones !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {peek.due_date ? (
                      <div className="gb-peek-meta-row">
                        <Icon name="calendar" size={15} />
                        <span>{dueLine(peek)}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })()}
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setPeek(null)}>
                Close
              </Button>
              {isBoard ? (
                <Button
                  icon="edit"
                  onClick={() => {
                    setEditing(peek);
                    setPeek(null);
                  }}
                >
                  Edit task
                </Button>
              ) : (
                <Button
                  icon="layers"
                  onClick={() => {
                    const g = peek;
                    setPeek(null);
                    if (g) jumpToGoal(g);
                  }}
                >
                  Go to task
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
      {showScrollTop ? (
        <button
          type="button"
          className="scroll-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          title="Back to top"
        >
          <svg
            className="scroll-top-svg"
            width="20"
            height="24"
            viewBox="0 0 20 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3,11 10,3 17,11" />
            <line x1="10" y1="3" x2="10" y2="21" />
          </svg>
        </button>
      ) : null}
    </>
  );

  // Nothing to show at all.
  if (goals.length === 0) {
    return (
      <div>
        {header}
        {missionVision}
        <EmptyState
          icon="target"
          title="No tasks yet"
          hint={
            isBoard
              ? 'Click "Add Task" to create the first one.'
              : 'No tasks have been assigned to you or your department yet.'
          }
        />
        {modals}
      </div>
    );
  }

  // No top-tier goals visible — board gets the empty pinboard; members get a flat
  // list. Only for the cascade view: in Table / One-Shot the main return below
  // renders those (they don't need a yearly root), so let them fall through.
  if (yearly.length === 0 && viewMode === 'cascade') {
    const flat = subYearly;
    const memberQ = !isBoard ? query.trim().toLowerCase() : '';
    const flatShown = memberQ
      ? flat.filter((g) => `${g.title} ${plainText(g.description)}`.toLowerCase().includes(memberQ))
      : flat;
    return (
      <div>
        {header}
        {missionVision}
        {myToday}
        {navControls}
        {isBoard ? (
          <>
            <div className="gb-section-head">
              <h2 className="gb-section-title">Yearly Tasks</h2>
              <p className="gb-section-sub">Pin your big yearly tasks here. Click a card to drill into the breakdown.</p>
            </div>
            <div className="gb-pinboard-wrap">
              <div className="gb-pinboard">
                <button
                  type="button"
                  className="gb-pin-add"
                  onClick={() => setEditing({ level: 'yearly' })}
                >
                  <div className="gb-pin-add-icon">+</div>
                  New Yearly Task
                </button>
              </div>
            </div>
          </>
        ) : null}
        {flat.length > 0 ? (
          <>
            <div className="gb-section-head">
              <h2 className="gb-section-title">
                {isBoard ? 'Unlinked Tasks' : 'Your tasks'}
              </h2>
              <p className="gb-section-sub">
                {isBoard
                  ? 'These tasks exist but are not anchored to a yearly task yet.'
                  : 'Tasks assigned to you or your department.'}
              </p>
            </div>
            {isBoard ? (
              <div className="gb-unlinked-banner">
                <div className="gb-unlinked-icon">⚠</div>
                <div className="gb-unlinked-text">
                  <div className="gb-unlinked-title">Tasks without a yearly anchor</div>
                  <div className="gb-unlinked-sub">
                    Create a yearly task on the pinboard above, then edit each task below and set its parent to link it into the cascade.
                  </div>
                </div>
                <div className="gb-unlinked-count">{flat.length}</div>
              </div>
            ) : null}
            {!isBoard ? <MemberSearchBar query={query} setQuery={setQuery} /> : null}
            {flatShown.length > 0 ? (
              <div className="grid gap-3">
                {flatShown.map((g) => (
                  <GoalCard key={g.id} goal={g} ctx={ctx} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="search"
                title="No tasks match"
                hint="Try a different word, or clear the search."
              />
            )}
          </>
        ) : null}
        {modals}
        {commandPalette}
      </div>
    );
  }

  // Stats across the whole subtree of the selected top goal.
  const subtreeOf = (root: Goal): Goal[] => {
    const out: Goal[] = [];
    const walk = (pid: string) => {
      for (const g of goals) {
        if (g.parent_id === pid) {
          out.push(g);
          walk(g.id);
        }
      }
    };
    walk(root.id);
    return out;
  };
  const subtree = sel ? subtreeOf(sel) : [];
  const branches = sel ? halfYearly.filter((h) => h.parent_id === sel.id) : [];
  const achievedUnder = subtree.filter((g) => g.status === 'achieved').length;

  return (
    <div>
      {header}
      {missionVision}
      {myToday}

      {/* Board-only management toolbar — search across teams, filter by
          department and status. */}
      {isBoard ? (
        <BoardGoalsToolbar
          query={query}
          setQuery={setQuery}
          dept={deptFilter}
          setDept={setDeptFilter}
          status={statusFilter}
          setStatus={setStatusFilter}
          due={dueFilter}
          setDue={setDueFilter}
          assignee={assigneeFilter}
          setAssignee={setAssigneeFilter}
          departments={departments}
          members={members}
          filtersActive={filtersActive}
          onClear={clearFilters}
        />
      ) : null}

      {navControls}

      {/* One-Shot view: the entire tree as a single zoomable canvas — no scrolling. */}
      {viewMode === 'canvas' ? (
        <>
          <GoalsCanvas
            goals={goals}
            onOpen={setPeek}
            query={query}
            dept={deptFilter}
            status={statusFilter}
            due={dueFilter}
            assignee={assigneeFilter}
            isMatch={isMatch}
          />
          {modals}
          {commandPalette}
        </>
      ) : /* Table view: one scannable, grouped, sortable surface for many goals. */
      viewMode === 'table' ? (
        <>
          <GoalsTable
            goals={goals}
            assigneesByGoal={assigneesByGoal}
            query={query}
            dept={deptFilter}
            status={statusFilter}
            due={dueFilter}
            assignee={assigneeFilter}
            grouping={grouping}
            setGrouping={setGrouping}
            sort={sort}
            setSort={setSort}
            pinned={pinned}
            onTogglePin={togglePin}
            onOpen={jumpToGoal}
          />
          {modals}
          {commandPalette}
        </>
      ) : filtering ? (
        <>
          <BoardGoalsResults
            groups={resultGroups}
            total={results.length}
            ctx={ctx}
            onClear={clearFilters}
          />
          {modals}
          {commandPalette}
        </>
      ) : (
        <>
      {isBoard ? (
        <div className="gb-cascade-tools">
          {focused ? (
            <nav className="gb-breadcrumb" aria-label="Task path">
              {goalPath(focused, goals).map((c, i, arr) => (
                <React.Fragment key={c.id}>
                  <button
                    type="button"
                    className={`gb-crumb${c.id === focused.id ? ' current' : ''}`}
                    onClick={() => jumpToGoal(c)}
                  >
                    {c.title}
                  </button>
                  {i < arr.length - 1 ? <Icon name="chevron-right" size={12} /> : null}
                </React.Fragment>
              ))}
            </nav>
          ) : (
            <span className="gb-cascade-hint">Pick a {topLabel.toLowerCase()} below to drill in.</span>
          )}
          {parentIds.length > 0 ? (
            <span className="gb-cascade-foldbtns">
              <button type="button" className="gb-foldbtn" onClick={expandAll}>
                <Icon name="chevron-down" size={13} /> Expand all
              </button>
              <button type="button" className="gb-foldbtn" onClick={collapseAll}>
                <Icon name="chevron-right" size={13} /> Collapse all
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {isBoard ? (
        <BoardHealthStrip
          counts={healthCounts}
          onStatus={setStatusFilter}
          onOverdue={() => setDueFilter('overdue')}
        />
      ) : null}
      <div className="gb-section-head">
        <h2 className="gb-section-title">Task breakdown</h2>
        <p className="gb-section-sub">
          Pick a {topLabel.toLowerCase()} to see how it breaks down into half-yearly,
          quarterly, monthly and daily tasks.
        </p>
      </div>

      {/* ── Board: pinboard canvas of yearly goals ── */}
      {isBoard ? (
        <div className="gb-pinboard-wrap">
          <div className="gb-pinboard">
            {yearly.map((y, i) => {
              const yBranches = halfYearly.filter((h) => h.parent_id === y.id);
              const isSelected = sel?.id === y.id;
              const rot = i % 3 === 0 ? -1.5 : i % 3 === 1 ? 1.2 : -0.7;
              return (
                <button
                  key={y.id}
                  type="button"
                  className={`gb-pin-card gb-pin-status-${y.status}${isSelected ? ' gb-pin-selected' : ''}`}
                  style={{ transform: isSelected ? 'rotate(0deg)' : `rotate(${rot}deg)` }}
                  onClick={() => setSelId(y.id)}
                >
                  <div className="gb-pin-head" />
                  <div className="gb-pin-title">{y.title}</div>
                  <span className={`badge ${STATUS[y.status].cls}`} style={{ alignSelf: 'flex-start' }}>
                    {STATUS[y.status].label}
                  </span>
                  {y.description ? (
                    <div className="gb-pin-desc">
                      <RichText value={y.description} />
                    </div>
                  ) : null}
                  <div className="gb-pin-progress">
                    <div className="gb-pin-meta">
                      <span>{yBranches.length} milestone{yBranches.length !== 1 ? 's' : ''}</span>
                      <span className="gb-pin-pct">{y.progress ?? 0}%</span>
                    </div>
                    <div className="gb-pin-bar">
                      <div className="gb-pin-fill" style={{ width: `${y.progress ?? 0}%` }} />
                    </div>
                    {y.due_date ? <div className="gb-pin-due">{dueLine(y)}</div> : null}
                  </div>
                  <div className="gb-pin-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="gb-pin-action-btn"
                      aria-label="View task"
                      title="View task"
                      onClick={() => setPeek(y)}
                    >
                      <Icon name="eye" size={13} />
                    </button>
                    <button
                      type="button"
                      className="gb-pin-action-btn"
                      aria-label="Edit task"
                      onClick={() => ctx.onEdit(y)}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      className="gb-pin-action-btn danger"
                      aria-label="Delete task"
                      onClick={() => ctx.onDelete(y)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              className="gb-pin-add"
              onClick={() => setEditing({ level: 'yearly' })}
            >
              <div className="gb-pin-add-icon">+</div>
              New Yearly Task
            </button>
          </div>
        </div>
      ) : (
        /* ── Non-board: original pill selector ── */
        yearly.length > 1 ? (
          <div className="gb-switch">
            {yearly.map((y) => (
              <button
                key={y.id}
                type="button"
                className={`gb-pill ${sel?.id === y.id ? 'active' : ''}`}
                onClick={() => setSelId(y.id)}
              >
                <span className="gb-pill-title">{y.title}</span>
                <span className="gb-pill-pct">{y.progress || 0}%</span>
              </button>
            ))}
          </div>
        ) : null
      )}

      {sel ? (
        <div className="gb-flow">
          {/* For non-board, keep the hero card; board sees the pinboard above */}
          {!isBoard ? (
            <GoalCard
              goal={sel}
              ctx={ctx}
              extra={
                <div className="gb-stats">
                  <div>
                    <div className="gb-stat-num">{branches.length}</div>
                    <div className="gb-stat-lbl">Half-yearly milestones</div>
                  </div>
                  <div>
                    <div className="gb-stat-num">{subtree.length}</div>
                    <div className="gb-stat-lbl">Sub-tasks</div>
                  </div>
                  <div>
                    <div className="gb-stat-num">{achievedUnder}</div>
                    <div className="gb-stat-lbl">Completed</div>
                  </div>
                </div>
              }
            />
          ) : (
            /* Board: show a slim breakdown header instead of the full hero card */
            <div className="gb-breakdown-head">
              <span className="gb-breakdown-label">Breakdown</span>
              <span className="gb-breakdown-title">{sel.title}</span>
            </div>
          )}

          {branches.length === 0 ? (
            <div className="gb-empty-branch">
              No half-yearly milestones under this task yet.
              {isBoard ? ' Add one with "Add Task".' : ''}
            </div>
          ) : (
            <div className="gb-children">
              {branches.map((m) => (
                <GoalNode
                  key={m.id}
                  goal={m}
                  goals={goals}
                  ctx={ctx}
                  collapsed={collapsed}
                  toggle={toggle}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {unlinked.length > 0 ? (
        <div className="mt-8">
          <div className="gb-section-head">
            <h2 className="gb-section-title">Unlinked Tasks</h2>
            <p className="gb-section-sub">These tasks are not connected to any {topLabel.toLowerCase()}.</p>
          </div>
          {isBoard ? (
            <div className="gb-unlinked-banner">
              <div className="gb-unlinked-icon">⚠</div>
              <div className="gb-unlinked-text">
                <div className="gb-unlinked-title">Tasks without a yearly anchor</div>
                <div className="gb-unlinked-sub">
                  Edit each task below and set its parent to link it into the cascade under a yearly task on the pinboard.
                </div>
              </div>
              <div className="gb-unlinked-count">{unlinked.length}</div>
            </div>
          ) : null}
          <div className="grid gap-3">
            {/* GoalNode (not GoalCard) so an orphan mid-tier task still renders
                its child tier — otherwise a deep-link to a child of an unlinked
                parent (e.g. a monthly under a yearless quarterly) has nothing to
                scroll to. */}
            {unlinked.map((g) => (
              <GoalNode
                key={g.id}
                goal={g}
                goals={goals}
                ctx={ctx}
                collapsed={collapsed}
                toggle={toggle}
              />
            ))}
          </div>
        </div>
      ) : null}

      {modals}
      {commandPalette}
        </>
      )}
    </div>
  );
}
