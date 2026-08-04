'use client';

// ── Goals cleanup (Board only) ──────────────────────────────────────────────
// A one-stop modal to tidy up past goals. Goals older than the current month are
// bucketed by month (by due date, falling back to created date). The Board picks
// the months to clean up, exports them as a backup (CSV for scanning + JSON for
// full detail), and then either:
//   • Archives them  → hidden from every view but retained and restorable, or
//   • Deletes them    → permanent removal from the database (typed confirmation).
// A second tab lists already-archived goals to restore or permanently delete.
import * as React from 'react';
import { Modal, Button, Avatar } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { downloadCsv, downloadJson } from '@/lib/csv';
import { fmtDate, fmtShort } from '@/lib/dates';
import { archiveGoals, restoreGoals, deleteGoals } from '@/lib/actions';
import { STATUS, LEVEL_META, plainText, goalDepts } from './goal-ui';
import type { AssigneeChip } from './GoalsView';
import type { Goal, GoalChecklistItem } from '@/lib/types';

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
    { header: 'Status', value: (g: Goal) => STATUS[g.status]?.label ?? g.status },
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
    status: g.status,
    statusLabel: STATUS[g.status]?.label ?? g.status,
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
          <span className={`badge ${STATUS[goal.status]?.cls ?? ''}`}>
            {STATUS[goal.status]?.label ?? goal.status}
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
}: {
  open: boolean;
  onClose: () => void;
  goals: Goal[]; // live goals (Board sees all of them)
  archivedGoals: Goal[];
  assigneesByGoal: Record<string, AssigneeChip[]>;
  checklistsByGoal: Record<string, GoalChecklistItem[]>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = React.useState<'cleanup' | 'archived'>('cleanup');
  const [busy, setBusy] = React.useState(false);
  // Cleanup tab: which month buckets are selected.
  const [selMonths, setSelMonths] = React.useState<Set<string>>(new Set());
  // Archived tab: which archived goals are selected.
  const [selArchived, setSelArchived] = React.useState<Set<string>>(new Set());
  // Permanent-delete guard: the typed confirmation text ("DELETE").
  const [confirmText, setConfirmText] = React.useState('');
  const [deleteArmed, setDeleteArmed] = React.useState(false);

  // Reset transient state whenever the modal (re)opens.
  React.useEffect(() => {
    if (!open) return;
    setSelMonths(new Set());
    setSelArchived(new Set());
    setConfirmText('');
    setDeleteArmed(false);
    setTab('cleanup');
  }, [open]);

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

  const selectedGoals = React.useMemo(
    () => monthBuckets.filter(([k]) => selMonths.has(k)).flatMap(([, gs]) => gs),
    [monthBuckets, selMonths],
  );
  const selectedArchivedGoals = React.useMemo(
    () => archivedGoals.filter((g) => selArchived.has(g.id)),
    [archivedGoals, selArchived],
  );

  const toggleMonth = (key: string) =>
    setSelMonths((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allMonthsSelected = monthBuckets.length > 0 && selMonths.size === monthBuckets.length;
  const toggleAllMonths = () =>
    setSelMonths(allMonthsSelected ? new Set() : new Set(monthBuckets.map(([k]) => k)));

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
      setSelMonths(new Set());
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
      </div>

      {tab === 'cleanup' ? (
        monthBuckets.length === 0 ? (
          <div className="text-grey" style={{ padding: '24px 8px', textAlign: 'center' }}>
            No tasks older than this month. Nothing to clean up yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8, maxHeight: '46vh', overflowY: 'auto' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={allMonthsSelected} onChange={toggleAllMonths} />
              <span className="fw-medium">Select all past months</span>
            </label>
            {monthBuckets.map(([key, gs]) => {
              const on = selMonths.has(key);
              return (
                <div key={key} className="card" style={{ padding: 10 }}>
                  <label
                    style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleMonth(key)} />
                    <Icon name="calendar" size={14} />
                    <span className="fw-medium">{monthLabel(key)}</span>
                    <span className="badge badge-slate" style={{ marginLeft: 'auto' }}>
                      {gs.length} task{gs.length !== 1 ? 's' : ''}
                    </span>
                  </label>
                  {on ? (
                    <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                      {gs.map((g) => (
                        <div key={g.id} style={{ fontSize: 12 }} className="text-grey">
                          · {g.title}
                        </div>
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
          / delete. Permanent delete is gated behind a typed confirmation. */}
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
                    ? runDelete(selectedGoals, () => setSelMonths(new Set()))
                    : runDelete(selectedArchivedGoals, () => setSelArchived(new Set()))
                }
              >
                Delete {activeList.length} permanently
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
