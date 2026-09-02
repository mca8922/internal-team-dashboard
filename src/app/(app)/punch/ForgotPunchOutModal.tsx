'use client';

// Shown when a member tries to punch in but still has a session open from an
// earlier day (they forgot to punch out and it has crossed the stale window).
// They must say when they actually left — that closes the old session
// provisionally and files a 'forgot_punch_out' request for the Founder to
// review — before a new session can start. The Founder's decision doesn't
// gate anything; filing it is enough.
import * as React from 'react';
import { Button, Field } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { DateTimePicker } from '@/components/DateTimePicker';
import { submitForgotPunchOut } from '@/lib/actions';
import { fmtDateDMY, fmtTime, parseDate } from '@/lib/dates';

export interface ForgotPunchOutSession {
  punchId: string;
  workDate: string;
  punchInAt: string; // ISO
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function ForgotPunchOutModal({
  session,
  expectedHrs,
  onResolved,
  onClose,
}: {
  session: ForgotPunchOutSession;
  expectedHrs: number;
  onResolved: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const inDate = React.useMemo(() => new Date(session.punchInAt), [session.punchInAt]);

  // Prefill: punch-in + the member's target hours, but never past now.
  const [punchOut, setPunchOut] = React.useState(() => {
    const guess = new Date(inDate.getTime() + expectedHrs * 60 * 60 * 1000);
    return toLocalInput(guess.getTime() > Date.now() ? new Date() : guess);
  });
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      toast('Tell us briefly what happened.', 'warning');
      return;
    }
    const outMs = new Date(punchOut).getTime();
    if (!Number.isFinite(outMs) || outMs <= inDate.getTime()) {
      toast('Punch-out must be after punch-in.', 'warning');
      return;
    }
    setPending(true);
    const res = await submitForgotPunchOut({
      punchId: session.punchId,
      punchOut: new Date(punchOut).toISOString(),
      reason: reason.trim(),
    });
    setPending(false);
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    toast('Old session closed — the Founder will review it.');
    onResolved();
  };

  return (
    <div className="grid gap-3">
      <div className="text-sm text-slate">
        You didn&apos;t punch out on{' '}
        <span className="fw-medium">{fmtDateDMY(parseDate(session.workDate))}</span> — that
        session started at{' '}
        <span className="font-mono">{fmtTime(session.punchInAt)}</span> and is still
        running. Tell us when you actually left, then you can punch in.
      </div>

      <Field label="When did you leave?">
        <DateTimePicker value={punchOut} onChange={setPunchOut} ariaLabel="Punch out time" />
      </Field>

      <Field label="What happened?">
        <textarea
          className="textarea"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Left for the day and forgot to punch out"
        />
      </Field>

      <div className="text-xs text-grey">
        This closes the old session at the time you enter and sends it to the Founder to
        confirm. It doesn&apos;t count against your monthly punch requests.
      </div>

      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          Close session &amp; continue
        </Button>
      </div>
    </div>
  );
}
