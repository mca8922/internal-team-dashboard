'use client';

// Table view — one flat, scannable surface for browsing many goals at once.
// Complements the cascade (which is for understanding hierarchy). Goals are
// filtered by the shared toolbar, grouped (by due date by default), sortable by
// column, and pinned favourites float to the top. Clicking a row jumps back
// into the cascade focused on that goal.
//
// Two things keep this fast on a few hundred tasks:
//   • Every per-goal value the filter, the sort and the cell markup need
//     (derived status, overdue flag, due line, departments, search haystack) is
//     computed ONCE per goals array into a `Row`, not re-derived on each
//     keystroke. Date parsing and the description's HTML strip were the hot
//     spots — the latter is cached across refreshes by goal id.
//   • Rows render through a memoised component, and every group is capped with
//     the same "show more" bar the cascade uses, so an "Overdue" bucket with
//     300 tasks mounts 25 rows instead of 300.
import * as React from 'react';
import { Avatar } from '@/components/ui';
import { Icon } from '@/components/Icon';
import {
  STATUS,
  LEVEL_META,
  LEVEL_ORDER,
  isOverdue,
  dueLine,
  daysToDue,
  plainText,
  goalDepts,
  goalInDept,
  deriveGoalStatus,
} from './goal-ui';
import { dueBucket, BUCKET_META } from '@/lib/goal-buckets';
import type { AssigneeChip, AssignerInfo } from './GoalsView';
import type { Goal, GoalStatus, GoalGrouping, GoalSortKey } from '@/lib/types';

// Rows shown per group before the "show more" bar, and how many each press
// adds — the same rhythm as the cascade's paged lists.
const GROUP_PAGE = 25;
const GROUP_STEP = 40;

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

// Shared empty array so a task with no assignees keeps a stable `chips` prop.
const EMPTY_CHIPS: AssigneeChip[] = [];

// One goal, with everything the table asks of it already answered.
interface Row {
  g: Goal;
  status: GoalStatus;
  overdue: boolean;
  due: string;
  days: number; // Infinity when there is no due date, so it sorts last
  bucket: string;
  depts: string;
  search: string;
  pct: number;
}

function groupKeyOf(r: Row, grouping: GoalGrouping): string {
  switch (grouping) {
    case 'due':
      return r.bucket;
    case 'department':
      return r.g.department?.trim() || 'Unassigned';
    case 'status':
      return r.status;
    case 'level':
      return r.g.level;
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

function cmp(a: Row, b: Row, key: GoalSortKey): number {
  switch (key) {
    case 'title':
      return a.g.title.localeCompare(b.g.title);
    case 'status':
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    case 'progress':
      return a.pct - b.pct;
    case 'due':
      // Both undated (Infinity - Infinity = NaN) would poison the comparator.
      return a.days === b.days ? 0 : a.days - b.days; // no due date sorts last
  }
}

// ── One row ────────────────────────────────────────────────────────────────
// Memoised: paging a group in, pinning a task or re-sorting re-renders only the
// rows whose own props actually moved. `chips` comes straight off the parent's
// assigneesByGoal map, so its identity is stable between renders.
const TableRow = React.memo(function TableRow({
  row,
  chips,
  pin,
  onOpen,
  onTogglePin,
}: {
  row: Row;
  chips: AssigneeChip[];
  pin: boolean;
  onOpen: (g: Goal) => void;
  onTogglePin: (g: Goal) => void;
}) {
  const { g, status, overdue } = row;
  const meta = STATUS[status];
  return (
    <div
      className="gb-tr gb-tr-row"
      onClick={() => onOpen(g)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(g);
      }}
    >
      <span className="gb-td gb-td-pin">
        <button
          type="button"
          className={`icon-btn gb-pin-star${pin ? ' active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(g);
          }}
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
        {row.depts ? <span className="gb-td-dept">{row.depts}</span> : null}
      </span>
      <span className="gb-td gb-td-status">
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
        {overdue ? <span className="badge badge-red">Overdue</span> : null}
      </span>
      <span className="gb-td gb-td-team">
        {chips.slice(0, 3).map((c) => (
          <Avatar key={c.id} name={c.name} size="sm" src={c.avatar_url} />
        ))}
        {chips.length > 3 ? <span className="gb-td-more">+{chips.length - 3}</span> : null}
        {chips.length === 0 ? <span className="gb-td-team-empty">-</span> : null}
      </span>
      <span className={`gb-td gb-td-due${overdue ? ' over' : ''}`}>{row.due}</span>
      <span className="gb-td gb-td-pct">{row.pct}%</span>
    </div>
  );
});

export function GoalsTable({
  goals,
  assigneesByGoal,
  assignerByGoal,
  query,
  dept,
  status,
  due,
  selfAssigned,
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
  assignerByGoal: Record<string, AssignerInfo>;
  query: string;
  dept: string;
  status: 'all' | GoalStatus;
  due: 'all' | 'overdue' | 'week';
  selfAssigned: 'all' | 'self' | 'others';
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
  // How many rows each group currently shows; absent = the GROUP_PAGE default.
  const [limits, setLimits] = React.useState<Record<string, number>>({});

  // Row callbacks stay identity-stable so the memoised rows survive a parent
  // re-render that only handed us new closures.
  const openRef = React.useRef(onOpen);
  const pinRef = React.useRef(onTogglePin);
  React.useEffect(() => {
    openRef.current = onOpen;
    pinRef.current = onTogglePin;
  });
  const handleOpen = React.useCallback((g: Goal) => openRef.current(g), []);
  const handlePin = React.useCallback((g: Goal) => pinRef.current(g), []);

  // Stripping HTML off every description is the single most expensive thing the
  // filter does, and the text barely ever changes — keep it across refreshes.
  const searchCache = React.useRef(new Map<string, { src: string; text: string }>());

  // Everything per-goal, derived once. Rebuilt only when the goals array itself
  // changes (a save/refresh), not on every keystroke or sort flip.
  const rows = React.useMemo(() => {
    const cache = searchCache.current;
    const seen = new Set<string>();
    const out = goals.map<Row>((g) => {
      const st = deriveGoalStatus(g);
      const days = daysToDue(g);
      const src = g.description ?? '';
      let hit = cache.get(g.id);
      if (!hit || hit.src !== src) {
        hit = { src, text: plainText(src) };
        cache.set(g.id, hit);
      }
      seen.add(g.id);
      return {
        g,
        status: st,
        overdue: isOverdue(g, st),
        due: dueLine(g),
        days: days ?? Infinity,
        bucket: dueBucket(g),
        depts: goalDepts(g).join(', '),
        search: `${g.title} ${hit.text}`.toLowerCase(),
        pct: g.progress ?? 0,
      };
    });
    // Drop cache entries for goals that no longer exist.
    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
    return out;
  }, [goals]);

  // Apply the shared toolbar filters (same rules as the cascade results list).
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (dept !== 'all' && !goalInDept(r.g, dept)) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (due === 'overdue' && !r.overdue) return false;
      // "This week" excludes settled work, exactly as dueWithin does.
      if (due === 'week' && !(r.days >= 0 && r.days <= 6 && r.status !== 'achieved' && r.status !== 'not_met'))
        return false;
      // Same "self" flag the card's violet badge reads — a task whose assigner
      // couldn't be resolved matches neither side of the split.
      if (selfAssigned === 'self' && !assignerByGoal[r.g.id]?.selfAssigned) return false;
      if (
        selfAssigned === 'others' &&
        !(assignerByGoal[r.g.id] && !assignerByGoal[r.g.id].selfAssigned)
      )
        return false;
      if (assignee !== 'all' && !(assigneesByGoal[r.g.id] ?? []).some((a) => a.id === assignee))
        return false;
      if (q && !r.search.includes(q)) return false;
      return true;
    });
  }, [rows, query, dept, status, due, selfAssigned, assignee, assigneesByGoal, assignerByGoal]);

  const dir = sort.dir === 'asc' ? 1 : -1;
  const sortRows = React.useCallback(
    (list: Row[]) =>
      [...list].sort((a, b) => cmp(a, b, sort.key) * dir || a.g.title.localeCompare(b.g.title)),
    [sort.key, dir],
  );

  // Pins always float to the top (from the full set, so they stay reachable
  // even when filtered out below).
  const pinnedRows = React.useMemo(
    () => sortRows(rows.filter((r) => pinned.has(r.g.id))),
    [rows, pinned, sortRows],
  );

  // Build ordered groups of the (non-pinned-priority) filtered rows.
  const groups = React.useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const k = groupKeyOf(r, grouping);
      const arr = map.get(k);
      if (arr) arr.push(r);
      else map.set(k, [r]);
    }
    return orderGroups([...map.keys()], grouping).map((k) => ({
      key: k,
      label: groupLabel(k, grouping),
      rows: sortRows(map.get(k)!),
    }));
  }, [filtered, grouping, sortRows]);

  // A new filter/sort/grouping means a new list — start it back at one page.
  React.useEffect(
    () => setLimits((l) => (Object.keys(l).length ? {} : l)),
    [query, dept, status, due, selfAssigned, assignee, grouping, sort.key, sort.dir],
  );

  const toggleSort = (key: GoalSortKey) =>
    setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const sortCaret = (key: GoalSortKey) =>
    sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '';

  const expandGroups = () => setCollapsedGroups(new Set());
  const collapseGroups = () => setCollapsedGroups(new Set(groups.map((g) => g.key)));

  const grow = (key: string, to: number) => setLimits((l) => ({ ...l, [key]: to }));

  // The cascade's "load more" panel, reused per group: how much is loaded, how
  // much is left, a next page and an escape hatch to the whole list.
  const loadMore = (key: string, total: number, shown: number) => {
    if (total <= shown) return null;
    const remaining = total - shown;
    const nextChunk = Math.min(GROUP_STEP, remaining);
    const pct = Math.round((shown / total) * 100);
    return (
      <div className="gb-loadmore gb-loadmore-inrow">
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
            onClick={() => grow(key, shown + GROUP_STEP)}
          >
            <Icon name="chevron-down" size={16} />
            Show {nextChunk} more
          </button>
          {remaining > nextChunk ? (
            <button type="button" className="gb-loadmore-all" onClick={() => grow(key, total)}>
              Show all {total}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  // Render one group's rows, capped at its current limit, with the bar beneath.
  const groupBody = (key: string, list: Row[]) => {
    const shown = Math.min(limits[key] ?? GROUP_PAGE, list.length);
    return (
      <>
        {list.slice(0, shown).map((r) => (
          <TableRow
            key={r.g.id}
            row={r}
            chips={assigneesByGoal[r.g.id] ?? EMPTY_CHIPS}
            pin={pinned.has(r.g.id)}
            onOpen={handleOpen}
            onTogglePin={handlePin}
          />
        ))}
        {loadMore(key, list.length, shown)}
      </>
    );
  };

  const total = filtered.length;
  const flat = grouping === 'none';

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

  return (
    <div className="gb-table-wrap">
      <div className="gb-table-controls">
        <span className="gb-table-count">
          {total} task{total !== 1 ? 's' : ''}
          {pinnedRows.length > 0 ? ` · ${pinnedRows.length} pinned` : ''}
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
        {pinnedRows.length > 0 ? (
          <>
            <div className="gb-group-head gb-group-pinned">
              <Icon name="star-filled" size={13} /> Pinned
              <span className="gb-group-count">{pinnedRows.length}</span>
            </div>
            {groupBody('__pinned', pinnedRows)}
          </>
        ) : null}

        {total === 0 ? (
          <div className="gb-table-empty">No tasks match the current filters.</div>
        ) : flat ? (
          groupBody('all', groups[0]?.rows ?? [])
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
                {open ? groupBody(grp.key, grp.rows) : null}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
