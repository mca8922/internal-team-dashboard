'use client';

// Leaves view - request modal, board approvals, holiday manager. Ported from
// page-leaves-settings.jsx.
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Avatar, Button, Field, Modal, Progress, EmptyState } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  createLeave,
  reviewLeave,
  deleteLeave,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  loadMemberGoalsForHandoff,
} from '@/lib/actions';
import { MemberGoalsHandoff } from '@/components/MemberGoalsHandoff';
import { DatePicker } from '@/components/DatePicker';
import { Icon } from '@/components/Icon';
import { fmtDate, fmtShort, fmtFriendly, fmtWeekday, parseDate, daysBetween } from '@/lib/dates';
import { downloadCsv } from '@/lib/csv';
import type { LeaveUsage } from '@/lib/queries';
import type { Leave, Holiday, LeaveType } from '@/lib/types';

type LeaveWithName = Leave & {
  userName: string;
  userAvatarUrl?: string | null;
  preApproverName?: string | null;
};

const TYPE_META = [
  { id: 'casual' as const, name: 'Casual', color: 'var(--color-green-primary)' },
  { id: 'sick' as const, name: 'Sick', color: 'var(--color-slate)' },
  { id: 'emergency' as const, name: 'Emergency', color: 'var(--color-red)' },
];

function LeaveForm({
  usage,
  onSubmit,
  onCancel,
}: {
  usage: LeaveUsage;
  onSubmit: (d: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState({
    type: 'casual' as LeaveType,
    startDate: fmtDate(new Date()),
    endDate: fmtDate(new Date()),
    reason: '',
    isHalfDay: false,
  });
  const [err, setErr] = React.useState<Record<string, string>>({});
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Days this request would consume, matching how leaveUsage counts them
  // (half-day = 0.5, otherwise inclusive calendar days). WFH has no balance.
  const requestedDays =
    form.endDate < form.startDate
      ? 0
      : form.isHalfDay
        ? 0.5
        : (daysBetween(parseDate(form.startDate), parseDate(form.endDate)) || 0) + 1;
  const balancedType =
    form.type === 'casual' || form.type === 'sick' || form.type === 'emergency'
      ? form.type
      : null;
  const balanced = balancedType !== null;
  const remaining = balancedType ? usage.remaining[balancedType] : null;
  const overBalance = remaining != null && requestedDays > remaining;

  const submit = () => {
    const ne: Record<string, string> = {};
    if (form.endDate < form.startDate) ne.endDate = 'Must be after start';
    if (!form.reason.trim()) ne.reason = 'Tell us briefly';
    if (Object.keys(ne).length) {
      setErr(ne);
      return;
    }
    onSubmit(form);
  };

  return (
    <div className="grid gap-3">
      <Field label="Leave type">
        <select
          className="select"
          value={form.type}
          onChange={(e) => set('type', e.target.value as LeaveType)}
        >
          <option value="casual">Casual</option>
          <option value="sick">Sick (no prior approval needed)</option>
          <option value="emergency">Emergency</option>
          <option value="wfh">Work from home</option>
        </select>
      </Field>
      <div className="grid grid-2col-even" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Start" error={err.startDate}>
          <DatePicker
            value={form.startDate}
            onChange={(v) => set('startDate', v)}
            ariaLabel="Start date"
          />
        </Field>
        <Field label="End" error={err.endDate}>
          <DatePicker
            value={form.endDate}
            onChange={(v) => set('endDate', v)}
            min={form.startDate || undefined}
            ariaLabel="End date"
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate cursor-pointer">
        <input
          type="checkbox"
          checked={form.isHalfDay}
          onChange={(e) => set('isHalfDay', e.target.checked)}
        />
        Half day only
      </label>
      <Field label="Reason" error={err.reason}>
        <textarea
          className="textarea"
          rows={3}
          value={form.reason}
          onChange={(e) => set('reason', e.target.value)}
          placeholder="Why?"
        />
      </Field>
      {balanced ? (
        <div
          className="text-xs"
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: overBalance ? 'var(--color-amber-bg, #FEF3C7)' : 'var(--color-bg)',
            color: overBalance ? 'var(--color-amber-text)' : 'var(--color-grey-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          {overBalance
            ? `Heads up: this is ${requestedDays} day${requestedDays === 1 ? '' : 's'} but you have only ${remaining} ${form.type} day${remaining === 1 ? '' : 's'} left this quarter. You can still submit, and the Board will decide.`
            : `${requestedDays} day${requestedDays === 1 ? '' : 's'} · ${remaining} ${form.type} day${remaining === 1 ? '' : 's'} left this quarter.`}
        </div>
      ) : null}
      <div className="modal-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit}>Submit</Button>
      </div>
    </div>
  );
}

type HolidayTone = 'today' | 'soon' | 'future' | 'past';

// How urgent/how-far a holiday reads: today gets the gold spotlight, this
// week reads as "soon" (still green, just the brand's), further out is a
// quieter tint of the same green, and anything already gone recedes to grey.
function holidayTone(dateStr: string): { tone: HolidayTone; label: string } {
  const days = daysBetween(new Date(), parseDate(dateStr));
  if (days === 0) return { tone: 'today', label: 'Today' };
  if (days < 0) {
    const n = Math.abs(days);
    return { tone: 'past', label: n === 1 ? 'Yesterday' : `${n} days ago` };
  }
  if (days === 1) return { tone: 'soon', label: 'Tomorrow' };
  if (days <= 7) return { tone: 'soon', label: `In ${days} days` };
  return { tone: 'future', label: `In ${days} days` };
}

// "Company holidays" showcase — an Upcoming/Past segmented view (holidays are
// ordered oldest-first from the query; Upcoming keeps that order, Past is
// reversed so the most recent one leads). Board members get edit/delete right
// on each card — no need to open the separate "Manage holidays" modal for a
// quick fix. Everyone else just sees the calendar.
function HolidaysShowcase({ holidays, isBoard }: { holidays: Holiday[]; isBoard: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = React.useState<'upcoming' | 'past'>('upcoming');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ date: '', name: '' });
  const today = fmtDate(new Date());

  const upcoming = holidays.filter((h) => h.holiday_date >= today);
  const past = [...holidays.filter((h) => h.holiday_date < today)].reverse();
  const shown = tab === 'upcoming' ? upcoming : past;

  const startEdit = (h: Holiday) => {
    setEditingId(h.id);
    setForm({ date: h.holiday_date, name: h.name });
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async () => {
    if (!editingId || !form.date || !form.name.trim()) return;
    await updateHoliday(editingId, form.date, form.name.trim());
    toast('Holiday updated');
    setEditingId(null);
  };
  const remove = async (h: Holiday) => {
    const ok = await confirm({
      title: 'Delete holiday?',
      message: `“${h.name}” (${fmtShort(parseDate(h.holiday_date))}) will be removed from the company calendar.`,
      confirmLabel: 'Delete',
      icon: 'trash',
    });
    if (!ok) return;
    await deleteHoliday(h.id);
    toast('Holiday removed');
  };

  return (
    <div className="card mt-6">
      <div className="holiday-showcase-head">
        <div className="card-subtitle">Company holidays · {new Date().getFullYear()}</div>
        <div className="gb-viewswitch">
          <button
            type="button"
            className={`gb-viewswitch-btn${tab === 'upcoming' ? ' active' : ''}`}
            onClick={() => setTab('upcoming')}
          >
            Upcoming{upcoming.length ? ` (${upcoming.length})` : ''}
          </button>
          <button
            type="button"
            className={`gb-viewswitch-btn${tab === 'past' ? ' active' : ''}`}
            onClick={() => setTab('past')}
          >
            Past{past.length ? ` (${past.length})` : ''}
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="holiday-empty">
          {tab === 'upcoming' ? 'No upcoming holidays scheduled.' : 'No past holidays yet.'}
        </div>
      ) : (
        <div className="holiday-grid">
          {shown.map((h) => {
            if (editingId === h.id) {
              return (
                <div key={h.id} className="holiday-chip is-editing">
                  <div className="holiday-chip-edit-fields">
                    <DatePicker
                      value={form.date}
                      onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                      ariaLabel="Holiday date"
                    />
                    <input
                      className="input"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Holiday name"
                      aria-label="Holiday name"
                    />
                  </div>
                  <div className="holiday-chip-edit-actions">
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdit} disabled={!form.date || !form.name.trim()}>
                      Save
                    </Button>
                  </div>
                </div>
              );
            }
            const { tone, label } = holidayTone(h.holiday_date);
            return (
              <div
                key={h.id}
                className={`holiday-chip${tone === 'past' ? ' is-past' : ''}${tone === 'today' ? ' is-today' : ''}`}
              >
                <div className="holiday-chip-top">
                  <span className="holiday-chip-emoji" aria-hidden>
                    🎉
                  </span>
                  <div className="holiday-chip-name">{h.name}</div>
                </div>
                <div className="holiday-chip-bottom">
                  <span className="holiday-chip-date">
                    {fmtWeekday(parseDate(h.holiday_date))} · {fmtShort(parseDate(h.holiday_date))}
                  </span>
                  <span className={`holiday-chip-tag is-${tone}`}>{label}</span>
                </div>
                {isBoard ? (
                  <div className="holiday-chip-manage">
                    <button
                      type="button"
                      className="holiday-pill-btn"
                      aria-label="Edit holiday"
                      onClick={() => startEdit(h)}
                    >
                      <Icon name="edit" size={12} /> Edit
                    </button>
                    <span className="holiday-pill-sep" aria-hidden />
                    <button
                      type="button"
                      className="holiday-pill-btn holiday-pill-btn-danger"
                      aria-label="Delete holiday"
                      onClick={() => remove(h)}
                    >
                      <Icon name="trash" size={12} /> Delete
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HolidayManager({ holidays, onClose }: { holidays: Holiday[]; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = React.useState({ date: '', name: '' });

  const add = async () => {
    if (!form.date || !form.name) return;
    await createHoliday(form.date, form.name);
    setForm({ date: '', name: '' });
    toast('Holiday added');
  };

  return (
    <div>
      <div className="grid gap-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
        {holidays.map((h) => (
          <div
            key={h.id}
            className="flex items-center gap-3"
            style={{ padding: 8, background: 'var(--color-bg)', borderRadius: 6 }}
          >
            <div className="text-sm fw-medium" style={{ minWidth: 90 }}>
              {h.holiday_date}
            </div>
            <div className="flex-1">{h.name}</div>
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              onClick={async () => {
                await deleteHoliday(h.id);
                toast('Holiday removed');
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2 mt-4">
        <Field label="Date">
          <DatePicker
            value={form.date}
            onChange={(v) => setForm((f) => ({ ...f, date: v }))}
            ariaLabel="Holiday date"
          />
        </Field>
        <Field label="Name">
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ganesh Chaturthi"
          />
        </Field>
        <Button onClick={add}>Add</Button>
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function LeavesView({
  isBoard,
  isFounder,
  usage,
  myLeaves,
  allLeaves,
  holidays,
}: {
  isBoard: boolean;
  isFounder: boolean;
  usage: LeaveUsage;
  myLeaves: Leave[];
  allLeaves: LeaveWithName[];
  holidays: Holiday[];
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [modal, setModal] = React.useState(false);
  const [holidayModal, setHolidayModal] = React.useState(false);
  // The pending request a Board reviewer is acting on, plus a comment box.
  const [review, setReview] = React.useState<{
    leave: LeaveWithName;
    status: 'approved' | 'rejected';
  } | null>(null);
  const [reviewNote, setReviewNote] = React.useState('');
  // After a final leave approval, offer to cover that member's open goals.
  const [handoff, setHandoff] = React.useState<{
    memberId: string;
    memberName: string;
    range: string;
  } | null>(null);
  const [, startTransition] = React.useTransition();
  const refreshDate = fmtFriendly(parseDate(usage.quarter.nextStart));

  // Optimistic leave list — a request appears, and an approval/rejection
  // takes effect, the instant the action fires; the local mirror re-syncs
  // from props once the server revalidation lands (or on failure).
  const baseLeaves = React.useMemo<LeaveWithName[]>(
    () => (isBoard ? allLeaves : myLeaves.map((l) => ({ ...l, userName: '' }))),
    [isBoard, allLeaves, myLeaves],
  );
  const [leaves, setLeaves] = React.useState(baseLeaves);
  React.useEffect(() => setLeaves(baseLeaves), [baseLeaves]);

  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const listForTable = leaves;

  // Deep-link from a leave notification: `/leaves?leave=<id>` scrolls to that
  // leave's row and gives it the premium highlight so the user sees exactly
  // which one the notification was about. Reactive to the query so it fires even
  // when the bell is clicked while already on this page.
  const searchParams = useSearchParams();
  const leaveParam = searchParams.get('leave');
  const [flashLeaveId, setFlashLeaveId] = React.useState<string | null>(null);
  const handledLeaveRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!leaveParam) return;
    if (handledLeaveRef.current === leaveParam) return;
    if (!leaves.some((l) => l.id === leaveParam)) return; // not loaded yet
    handledLeaveRef.current = leaveParam;
    setFlashLeaveId(leaveParam);
    // Let the rows render, then scroll the (first) matching one into view.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-leave-id="${leaveParam}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const t = setTimeout(() => setFlashLeaveId(null), 3600);
    const url = new URL(window.location.href);
    url.searchParams.delete('leave');
    window.history.replaceState(window.history.state, '', url.toString());
    return () => clearTimeout(t);
  }, [leaveParam, leaves]);

  const submitLeave = (d: {
    type: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay: boolean;
  }) => {
    setModal(false);
    const optimistic: LeaveWithName = {
      id: 'optimistic-' + Date.now(),
      user_id: '',
      type: d.type,
      start_date: d.startDate,
      end_date: d.endDate,
      reason: d.reason,
      is_half_day: d.isHalfDay,
      status: 'pending',
      reviewed_by: null,
      review_note: '',
      pre_approved_by: null,
      pre_approved_at: null,
      created_at: new Date().toISOString(),
      userName: '',
    };
    setLeaves((cur) => [optimistic, ...cur]);
    startTransition(async () => {
      try {
        await createLeave(d);
        toast('Leave submitted');
      } catch {
        setLeaves(baseLeaves); // revert to server truth
        toast('Could not submit your leave request.', 'error');
      }
    });
  };

  // A Board Member who is not the Founder can only *accept* a request (a
  // pre-approval that awaits the Founder's finalisation); the Founder's
  // approval finalises it. Rejections are final for either.
  const preApproveOnly = (status: 'approved' | 'rejected') =>
    status === 'approved' && !isFounder;

  const decide = (id: string, status: 'approved' | 'rejected', note?: string) => {
    const comment = (note ?? '').trim();
    const lv = leaves.find((l) => l.id === id);
    setLeaves((cur) =>
      cur.map((l) =>
        l.id === id
          ? preApproveOnly(status)
            ? { ...l, pre_approved_by: 'me', preApproverName: 'You', review_note: comment }
            : { ...l, status, review_note: comment }
          : l,
      ),
    );
    // On the FINAL approval (not a pre-approval), offer to cover the member's
    // open goals — but only pop the modal if they actually have any.
    if (lv && status === 'approved' && !preApproveOnly(status)) {
      const range =
        fmtShort(parseDate(lv.start_date)) +
        (lv.start_date !== lv.end_date ? ` – ${fmtShort(parseDate(lv.end_date))}` : '');
      loadMemberGoalsForHandoff(lv.user_id)
        .then((d) => {
          if (d.goals.length > 0)
            setHandoff({ memberId: lv.user_id, memberName: lv.userName, range });
        })
        .catch(() => {});
    }
    startTransition(async () => {
      try {
        await reviewLeave(id, status, comment);
        toast(
          preApproveOnly(status)
            ? 'Accepted · sent to Nishit for final approval'
            : `Leave ${status}`,
        );
      } catch {
        setLeaves(baseLeaves); // revert to server truth
        toast('Could not update the leave request.', 'error');
      }
    });
  };

  // Open the comment box for an approve/reject decision.
  const openReview = (leave: LeaveWithName, status: 'approved' | 'rejected') => {
    setReviewNote('');
    setReview({ leave, status });
  };
  const submitReview = () => {
    if (!review) return;
    decide(review.leave.id, review.status, reviewNote);
    setReview(null);
  };

  // Founder-only: permanently delete a leave log.
  const remove = async (id: string) => {
    const ok = await confirm({
      title: 'Delete this leave log?',
      message: 'This permanently removes the request and its history. This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    setLeaves((cur) => cur.filter((l) => l.id !== id));
    startTransition(async () => {
      try {
        await deleteLeave(id);
        toast('Leave deleted');
      } catch {
        setLeaves(baseLeaves); // revert to server truth
        toast('Could not delete the leave.', 'error');
      }
    });
  };

  // Action buttons for one pending request, varying by who is reviewing.
  const reviewActions = (l: LeaveWithName) => {
    if (isFounder) {
      return (
        <>
          <Button size="sm" icon="check" onClick={() => openReview(l, 'approved')}>
            {l.pre_approved_by ? 'Finalize' : 'Approve'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openReview(l, 'rejected')}>
            Reject
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(l.id)} />
        </>
      );
    }
    return (
      <>
        {l.pre_approved_by ? (
          <span className="badge badge-amber">Awaiting Nishit</span>
        ) : (
          <Button size="sm" icon="check" onClick={() => openReview(l, 'approved')}>
            Accept
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => openReview(l, 'rejected')}>
          Reject
        </Button>
      </>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leaves</h1>
          <div className="page-subtitle">Time off, holidays, and approvals</div>
        </div>
        <div className="page-header-actions">
          {isBoard ? (
            <Button variant="secondary" icon="calendar" onClick={() => setHolidayModal(true)}>
              Set holidays
            </Button>
          ) : null}
          <Button icon="plus" onClick={() => setModal(true)}>
            Apply for leave
          </Button>
        </div>
      </div>

      <div
        className="card mb-4 flex items-center gap-3"
        style={{ borderLeft: '3px solid var(--color-green-primary)', flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 20 }}>🗓️</span>
        <div className="flex-1" style={{ minWidth: 200 }}>
          <div className="text-sm fw-medium">
            Leaves are allocated quarterly · {usage.quarter.label}
          </div>
          <div className="text-xs text-grey mt-1">
            Your balance refreshes on <strong>{refreshDate}</strong> (start of the next
            quarter). Unused days do not carry over.
          </div>
        </div>
      </div>

      <div className="grid grid-3 gap-4 mb-6">
        {TYPE_META.map((t) => {
          const total = usage.allotment[t.id];
          const remaining = usage.remaining[t.id];
          return (
            <div key={t.id} className="card">
              <div className="card-subtitle">{t.name} leave</div>
              <div className="flex items-end gap-2 mt-2">
                <div className="text-3xl fw-bold">{remaining}</div>
                <div className="text-sm text-grey mb-1">/ {total} this quarter</div>
              </div>
              <Progress value={total ? (remaining / total) * 100 : 0} color={t.color} />
              <div className="text-xs text-grey mt-2">
                {usage.used[t.id]} used · refreshes {fmtShort(parseDate(usage.quarter.nextStart))}
              </div>
            </div>
          );
        })}
      </div>

      {isBoard && pendingLeaves.length > 0 && (
        <div className="card mb-6 active-card">
          <div className="card-header">
            <div className="card-subtitle">Pending approvals · {pendingLeaves.length}</div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pendingLeaves.map((l) => (
                <tr key={l.id} data-leave-id={l.id} className={l.id === flashLeaveId ? 'leave-flash' : ''}>
                  <td className="fw-medium flex items-center gap-2">
                    <Avatar name={l.userName} size="sm" src={l.userAvatarUrl} />
                    {l.userName}
                  </td>
                  <td>
                    <span className="badge badge-slate" style={{ textTransform: 'capitalize' }}>
                      {l.type}
                    </span>
                  </td>
                  <td>
                    {fmtShort(parseDate(l.start_date))}
                    {l.start_date !== l.end_date
                      ? ` - ${fmtShort(parseDate(l.end_date))}`
                      : ''}
                  </td>
                  <td className="text-grey">
                    {l.reason}
                    {l.pre_approved_by ? (
                      <div className="text-xs" style={{ color: 'var(--color-amber-text)' }}>
                        Accepted by {l.preApproverName ?? 'a Board Member'} · awaiting final
                        approval
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right">{reviewActions(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-subtitle">{isBoard ? 'All leaves' : 'Your leaves'}</div>
          {listForTable.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              icon="archive"
              onClick={() =>
                downloadCsv(
                  `leaves-${fmtDate(new Date())}`,
                  listForTable,
                  [
                    ...(isBoard ? [{ header: 'Person', value: (l: LeaveWithName) => l.userName }] : []),
                    { header: 'Type', value: (l: LeaveWithName) => l.type },
                    { header: 'Half day', value: (l: LeaveWithName) => (l.is_half_day ? 'Yes' : 'No') },
                    { header: 'Start', value: (l: LeaveWithName) => l.start_date },
                    { header: 'End', value: (l: LeaveWithName) => l.end_date },
                    { header: 'Status', value: (l: LeaveWithName) => l.status },
                    { header: 'Reason', value: (l: LeaveWithName) => l.reason ?? '' },
                    { header: 'Review note', value: (l: LeaveWithName) => l.review_note ?? '' },
                  ],
                )
              }
            >
              Export CSV
            </Button>
          ) : null}
        </div>
        {listForTable.length === 0 ? (
          <EmptyState icon="plane" title="No leave history yet" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {isBoard ? <th>Person</th> : null}
                <th>Type</th>
                <th>Dates</th>
                <th>Reason</th>
                <th>Status</th>
                {isFounder ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {listForTable.map((l) => (
                <tr key={l.id} data-leave-id={l.id} className={l.id === flashLeaveId ? 'leave-flash' : ''}>
                  {isBoard ? <td className="fw-medium">{l.userName}</td> : null}
                  <td>
                    <span className="badge badge-slate" style={{ textTransform: 'capitalize' }}>
                      {l.type}
                      {l.is_half_day ? ' · ½' : ''}
                    </span>
                  </td>
                  <td>
                    {fmtShort(parseDate(l.start_date))}
                    {l.start_date !== l.end_date
                      ? ` - ${fmtShort(parseDate(l.end_date))}`
                      : ''}
                  </td>
                  <td className="text-grey">{l.reason || '-'}</td>
                  <td>
                    <span
                      className={`badge ${
                        l.status === 'approved'
                          ? ''
                          : l.status === 'rejected'
                            ? 'badge-red'
                            : 'badge-amber'
                      }`}
                    >
                      {l.status === 'pending' && l.pre_approved_by ? 'accepted' : l.status}
                    </span>
                    {l.review_note ? (
                      <div
                        className="text-xs text-grey mt-1"
                        style={{ whiteSpace: 'normal', maxWidth: 220 }}
                      >
                        💬 {l.review_note}
                      </div>
                    ) : null}
                  </td>
                  {isFounder ? (
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        onClick={() => remove(l.id)}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <HolidaysShowcase holidays={holidays} isBoard={isBoard} />

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Apply for leave"
        subtitle="Tell the Board what you need."
      >
        <LeaveForm usage={usage} onSubmit={submitLeave} onCancel={() => setModal(false)} />
      </Modal>

      <Modal
        open={holidayModal}
        onClose={() => setHolidayModal(false)}
        title="Manage holidays"
        subtitle="System-set days off the whole team shares."
      >
        <HolidayManager holidays={holidays} onClose={() => setHolidayModal(false)} />
      </Modal>

      <Modal
        open={!!review}
        onClose={() => setReview(null)}
        title={
          review
            ? review.status === 'approved'
              ? preApproveOnly('approved')
                ? 'Accept leave'
                : 'Approve leave'
              : 'Decline leave'
            : ''
        }
        subtitle={
          review
            ? `${review.leave.userName || 'Member'} · ${review.leave.type.toUpperCase()} · ${fmtShort(
                parseDate(review.leave.start_date),
              )}${
                review.leave.start_date !== review.leave.end_date
                  ? ` – ${fmtShort(parseDate(review.leave.end_date))}`
                  : ''
              }`
            : undefined
        }
      >
        <div className="grid gap-3">
          <Field label="Comment (optional), shared with the member">
            <textarea
              className="textarea"
              rows={3}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder={
                review?.status === 'approved'
                  ? 'Enjoy the time off!'
                  : 'Let them know why, or what to adjust.'
              }
            />
          </Field>
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              variant={review?.status === 'rejected' ? 'danger' : 'primary'}
              icon={review?.status === 'rejected' ? undefined : 'check'}
              onClick={submitReview}
            >
              {review?.status === 'rejected'
                ? 'Decline'
                : preApproveOnly('approved')
                  ? 'Accept'
                  : 'Approve'}
            </Button>
          </div>
        </div>
      </Modal>

      {handoff ? (
        <MemberGoalsHandoff
          open
          onClose={() => setHandoff(null)}
          memberId={handoff.memberId}
          memberName={handoff.memberName}
          contextLabel={`On leave · ${handoff.range}. Optionally reassign their goals to cover.`}
        />
      ) : null}
    </div>
  );
}
