'use client';

// The Board's Goals management toolbar cluster, extracted verbatim from
// GoalsView: the lightweight member search box, the searchable assignee-filter
// dropdown, the search + department + status + due toolbar, and the at-a-glance
// health strip that doubles as quick filters. No behaviour change.
import * as React from 'react';
import { Icon } from '@/components/Icon';
import { STATUS } from './goal-ui';
import type { AssignableMember } from './GoalForm';
import type { GoalStatus } from '@/lib/types';

// A lightweight search box for members (just a filter over their own goals).
export function MemberSearchBar({
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
export function BoardGoalsToolbar({
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
export function BoardHealthStrip({
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
