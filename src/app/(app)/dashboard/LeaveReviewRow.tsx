'use client';

// One pending-leave row on the dashboard. Excludes the viewer's own request
// (see dashboard/page.tsx's reviewableList — you can't review your own
// leave). A Board Member who is not the Founder can only *accept* (a
// pre-approval awaiting Founder sign-off); the Founder finalises and may
// delete the log.
import * as React from 'react';
import { Avatar, Button } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { reviewLeave, deleteLeave } from '@/lib/actions';

export function LeaveReviewRow({
  id,
  userName,
  userAvatarUrl,
  type,
  range,
  isFounder,
  preApproverName,
}: {
  id: string;
  userName: string;
  userAvatarUrl?: string | null;
  type: string;
  range: string;
  isFounder: boolean;
  preApproverName: string | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, setPending] = React.useState(false);

  const decide = async (status: 'approved' | 'rejected') => {
    setPending(true);
    try {
      await reviewLeave(id, status);
      toast(
        status === 'approved' && !isFounder
          ? 'Accepted · sent for Founder approval'
          : `Leave ${status}`,
      );
    } catch (e) {
      setPending(false);
      toast((e as Error).message || 'Could not update the leave.', 'error');
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this leave log?',
      message: 'This permanently removes the request. This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    setPending(true);
    try {
      await deleteLeave(id);
      toast('Leave deleted');
    } catch (e) {
      setPending(false);
      toast((e as Error).message || 'Could not delete the leave.', 'error');
    }
  };

  return (
    <div
      className="flex items-center gap-3"
      style={{ padding: 10, borderRadius: 6, background: 'var(--color-bg)' }}
    >
      <Avatar name={userName} size="sm" src={userAvatarUrl} />
      <div className="flex-1">
        <div className="text-sm fw-medium">{userName}</div>
        <div className="text-xs text-grey">
          {type} · {range}
        </div>
        {preApproverName ? (
          <div className="text-xs" style={{ color: 'var(--color-amber-text)' }}>
            Accepted by {preApproverName} · {isFounder ? 'awaiting you' : 'awaiting Founder approval'}
          </div>
        ) : null}
      </div>
      {isFounder ? (
        <>
          <Button size="sm" icon="check" disabled={pending} onClick={() => decide('approved')}>
            {preApproverName ? 'Finalize' : 'Approve'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => decide('rejected')}
          >
            Decline
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            disabled={pending}
            onClick={remove}
          />
        </>
      ) : preApproverName ? (
        <>
          <span className="badge badge-amber">Awaiting Founder approval</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => decide('rejected')}
          >
            Decline
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" icon="check" disabled={pending} onClick={() => decide('approved')}>
            Accept
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => decide('rejected')}
          >
            Decline
          </Button>
        </>
      )}
    </div>
  );
}
