'use client';

// Founder-only punch-change-request queue — a lightweight inbox alongside the
// existing account "change requests" tab. Narrower than isBoard: only the
// Founder ever sees this (same restriction as FounderPunchEditor).
import * as React from 'react';
import { Avatar, Button, Field, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { approvePunchChangeRequest, rejectPunchChangeRequest } from '@/lib/actions';
import { fmtDateDMY, fmtTime, parseDate } from '@/lib/dates';
import type { PunchChangeRequest } from '@/lib/types';

const LEAVE_LABEL: Record<string, string> = {
  casual: 'Casual leave',
  sick: 'Sick leave',
  emergency: 'Emergency leave',
  wfh: 'Work from home',
};

function StatusPill({ status }: { status: PunchChangeRequest['status'] }) {
  const cls =
    status === 'approved'
      ? 'badge badge-green'
      : status === 'rejected'
        ? 'badge badge-red'
        : status === 'withdrawn'
          ? 'badge badge-slate'
          : 'badge badge-amber';
  return <span className={cls}>{status}</span>;
}

function PunchRequestCard({
  r,
  names,
  avatars,
  onActed,
}: {
  r: PunchChangeRequest;
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  onActed: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [note, setNote] = React.useState('');

  const memberName = names[r.user_id] ?? 'A member';
  const memberAvatarUrl = avatars[r.user_id] ?? null;

  const approve = async () => {
    setPending(true);
    const res = await approvePunchChangeRequest(r.id);
    setPending(false);
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    toast('Request approved & applied');
    onActed();
  };

  const reject = async () => {
    if (!note.trim()) {
      toast('A note is required when rejecting.', 'warning');
      return;
    }
    setPending(true);
    const res = await rejectPunchChangeRequest(r.id, note);
    setPending(false);
    setRejectOpen(false);
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
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
            {fmtDateDMY(parseDate(r.work_date))} · submitted{' '}
            {r.created_at ? fmtDateDMY(new Date(r.created_at)) : ''}
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
        {r.request_type === 'missed_punch' ? (
          <>
            <span className="text-xs fw-medium text-grey" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Missed punch
            </span>
            <span className="text-sm fw-bold">
              {r.requested_punch_in ? fmtTime(r.requested_punch_in) : '-'}
            </span>
            <Icon name="arrow-right" size={14} />
            <span className="text-sm fw-bold">
              {r.requested_punch_out ? fmtTime(r.requested_punch_out) : 'in progress'}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs fw-medium text-grey" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Day status
            </span>
            <span className="text-sm fw-bold">
              {r.requested_leave_type ? LEAVE_LABEL[r.requested_leave_type] : '-'}
              {r.requested_is_half_day ? ' · half-day' : ''}
            </span>
          </>
        )}
      </div>

      <div className="text-sm text-grey mt-2">Reason: {r.reason}</div>

      {r.status === 'rejected' && r.review_note ? (
        <div className="text-xs text-grey mt-2">Note: &quot;{r.review_note}&quot;</div>
      ) : null}

      {r.status === 'pending' ? (
        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" icon="check" onClick={approve} disabled={pending}>
            Approve & apply
          </Button>
          <Button size="sm" variant="secondary" icon="x" onClick={() => setRejectOpen(true)} disabled={pending}>
            Reject
          </Button>
        </div>
      ) : null}

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject punch request">
        <div className="text-sm text-grey mb-3">
          Tell {memberName} why this change isn&apos;t being made.
        </div>
        <Field label="Reason (required)">
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Please check with your manager and resubmit"
          />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={reject} disabled={pending || !note.trim()}>
            Reject request
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function PunchRequestsSection({
  requests,
  names,
  avatars,
}: {
  requests: PunchChangeRequest[];
  names: Record<string, string>;
  avatars: Record<string, string | null>;
}) {
  const [tab, setTab] = React.useState<'pending' | 'all'>('pending');
  const pending = requests.filter((r) => r.status === 'pending');
  const shown = tab === 'pending' ? pending : requests;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-subtitle">
            Punch time corrections team members have requested
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
          <Icon name="clock" size={42} stroke={1.2} />
          <h3>{tab === 'pending' ? 'No pending punch requests' : 'No punch requests yet'}</h3>
          <p className="text-grey text-sm">
            When a member requests a punch correction, it shows up here for approval.
          </p>
        </div>
      ) : (
        <div className="grid grid-2 gap-4">
          {shown.map((r) => (
            <PunchRequestCard
              key={r.id}
              r={r}
              names={names}
              avatars={avatars}
              onActed={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
