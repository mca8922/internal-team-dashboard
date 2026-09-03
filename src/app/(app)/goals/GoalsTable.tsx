'use client';

// Table view — one flat, scannable surface for browsing many goals at once.
// Complements the cascade (which is for understanding hierarchy). Goals are
// filtered by the shared toolbar, grouped (by due date by default), sortable by
// column, and pinned favourites float to the top. Clicking a row jumps back
// into the cascade focused on that goal.
import * as React from 'react';
import { Avatar } from '@/components/ui';
import { Icon } from '@/components/Icon';
import {
  STATUS,
  LEVEL_META,
  LEVEL_ORDER,
  isOverdue,
  dueWithin,
  dueLine,
  daysToDue,
  plainText,
  goalDepts,
  goalInDept,
  deriveGoalStatus,
} from './goal-ui';
import { dueBucket, BUCKET_META } from '@/lib/goal-buckets';
import type { AssigneeChip } from './GoalsView';
import type { Goal, GoalStatus, GoalGrouping, GoalSortKey } from '@/lib/types';

const PAGE_SIZE = 25;

const GROUPINGS: { value: GoalGrouping; label: string }[] = [
  { value: 'due', label: 'Due date' },
  { value: 'department', label: 'Department' },
  { value: 'status', label: 'Status' },
  { value: 'level', label: 'Tier' },
  { value: 'none', label: 'None' },
];

// Short tier tag for the title cell (e.g. "Quarterly", "Monthly").
const tierShort: Record<Goal['level'], string> = {
  yearly: 'Yearly',
  half_yearly: 'Half-Yearly',
  quarterly: 'Quarterly',
  monthly: 'Monthly',
  daily: 'Daily',
};

const STATUS_ORDER: GoalStatus[] = ['active', 'inactive', 'not_met', 'achieved'];

function groupKey(g: Goal, grouping: GoalGrouping): string {
  switch (grouping) {
    case 'due':
      return dueBucket(g);
    case 'department':
      return g.department?.trim() || 'Unassigned';
    case 'status':
      return deriveGoalStatus(g);
    case 'level':
      return g.level;
    default:
      return 'all';
  }
}

function groupLabel(key: string, grouping: GoalGrouping): string {
  if (grouping === 'due') return BUCKET_META.find((b) => b.key === key)?.label ?? key;
  if (grouping === 'status') return STATUS[key as GoalStatus]?.label ?? key;
  if (grouping === 'level') return LEVEL_META[key as Goal['level']]?.label ?? key;
  return key;
}

// Stable display order for the group headers.
function orderGroups(keys: string[], grouping: GoalGrouping): string[] {
  if (grouping === 'due') {
    const order = BUCKET_META.map((b) => b.key) as string[];
    return [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  if (grouping === 'status') {
    return [...keys].sort((a, b) => STATUS_ORDER.indexOf(a as GoalStatus) - STATUS_ORDER.indexOf(b as GoalStatus));
  }
  if (grouping === 'level') {
    return [...keys].sort((a, b) => LEVEL_ORDER.indexOf(a as Goal['level']) - LEVEL_ORDER.indexOf(b as Goal['level']));
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function cmp(a: Goal, b: Goal, key: GoalSortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title);
    case 'status':
      return (
        STATUS_ORDER.indexOf(deriveGoalStatus(a)) - STATUS_ORDER.indexOf(deriveGoalStatus(b))
      );
    case 'progress':
      return (a.progress ?? 0) - (b.progress ?? 0);
    case 'due': {
      const da = daysToDue(a);
      const db = daysToDue(b);
      return (da ?? Infinity) - (db ?? Infinity); // no due date sorts last
    }
  }
}

export function GoalsTable({
  goals,
  assigneesByGoal,
  query,
  dept,
  status,
  due,
  assignee,
  grouping,
  setGrouping,
  sort,
  setSort,
  pinned,
  onTogglePin,
  onOpen,
}: {
  goals: Goal[];
  assigneesByGoal: Record<string, AssigneeChip[]>;
  query: string;
  dept: string;
  status: 'all' | GoalStatus;
  due: 'all' | 'overdue' | 'week';
  assignee: string;
  grouping: GoalGrouping;
  setGrouping: (g: GoalGrouping) => void;
  sort: { key: GoalSortKey; dir: 'asc' | 'desc' };
  setSort: (s: { key: GoalSortKey; dir: 'asc' | 'desc' }) => void;
  pinned: Set<string>;
  onTogglePin: (g: Goal) => void;
  onOpen: (g: Goal) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const [page, setPage] = React.useState(0);

  // Apply the shared toolbar filters (same rules as the cascade results list).
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return goals.filter((g) => {
      if (dept !== 'all' && !goalInDept(g, dept)) return false;
      if (status !== 'all' && deriveGoalStatus(g) !== status) return false;
      if (due === 'overdue' && !isOverdue(g)) return false;
      if (due === 'week' && !dueWithin(g, 6)) return false;
      if (assignee !== 'all' && !(assigneesByGoal[g.id] ?? []).some((a) => a.id === assignee))
        return false;
      if (q && !`${g.title} ${plainText(g.description)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [goals, query, dept, status, due, assignee, assigneesByGoal]);

  // Pins always float to the top (from the full set, so they stay reachable
  // even when filtered out below).
  const pinnedGoals = React.useMemo(
    () => goals.filter((g) => pinned.has(g.id)).sort((a, b) => a.title.localeCompare(b.title)),
    [goals, pinned],
  );

  const dir = sort.dir === 'asc' ? 1 : -1;
  const sortRows = React.useCallback(
    (rows: Goal[]) => [...rows].sort((a, b) => cmp(a, b, sort.key) * dir || a.title.localeCompare(b.title)),
    [sort.key, dir],
  );

  // Build ordered groups of the (non-pinned-priority) filtered rows.
  const groups = React.useMemo(() => {
    const rest = filtered;
    const map = new Map<string, Goal[]>();
    for (const g of rest) {
      const k = groupKey(g, grouping);
      const arr = map.get(k);
      if (arr) arr.push(g);
      else map.set(k, [g]);
    }
    return orderGroups([...map.keys()], grouping).map((k) => ({
      key: k,
      label: groupLabel(k, grouping),
      rows: sortRows(map.get(k)!),
    }));
  }, [filtered, grouping, sortRows]);

  React.useEffect(
    () => setPage(0),
    [query, dept, status, due, assignee, grouping, sort.key, sort.dir],
  );

  const toggleSort = (key: GoalSortKey) =>
    setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const sortCaret = (key: GoalSortKey) =>
    sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '';

  const allGroupKeys = groups.map((g) => g.key);
  const expandGroups = () => setCollapsedGroups(new Set());
  const collapseGroups = () => setCollapsedGroups(new Set(allGroupKeys));

  // Flat (no grouping) gets pagination; grouped mode relies on collapsible
  // headers — naturally bounded per due-bucket/dept.
  const flat = grouping === 'none';
  const flatRows = flat ? groups[0]?.rows ?? [] : [];
  const pageCount = Math.max(1, Math.ceil(flatRows.length / PAGE_SIZE));
  const pageRows = flat ? flatRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : [];

  const headerRow = (
    <div className="gb-tr gb-tr-head">
      <span className="gb-th gb-th-pin" aria-hidden />
      <button type="button" className="gb-th gb-th-title" onClick={() => toggleSort('title')}>
        Task <span className="gb-sort">{sortCaret('title')}</span>
      </button>
      <button type="button" className="gb-th gb-th-status" onClick={() => toggleSort('status')}>
        Status <span className="gb-sort">{sortCaret('status')}</span>
      </button>
      <span className="gb-th gb-th-team">Team</span>
      <button type="button" className="gb-th gb-th-due" onClick={() => toggleSort('due')}>
        Due <span className="gb-sort">{sortCaret('due')}</span>
      </button>
      <button type="button" className="gb-th gb-th-pct" onClick={() => toggleSort('progress')}>
        % <span className="gb-sort">{sortCaret('progress')}</span>
      </button>
    </div>
  );

  const row = (g: Goal) => {
    const chips = assigneesByGoal[g.id] ?? [];
    const over = isOverdue(g);
    const pin = pinned.has(g.id);
    return (
      <div key={g.id} className="gb-tr gb-tr-row" onClick={() => onOpen(g)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(g); }}>
        <span className="gb-td gb-td-pin">
          <button
            type="button"
            className={`icon-btn gb-pin-star${pin ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onTogglePin(g); }}
            aria-pressed={pin}
            aria-label={pin ? 'Unpin task' : 'Pin task'}
            title={pin ? 'Unpin from top' : 'Pin to top'}
          >
            <Icon name={pin ? 'star-filled' : 'star'} size={14} />
          </button>
        </span>
        <span className="gb-td gb-td-title">
          <span className="gb-td-tier">{tierShort[g.level]}</span>
          <span className="gb-td-name">{g.title}</span>
          {goalDepts(g).length ? (
            <span className="gb-td-dept">{goalDepts(g).join(', ')}</span>
          ) : null}
        </span>
        <span className="gb-td gb-td-status">
          <span className={`badge ${STATUS[deriveGoalStatus(g)].cls}`}>
            {STATUS[deriveGoalStatus(g)].label}
          </span>
          {over ? <span className="badge badge-red">Overdue</span> : null}
        </span>
        <span className="gb-td gb-td-team">
          {chips.slice(0, 3).map((c) => (
            <Avatar key={c.id} name={c.name} size="sm" src={c.avatar_url} />
          ))}
          {chips.length > 3 ? <span className="gb-td-more">+{chips.length - 3}</span> : null}
          {chips.length === 0 ? <span className="gb-td-team-empty">-</span> : null}
        </span>
        <span className={`gb-td gb-td-due${over ? ' over' : ''}`}>{dueLine(g)}</span>
        <span className="gb-td gb-td-pct">{g.progress ?? 0}%</span>
      </div>
    );
  };

  const total = filtered.length;

  return (
    <div className="gb-table-wrap">
      <div className="gb-table-controls">
        <span className="gb-table-count">
          {total} task{total !== 1 ? 's' : ''}
          {pinnedGoals.length > 0 ? ` · ${pinnedGoals.length} pinned` : ''}
        </span>
        <label className="gb-table-group">
          Group by
          <select className="select" value={grouping} onChange={(e) => setGrouping(e.target.value as GoalGrouping)}>
            {GROUPINGS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {!flat ? (
          <span className="gb-table-foldbtns">
            <button type="button" className="gb-foldbtn" onClick={expandGroups}>Expand all</button>
            <button type="button" className="gb-foldbtn" onClick={collapseGroups}>Collapse all</button>
          </span>
        ) : null}
      </div>

      <div className="gb-table" role="table">
        {headerRow}

        {/* Pinned, always on top */}
        {pinnedGoals.length > 0 ? (
          <>
            <div className="gb-group-head gb-group-pinned">
              <Icon name="star-filled" size={13} /> Pinned
              <span className="gb-group-count">{pinnedGoals.length}</span>
            </div>
            {sortRows(pinnedGoals).map(row)}
          </>
        ) : null}

        {total === 0 ? (
          <div className="gb-table-empty">No tasks match the current filters.</div>
        ) : flat ? (
          <>
            {pageRows.map(row)}
            {pageCount > 1 ? (
              <div className="gb-pager">
                <button type="button" className="gb-foldbtn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <Icon name="chevron-left" size={13} /> Prev
                </button>
                <span className="gb-pager-info">Page {page + 1} / {pageCount}</span>
                <button type="button" className="gb-foldbtn" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
                  Next <Icon name="chevron-right" size={13} />
                </button>
              </div>
            ) : null}
          </>
        ) : (
          groups.map((grp) => {
            const open = !collapsedGroups.has(grp.key);
            return (
              <React.Fragment key={grp.key}>
                <button
                  type="button"
                  className={`gb-group-head gb-group-${grouping}-${grp.key}`}
                  onClick={() =>
                    setCollapsedGroups((c) => {
                      const n = new Set(c);
                      if (n.has(grp.key)) n.delete(grp.key);
                      else n.add(grp.key);
                      return n;
                    })
                  }
                  aria-expanded={open}
                >
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
                  {grp.label}
                  <span className="gb-group-count">{grp.rows.length}</span>
                </button>
                {open ? grp.rows.map(row) : null}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
