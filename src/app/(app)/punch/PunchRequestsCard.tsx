'use client';

// Punch time change requests — lets a member ask the Founder to correct a
// missed punch or reclassify a day as leave. Nothing on punches/leaves
// changes until the Founder approves (see src/app/(app)/team/requests).
import * as React from 'react';
import { Button, Field, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { submitPunchChangeRequest, withdrawPunchChangeRequest } from '@/lib/actions';
import { DateTimePicker } from '@/components/DateTimePicker';
import { fmtDateDMY, parseDate } from '@/lib/dates';
import {
  MONTHLY_REQUEST_LIMIT,
  monthKey,
  countsTowardMonthlyLimit,
  isForcedCorrection,
} from '@/lib/punch-requests';
import type { LeaveType, PunchChangeRequest, PunchChangeRequestType } from '@/lib/types';

const PUNCH_TYPE_LABEL: Record<PunchChangeRequestType, string> = {
  missed_punch: 'Missed punch',
  day_status: 'Day status',
  forgot_punch_out: 'Forgot punch-out',
};

const LEAVE_OPTIONS: { id: LeaveType; label: string }[] = [
  { id: 'casual', label: 'Casual leave' },
  { id: 'sick', label: 'Sick leave' },
  { id: 'emergency', label: 'Emergency leave' },
  { id: 'wfh', label: 'Work from home' },
];

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function RequestModal({
  date,
  usedThisMonth,
  onClose,
  onSubmitted,
}: {
  date: string;
  usedThisMonth: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const [type, setType] = React.useState<'missed_punch' | 'day_status'>('missed_punch');
  const [punchIn, setPunchIn] = React.useState(`${date}T09:00`);
  const [punchOut, setPunchOut] = React.useState(`${date}T18:00`);
  const [leaveType, setLeaveType] = React.useState<LeaveType>('casual');
  const [isHalfDay, setIsHalfDay] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const atLimit = usedThisMonth >= MONTHLY_REQUEST_LIMIT;

  const submit = async () => {
    if (!reason.trim()) {
      toast('Tell the Founder briefly why you need this change.', 'warning');
      return;
    }
    if (type === 'missed_punch' && !punchOut) {
      toast('Punch-out time is required.', 'warning');
      return;
    }
    setPending(true);
    const res = await submitPunchChangeRequest({
      workDate: date,
      requestType: type,
      punchIn: type === 'missed_punch' ? fromLocalInput(punchIn) : undefined,
      punchOut: type === 'missed_punch' && punchOut ? fromLocalInput(punchOut) : undefined,
      leaveType: type === 'day_status' ? leaveType : undefined,
      isHalfDay: type === 'day_status' ? isHalfDay : undefined,
      reason,
    });
    setPending(false);
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    toast('Request submitted');
    onSubmitted();
  };

  return (
    <div className="grid gap-3">
      <div className="text-sm fw-medium">{fmtDateDMY(parseDate(date))}</div>
      <div
        className="flex items-center gap-1"
        style={{ background: 'var(--color-bg)', padding: 3, borderRadius: 6, border: '1px solid var(--color-border)' }}
      >
        {(['missed_punch', 'day_status'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            style={{
              flex: 1,
              padding: '7px 14px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              background: type === t ? 'var(--color-card)' : 'transparent',
              color: type === t ? 'var(--color-black)' : 'var(--color-grey-text)',
              boxShadow: type === t ? 'var(--shadow-card)' : 'none',
            }}
          >
            {t === 'missed_punch' ? 'Missed punch' : 'Day status'}
          </button>
        ))}
      </div>

      {type === 'missed_punch' ? (
        <div className="grid grid-2col-even" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Punch in">
            <DateTimePicker value={punchIn} onChange={setPunchIn} ariaLabel="Punch in" />
          </Field>
          <Field label="Punch out">
            <DateTimePicker value={punchOut} onChange={setPunchOut} ariaLabel="Punch out" />
          </Field>
        </div>
      ) : (
        <>
          <Field label="Leave type">
            <select
              className="select"
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            >
              {LEAVE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate cursor-pointer">
            <input
              type="checkbox"
              checked={isHalfDay}
              onChange={(e) => setIsHalfDay(e.target.checked)}
            />
            Half day only
          </label>
        </>
      )}

      <Field label="Reason">
        <textarea
          className="textarea"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why do you need this change?"
        />
      </Field>

      <div className="text-xs text-grey">
        You&apos;ve used {usedThisMonth} of {MONTHLY_REQUEST_LIMIT} requests this month.
        {atLimit ? ' The cap resets next calendar month.' : ''}
      </div>

      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending || atLimit}>
          Submit
        </Button>
      </div>
    </div>
  );
}

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

export function PunchRequestsCard({
  days,
  today,
  myRequests,
}: {
  days: { date: string; hours: number; hasPendingRequest: boolean }[];
  today: string;
  myRequests: PunchChangeRequest[];
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [modalDate, setModalDate] = React.useState<string | null>(null);

  const thisMonth = monthKey(today);
  const usedThisMonth = myRequests.filter(
    (r) =>
      !isForcedCorrection(r.request_type) &&
      countsTowardMonthlyLimit(r.status) &&
      monthKey(r.created_at) === thisMonth,
  ).length;

  const withdraw = async (id: string) => {
    const ok = await confirm({
      title: 'Withdraw this request?',
      message: 'You can submit a new one for this date afterwards if needed.',
      confirmLabel: 'Withdraw',
      tone: 'danger',
      icon: 'x',
    });
    if (!ok) return;
    const res = await withdrawPunchChangeRequest(id);
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    toast('Request withdrawn');
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <>
      <div className="card mt-6">
        <div className="card-header">
          <div>
            <div className="card-subtitle">Punch requests</div>
            <div className="text-xs text-grey mt-1">
              Ask the Founder to fix a missed punch or reclassify a day as leave.
            </div>
          </div>
          <div className="text-xs text-grey">
            {usedThisMonth} / {MONTHLY_REQUEST_LIMIT} this month
          </div>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="data-table mt-3">
            <thead>
              <tr>
                <th>Date</th>
                <th>Hours worked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td>{fmtDateDMY(parseDate(d.date))}</td>
                  <td className="font-mono">{d.hours.toFixed(1)}h</td>
                  <td className="text-right">
                    {d.hasPendingRequest ? (
                      <span className="badge badge-amber">Pending</span>
                    ) : (
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => setModalDate(d.date)}>
                        Request change
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {myRequests.length > 0 ? (
        <div className="card mt-6">
          <div className="card-subtitle">My requests</div>
          <table className="data-table mt-3">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {myRequests.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateDMY(parseDate(r.work_date))}</td>
                  <td>{PUNCH_TYPE_LABEL[r.request_type] ?? 'Punch change'}</td>
                  <td>
                    <StatusPill status={r.status} />
                    {r.status === 'rejected' && r.review_note ? (
                      <div className="text-xs text-grey mt-1">Note: &quot;{r.review_note}&quot;</div>
                    ) : null}
                  </td>
                  <td className="text-right">
                    {r.status === 'pending' ? (
                      <Button size="sm" variant="ghost" icon="x" onClick={() => withdraw(r.id)}>
                        Withdraw
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal open={!!modalDate} onClose={() => setModalDate(null)} title="Request a punch change">
        {modalDate ? (
          <RequestModal
            date={modalDate}
            usedThisMonth={usedThisMonth}
            onClose={() => setModalDate(null)}
            onSubmitted={() => {
              setModalDate(null);
              if (typeof window !== 'undefined') window.location.reload();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
