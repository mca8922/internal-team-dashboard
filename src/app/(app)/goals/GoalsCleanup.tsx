'use client';

// ── Goals cleanup (Board only) ──────────────────────────────────────────────
// A one-stop modal to tidy up past goals. Goals older than the current month are
// bucketed by month (by due date, falling back to created date). The Board picks
// the months to clean up, exports them as a backup (CSV for scanning + JSON for
// full detail), and then either:
//   • Archives them  → hidden from every view but retained and restorable, or
//   • Deletes them    → permanent removal from the database (typed confirmation).
// A second tab lists already-archived goals to restore or permanently delete.
// A third, Activity, is the log of every archive / restore / delete (migration
// 0070) — the Board's own cleanups included, not only the members'.
//
// The header carries the Board's "Delete option for everyone" switch: while on,
// Executives and Managers may archive or delete the tasks they created.
import * as React from 'react';
import { Modal, Button, Avatar, Toggle } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { downloadCsv, downloadJson } from '@/lib/csv';
import { fmtDate, fmtDateDMY, fmtShort, fmtTime } from '@/lib/dates';
import {
  archiveGoals,
  restoreGoals,
  deleteGoals,
  setMemberTaskDelete,
  getGoalActivity,
} from '@/lib/actions';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { STATUS, LEVEL_META, plainText, goalDepts, deriveGoalStatus } from './goal-ui';
import type { AssigneeChip } from './GoalsView';
import type {
  Goal,
  GoalActivity,
  GoalActivityAction,
  GoalActivityActorRole,
  GoalChecklistItem,
} from '@/lib/types';

// A goal's "month" — its due date if it has one, else when it was created. Both
// are ISO-ish strings, so a YYYY-MM prefix is a stable, sortable bucket key.
function monthKeyOf(g: Goal): string {
  const d = g.due_date || g.created_at;
  return d ? d.slice(0, 7) : '';
}

// The current local month as a YYYY-MM key; anything strictly before is "past".
function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// "2026-07" → "July 2026".
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return 'No date';
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// The columns a CSV row exposes — flat + easy to scan/filter in a spreadsheet.
function csvColumns(
  assigneesByGoal: Record<string, AssigneeChip[]>,
  checklistsByGoal: Record<string, GoalChecklistItem[]>,
) {
  return [
    { header: 'Month', value: (g: Goal) => monthLabel(monthKeyOf(g)) },
    { header: 'Level', value: (g: Goal) => LEVEL_META[g.level].label },
    { header: 'Title', value: (g: Goal) => g.title },
    { header: 'Departments', value: (g: Goal) => goalDepts(g).join(' · ') },
    { header: 'Status', value: (g: Goal) => STATUS[deriveGoalStatus(g)]?.label ?? g.status },
    { header: 'Progress %', value: (g: Goal) => g.progress },
    { header: 'Due date', value: (g: Goal) => g.due_date ?? '' },
    { header: 'Created', value: (g: Goal) => g.created_at.slice(0, 10) },
    {
      header: 'Assignees',
      value: (g: Goal) => (assigneesByGoal[g.id] ?? []).map((a) => a.name).join('; '),
    },
    {
      header: 'Checklist items',
      value: (g: Goal) => (checklistsByGoal[g.id] ?? []).map((it) => it.label).join(' | '),
    },
    { header: 'Description', value: (g: Goal) => plainText(g.description) },
  ];
}

// The full-fidelity shape a JSON export keeps per goal (nested detail intact).
function toJsonRecord(
  g: Goal,
  assigneesByGoal: Record<string, AssigneeChip[]>,
  checklistsByGoal: Record<string, GoalChecklistItem[]>,
) {
  return {
    month: monthKeyOf(g),
    id: g.id,
    level: g.level,
    title: g.title,
    status: deriveGoalStatus(g),
    statusLabel: STATUS[deriveGoalStatus(g)]?.label ?? g.status,
    progress: g.progress,
    departments: goalDepts(g),
    due_date: g.due_date,
    created_at: g.created_at,
    archived_at: g.archived_at,
    description: plainText(g.description),
    descriptionHtml: g.description,
    assignees: (assigneesByGoal[g.id] ?? []).map((a) => ({ id: a.id, name: a.name })),
    checklist: (checklistsByGoal[g.id] ?? []).map((it) => ({
      label: it.label,
      description: plainText(it.description),
      recurrence: it.recurrence,
      report_required: it.report_required,
    })),
  };
}

// ── Activity log ────────────────────────────────────────────────────────────

const ACTION_META: Record<
  GoalActivityAction,
  { label: string; cls: string; icon: 'trash' | 'archive' | 'refresh' }
> = {
  deleted: { label: 'Deleted', cls: 'badge-red', icon: 'trash' },
  archived: { label: 'Archived', cls: 'badge-amber', icon: 'archive' },
  restored: { label: 'Restored', cls: 'badge-slate', icon: 'refresh' },
};

const ROLE_LABEL: Record<GoalActivityActorRole, string> = {
  founder: 'Founder',
  director: 'Director',
  manager: 'Manager',
  executive: 'Executive',
  system: 'System',
};

// Who filter: the members the switch empowers vs. the Board itself.
type WhoFilter = 'all' | 'members' | 'board';
function matchesWho(a: GoalActivity, who: WhoFilter): boolean {
  if (who === 'all') return true;
  const member = a.actor_role === 'executive' || a.actor_role === 'manager';
  return who === 'members' ? member : !member;
}

function activityDepts(a: GoalActivity): string {
  const list = a.departments?.length ? a.departments : a.department ? [a.department] : [];
  return list.join(' · ');
}

function tierLabel(a: GoalActivity): string {
  if (!a.level) return '';
  return LEVEL_META[a.level as Goal['level']]?.label ?? a.level;
}

const ACTIVITY_CSV = [
  { header: 'Date', value: (a: GoalActivity) => fmtDateDMY(a.occurred_at) },
  { header: 'Time (IST)', value: (a: GoalActivity) => fmtTime(a.occurred_at) },
  { header: 'Action', value: (a: GoalActivity) => ACTION_META[a.action].label },
  { header: 'By', value: (a: GoalActivity) => a.actor_name ?? 'System' },
  { header: 'Role', value: (a: GoalActivity) => ROLE_LABEL[a.actor_role] },
  { header: 'Task', value: (a: GoalActivity) => a.title },
  { header: 'Tier', value: tierLabel },
  { header: 'Departments', value: activityDepts },
  { header: 'Created by', value: (a: GoalActivity) => a.creator_name ?? '' },
  { header: 'Assignees', value: (a: GoalActivity) => a.assignee_names.join('; ') },
  { header: 'Due date', value: (a: GoalActivity) => a.due_date ?? '' },
];

function ActivityRow({ a }: { a: GoalActivity }) {
  const meta = ACTION_META[a.action];
  const tier = tierLabel(a);
  return (
    <div className="card" style={{ padding: '8px 10px', display: 'grid', gap: 3 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          className={`badge ${meta.cls}`}
          style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
        >
          <Icon name={meta.icon} size={11} /> {meta.label}
        </span>
        <span className="fw-medium" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {a.title}
        </span>
      </div>
      <div style={{ fontSize: 12 }}>
        by <b>{a.actor_name ?? 'System'}</b>{' '}
        <span className="text-grey">
          ({ROLE_LABEL[a.actor_role]}) · {fmtDateDMY(a.occurred_at)} · {fmtTime(a.occurred_at)}
        </span>
      </div>
      <div className="text-grey" style={{ fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tier ? <span>{tier}</span> : null}
        <span>{activityDepts(a) || '—'}</span>
        {a.creator_name ? <span>Created by {a.creator_name}</span> : null}
        {a.assignee_names.length ? <span>Assigned to {a.assignee_names.join(', ')}</span> : null}
      </div>
    </div>
  );
}

function GoalRow({
  goal,
  checked,
  onToggle,
  assignees,
}: {
  goal: Goal;
  checked: boolean;
  onToggle: () => void;
  assignees: AssigneeChip[];
}) {
  return (
    <label className="gc-goal-row" style={rowStyle(checked)}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${STATUS[deriveGoalStatus(goal)]?.cls ?? ''}`}>
            {STATUS[deriveGoalStatus(goal)]?.label ?? goal.status}
          </span>
          <span className="text-grey" style={{ fontSize: 12 }}>
            {LEVEL_META[goal.level].label}
          </span>
          <span className="fw-medium" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {goal.title}
          </span>
        </span>
        <span className="text-grey" style={{ fontSize: 12, display: 'flex', gap: 10, marginTop: 2 }}>
          <span>{goalDepts(goal).join(' · ') || '—'}</span>
          <span>Due {goal.due_date ? fmtShort(goal.due_date) : '—'}</span>
          {assignees.length > 0 ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {assignees.slice(0, 4).map((a) => (
                <Avatar key={a.id} name={a.name} size="sm" src={a.avatar_url} />
              ))}
              {assignees.length > 4 ? <span>+{assignees.length - 4}</span> : null}
            </span>
          ) : null}
        </span>
      </span>
    </label>
  );
}

// A checkbox that can also show "some selected" — `indeterminate` is a DOM
// property only, with no HTML attribute, so it has to be set through a ref.
function TriCheckbox({
  checked,
  partial,
  onChange,
}: {
  checked: boolean;
  partial: boolean;
  onChange: () => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />;
}

function rowStyle(checked: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    padding: '8px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    background: checked ? 'var(--color-green-soft, rgba(16,185,129,0.08))' : 'transparent',
  };
}

export function GoalsCleanup({
  open,
  onClose,
  goals,
  archivedGoals,
  assigneesByGoal,
  checklistsByGoal,
  memberTaskDelete,
}: {
  open: boolean;
  onClose: () => void;
  goals: Goal[]; // live goals (Board sees all of them)
  archivedGoals: Goal[];
  assigneesByGoal: Record<string, AssigneeChip[]>;
  checklistsByGoal: Record<string, GoalChecklistItem[]>;
  memberTaskDelete: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = React.useState<'cleanup' | 'archived' | 'activity'>('cleanup');
  // The switch, held locally so it flips at once; the server value follows via
  // revalidation, and a failed save puts it back.
  const [memberDelete, setMemberDelete] = React.useState(memberTaskDelete);
  const [switchBusy, setSwitchBusy] = React.useState(false);
  React.useEffect(() => setMemberDelete(memberTaskDelete), [memberTaskDelete]);
  // Activity tab: fetched on demand (it's a log, not page data), and again on
  // every visit so this session's own archives / deletes show up.
  const [activity, setActivity] = React.useState<GoalActivity[] | null>(null);
  const [activityError, setActivityError] = React.useState<string | null>(null);
  const [actionFilter, setActionFilter] = React.useState<GoalActivityAction | 'all'>('all');
  const [whoFilter, setWhoFilter] = React.useState<WhoFilter>('all');
  const [busy, setBusy] = React.useState(false);
  // Cleanup tab: the individual tasks selected (a month checkbox just adds or
  // removes all of that month's ids), and which months are opened to list them.
  const [selIds, setSelIds] = React.useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = React.useState<Set<string>>(new Set());
  // Archived tab: which archived goals are selected.
  const [selArchived, setSelArchived] = React.useState<Set<string>>(new Set());
  // Permanent-delete guard: the typed confirmation text ("DELETE").
  const [confirmText, setConfirmText] = React.useState('');
  const [deleteArmed, setDeleteArmed] = React.useState(false);

  // Reset transient state whenever the modal (re)opens.
  React.useEffect(() => {
    if (!open) return;
    setSelIds(new Set());
    setOpenMonths(new Set());
    setSelArchived(new Set());
    setConfirmText('');
    setDeleteArmed(false);
    setTab('cleanup');
  }, [open]);

  React.useEffect(() => {
    if (!open || tab !== 'activity') return;
    let live = true;
    setActivityError(null);
    getGoalActivity()
      .then((rows) => {
        if (live) setActivity(rows);
      })
      .catch((e) => {
        if (live) setActivityError((e as Error).message || 'Could not load the activity.');
      });
    return () => {
      live = false;
    };
  }, [open, tab]);

  const filteredActivity = React.useMemo(
    () =>
      (activity ?? []).filter(
        (a) => (actionFilter === 'all' || a.action === actionFilter) && matchesWho(a, whoFilter),
      ),
    [activity, actionFilter, whoFilter],
  );

  const flipMemberDelete = async (next: boolean) => {
    if (next) {
      const ok = await confirm({
        title: 'Let everyone delete their own tasks?',
        message:
          'Executives and Managers will be able to archive or permanently delete tasks they created themselves — never tasks assigned to them. Every removal is recorded in the Activity tab.',
        confirmLabel: 'Turn on',
        icon: 'trash',
      });
      if (!ok) return;
    }
    setMemberDelete(next);
    setSwitchBusy(true);
    try {
      await setMemberTaskDelete(next);
      toast(next ? 'Everyone can now delete their own tasks' : 'Only Directors can delete tasks now');
    } catch (e) {
      setMemberDelete(!next);
      toast((e as Error).message || 'Could not change the setting.', 'error');
    } finally {
      setSwitchBusy(false);
    }
  };

  // Past goals bucketed by month (newest month first).
  const monthBuckets = React.useMemo(() => {
    const cur = currentMonthKey();
    const m = new Map<string, Goal[]>();
    for (const g of goals) {
      const key = monthKeyOf(g);
      if (!key || key >= cur) continue; // only months strictly before this one
      (m.get(key) ?? m.set(key, []).get(key)!).push(g);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [goals]);

  // Derived from the live buckets, so an id that has since been archived or
  // deleted simply stops counting — no stale selections reach an action.
  const selectedGoals = React.useMemo(
    () => monthBuckets.flatMap(([, gs]) => gs.filter((g) => selIds.has(g.id))),
    [monthBuckets, selIds],
  );
  const selectedArchivedGoals = React.useMemo(
    () => archivedGoals.filter((g) => selArchived.has(g.id)),
    [archivedGoals, selArchived],
  );

  const toggleTask = (id: string) =>
    setSelIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // A fully selected month clears; anything less (none or some) selects it all.
  const toggleMonth = (gs: Goal[]) =>
    setSelIds((prev) => {
      const n = new Set(prev);
      const all = gs.every((g) => n.has(g.id));
      for (const g of gs) {
        if (all) n.delete(g.id);
        else n.add(g.id);
      }
      return n;
    });
  const toggleMonthOpen = (key: string) =>
    setOpenMonths((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const pastTotal = monthBuckets.reduce((sum, [, gs]) => sum + gs.length, 0);
  const allMonthsSelected = pastTotal > 0 && selectedGoals.length === pastTotal;
  const toggleAllMonths = () =>
    setSelIds(
      allMonthsSelected ? new Set() : new Set(monthBuckets.flatMap(([, gs]) => gs.map((g) => g.id))),
    );

  const toggleArchived = (id: string) =>
    setSelArchived((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allArchivedSelected =
    archivedGoals.length > 0 && selArchived.size === archivedGoals.length;
  const toggleAllArchived = () =>
    setSelArchived(allArchivedSelected ? new Set() : new Set(archivedGoals.map((g) => g.id)));

  const exportGoals = (list: Goal[], kind: 'csv' | 'json') => {
    if (list.length === 0) return;
    const stamp = fmtDate(new Date());
    if (kind === 'csv') {
      downloadCsv(`goals-archive-${stamp}`, list, csvColumns(assigneesByGoal, checklistsByGoal));
    } else {
      downloadJson(`goals-archive-${stamp}`, {
        exportedAt: new Date().toISOString(),
        count: list.length,
        goals: list.map((g) => toJsonRecord(g, assigneesByGoal, checklistsByGoal)),
      });
    }
    toast(`Exported ${list.length} task${list.length !== 1 ? 's' : ''} as ${kind.toUpperCase()}`);
  };

  const runArchive = async () => {
    const ids = selectedGoals.map((g) => g.id);
    const ok = await confirm({
      title: `Archive ${ids.length} task${ids.length !== 1 ? 's' : ''}?`,
      message:
        'They disappear from the cascade, dashboard and analytics but are kept in the database. You can restore them anytime from the Archived tab.',
      confirmLabel: 'Archive them',
      icon: 'archive',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await archiveGoals(ids);
      toast(`Archived ${ids.length} task${ids.length !== 1 ? 's' : ''}`);
      setSelIds(new Set());
    } catch (e) {
      toast((e as Error).message || 'Could not archive the tasks.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async (list: Goal[], after: () => void) => {
    const ids = list.map((g) => g.id);
    setBusy(true);
    try {
      await deleteGoals(ids);
      toast(`Permanently deleted ${ids.length} task${ids.length !== 1 ? 's' : ''}`);
      setConfirmText('');
      setDeleteArmed(false);
      after();
    } catch (e) {
      toast((e as Error).message || 'Could not delete the tasks.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async () => {
    const ids = selectedArchivedGoals.map((g) => g.id);
    setBusy(true);
    try {
      await restoreGoals(ids);
      toast(`Restored ${ids.length} task${ids.length !== 1 ? 's' : ''}`);
      setSelArchived(new Set());
    } catch (e) {
      toast((e as Error).message || 'Could not restore the tasks.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // The active tab's current selection drives the shared export + delete panel.
  const activeList = tab === 'cleanup' ? selectedGoals : selectedArchivedGoals;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clean up tasks"
      subtitle="Export past tasks as a backup, then archive or delete them in one shot."
      width={720}
      headerAction={
        FEATURE_FLAGS.memberTaskDelete ? (
          <div className="gc-member-delete">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="gc-member-delete-title">Delete option for everyone</div>
              <div className="gc-member-delete-sub">
                {memberDelete
                  ? 'On: Executives & Managers can delete tasks they created.'
                  : 'Off: only Directors can delete tasks.'}
              </div>
            </div>
            <Toggle
              on={memberDelete}
              onChange={flipMemberDelete}
              disabled={switchBusy}
              label="Delete option for everyone"
            />
          </div>
        ) : null
      }
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          className={`gb-viewswitch-btn${tab === 'cleanup' ? ' active' : ''}`}
          onClick={() => setTab('cleanup')}
        >
          <Icon name="calendar" size={14} /> Past months
        </button>
        <button
          type="button"
          className={`gb-viewswitch-btn${tab === 'archived' ? ' active' : ''}`}
          onClick={() => setTab('archived')}
        >
          <Icon name="archive" size={14} /> Archived ({archivedGoals.length})
        </button>
        <button
          type="button"
          className={`gb-viewswitch-btn${tab === 'activity' ? ' active' : ''}`}
          onClick={() => setTab('activity')}
        >
          <Icon name="clock" size={14} /> Activity
        </button>
      </div>

      {tab === 'activity' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as GoalActivityAction | 'all')}
              aria-label="Filter by action"
            >
              <option value="all">All actions</option>
              <option value="deleted">Deleted</option>
              <option value="archived">Archived</option>
              <option value="restored">Restored</option>
            </select>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={whoFilter}
              onChange={(e) => setWhoFilter(e.target.value as WhoFilter)}
              aria-label="Filter by who"
            >
              <option value="all">Everyone</option>
              <option value="members">Executives &amp; Managers</option>
              <option value="board">Directors &amp; Founders</option>
            </select>
            <span style={{ flex: 1 }} />
            <Button
              size="sm"
              variant="secondary"
              icon="copy"
              disabled={filteredActivity.length === 0}
              onClick={() => {
                const n = filteredActivity.length;
                downloadCsv(`task-activity-${fmtDate(new Date())}`, filteredActivity, ACTIVITY_CSV);
                toast(`Exported ${n} entr${n !== 1 ? 'ies' : 'y'} as CSV`);
              }}
            >
              Export CSV
            </Button>
          </div>
          {activityError ? (
            <div className="text-grey" style={{ padding: '24px 8px', textAlign: 'center' }}>
              {activityError}
            </div>
          ) : activity === null ? (
            <div className="text-grey" style={{ padding: '24px 8px', textAlign: 'center' }}>
              Loading activity…
            </div>
          ) : filteredActivity.length === 0 ? (
            <div className="text-grey" style={{ padding: '24px 8px', textAlign: 'center' }}>
              {activity.length === 0
                ? 'Nothing archived, restored or deleted yet. Every removal shows up here.'
                : 'No activity matches these filters.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6, maxHeight: '46vh', overflowY: 'auto' }}>
              {filteredActivity.map((a) => (
                <ActivityRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      ) : tab === 'cleanup' ? (
        monthBuckets.length === 0 ? (
          <div className="text-grey" style={{ padding: '24px 8px', textAlign: 'center' }}>
            No tasks older than this month. Nothing to clean up yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8, maxHeight: '46vh', overflowY: 'auto' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <TriCheckbox
                checked={allMonthsSelected}
                partial={selectedGoals.length > 0 && !allMonthsSelected}
                onChange={toggleAllMonths}
              />
              <span className="fw-medium">Select all past months</span>
            </label>
            {monthBuckets.map(([key, gs]) => {
              const picked = gs.reduce((n, g) => n + (selIds.has(g.id) ? 1 : 0), 0);
              const isOpen = openMonths.has(key);
              return (
                <div key={key} className="card" style={{ padding: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label
                      style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', flex: 1, minWidth: 0 }}
                    >
                      <TriCheckbox
                        checked={picked === gs.length}
                        partial={picked > 0 && picked < gs.length}
                        onChange={() => {
                          // Selecting a month opens it, so what was picked is in view.
                          if (picked < gs.length) setOpenMonths((prev) => new Set(prev).add(key));
                          toggleMonth(gs);
                        }}
                      />
                      <Icon name="calendar" size={14} />
                      <span className="fw-medium">{monthLabel(key)}</span>
                    </label>
                    <span className="badge badge-slate">
                      {picked > 0 ? `${picked} of ${gs.length}` : `${gs.length} task${gs.length !== 1 ? 's' : ''}`}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => toggleMonthOpen(key)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? `Hide ${monthLabel(key)} tasks` : `Show ${monthLabel(key)} tasks`}
                      title={isOpen ? 'Hide tasks' : 'Show tasks to pick individually'}
                    >
                      <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                    </button>
                  </div>
                  {isOpen ? (
                    <div style={{ marginTop: 8, display: 'grid', gap: 2, paddingLeft: 4 }}>
                      {gs.map((g) => (
                        <label key={g.id} className="gc-task-pick">
                          <input
                            type="checkbox"
                            checked={selIds.has(g.id)}
                            onChange={() => toggleTask(g.id)}
                          />
                          <span className="gc-task-pick-title">{g.title}</span>
                          <span className="gc-task-pick-meta">
                            {g.due_date ? `Due ${fmtShort(g.due_date)}` : LEVEL_META[g.level].label}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : archivedGoals.length === 0 ? (
        <div className="text-grey" style={{ padding: '24px 8px', textAlign: 'center' }}>
          No archived tasks. Anything you archive shows up here to restore or delete for good.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, maxHeight: '46vh', overflowY: 'auto' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={allArchivedSelected} onChange={toggleAllArchived} />
            <span className="fw-medium">Select all archived</span>
          </label>
          {archivedGoals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              checked={selArchived.has(g.id)}
              onToggle={() => toggleArchived(g.id)}
              assignees={assigneesByGoal[g.id] ?? []}
            />
          ))}
        </div>
      )}

      {/* Shared action bar: export the current selection, then archive / restore
          / delete. Permanent delete is gated behind a typed confirmation. The
          Activity tab is read-only and has its own export above. */}
      {tab !== 'activity' ? (
      <div
        style={{
          borderTop: '1px solid var(--color-border, rgba(0,0,0,0.1))',
          marginTop: 14,
          paddingTop: 14,
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="fw-medium">
            {activeList.length} task{activeList.length !== 1 ? 's' : ''} selected
          </span>
          <span style={{ flex: 1 }} />
          <Button
            size="sm"
            variant="secondary"
            icon="copy"
            disabled={activeList.length === 0}
            onClick={() => exportGoals(activeList, 'csv')}
          >
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="copy"
            disabled={activeList.length === 0}
            onClick={() => exportGoals(activeList, 'json')}
          >
            Export JSON
          </Button>
        </div>

        {!deleteArmed ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tab === 'cleanup' ? (
              <Button
                icon="archive"
                variant="secondary"
                disabled={activeList.length === 0 || busy}
                loading={busy}
                onClick={runArchive}
              >
                Archive selected
              </Button>
            ) : (
              <Button
                icon="refresh"
                variant="secondary"
                disabled={activeList.length === 0 || busy}
                loading={busy}
                onClick={runRestore}
              >
                Restore selected
              </Button>
            )}
            <Button
              icon="trash"
              variant="danger"
              disabled={activeList.length === 0 || busy}
              onClick={() => {
                setConfirmText('');
                setDeleteArmed(true);
              }}
            >
              Delete permanently
            </Button>
          </div>
        ) : (
          <div
            className="card"
            style={{ padding: 12, display: 'grid', gap: 8, borderColor: 'var(--color-red-primary, #dc2626)' }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon name="trash" size={16} />
              <span className="fw-medium">
                Permanently delete {activeList.length} task{activeList.length !== 1 ? 's' : ''}?
              </span>
            </div>
            <div className="text-grey" style={{ fontSize: 13 }}>
              This removes them and all their checklist items, reports and history from the
              database. It cannot be undone — export a backup first. Type <b>DELETE</b> to confirm.
            </div>
            <input
              className="input"
              placeholder="Type DELETE"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              style={{ maxWidth: 220 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDeleteArmed(false);
                  setConfirmText('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon="trash"
                loading={busy}
                disabled={confirmText.trim().toUpperCase() !== 'DELETE' || busy}
                onClick={() =>
                  tab === 'cleanup'
                    ? runDelete(selectedGoals, () => setSelIds(new Set()))
                    : runDelete(selectedArchivedGoals, () => setSelArchived(new Set()))
                }
              >
                Delete {activeList.length} permanently
              </Button>
            </div>
          </div>
        )}
      </div>
      ) : null}
    </Modal>
  );
}
