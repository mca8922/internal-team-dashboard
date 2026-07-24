'use client';

// Dashboard punch-status card. Punch in/out happens inline — the member
// stays on the dashboard.
import * as React from 'react';
import { Button, Progress } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { punchIn, punchOut } from '@/lib/actions';
import { durationMs, fmtTime } from '@/lib/dates';

type Status = 'not-started' | 'in' | 'complete';

export function PunchWidget({
  initialStatus,
  initialTotalMs,
  sessionCount,
  expectedHrs,
  lastPunchIn,
  lastPunchOut,
}: {
  initialStatus: Status;
  initialTotalMs: number;
  sessionCount: number;
  expectedHrs: number;
  lastPunchIn: string | null;
  lastPunchOut: string | null;
}) {
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  // Optimistic punch state — the button and status flip the instant they are
  // clicked, before the server round-trip. It re-syncs from props once the
  // action's revalidation lands (and is reverted by hand if punch-in fails).
  const [status, setStatus] = React.useState<Status>(initialStatus);
  React.useEffect(() => setStatus(initialStatus), [initialStatus]);
  // Tick the displayed total while punched in.
  const [extraMs, setExtraMs] = React.useState(0);
  React.useEffect(() => {
    if (initialStatus !== 'in') return;
    const id = setInterval(() => setExtraMs((x) => x + 30000), 30000);
    return () => clearInterval(id);
  }, [initialStatus]);

  // A session never counts beyond 24h — a forgotten punch stops accruing.
  const total = Math.min(initialTotalMs + extraMs, 24 * 60 * 60 * 1000);
  const pct = Math.min(100, (total / (expectedHrs * 60 * 60 * 1000)) * 100);
  const metTarget = total >= expectedHrs * 60 * 60 * 1000;
  // For a finished day, say whether the target was actually met instead of a
  // flat "Session complete" — the hours below already show the exact split.
  const statusLabel = {
    'not-started': 'Not started',
    in: 'Punched in',
    complete: metTarget ? 'Target met' : 'Wrapped up · below target',
  }[status];
  const dotCls = { 'not-started': 'dot-grey', in: 'dot-green', complete: 'dot-grey' }[
    status
  ];

  const onClick = () => {
    if (status === 'in') {
      setStatus('complete');
      startTransition(async () => {
        await punchOut();
        toast('Punched out.');
      });
      return;
    }
    setStatus('in');
    startTransition(async () => {
      await punchIn();
      toast('Punched in');
    });
  };

  return (
    <div
      className={`card ${status === 'in' ? 'active-card' : ''}`}
      data-tour="punch-widget"
    >
      <div className="card-header">
        <div>
          <div className="card-subtitle">Today&apos;s punch</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`dot ${dotCls}`} />
            <span className="fw-medium">{statusLabel}</span>
          </div>
        </div>
        <Button
          size="sm"
          variant={status === 'in' ? 'danger' : 'primary'}
          icon={status === 'in' ? 'pause' : 'play'}
          disabled={pending}
          onClick={onClick}
        >
          {status === 'in'
            ? 'Punch out'
            : status === 'complete'
              ? 'Punch in again'
              : 'Punch in'}
        </Button>
      </div>
      <div className="flex items-end gap-3 mt-3">
        <div className="text-3xl fw-bold font-mono">{durationMs(total)}</div>
        <div className="text-sm text-grey mb-1">of {expectedHrs}h target</div>
      </div>
      <Progress value={pct} />
      {sessionCount > 0 ? (
        <div className="text-xs text-grey mt-3">
          {sessionCount} session{sessionCount > 1 ? 's' : ''} · last{' '}
          {initialStatus === 'in' ? 'started' : 'ended'} at{' '}
          {fmtTime(initialStatus === 'in' ? lastPunchIn! : lastPunchOut!)}
        </div>
      ) : (
        <div className="text-xs text-grey mt-3">No sessions yet today.</div>
      )}
    </div>
  );
}
