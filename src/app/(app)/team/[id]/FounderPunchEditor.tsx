'use client';

// Founder-only punch editor — rendered on a teammate's detail page.
//
// The Founder may correct anyone's punch_in / punch_out timestamps and
// delete sessions outright. Other Board Members never see this card; the
// server actions also re-check the caller via requireFounder().
import * as React from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { updatePunch, deletePunch } from '@/lib/actions';
import { DateTimePicker } from '@/components/DateTimePicker';
import { durationMs, fmtTime, fmtFriendly, parseDate } from '@/lib/dates';

interface PunchRow {
  id: string;
  work_date: string;
  punch_in: string;
  punch_out: string | null;
}

// Convert an ISO timestamp to the `YYYY-MM-DDTHH:mm` value expected by an
// <input type="datetime-local"> (rendered in the user's local zone — IST in
// practice for this app).
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  // The input gives us a wall-clock string with no timezone — interpret it
  // as local time and serialise to a UTC ISO string for storage.
  return new Date(value).toISOString();
}

function Row({ p }: { p: PunchRow }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState(false);
  const [pIn, setPIn] = React.useState(toLocalInput(p.punch_in));
  const [pOut, setPOut] = React.useState(toLocalInput(p.punch_out));
  const [pending, setPending] = React.useState(false);

  const reset = () => {
    setPIn(toLocalInput(p.punch_in));
    setPOut(toLocalInput(p.punch_out));
    setEditing(false);
  };

  const save = async () => {
    if (!pIn) {
      toast('Punch-in time is required.', 'warning');
      return;
    }
    setPending(true);
    try {
      await updatePunch(p.id, fromLocalInput(pIn), pOut ? fromLocalInput(pOut) : null);
      toast('Punch updated');
      setEditing(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this punch session?',
      message: `${fmtFriendly(parseDate(p.work_date))} · ${fmtTime(p.punch_in)} → ${
        p.punch_out ? fmtTime(p.punch_out) : 'in progress'
      }. This cannot be undone.`,
      confirmLabel: 'Delete session',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    setPending(true);
    try {
      await deletePunch(p.id);
      toast('Session deleted');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  const dur = p.punch_out
    ? new Date(p.punch_out).getTime() - new Date(p.punch_in).getTime()
    : Date.now() - new Date(p.punch_in).getTime();

  if (editing) {
    return (
      <tr>
        <td>{fmtFriendly(parseDate(p.work_date))}</td>
        <td>
          <div style={{ minWidth: 200 }}>
            <DateTimePicker value={pIn} onChange={setPIn} ariaLabel="Punch in" />
          </div>
        </td>
        <td>
          <div style={{ minWidth: 200 }}>
            <DateTimePicker value={pOut} onChange={setPOut} ariaLabel="Punch out" />
          </div>
          <div className="text-xs text-grey mt-1">Blank = still in progress</div>
        </td>
        <td>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={pending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{fmtFriendly(parseDate(p.work_date))}</td>
      <td className="font-mono">{fmtTime(p.punch_in)}</td>
      <td className="font-mono">
        {p.punch_out ? (
          fmtTime(p.punch_out)
        ) : (
          <span className="text-green fw-medium">in progress</span>
        )}
      </td>
      <td>
        <div className="flex items-center gap-2">
          <span className="fw-medium">{durationMs(dur)}</span>
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            onClick={() => setEditing(true)}
            disabled={pending}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            onClick={remove}
            disabled={pending}
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function FounderPunchEditor({
  memberName,
  punches,
}: {
  memberName: string;
  punches: PunchRow[];
}) {
  const sorted = [...punches].sort((a, b) => b.punch_in.localeCompare(a.punch_in));
  return (
    <div className="card mt-6">
      <div className="card-header">
        <div>
          <div className="card-subtitle">
            <Icon name="lock" size={14} /> Founder · punch corrections
          </div>
          <div className="text-xs text-grey mt-1">
            Edit or delete any of {memberName}&apos;s recent punch sessions. Use this only to
            fix data. Every change is final.
          </div>
        </div>
        <span className="badge badge-black">Founder only</span>
      </div>
      {sorted.length === 0 ? (
        <div className="text-grey text-sm mt-3">No punch sessions in the last 30 days.</div>
      ) : (
        <table className="data-table mt-3">
          <thead>
            <tr>
              <th>Date</th>
              <th>Punch in</th>
              <th>Punch out</th>
              <th>Duration / Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
