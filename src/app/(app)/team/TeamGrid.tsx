'use client';

// Team grid with search + role/department filters, board account creation,
// per-member management, and a "former members" section.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { roleLabel, weeklyTargetFromDaily } from '@/lib/roles';
import { usePresence } from '@/components/Presence';
import { durationMs, fmtRelative, parseDate } from '@/lib/dates';
import { CreateMemberModal } from './CreateMemberModal';
import { ManageMemberModal } from './ManageMemberModal';
import { ManageDepartmentsModal, type DepartmentStat } from './ManageDepartmentsModal';
import type { UserRole } from '@/lib/types';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  commuteEmail: string | null;
  role: UserRole;
  department: string;
  deptColor: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  leftAt: string | null;
  targetHours: number | null;
  roleDefaultHours: number;
  internshipMonths: number | null;
  joinedDate: string;
  dateOfBirth: string | null;
  jobTitle: string;
  isFounder: boolean;
  isManager: boolean;
  managedDepartment: string | null;
  managerId: string | null;
  managerResponsibilities: string | null;
  status: 'in' | 'complete' | 'short' | 'not-started' | 'leave';
  todayMs: number;
  weeklyHours: number;
  lastLog: string | null;
  lastSeenLabel: string;
}

const DOT: Record<TeamMember['status'], string> = {
  in: 'dot-green',
  complete: 'dot-grey',
  short: 'dot-amber',
  'not-started': 'dot-red',
  leave: 'dot-amber',
};
const DOT_LABEL: Record<TeamMember['status'], string> = {
  in: 'On the clock',
  complete: 'Done for today',
  short: 'Short day (under 60%)',
  'not-started': 'Not yet',
  leave: 'On leave',
};

// Sort priority within a department: leadership first, interns last.
const ROLE_ORDER: Record<UserRole, number> = { board: 0, fte: 1, pte: 2, intern: 3 };

// Google brand palette — assigned by sort index (Founder first, then A-Z)
// so every board member always gets a distinct colour.
const BOARD_COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853'];


// Memoized — a card only re-renders when its own member data changes, not
// when an unrelated filter/search keystroke re-renders the grid.
const TeamCard = React.memo(function TeamCard({
  u,
  onManage,
  boardColor,
}: {
  u: TeamMember;
  onManage: (m: TeamMember) => void;
  boardColor?: string;
}) {
  const router = useRouter();
  // Live "in the app right now" — updates in real time as teammates open or
  // close the dashboard, independent of whether they have punched in.
  const online = usePresence().has(u.id);
  const accent = boardColor || u.deptColor || 'var(--color-green-primary)';
  const open = () => router.push('/team/' + u.id);
  return (
    <div
      className={`card team-card${boardColor ? ' team-card--board' : ''} ${u.isActive ? '' : 'member-left'}`}
      style={{ '--dept': accent, ...(boardColor ? { '--board-color': boardColor } : {}) } as React.CSSProperties}
    >
      {/* One clear clickable region: avatar, name, status and stats all open
          the member's profile. The Manage button below is the only part that
          does something else. */}
      <button type="button" className="team-card-open" onClick={open} title="View profile">
        <div className="flex items-center gap-3">
          {boardColor ? (
            <div className="team-board-avatar-ring" style={{ '--board-color': boardColor } as React.CSSProperties}>
              <Avatar name={u.name} size="lg" src={u.avatarUrl} />
            </div>
          ) : (
            <Avatar name={u.name} size="lg" src={u.avatarUrl} />
          )}
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <div className="fw-bold">{u.name}</div>
              {online ? <span className="dot dot-live" title="Online now" /> : null}
              {u.isFounder ? (
                <span className="badge badge-black" style={boardColor ? { background: boardColor, color: '#fff' } : undefined}>Founder</span>
              ) : null}
              {u.role === 'intern' ? <span className="badge badge-slate">Intern</span> : null}
              {u.role === 'board' && !u.isFounder ? (
                <span className="badge badge-black" style={boardColor ? { background: boardColor, color: '#fff' } : undefined}>Director</span>
              ) : null}
              {u.isManager ? (
                <span
                  className="badge badge-manager"
                  title={`Head of ${u.managedDepartment ?? u.department}`}
                >
                  <Icon name="crown" size={11} />
                  Manager
                </span>
              ) : null}
              {!u.isActive ? <span className="badge badge-red">Left</span> : null}
            </div>
            <div className="text-xs mt-1 team-card-dept">
              <span className="dept-name-text">{u.department}</span>
              {/* The role is repeated in the job-title line below, so only show
                  it here as a fallback when the member has no job title. */}
              {!u.jobTitle ? (
                <span className="text-grey"> · {roleLabel(u.role)}</span>
              ) : null}
            </div>
            {u.jobTitle ? (
              <div
                className="text-xs fw-medium mt-1"
                style={{ color: 'var(--color-black)', letterSpacing: '0.02em' }}
              >
                {u.isFounder ? 'Founder' : roleLabel(u.role)}
                {' · '}
                {u.jobTitle}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <span className={`dot ${DOT[u.status]}`} />
          <span className="text-sm fw-medium">{DOT_LABEL[u.status]}</span>
          {u.status === 'in' || u.status === 'complete' || u.status === 'short' ? (
            <span className="text-xs text-grey ml-auto">{durationMs(u.todayMs)} today</span>
          ) : null}
        </div>
        <div
          className="text-xs mt-1"
          style={{
            // Align this line's text under the status label above: the dot (8px)
            // plus the flex gap-2 (8px) = 16px, so "Online now" starts under
            // "Short day" / "On the clock".
            paddingLeft: 16,
            color:
              online || u.status === 'in'
                ? 'var(--color-green-primary)'
                : 'var(--color-grey-text)',
            fontWeight: online || u.status === 'in' ? 600 : 400,
          }}
        >
          {online ? 'Online now · in the dashboard' : u.lastSeenLabel}
        </div>
        <div className="team-card-stats">
          <div className="team-card-stat">
            <div className="team-card-stat-label">This week</div>
            <div className="team-card-stat-value">
              {u.weeklyHours}h{' '}
              <span className="team-card-stat-of">
                / {weeklyTargetFromDaily(u.targetHours != null ? u.targetHours : u.roleDefaultHours)}h
              </span>
            </div>
          </div>
          <div className="team-card-stat">
            <div className="team-card-stat-label">Daily target</div>
            <div className="team-card-stat-value">
              {u.targetHours != null ? u.targetHours : u.roleDefaultHours}h
            </div>
          </div>
          <div className="team-card-stat">
            <div className="team-card-stat-label">Last log</div>
            <div className="team-card-stat-value">
              {u.lastLog ? fmtRelative(parseDate(u.lastLog)) : '-'}
            </div>
          </div>
        </div>
      </button>
      <div className="mt-3">
        <Button
          size="sm"
          variant="secondary"
          icon="settings"
          onClick={() => onManage(u)}
          className="w-full"
        >
          Manage
        </Button>
      </div>
    </div>
  );
});

export function TeamGrid({
  members,
  currentUserId,
  viewerIsFounder,
  goalDeptCounts,
  deptColors,
}: {
  members: TeamMember[];
  currentUserId: string;
  viewerIsFounder: boolean;
  goalDeptCounts: Record<string, number>;
  deptColors: Record<string, string>;
}) {
  const [filter, setFilter] = React.useState<'all' | UserRole>('all');
  const [search, setSearch] = React.useState('');
  const [dept, setDept] = React.useState('all');
  const [showFormer, setShowFormer] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deptsOpen, setDeptsOpen] = React.useState(false);
  const [managing, setManaging] = React.useState<TeamMember | null>(null);

  const active = React.useMemo(() => members.filter((u) => u.isActive), [members]);
  const former = React.useMemo(() => members.filter((u) => !u.isActive), [members]);

  // Distinct departments across the whole org (active + former), sorted —
  // used to populate the department dropdown in the member modals.
  const departmentList = React.useMemo(
    () =>
      Array.from(new Set(members.map((u) => u.department).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [members],
  );

  // Per-department usage for the manage-departments modal: member headcount
  // (active + former) plus the goal count tagged to that department.
  const departmentStats = React.useMemo<DepartmentStat[]>(() => {
    const names = new Set<string>(departmentList);
    Object.keys(goalDeptCounts).forEach((d) => names.add(d));
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        memberCount: members.filter((u) => u.department === name).length,
        goalCount: goalDeptCounts[name] ?? 0,
        color: deptColors[name] ?? null,
      }));
  }, [departmentList, members, goalDeptCounts, deptColors]);

  const deps = React.useMemo(
    () => ['all', ...Array.from(new Set(active.map((u) => u.department)))],
    [active],
  );
  const punchedIn = React.useMemo(
    () => active.filter((u) => u.status === 'in').length,
    [active],
  );

  // Re-run the search/role/department filter only when an input actually
  // changes — not on every render (e.g. the per-second clock tick upstream).
  const filtered = React.useMemo(() => {
    const matches = (u: TeamMember) => {
      if (filter !== 'all' && u.role !== filter) return false;
      if (dept !== 'all' && u.department !== dept) return false;
      if (search && !u.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    };
    return active.filter(matches);
  }, [active, filter, dept, search]);

  // Board Members get their own section pinned to the very top (Founder first),
  // regardless of department — leadership is easiest to find up top.
  const boardGroup = React.useMemo(() => {
    const mem = filtered.filter((u) => u.role === 'board');
    if (mem.length === 0) return null;
    return {
      inCount: mem.filter((m) => m.status === 'in').length,
      members: mem.slice().sort((a, b) => {
        if (a.isFounder !== b.isFounder) return a.isFounder ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    };
  }, [filtered]);

  // Everyone else grouped by department, each group keeping its own header above
  // its members. Within a department, the member who HEADS it (isManager) leads
  // the group regardless of their base role — a Manager who is technically an
  // intern still runs the department, so they shouldn't sort behind plain
  // interns by ROLE_ORDER. After that, members fall back to role then name.
  // Departments themselves are A–Z. The groups are laid out side by side (see
  // the masonry container below) so small departments don't each hog a row.
  const deptGroups = React.useMemo(() => {
    const map = new Map<string, TeamMember[]>();
    for (const u of filtered) {
      if (u.role === 'board') continue;
      const key = u.department || 'No department';
      (map.get(key) ?? map.set(key, []).get(key)!).push(u);
    }
    return Array.from(map.entries())
      .map(([name, mem]) => ({
        name,
        color: deptColors[name] ?? 'var(--color-green-primary)',
        inCount: mem.filter((m) => m.status === 'in').length,
        members: mem.slice().sort((a, b) => {
          if (a.isManager !== b.isManager) return a.isManager ? -1 : 1;
          const pr = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
          return pr !== 0 ? pr : a.name.localeCompare(b.name);
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, deptColors]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <div className="page-subtitle">
            {active.length} active · {punchedIn} punched in today
            {former.length > 0 ? ` · ${former.length} former` : ''}
          </div>
        </div>
        <div className="page-header-actions">
          <Button icon="building" variant="secondary" onClick={() => setDeptsOpen(true)}>
            Departments
          </Button>
          <Button icon="plus" onClick={() => setCreateOpen(true)}>
            Create account
          </Button>
        </div>
      </div>

      <CreateMemberModal
        open={createOpen}
        departments={departmentList}
        onClose={() => setCreateOpen(false)}
      />
      <ManageDepartmentsModal
        open={deptsOpen}
        departments={departmentStats}
        onClose={() => setDeptsOpen(false)}
      />
      <ManageMemberModal
        member={managing}
        isSelf={managing?.id === currentUserId}
        viewerIsFounder={viewerIsFounder}
        departments={departmentList}
        allMembers={members}
        onClose={() => setManaging(null)}
      />

      <div className="card mb-6">
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Icon
              name="search"
              size={14}
              style={{ position: 'absolute', left: 12, top: 12, color: 'var(--color-grey-text)' }}
            />
            <input
              className="input"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 34 }}
            />
          </div>
          <div
            className="flex items-center gap-1"
            style={{
              background: 'var(--color-bg)',
              padding: 3,
              borderRadius: 6,
              border: '1px solid var(--color-border)',
            }}
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'board', label: 'Directors' },
                { id: 'fte', label: 'Full-Time' },
                { id: 'pte', label: 'Part-Time' },
                { id: 'intern', label: 'Interns' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 500,
                  background: filter === t.id ? 'var(--color-card)' : 'transparent',
                  color: filter === t.id ? 'var(--color-black)' : 'var(--color-grey-text)',
                  boxShadow: filter === t.id ? 'var(--shadow-card)' : 'none',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={dept}
            onChange={(e) => setDept(e.target.value)}
          >
            {deps.map((d) => (
              <option key={d} value={d}>
                {d === 'all' ? 'All departments' : d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {boardGroup ? (
        <section className="team-dept">
          <div className="team-dept-head">
            <span className="team-dept-accent" style={{ background: 'linear-gradient(180deg, #4285F4 0%, #EA4335 33%, #FBBC04 66%, #34A853 100%)' }} />
            <span className="team-dept-name">Directors</span>
            <span className="team-dept-count">{boardGroup.members.length}</span>
            {boardGroup.inCount > 0 ? (
              <span className="team-dept-in">
                <span className="dot dot-green" />
                {boardGroup.inCount} on the clock
              </span>
            ) : null}
          </div>
          <div className="grid grid-3 gap-4">
            {boardGroup.members.map((u, idx) => (
              <TeamCard key={u.id} u={u} onManage={setManaging} boardColor={BOARD_COLORS[idx % BOARD_COLORS.length]} />
            ))}
          </div>
        </section>
      ) : null}

      {deptGroups.length > 0 ? (
        <div className="team-depts">
          {deptGroups.map((g) => {
            // A block is as wide as its member count (capped at 3 columns), so a
            // multi-member department lays its cards out horizontally while a
            // single-member one stays narrow and packs beside its neighbours.
            const span = Math.min(g.members.length, 3);
            return (
              <section
                key={g.name}
                className="team-dept-block"
                style={{ gridColumn: `span ${span}` }}
              >
                <div className="team-dept-head">
                  <span className="team-dept-accent" style={{ background: g.color }} />
                  <span className="team-dept-name">{g.name}</span>
                  <span className="team-dept-count">{g.members.length}</span>
                  {g.inCount > 0 ? (
                    <span className="team-dept-in">
                      <span className="dot dot-green" />
                      {g.inCount} on the clock
                    </span>
                  ) : null}
                </div>
                <div
                  className="team-dept-members"
                  style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}
                >
                  {g.members.map((u) => (
                    <TeamCard key={u.id} u={u} onManage={setManaging} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
      {filtered.length === 0 && (
        <div className="empty-state">
          <Icon name="users" size={42} stroke={1.2} />
          <h3>No people match your filter</h3>
        </div>
      )}

      {/* Former members - hidden by default. */}
      {former.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <div
              className="text-xs text-grey fw-medium"
              style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Former members · {former.length}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setShowFormer((s) => !s)}>
              {showFormer ? 'Hide' : 'Show'}
            </Button>
          </div>
          {showFormer && (
            <div className="grid grid-3 gap-4">
              {former.map((u) => (
                <TeamCard key={u.id} u={u} onManage={setManaging} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
