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

// Rank inside a department block, top of the chain first:
// Director → Manager → Full-Time → Part-Time → Intern. A Manager outranks
// their base role — someone who heads the department runs it even if they are
// technically an intern, so they must not sort behind plain interns.
function chainRank(u: TeamMember): number {
  if (u.role === 'board') return 0;
  if (u.isManager) return 1;
  return 2 + ROLE_ORDER[u.role];
}

// Google brand palette — assigned by sort index (Founder first, then A-Z)
// so every board member always gets a distinct colour.
const BOARD_COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853'];

// Founders get a single shared golden identity instead of the per-person
// Google palette — they're a fixed, un-removable pair, not just "first on
// the board", so their cards should read as visually distinct from Directors.
const FOUNDER_COLOR = '#D4A017';


// Memoized — a card only re-renders when its own member data changes, not
// when an unrelated filter/search keystroke re-renders the grid.
const TeamCard = React.memo(function TeamCard({
  u,
  onManage,
  boardColor,
  founder,
}: {
  u: TeamMember;
  onManage: (m: TeamMember) => void;
  boardColor?: string;
  founder?: boolean;
}) {
  const router = useRouter();
  // Live "in the app right now" — updates in real time as teammates open or
  // close the dashboard, independent of whether they have punched in.
  const online = usePresence().has(u.id);
  const cardColor = founder ? FOUNDER_COLOR : boardColor;
  const accent = cardColor || u.deptColor || 'var(--color-green-primary)';
  const open = () => router.push('/team/' + u.id);
  return (
    <div
      className={`card team-card${cardColor ? ' team-card--board' : ''}${founder ? ' team-card--founder' : ''} ${u.isActive ? '' : 'member-left'}`}
      style={{ '--dept': accent, ...(cardColor ? { '--board-color': cardColor } : {}) } as React.CSSProperties}
    >
      {/* One clear clickable region: avatar, name, status and stats all open
          the member's profile. The Manage button below is the only part that
          does something else. */}
      <button type="button" className="team-card-open" onClick={open} title="View profile">
        <div className="flex items-center gap-3">
          {cardColor ? (
            <div className="team-board-avatar-ring" style={{ '--board-color': cardColor } as React.CSSProperties}>
              <Avatar name={u.name} size="lg" src={u.avatarUrl} />
              {founder ? (
                <span className="team-founder-crown">
                  <Icon name="crown" size={11} />
                </span>
              ) : null}
            </div>
          ) : (
            <Avatar name={u.name} size="lg" src={u.avatarUrl} />
          )}
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <div className="fw-bold">{u.name}</div>
              {online ? <span className="dot dot-live" title="Online now" /> : null}
              {u.isFounder ? (
                <span className="badge badge-black" style={cardColor ? { background: cardColor, color: '#fff' } : undefined}>Founder</span>
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
  viewerDepartment,
  goalDeptCounts,
  deptColors,
}: {
  members: TeamMember[];
  currentUserId: string;
  viewerIsFounder: boolean;
  // The department the viewer directs. Empty for a Founder, who belongs to
  // none and sees every department (migration 0058).
  viewerDepartment: string;
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

  // Distinct departments across the whole org (active + former), sorted — used
  // to populate the department dropdown in the member modals. Registered
  // departments are folded in from `departments` (via deptColors) as well as
  // those derived from members, so a newly created empty department can have
  // its first member assigned — otherwise it would be uncreatable in practice.
  const departmentList = React.useMemo(
    () =>
      Array.from(
        new Set([...members.map((u) => u.department), ...Object.keys(deptColors)].filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [members, deptColors],
  );

  // Per-department usage for the manage-departments modal: member headcount
  // (active + former) plus the goal count tagged to that department.
  const departmentStats = React.useMemo<DepartmentStat[]>(() => {
    const names = new Set<string>(departmentList);
    Object.keys(goalDeptCounts).forEach((d) => names.add(d));
    // Registered-but-empty departments live only in the `departments` table
    // (deptColors is keyed off it), so a freshly created one would vanish from
    // this list until someone was assigned to it.
    Object.keys(deptColors).forEach((d) => names.add(d));
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

  // Founders get their own section pinned above everything else — they're a
  // fixed, un-removable pair distinct from the rest of the board.
  const founderGroup = React.useMemo(() => {
    const mem = filtered.filter((u) => u.role === 'board' && u.isFounder);
    if (mem.length === 0) return null;
    return {
      inCount: mem.filter((m) => m.status === 'in').length,
      members: mem.slice().sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [filtered]);

  // The department is the org's security boundary (migration 0058), so it is
  // also the unit the grid is built from. Every non-Founder — Directors
  // included — falls into their own department block, ordered down the chain:
  // Director → Manager → staff. Directors no longer get a separate global
  // section; showing them detached from their department contradicted the
  // scope they actually hold.
  //
  // Departments themselves are A–Z. The blocks are laid out side by side (see
  // the masonry container below) so small departments don't each hog a row.
  const deptGroups = React.useMemo(() => {
    const map = new Map<string, TeamMember[]>();
    for (const u of filtered) {
      if (u.isFounder) continue; // Founders sit under no department
      const key = u.department || 'No department';
      (map.get(key) ?? map.set(key, []).get(key)!).push(u);
    }
    return Array.from(map.entries())
      .map(([name, mem]) => {
        const sorted = mem.slice().sort((a, b) => {
          const cr = chainRank(a) - chainRank(b);
          return cr !== 0 ? cr : a.name.localeCompare(b.name);
        });
        return {
          name,
          color: deptColors[name] ?? 'var(--color-green-primary)',
          inCount: sorted.filter((m) => m.status === 'in').length,
          // Named in the block header so it's obvious at a glance who owns the
          // department. Usually one; the model allows several.
          directors: sorted.filter((m) => m.role === 'board'),
          members: sorted,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, deptColors]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <div className="page-subtitle">
            {/* A Director's scope is one department, so say which — the counts
                below are their department's, not the whole company's. */}
            {viewerIsFounder ? null : `${viewerDepartment} · `}
            {active.length} active · {punchedIn} punched in today
            {former.length > 0 ? ` · ${former.length} former` : ''}
          </div>
        </div>
        <div className="page-header-actions">
          {/* Renaming or removing a department redraws the security boundaries
              themselves, so it stays with the Founders. */}
          {viewerIsFounder ? (
            <Button icon="building" variant="secondary" onClick={() => setDeptsOpen(true)}>
              Departments
            </Button>
          ) : null}
          <Button icon="plus" onClick={() => setCreateOpen(true)}>
            Create account
          </Button>
        </div>
      </div>

      <CreateMemberModal
        open={createOpen}
        departments={departmentList}
        viewerIsFounder={viewerIsFounder}
        viewerDepartment={viewerDepartment}
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

      {founderGroup ? (
        <section className="team-dept">
          <div className="team-dept-head">
            <span className="team-dept-accent" style={{ background: FOUNDER_COLOR }} />
            <span className="team-dept-name">Founders</span>
            <span className="team-dept-count">{founderGroup.members.length}</span>
            {founderGroup.inCount > 0 ? (
              <span className="team-dept-in">
                <span className="dot dot-green" />
                {founderGroup.inCount} on the clock
              </span>
            ) : null}
          </div>
          <div className="grid grid-3 gap-4">
            {founderGroup.members.map((u) => (
              <TeamCard key={u.id} u={u} onManage={setManaging} founder />
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
                  {g.directors.length > 0 ? (
                    <span className="team-dept-director" title="Director of this department">
                      <Icon name="shield" size={11} />
                      {g.directors.map((d) => d.name).join(', ')}
                    </span>
                  ) : (
                    <span className="team-dept-director team-dept-director--none">
                      No Director
                    </span>
                  )}
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
                    <TeamCard
                      key={u.id}
                      u={u}
                      onManage={setManaging}
                      boardColor={
                        u.role === 'board'
                          ? BOARD_COLORS[
                              g.directors.findIndex((d) => d.id === u.id) % BOARD_COLORS.length
                            ]
                          : undefined
                      }
                    />
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
