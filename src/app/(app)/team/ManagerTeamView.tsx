'use client';

// Department Manager's team view — only the manager's picked team, with
// punch-based status and a "Request change" action per member. No daily-log
// information is shown anywhere here (managers never see team logs).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Field, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { usePresence } from '@/components/Presence';
import { ManagerBadge } from '@/components/ManagerBadge';
import { ResponsibilitiesCard } from './ResponsibilitiesCard';
import { roleLabel, weeklyTargetFromDaily } from '@/lib/roles';
import { durationMs } from '@/lib/dates';
import { submitChangeRequest } from '@/lib/actions';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import type { ChangeRequestField, UserRole } from '@/lib/types';

export interface ManagerTeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  deptColor: string | null;
  avatarUrl: string | null;
  jobTitle: string;
  targetHours: number | null;
  roleDefaultHours: number;
  status: 'in' | 'complete' | 'short' | 'not-started' | 'leave';
  todayMs: number;
  weeklyHours: number;
  lastSeenLabel: string;
}

const DOT: Record<ManagerTeamMember['status'], string> = {
  in: 'dot-green',
  complete: 'dot-grey',
  short: 'dot-amber',
  'not-started': 'dot-red',
  leave: 'dot-amber',
};
const DOT_LABEL: Record<ManagerTeamMember['status'], string> = {
  in: 'On the clock',
  complete: 'Done for today',
  short: 'Short day (under 60%)',
  'not-started': 'Not yet',
  leave: 'On leave',
};

const ROLE_ORDER: Record<UserRole, number> = { board: 0, fte: 1, pte: 2, intern: 3 };

function TeamCard({
  u,
  onRequest,
}: {
  u: ManagerTeamMember;
  onRequest: (m: ManagerTeamMember) => void;
}) {
  const router = useRouter();
  const online = usePresence().has(u.id);
  const accent = u.deptColor || 'var(--color-green-primary)';
  return (
    <div className="card team-card" style={{ '--dept': accent } as React.CSSProperties}>
      <button
        type="button"
        className="team-card-open"
        onClick={() => router.push('/team/' + u.id)}
        title="View analytics"
      >
        <div className="flex items-center gap-3">
          <Avatar name={u.name} size="lg" src={u.avatarUrl} />
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <div className="fw-bold">{u.name}</div>
              {online ? <span className="dot dot-live" title="Online now" /> : null}
            </div>
            <div className="text-xs mt-1 team-card-dept">
              <span className="dept-name-text">{u.department}</span>
              {!u.jobTitle ? <span className="text-grey"> · {roleLabel(u.role)}</span> : null}
            </div>
            {u.jobTitle ? (
              <div
                className="text-xs fw-medium mt-1"
                style={{ color: 'var(--color-black)', letterSpacing: '0.02em' }}
              >
                {roleLabel(u.role)} · {u.jobTitle}
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
        <div className="team-card-stats team-card-stats-2">
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
        </div>
      </button>
      {FEATURE_FLAGS.teamRequests ? (
        <div className="mt-3">
          <Button
            size="sm"
            variant="secondary"
            icon="edit"
            onClick={() => onRequest(u)}
            className="w-full"
          >
            Request change
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ManagerTeamView({
  department,
  deptColor,
  responsibilities,
  members,
}: {
  department: string;
  deptColor: string | null;
  responsibilities: string;
  members: ManagerTeamMember[];
}) {
  const [requesting, setRequesting] = React.useState<ManagerTeamMember | null>(null);

  const sorted = React.useMemo(
    () =>
      members
        .slice()
        .sort(
          (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name),
        ),
    [members],
  );
  const onClock = members.filter((m) => m.status === 'in').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Your Team</h1>
          <div className="page-subtitle">
            {members.length} member{members.length === 1 ? '' : 's'} · {onClock} on the clock ·
            daily logs are private to each member
          </div>
        </div>
        {department ? (
          <div className="page-header-actions">
            <ManagerBadge department={department} accent={deptColor} />
          </div>
        ) : null}
      </div>

      {responsibilities.trim() ? (
        <ResponsibilitiesCard
          value={responsibilities}
          accent={deptColor || 'var(--color-green-primary)'}
        />
      ) : null}

      {members.length === 0 ? (
        <div className="empty-state">
          <Icon name="users" size={42} stroke={1.2} />
          <h3>No team members yet</h3>
          <p className="text-grey text-sm">
            The Board hasn&apos;t assigned anyone to your team yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-3 gap-4">
          {sorted.map((u) => (
            <TeamCard key={u.id} u={u} onRequest={setRequesting} />
          ))}
        </div>
      )}

      <RequestChangeModal member={requesting} onClose={() => setRequesting(null)} />
    </div>
  );
}

// ── Request-change modal ──────────────────────────────────────────────────────
const FIELD_OPTIONS: { value: ChangeRequestField; label: string }[] = [
  { value: 'email', label: 'Login email' },
  { value: 'role', label: 'Role' },
  { value: 'job_title', label: 'Job title' },
  { value: 'daily_target_hours', label: 'Daily target hours' },
];

function RequestChangeModal({
  member,
  onClose,
}: {
  member: ManagerTeamMember | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [field, setField] = React.useState<ChangeRequestField>('job_title');
  const [value, setValue] = React.useState('');
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (member) {
      setField('job_title');
      setValue('');
    }
  }, [member]);

  if (!member) return null;

  const current: Record<ChangeRequestField, string> = {
    email: member.email,
    role: roleLabel(member.role),
    job_title: member.jobTitle || '-',
    daily_target_hours:
      member.targetHours != null ? `${member.targetHours}h` : `${member.roleDefaultHours}h (default)`,
  };

  const submit = async () => {
    setPending(true);
    const res = await submitChangeRequest(member.id, field, value);
    setPending(false);
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    toast('Request sent to the Board for approval');
    onClose();
  };

  return (
    <Modal open={!!member} onClose={onClose} title="Request a change">
      <div className="flex items-center gap-3 mb-4">
        <Avatar name={member.name} size="lg" src={member.avatarUrl} />
        <div>
          <div className="text-md fw-bold">{member.name}</div>
          <div className="text-xs text-grey">
            {member.department} · {roleLabel(member.role)}
          </div>
        </div>
      </div>

      <div className="text-xs text-grey mb-4">
        Managers can&apos;t edit accounts directly. Your request is sent to the Board, who
        approve or decline it. Joining date can&apos;t be changed this way.
      </div>

      <div className="grid gap-3">
        <Field label="What should change?">
          <select
            className="select"
            value={field}
            onChange={(e) => setField(e.target.value as ChangeRequestField)}
          >
            {FIELD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="text-xs text-grey">
          Current: <strong>{current[field]}</strong>
        </div>

        <Field label="Requested value">
          {field === 'role' ? (
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Pick a role…</option>
              <option value="fte">Full-Time</option>
              <option value="pte">Part-Time</option>
              <option value="intern">Intern</option>
            </select>
          ) : field === 'daily_target_hours' ? (
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={value}
              placeholder="e.g. 8"
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <input
              className="input"
              type={field === 'email' ? 'email' : 'text'}
              value={value}
              placeholder={field === 'email' ? 'name@company.com' : 'New value'}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || !value.trim()}>
          Send request
        </Button>
      </div>
    </Modal>
  );
}
