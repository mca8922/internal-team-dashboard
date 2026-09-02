'use client';

// One approvals inbox for every kind of request that needs a decision.
//
// This used to be two stacked tab bars: an outer Account / Punch switch and an
// inner Pending / All switch inside each. The outer split didn't earn its
// keep — both queues ask the same question ("someone needs your approval"),
// and in practice one of them carries all the traffic while the other barely
// gets used. So the two are merged into a single queue ordered by age, with
// the type shown per row and demoted to a filter.
//
// Who sees what is decided by RLS before the rows ever reach this component:
// punch requests arrive empty for anyone but the Founder, and account requests
// are scoped to the Board (all) or a Manager (their own). This component only
// decides who can ACT, which is narrower than who can see.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Field, Modal } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import {
  approveChangeRequest,
  rejectChangeRequest,
  approvePunchChangeRequest,
  rejectPunchChangeRequest,
} from '@/lib/actions';
import { roleLabel } from '@/lib/roles';
import { fmtDateDMY, fmtTime, parseDate } from '@/lib/dates';
import type {
  ChangeRequest,
  ChangeRequestField,
  PunchChangeRequest,
  PunchChangeRequestType,
  UserRole,
} from '@/lib/types';

const FIELD_LABEL: Record<ChangeRequestField, string> = {
  email: 'Login email',
  role: 'Role',
  job_title: 'Job title',
  daily_target_hours: 'Daily target hours',
};

// What each punch request type is asking for, in the member's language.
const PUNCH_LABEL: Record<PunchChangeRequestType, string> = {
  missed_punch: 'Missed punch',
  day_status: 'Day status',
  forgot_punch_out: 'Forgot punch-out',
};

// The two types that carry a proposed punch-in / punch-out pair.
const PUNCH_TIME_TYPES: PunchChangeRequestType[] = ['missed_punch', 'forgot_punch_out'];

const LEAVE_LABEL: Record<string, string> = {
  casual: 'Casual leave',
  sick: 'Sick leave',
  emergency: 'Emergency leave',
  wfh: 'Work from home',
};

// Roles are stored raw in requested_value for the 'role' field — show a label.
function displayValue(field: ChangeRequestField, value: string | null): string {
  if (value == null || value === '') return '-';
  if (field === 'role') return roleLabel(value as UserRole);
  if (field === 'daily_target_hours') return `${value}h`;
  return value;
}

type Kind = 'punch' | 'account';
type Status = 'pending' | 'approved' | 'rejected' | 'withdrawn';

// Both request tables flattened to the shape the queue actually renders, so
// the row component never branches on which table a row came from. Only the
// approve/reject calls still care.
interface Row {
  id: string;
  kind: Kind;
  personId: string;
  personName: string;
  personAvatar: string | null;
  // Account requests are raised BY a manager FOR a member; punch requests are
  // raised by the member themselves, so this is only set for account rows.
  raisedBy: string | null;
  status: Status;
  createdAt: string;
  reviewNote: string;
  // What is being changed, as a label plus an optional leading value.
  changeLabel: string;
  from: string | null;
  to: string;
  // Whether `from` is the value being REPLACED (an account change: Developer
  // -> Senior Developer) or simply the start of a range (a missed punch:
  // 09:15 -> 18:30, where both times are being requested, and neither is a
  // previous value). Struck-through text on a range would read as "this time
  // is being removed", which is the opposite of what is being asked for.
  fromIsPrevious: boolean;
  // Punch rows carry the working day being corrected and the member's reason.
  contextDate: string | null;
  reason: string | null;
  canAct: boolean;
  // The viewer's own punch request — they can never review it themselves,
  // even though they ARE a Founder. Only ever true on a punch row: account
  // requests are raised by a manager FOR someone else, never for themselves.
  isSelf: boolean;
}

function buildRows(
  requests: ChangeRequest[],
  punchRequests: PunchChangeRequest[],
  names: Record<string, string>,
  avatars: Record<string, string | null>,
  isBoard: boolean,
  isFounder: boolean,
  currentUserId: string,
): Row[] {
  const account: Row[] = requests.map((r) => ({
    id: r.id,
    kind: 'account',
    personId: r.member_id,
    personName: names[r.member_id] ?? 'A member',
    personAvatar: avatars[r.member_id] ?? null,
    raisedBy: names[r.manager_id] ?? 'A manager',
    status: r.status as Status,
    createdAt: r.created_at,
    reviewNote: r.review_note ?? '',
    changeLabel: FIELD_LABEL[r.field],
    from: displayValue(r.field, r.current_value),
    to: displayValue(r.field, r.requested_value),
    fromIsPrevious: true,
    contextDate: null,
    reason: null,
    canAct: isBoard && r.status === 'pending',
    isSelf: false,
  }));

  // Only the two request types this dashboard's schema supports: a missed
  // punch (add a punch for a day with none recorded) or a day-status change
  // (reclassify the day as leave). See PunchChangeRequestType.
  const punch: Row[] = punchRequests.map((r) => ({
    id: r.id,
    kind: 'punch',
    personId: r.user_id,
    personName: names[r.user_id] ?? 'A member',
    personAvatar: avatars[r.user_id] ?? null,
    raisedBy: null,
    status: r.status as Status,
    createdAt: r.created_at,
    reviewNote: r.review_note ?? '',
    changeLabel: PUNCH_LABEL[r.request_type] ?? 'Punch change',
    from:
      PUNCH_TIME_TYPES.includes(r.request_type) && r.requested_punch_in
        ? fmtTime(r.requested_punch_in)
        : null,
    to:
      PUNCH_TIME_TYPES.includes(r.request_type)
        ? r.requested_punch_out
          ? fmtTime(r.requested_punch_out)
          : 'in progress'
        : `${r.requested_leave_type ? LEAVE_LABEL[r.requested_leave_type] : '-'}${
            r.requested_is_half_day ? ' · half-day' : ''
          }`,
    fromIsPrevious: false,
    contextDate: r.work_date,
    reason: r.reason,
    // A Founder can never approve/reject their own punch request — the
    // server enforces the same rule (approvePunchChangeRequest /
    // rejectPunchChangeRequest), this just keeps the button from ever
    // being offered in the first place. Mirrors LeavesView's identical
    // "you cannot review your own request" self-check.
    canAct: isFounder && r.status === 'pending' && r.user_id !== currentUserId,
    isSelf: r.user_id === currentUserId,
  }));

  // Oldest pending first: those are the people who have been waiting longest.
  // Everything already decided sorts newest first underneath.
  return [...account, ...punch].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    return a.status === 'pending' ? at - bt : bt - at;
  });
}

// Coarse "how long have they waited". Hour granularity matters here: decisions
// on this queue land in a couple of hours, so "Today" would say nothing.
function waitedFor(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

const KIND_META: Record<Kind, { label: string; icon: IconName }> = {
  punch: { label: 'Punch', icon: 'clock' },
  account: { label: 'Account', icon: 'user' },
};

function StatusPill({ status }: { status: Status }) {
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

function RequestRow({
  r,
  now,
  onActed,
  hasActions,
}: {
  r: Row;
  now: number;
  onActed: () => void;
  hasActions: boolean;
}) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [open, setOpen] = React.useState(false);

  // Two clamped lines hold roughly this much; past it there is something
  // hidden worth offering to reveal.
  const longText = (r.reason?.length ?? 0) + (r.reviewNote?.length ?? 0) > 105;

  // A punch rejection must say why (the member gets the note); an account
  // rejection may.
  const noteRequired = r.kind === 'punch';

  const approve = async () => {
    setPending(true);
    const res =
      r.kind === 'punch'
        ? await approvePunchChangeRequest(r.id)
        : await approveChangeRequest(r.id);
    setPending(false);
    if (res?.error) return toast(res.error, 'error');
    toast('Approved and applied');
    onActed();
  };

  const reject = async () => {
    if (noteRequired && !note.trim()) {
      toast('A note is required when rejecting.', 'warning');
      return;
    }
    setPending(true);
    const res =
      r.kind === 'punch'
        ? await rejectPunchChangeRequest(r.id, note)
        : await rejectChangeRequest(r.id, note);
    setPending(false);
    setRejectOpen(false);
    if (res?.error) return toast(res.error, 'error');
    toast('Request rejected');
    onActed();
  };

  const meta = KIND_META[r.kind];
  const waited = waitedFor(r.createdAt, now);
  // Anything past a day on a queue that normally turns around in under two
  // hours deserves to be visible without reading timestamps.
  const isStale = r.status === 'pending' && now - new Date(r.createdAt).getTime() > 864e5;

  return (
    <tr className={`req-tr${r.status === 'pending' ? ' is-pending' : ''}`}>
      <td data-label="Member">
        <div className="req-member">
          <Avatar name={r.personName} size="sm" src={r.personAvatar} />
          <div className="req-member-text">
            <span className="req-who">{r.personName}</span>
            {r.raisedBy ? <span className="req-by">by {r.raisedBy}</span> : null}
          </div>
        </div>
      </td>

      <td data-label="Type">
        <span className={`req-kind req-kind-${r.kind}`}>
          <Icon name={meta.icon} size={11} />
          {meta.label}
        </span>
      </td>

      {/* The dash keeps the column aligned on desktop; on mobile each cell
          is its own labelled line, where an empty one is just noise. */}
      <td data-label="Day" className={`req-day${r.contextDate ? '' : ' req-cell-empty'}`}>
        {r.contextDate ? fmtDateDMY(parseDate(r.contextDate)) : <span className="req-dash">—</span>}
      </td>

      <td data-label={r.changeLabel}>
        <div className="req-change">
          <span className="req-change-label">{r.changeLabel}</span>
          <span className="req-change-vals">
            {r.from ? (
              <>
                <span className={r.fromIsPrevious ? 'req-from' : 'req-to'}>{r.from}</span>
                <Icon name="arrow-right" size={13} />
              </>
            ) : null}
            <span className="req-to">{r.to}</span>
          </span>
        </div>
      </td>

      {/* Clamped to two lines so rows stay comparable, with an expander for
          the ones that are genuinely longer. A title tooltip isn't good
          enough: it takes a second to appear, never appears on touch, and
          leaves the decline note unreadable too. */}
      <td
        data-label="Reason"
        className={`req-reason-cell${r.reason || r.reviewNote ? '' : ' req-cell-empty'}`}
      >
        {r.reason ? (
          <span className={`req-reason${open ? ' is-open' : ''}`}>“{r.reason}”</span>
        ) : (
          <span className="req-dash">—</span>
        )}
        {r.status === 'rejected' && r.reviewNote ? (
          <span className={`req-note${open ? ' is-open' : ''}`}>
            Declined: “{r.reviewNote}”
          </span>
        ) : null}
        {longText ? (
          <button
            type="button"
            className="req-more"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? 'Show less' : 'Show more'}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
          </button>
        ) : null}
      </td>

      <td data-label="Status" className="req-status-cell">
        {r.status === 'pending' ? (
          <span
            className={`req-age${isStale ? ' is-stale' : ''}`}
            title={`Submitted ${fmtDateDMY(new Date(r.createdAt))}`}
          >
            {waited}
          </span>
        ) : (
          <StatusPill status={r.status} />
        )}
      </td>

      {hasActions ? (
        <td data-label="" className="req-action-cell">
          {r.canAct ? (
            <div className="req-actions">
              <Button size="sm" icon="check" onClick={approve} disabled={pending}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="x"
                onClick={() => setRejectOpen(true)}
                disabled={pending}
              >
                Decline
              </Button>
            </div>
          ) : r.isSelf && r.status === 'pending' ? (
            // Your own punch request — you can't review it yourself, even as
            // a Founder. The other Founder needs to. Mirrors the "Awaiting
            // another Director's review" badge LeavesView shows on your own
            // leave request.
            <span className="badge badge-amber">Waiting on the other Founder</span>
          ) : null}

          <Modal
            open={rejectOpen}
            onClose={() => setRejectOpen(false)}
            title={r.kind === 'punch' ? 'Decline punch request' : 'Decline change request'}
          >
            <div className="text-sm text-grey mb-3">
              {noteRequired
                ? `Tell ${r.personName} why this change isn't being made.`
                : `Optionally tell ${r.raisedBy ?? 'the manager'} why this change isn't being made.`}
            </div>
            <Field label={noteRequired ? 'Reason (required)' : 'Reason (optional)'}>
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
              <Button
                variant="danger"
                onClick={reject}
                disabled={pending || (noteRequired && !note.trim())}
              >
                Decline request
              </Button>
            </div>
          </Modal>
        </td>
      ) : null}
    </tr>
  );
}

export function RequestsView({
  requests,
  punchRequests,
  names,
  avatars,
  isBoard,
  isFounder,
  currentUserId,
}: {
  requests: ChangeRequest[];
  punchRequests: PunchChangeRequest[];
  names: Record<string, string>;
  avatars: Record<string, string | null>;
  isBoard: boolean;
  isFounder: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [scope, setScope] = React.useState<'pending' | 'all'>('pending');
  const [kind, setKind] = React.useState<Kind | 'all'>('all');

  // Ages are computed against a clock held in state rather than Date.now() at
  // render: the server pass and the client hydration would otherwise disagree
  // about "3h" and warn. Ticks every minute so a waiting row keeps counting.
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const rows = React.useMemo(
    () => buildRows(requests, punchRequests, names, avatars, isBoard, isFounder, currentUserId),
    [requests, punchRequests, names, avatars, isBoard, isFounder, currentUserId],
  );

  const pending = rows.filter((r) => r.status === 'pending');
  const counts = {
    all: rows.length,
    punch: rows.filter((r) => r.kind === 'punch').length,
    account: rows.filter((r) => r.kind === 'account').length,
  };

  const shown = rows
    .filter((r) => (scope === 'pending' ? r.status === 'pending' : true))
    .filter((r) => (kind === 'all' ? true : r.kind === kind));

  const oldest = pending.length && now ? waitedFor(pending[0].createdAt, now) : null;

  // No point holding a column open for buttons nobody on this screen can
  // press: a Manager's read-only view and a fully-decided queue both give
  // that width back to the Reason column instead. A self-request still
  // needs the column, though — it's where the "waiting on the other
  // Founder" note goes instead of the (withheld) buttons.
  const hasActions = shown.some((r) => r.canAct || (r.isSelf && r.status === 'pending'));

  // Only the Founder ever has more than one kind in the list, so the type
  // filter would be a row of one button for everyone else.
  const showKindFilter = counts.punch > 0 && counts.account > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Change requests</h1>
          <div className="page-subtitle">
            {isBoard
              ? 'Approvals waiting on you'
              : 'Changes you’ve requested for your team. The Board approves or declines them'}
          </div>
        </div>
        <div className="tabbar" role="tablist" aria-label="Which requests to show">
          {(['pending', 'all'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={scope === t}
              className={`tabbar-btn${scope === t ? ' tabbar-btn-on' : ''}`}
              onClick={() => setScope(t)}
            >
              {t === 'pending' ? 'Pending' : 'All'}
              {t === 'pending' && pending.length > 0 ? (
                <span className="req-count">{pending.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {pending.length > 0 ? (
        <div className="req-health">
          <div className="req-health-stat">
            <span className="req-health-num">{pending.length}</span>
            <span className="req-health-lbl">waiting</span>
          </div>
          {oldest ? (
            <div className="req-health-stat">
              <span className="req-health-num">{oldest}</span>
              <span className="req-health-lbl">longest wait</span>
            </div>
          ) : null}
          <div className="req-health-hint">
            <Icon name="bolt" size={13} />
            Approving applies the change immediately.
          </div>
        </div>
      ) : null}

      {showKindFilter ? (
        <div className="req-filters">
          {(
            [
              { id: 'all' as const, label: 'All', n: counts.all },
              { id: 'punch' as const, label: 'Punch corrections', n: counts.punch },
              { id: 'account' as const, label: 'Account changes', n: counts.account },
            ]
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              className={`req-filter${kind === f.id ? ' on' : ''}`}
              onClick={() => setKind(f.id)}
              aria-pressed={kind === f.id}
            >
              {f.label}
              <span className="req-filter-n">{f.n}</span>
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="empty-state">
          <Icon name={scope === 'pending' ? 'check' : 'inbox'} size={42} stroke={1.2} />
          <h3>
            {scope === 'pending'
              ? rows.length > 0
                ? 'All caught up'
                : 'Nothing waiting'
              : 'No requests yet'}
          </h3>
          <p className="text-grey text-sm">
            {isBoard
              ? scope === 'pending' && rows.length > 0
                ? 'Every request has been decided. Switch to All to see the history.'
                : 'Punch corrections and account changes needing your approval land here.'
              : 'Open your team and use “Request change” to ask the Board for an account change.'}
          </p>
        </div>
      ) : (
        <div className="req-table-wrap">
          <table className="data-table req-table">
            {/* Fixed layout with declared widths: otherwise the browser sizes
                columns from content, so the Reason column jumps around as
                rows change and the clamp cuts at an unpredictable point. */}
            <colgroup>
              <col style={{ width: hasActions ? '16%' : '20%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: hasActions ? '9%' : '10%' }} />
              <col style={{ width: hasActions ? '17%' : '21%' }} />
              <col style={{ width: hasActions ? '28%' : '33%' }} />
              <col style={{ width: '8%' }} />
              {hasActions ? <col style={{ width: '14%' }} /> : null}
            </colgroup>
            <thead>
              <tr>
                <th>Member</th>
                <th>Type</th>
                <th>Day</th>
                <th>Change</th>
                <th>Reason</th>
                <th>Status</th>
                {/* Only present when something on screen can be acted on, so a
                    fully-decided queue gives the width back to Reason. */}
                {hasActions ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RequestRow
                  key={`${r.kind}:${r.id}`}
                  r={r}
                  now={now ?? new Date(r.createdAt).getTime()}
                  // The server action revalidates; refresh the tree in place
                  // rather than reloading the page, which used to throw away
                  // the filter and scroll position on every decision.
                  onActed={() => router.refresh()}
                  hasActions={hasActions}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
