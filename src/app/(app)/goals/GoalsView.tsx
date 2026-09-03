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
//
// The card cluster (GoalCard / GoalNode / BoardChecklistPanel / …), the Board
// toolbar + health strip, the department-grouped results list, and the report
// template row all live in sibling files now; this file owns the page shell,
// its state, and the modals. Shared card types live in ./card-context.
import * as React from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { EmptyState, Button, Modal, Field } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { type ReviewerInfo } from '@/components/WorkReportReview';
import { MyTodayPanel } from '@/components/MyTodayPanel';
import { RichText } from '@/components/RichTextEditor';
import type { AssignableMember, GoalSubmit, ChecklistRow } from './GoalForm';
import {
  createGoal,
  updateGoal,
  deleteGoal,
  saveCompany,
  setGoalAssignees,
  createGoalTemplate,
  deleteGoalTemplate,
  addGoalPin,
  removeGoalPin,
} from '@/lib/actions';
import { currentReport } from '@/lib/recurrence';
import { type GoalTemplate } from '@/lib/goal-templates';
import {
  STATUS,
  LEVEL_META,
  LEVEL_ORDER,
  PARENT_LEVEL,
  plainText,
  daysToDue,
  isOverdue,
  dueWithin,
  dueLine,
  goalInDept,
  deriveGoalStatus,
} from './goal-ui';
import { goalPath } from '@/lib/goal-buckets';
import { SavedViewsMenu } from './SavedViewsMenu';
import { TaskCardGuide } from './TaskCardGuide';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import {
  type AssigneeChip,
  type AssignerInfo,
  type CardCtx,
} from './card-context';
import { GoalCard, GoalNode } from './GoalCard';
import { MemberSearchBar, BoardGoalsToolbar, BoardHealthStrip } from './board-toolbar';
import { BoardGoalsResults } from './BoardGoalsResults';
import { ReportTemplateEditorRow } from './ReportTemplateEditorRow';
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

// Re-exported so existing importers (page.tsx, GoalsTable, GoalsCleanup) keep
// resolving `import type { AssigneeChip } from './GoalsView'` unchanged.
export type { AssigneeChip, AssignerInfo } from './card-context';

// Heavy, mount-on-demand pieces — the add/edit form, the Table and One-Shot
// views, the cleanup modal and the Ctrl-K palette. None render on the first
// paint (all gated behind a viewer action or a non-cascade view), so
// code-splitting them keeps that first paint's JS to the cascade path only.
const LazyFallback = ({ label }: { label: string }) => (
  <div className="text-sm text-grey" style={{ padding: 24 }}>
    {label}
  </div>
);
const GoalForm = dynamic(() => import('./GoalForm').then((m) => m.GoalForm), {
  loading: () => <LazyFallback label="Loading form…" />,
});
const GoalsTable = dynamic(() => import('./GoalsTable').then((m) => m.GoalsTable), {
  loading: () => <LazyFallback label="Loading table…" />,
});
const GoalsCanvas = dynamic(() => import('./GoalsCanvas').then((m) => m.GoalsCanvas), {
  loading: () => <LazyFallback label="Loading canvas…" />,
});
const GoalCommandPalette = dynamic(() =>
  import('./GoalCommandPalette').then((m) => m.GoalCommandPalette),
);
const GoalsCleanup = dynamic(() => import('./GoalsCleanup').then((m) => m.GoalsCleanup));

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

export function GoalsView({
  goals,
  allGoals,
  archivedGoals,
  mission,
  vision,
  isBoard,
  canDelete,
  canAdmin,
  canUseTemplates,
  selfManage,
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
  canUseTemplates: boolean;
  selfManage: boolean;
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
  // Start with the whole cascade folded. A founder's tree can run to hundreds
  // of nodes, and GoalNode mounts a branch's descendant cards only once it's
  // open — so an all-expanded default was mounting every GoalCard (each with
  // its progress math, rich-text bodies and per-member checklist panel) on the
  // first paint, which is what made this page take minutes to load. Drilling in
  // still works: toggle, Expand-all, jump-to-task and the ?goal= deep-link all
  // open nodes on demand.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => {
    const withChildren = new Set<string>();
    for (const g of goals) if (g.parent_id) withChildren.add(g.parent_id);
    return withChildren;
  });
  // The Unlinked list and the no-yearly flat list render one full GoalCard per
  // goal. When the cascade is flat — every task hung straight off nothing —
  // that is hundreds of cards, and mounting them all is the slow path. Grow the
  // list in pages instead; a jump-to-task / deep-link raises the ceiling itself.
  const LIST_PAGE = 20;
  const LIST_STEP = 40;
  const [listLimit, setListLimit] = React.useState(LIST_PAGE);
  const showMoreBtn = (total: number) => {
    if (total <= listLimit) return null;
    const shown = Math.min(listLimit, total);
    const remaining = total - shown;
    const nextChunk = Math.min(LIST_STEP, remaining);
    const pct = Math.round((shown / total) * 100);
    return (
      <div className="gb-loadmore">
        <div className="gb-loadmore-info">
          <span className="gb-loadmore-count">
            Showing <strong>{shown}</strong> of <strong>{total}</strong> tasks
          </span>
          <span className="gb-loadmore-track">
            <span className="gb-loadmore-fill" style={{ width: `${pct}%` }} />
          </span>
        </div>
        <div className="gb-loadmore-actions">
          <button
            type="button"
            className="gb-loadmore-btn"
            onClick={() => setListLimit((n) => n + LIST_STEP)}
          >
            <Icon name="chevron-down" size={16} />
            Show {nextChunk} more
          </button>
          {remaining > nextChunk ? (
            <button
              type="button"
              className="gb-loadmore-all"
              onClick={() => setListLimit(Number.MAX_SAFE_INTEGER)}
            >
              Show all {total}
            </button>
          ) : null}
        </div>
      </div>
    );
  };
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

  // The add/edit form is code-split (it never renders on first paint), but
  // anyone who can create a task is likely to. Warm its chunk once the page is
  // idle so "Add task" / the edit pencil open with no "Loading form…" flash.
  React.useEffect(() => {
    if (!isBoard && !selfManage) return;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void) => number;
    };
    const run = () => void import('./GoalForm');
    if (w.requestIdleCallback) w.requestIdleCallback(run);
    else {
      const t = setTimeout(run, 1500);
      return () => clearTimeout(t);
    }
  }, [isBoard, selfManage]);

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
      // The chips filter on the DERIVED status, so All / Active / Not-Active /
      // Completed / Not met always agree with the badge on the card.
      if (statusFilter !== 'all' && deriveGoalStatus(g) !== statusFilter) return false;
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
      active: goals.filter((g) => deriveGoalStatus(g) === 'active').length,
      inactive: goals.filter((g) => deriveGoalStatus(g) === 'inactive').length,
      achieved: goals.filter((g) => deriveGoalStatus(g) === 'achieved').length,
      notMet: goals.filter((g) => deriveGoalStatus(g) === 'not_met').length,
      overdue: goals.filter((g) => isOverdue(g)).length,
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

  // parent id -> its direct children, built once. GoalNode used to re-scan the
  // full goals array on every render to find its children (O(n) per node); with
  // this map each lookup is O(1).
  const childrenByParent = React.useMemo(() => {
    const m = new Map<string, Goal[]>();
    for (const g of goals) {
      if (!g.parent_id) continue;
      const arr = m.get(g.parent_id);
      if (arr) arr.push(g);
      else m.set(g.parent_id, [g]);
    }
    return m;
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
      // The target may sit past the paged list ceiling (Unlinked / flat views) —
      // lift it so the card is actually mounted for scrollTo to find.
      setListLimit(Number.MAX_SAFE_INTEGER);
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
    canUseTemplates,
    selfManage,
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
          // The shared checklist is the blueprint. A member's personal steps
          // are their own note to themselves and don't travel with the task.
          checklist: (checklistsByGoal[g.id] ?? []).filter((it) => !it.owner_id).map((it) => ({
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
        _seedChecklist: (checklistsByGoal[g.id] ?? []).filter((it) => !it.owner_id).map((it) => ({
          // Intentionally no `id` — these become new checklist rows on the copy.
          // Personal steps stay with their author and are not copied over.
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
      {isBoard || selfManage ? (
        <div className="page-header-actions">
          {canAdmin ? (
            <Button variant="secondary" icon="edit" onClick={() => setMvOpen(true)}>
              Mission &amp; vision
            </Button>
          ) : null}
          {/* The task-template library is open to every member — anyone can
              build up the shared blueprints and spin a task up from one. */}
          <Button variant="secondary" icon="copy" onClick={() => setTplOpen(true)}>
            Templates
          </Button>
          {canAdmin ? (
            <Button variant="secondary" icon="edit" onClick={() => setRtOpen(true)}>
              Report templates
            </Button>
          ) : null}
          {FEATURE_FLAGS.goalsCleanup && canDelete ? (
            <Button variant="secondary" icon="archive" onClick={() => setCleanupOpen(true)}>
              Clean up
            </Button>
          ) : null}
          {/* Monthly is the default new-task tier: it's the lowest tier that
              still groups work, so it's what the Board reaches for most. An
              executive starts on Daily instead — the tier their own work
              actually lands on — though the form still offers all five. */}
          <Button
            icon="plus"
            onClick={() => setEditing({ level: selfManage ? 'daily' : 'monthly' })}
          >
            {selfManage ? 'Add my task' : 'Add Task'}
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
      {/* Sits beside "Jump to task" rather than off at the right edge: it reads
          as a labelled thing to open, not a "?" nobody clicks. Deliberately
          outside the isBoard check below — a member reading the cascade is
          exactly who needs to know why a card turned orange. */}
      <TaskCardGuide />
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

  // Only mounted once opened, so its chunk isn't fetched until Ctrl-K is used.
  const commandPalette = cmdkOpen ? (
    <GoalCommandPalette
      open
      goals={goals}
      onClose={() => setCmdkOpen(false)}
      onJump={jumpToGoal}
    />
  ) : null;

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
                  ? (checklistsByGoal[editing.id] || [])
                      // Personal items belong to the member who wrote them, not
                      // to this form. Showing them would let a save rename or
                      // drop somebody else's step; syncChecklist skips them on
                      // the server for the same reason.
                      .filter((it) => !it.owner_id)
                      .map((it) => ({
                      id: it.id,
                      label: it.label,
                      description: it.description || '',
                      recurrence: it.recurrence,
                      recurDays: it.recur_days || [],
                      reportRequired: it.report_required,
                    }))
                  : []
            }
            selfAssignee={selfManage ? members[0] : undefined}
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
                {canAdmin || t.createdBy === currentUserId ? (
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
                ) : null}
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

      {FEATURE_FLAGS.goalsCleanup && cleanupOpen ? (
        <GoalsCleanup
          open
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
            <span
              className={`badge ${STATUS[deriveGoalStatus(peek)].cls}`}
              style={{ alignSelf: 'flex-start' }}
            >
              {STATUS[deriveGoalStatus(peek)].label}
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
    // The Board's own search/department/status/due filters drive this list too,
    // now that the toolbar is rendered here — `results` is the same filtered,
    // sorted set the main layout uses. Without this the controls would render
    // but do nothing on the one screen that shows them.
    const flatShown = isBoard
      ? filtersActive
        ? results
        : flat
      : memberQ
        ? flat.filter((g) =>
            `${g.title} ${plainText(g.description)}`.toLowerCase().includes(memberQ),
          )
        : flat;
    return (
      <div>
        {header}
        {missionVision}
        {myToday}
        {/* A Director whose departments hold no YEARLY task lands here — and
            used to lose the whole management surface with it: no search, no
            department/status/due filters, no health strip. Nothing about having
            no top-tier task makes those irrelevant, and scoping Directors to
            their own departments (0065) is what started routing a real Director
            down this branch. Mirror the main layout's order: toolbar, nav
            controls, health strip. */}
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
        {isBoard ? (
          <BoardHealthStrip
            counts={healthCounts}
            onStatus={setStatusFilter}
            onOverdue={() => setDueFilter('overdue')}
          />
        ) : null}
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
              <>
              <div className="grid gap-3">
                {flatShown.slice(0, listLimit).map((g) => (
                  <GoalCard key={g.id} goal={g} ctx={ctx} />
                ))}
              </div>
              {showMoreBtn(flatShown.length)}
              </>
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
  const achievedUnder = subtree.filter((g) => deriveGoalStatus(g) === 'achieved').length;

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
                  className={`gb-pin-card gb-pin-status-${deriveGoalStatus(y)}${
                    isSelected ? ' gb-pin-selected' : ''
                  }`}
                  style={{ transform: isSelected ? 'rotate(0deg)' : `rotate(${rot}deg)` }}
                  onClick={() => setSelId(y.id)}
                >
                  <div className="gb-pin-head" />
                  <div className="gb-pin-title">{y.title}</div>
                  <span
                    className={`badge ${STATUS[deriveGoalStatus(y)].cls}`}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {STATUS[deriveGoalStatus(y)].label}
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
                  childrenByParent={childrenByParent}
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
            {unlinked.slice(0, listLimit).map((g) => (
              <GoalNode
                key={g.id}
                goal={g}
                childrenByParent={childrenByParent}
                ctx={ctx}
                collapsed={collapsed}
                toggle={toggle}
              />
            ))}
          </div>
          {showMoreBtn(unlinked.length)}
        </div>
      ) : null}

      {modals}
      {commandPalette}
        </>
      )}
    </div>
  );
}
