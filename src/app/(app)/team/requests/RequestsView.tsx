'use client';

// Change-request list. Board: approve / reject pending requests. Manager:
// read-only view of the requests they raised, with current status.
import * as React from 'react';
import { Avatar, Button, Field, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { approveChangeRequest, rejectChangeRequest } from '@/lib/actions';
import { roleLabel } from '@/lib/roles';
import { fmtDateDMY, fmtTime } from '@/lib/dates';
import type { ChangeRequest, ChangeRequestField, PunchChangeRequest, UserRole } from '@/lib/types';
import { PunchRequestsSection } from './PunchRequestsSection';

const FIELD_LABEL: Record<ChangeRequestField, string> = {
  email: 'Login email',
  role: 'Role',
  job_title: 'Job title',
  daily_target_hours: 'Daily target hours',
};

// Roles are stored raw in requested_value for the 'role' field — show a label.
function displayValue(field: ChangeRequestField, value: string | null): string {
  if (value == null || value === '') return '-';
  if (field === 'role') return roleLabel(value as UserRole);
  if (field === 'daily_target_hours') return `${value}h`;
  return value;
}

function StatusPill({ status }: { status: ChangeRequest['status'] }) {
  const cls =
    status === 'approved'
      ? 'badge badge-green'
      : status === 'rejected'
        ? 'badge badge-red'
        : 'badge badge-amber';
  return <span className={cls}>{status}</span>;
}

function RequestCard({
  r,
  names,
  avatars,
  isBoard,
  onActed,
}: {
  r: ChangeRequest;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  isBoard: boolean;
  onActed: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [note, setNote] = React.useState('');

  const memberName = names[r.member_id] ?? 'A member';
  const managerName = names[r.manager_id] ?? 'A manager';
  const memberAvatarUrl = avatars[r.member_id] ?? null;

  const approve = async () => {
    setPending(true);
    const res = await approveChangeRequest(r.id);
    setPending(false);
    if (res.error) return toast(res.error, 'error');
    toast('Request approved & applied');
    onActed();
  };

  const reject = async () => {
    setPending(true);
    const res = await rejectChangeRequest(r.id, note);
    setPending(false);
    setRejectOpen(false);
    if (res.error) return toast(res.error, 'error');
    toast('Request rejected');
    onActed();
  };

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <Avatar name={memberName} size="md" src={memberAvatarUrl} />
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="fw-bold">{memberName}</div>
          <div className="text-xs text-grey">
            Requested by {managerName} ·{' '}
            {r.created_at ? `${fmtDateDMY(new Date(r.created_at))} · ${fmtTime(new Date(r.created_at))}` : ''}
          </div>
        </div>
        <StatusPill status={r.status} />
      </div>

      <div
        className="mt-3 flex items-center gap-2"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: '10px 12px',
          flexWrap: 'wrap',
        }}
      >
        <span className="text-xs fw-medium text-grey" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {FIELD_LABEL[r.field]}
        </span>
        <span className="text-sm text-grey">{displayValue(r.field, r.current_value)}</span>
        <Icon name="arrow-right" size={14} />
        <span className="text-sm fw-bold">{displayValue(r.field, r.requested_value)}</span>
      </div>

      {r.status === 'rejected' && r.review_note ? (
        <div className="text-xs text-grey mt-2">Note: “{r.review_note}”</div>
      ) : null}

      {isBoard && r.status === 'pending' ? (
        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" icon="check" onClick={approve} disabled={pending}>
            Approve & apply
          </Button>
          <Button size="sm" variant="secondary" icon="x" onClick={() => setRejectOpen(true)} disabled={pending}>
            Reject
          </Button>
        </div>
      ) : null}

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject change request">
        <div className="text-sm text-grey mb-3">
          Optionally tell {managerName} why this change isn&apos;t being made.
        </div>
        <Field label="Reason (optional)">
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Let's discuss in our next 1:1"
          />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={reject} disabled={pending}>
            Reject request
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AccountChangeRequests({
  shown,
  pending,
  tab,
  setTab,
  names,
  avatars,
  isBoard,
}: {
  shown: ChangeRequest[];
  pending: ChangeRequest[];
  tab: 'pending' | 'all';
  setTab: (t: 'pending' | 'all') => void;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  isBoard: boolean;
}) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Change requests</h1>
          <div className="page-subtitle">
            {isBoard
              ? 'Account changes managers have requested for their team members'
              : 'Changes you’ve requested for your team. The Board approves or declines them'}
            {pending.length > 0 ? ` · ${pending.length} pending` : ''}
          </div>
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
          {(['pending', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '7px 14px',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                textTransform: 'capitalize',
                background: tab === t ? 'var(--color-card)' : 'transparent',
                color: tab === t ? 'var(--color-black)' : 'var(--color-grey-text)',
                boxShadow: tab === t ? 'var(--shadow-card)' : 'none',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          <Icon name="inbox" size={42} stroke={1.2} />
          <h3>{tab === 'pending' ? 'No pending requests' : 'No requests yet'}</h3>
          <p className="text-grey text-sm">
            {isBoard
              ? 'When a manager requests a change, it shows up here for approval.'
              : 'Open your team and use “Request change” to ask the Board for an account change.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-2 gap-4">
          {shown.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              names={names}
              avatars={avatars}
              isBoard={isBoard}
              onActed={() => {
                // The server action revalidates; nudge a refresh for instant UI.
                if (typeof window !== 'undefined') window.location.reload();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function RequestsView({
  requests,
  punchRequests,
  names,
  avatars,
  isBoard,
  isFounder,
}: {
  requests: ChangeRequest[];
  punchRequests: PunchChangeRequest[];
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  isBoard: boolean;
  isFounder: boolean;
}) {
  const [tab, setTab] = React.useState<'pending' | 'all'>('pending');
  // Only the Founder gets a second, outer tab for punch requests — everyone
  // else only ever sees account-change requests, unchanged from before.
  const [outerTab, setOuterTab] = React.useState<'account' | 'punch'>('account');

  const pending = requests.filter((r) => r.status === 'pending');
  const shown = tab === 'pending' ? pending : requests;
  const pendingPunch = punchRequests.filter((r) => r.status === 'pending').length;

  if (isFounder) {
    return (
      <div>
        <div
          className="flex items-center gap-1 mb-4"
          style={{
            background: 'var(--color-bg)',
            padding: 3,
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            width: 'fit-content',
          }}
        >
          <button
            onClick={() => setOuterTab('account')}
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              background: outerTab === 'account' ? 'var(--color-card)' : 'transparent',
              color: outerTab === 'account' ? 'var(--color-black)' : 'var(--color-grey-text)',
              boxShadow: outerTab === 'account' ? 'var(--shadow-card)' : 'none',
            }}
          >
            Account changes
          </button>
          <button
            onClick={() => setOuterTab('punch')}
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              background: outerTab === 'punch' ? 'var(--color-card)' : 'transparent',
              color: outerTab === 'punch' ? 'var(--color-black)' : 'var(--color-grey-text)',
              boxShadow: outerTab === 'punch' ? 'var(--shadow-card)' : 'none',
            }}
          >
            Punch requests{pendingPunch > 0 ? ` (${pendingPunch})` : ''}
          </button>
        </div>
        {outerTab === 'punch' ? (
          <PunchRequestsSection requests={punchRequests} names={names} avatars={avatars} />
        ) : (
          <AccountChangeRequests
            shown={shown}
            pending={pending}
            tab={tab}
            setTab={setTab}
            names={names}
            avatars={avatars}
            isBoard={isBoard}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Change requests</h1>
          <div className="page-subtitle">
            {isBoard
              ? 'Account changes managers have requested for their team members'
              : 'Changes you’ve requested for your team. The Board approves or declines them'}
            {pending.length > 0 ? ` · ${pending.length} pending` : ''}
          </div>
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
          {(['pending', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '7px 14px',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                textTransform: 'capitalize',
                background: tab === t ? 'var(--color-card)' : 'transparent',
                color: tab === t ? 'var(--color-black)' : 'var(--color-grey-text)',
                boxShadow: tab === t ? 'var(--shadow-card)' : 'none',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          <Icon name="inbox" size={42} stroke={1.2} />
          <h3>{tab === 'pending' ? 'No pending requests' : 'No requests yet'}</h3>
          <p className="text-grey text-sm">
            {isBoard
              ? 'When a manager requests a change, it shows up here for approval.'
              : 'Open your team and use “Request change” to ask the Board for an account change.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-2 gap-4">
          {shown.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              names={names}
              avatars={avatars}
              isBoard={isBoard}
              onActed={() => {
                // The server action revalidates; nudge a refresh for instant UI.
                if (typeof window !== 'undefined') window.location.reload();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
