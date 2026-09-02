'use client';

// Punch console - the big circular punch button, live clock, session table,
// and 14-day heatmap. Ported from page-punch.jsx.
import * as React from 'react';
import { Progress, EmptyState, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { punchIn, punchOut } from '@/lib/actions';
import { ForgotPunchOutModal, type ForgotPunchOutSession } from './ForgotPunchOutModal';
import {
  fmtTimeFull,
  fmtTime,
  fmtFriendly,
  durationMs,
  durationHours,
  punchMsOnDate,
  punchTotalMsForDate,
} from '@/lib/dates';

type Status = 'not-started' | 'in' | 'complete';
interface Session {
  punch_in: string;
  punch_out: string | null;
  // True for a session dated a prior day whose post-midnight minutes still
  // count toward today (see punch/page.tsx's carryoverRows).
  carriedOver: boolean;
}

export function PunchConsole({
  today,
  todaySessions,
  status: serverStatus,
  expectedHrs,
  heat,
}: {
  today: string;
  todaySessions: Session[];
  status: Status;
  expectedHrs: number;
  heat: { ds: string; hours: number }[];
}) {
  const toast = useToast();
  const [now, setNow] = React.useState<Date | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Optimistic punch state — the button flips the instant it is clicked,
  // then re-syncs from the server once the action's revalidation lands.
  const [status, setStatus] = React.useState<Status>(serverStatus);
  React.useEffect(() => setStatus(serverStatus), [serverStatus]);
  // Set when punch-in is blocked by a session left open on an earlier day —
  // the member has to close it (ForgotPunchOutModal) before starting a new one.
  const [forgot, setForgot] = React.useState<ForgotPunchOutSession | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Clips each session to today's IST window so a carried-over session only
  // counts its post-midnight portion — matching the dashboard's total exactly.
  const total = punchTotalMsForDate(todaySessions, today, now ? now.getTime() : Date.now());
  const isOvertime = total > 9 * 60 * 60 * 1000;
  const pct = Math.min(100, (total / (expectedHrs * 60 * 60 * 1000)) * 100);

  const click = () => {
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
      const res = await punchIn();
      if (res?.forgotPunchOut) {
        setStatus(serverStatus); // revert the optimistic flip
        setForgot(res.forgotPunchOut);
        return;
      }
      toast('Punched in');
    });
  };

  // Called after the old session is closed — retry the punch-in that was blocked.
  const retryPunchIn = () => {
    setForgot(null);
    setStatus('in');
    startTransition(async () => {
      const res = await punchIn();
      if (res?.forgotPunchOut) {
        // Another still-open earlier session — resolve that one too.
        setStatus(serverStatus);
        setForgot(res.forgotPunchOut);
        return;
      }
      toast('Punched in');
    });
  };

  const heatCls = (h: number) => {
    if (h > 6) return 'heat-cell h4';
    if (h > 4) return 'heat-cell h3';
    if (h > 2) return 'heat-cell h2';
    if (h > 0) return 'heat-cell h1';
    return 'heat-cell';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Punch</h1>
          <div className="page-subtitle">
            Today · {now ? fmtFriendly(now) : ''}
          </div>
        </div>
      </div>

      <div className="grid grid-2col-even" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 32 }}>
          <div className="punch-hero">
            <div
              className="text-xs text-grey fw-medium"
              style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              {status === 'in'
                ? 'On the clock'
                : status === 'complete'
                  ? 'Session complete'
                  : 'Not started'}
            </div>
            <div className="punch-clock">{now ? fmtTimeFull(now) : '-'}</div>
            <button
              className={`punch-button ${status === 'in' ? 'punched-in' : ''} ${
                status === 'complete' ? 'complete' : ''
              }`}
              onClick={click}
              disabled={pending}
            >
              {status === 'in'
                ? 'PUNCH OUT'
                : status === 'complete'
                  ? 'PUNCH IN AGAIN'
                  : 'PUNCH IN'}
            </button>
            <div className="text-sm text-grey">
              {status === 'in' && todaySessions.length
                ? `Started at ${fmtTime(todaySessions[todaySessions.length - 1].punch_in)}`
                : 'Press the button to start a session'}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="card">
            <div className="card-subtitle">Total time today</div>
            <div className="flex items-end gap-3 mt-2">
              <div className="font-mono fw-bold" style={{ fontSize: 44, letterSpacing: '-0.02em' }}>
                {durationMs(total)}
              </div>
              <div className="text-sm text-grey mb-1">target {expectedHrs}h</div>
            </div>
            <Progress value={pct} />
            <div className="flex items-center justify-between mt-3 text-xs">
              <span className="text-grey">{Math.round(pct)}% of target</span>
              {isOvertime ? (
                <span className="badge badge-amber">
                  ⚠ Overtime ({durationHours(total)}h)
                </span>
              ) : null}
            </div>
          </div>
          <div className="card">
            <div className="card-subtitle">Today&apos;s plan</div>
            <div className="grid gap-2 mt-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="dot dot-green" />
                <span>Target: {expectedHrs} hours</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="dot dot-grey" />
                <span>Allowed sessions: unlimited</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="dot dot-amber" />
                <span>Overtime warning at 9h</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <div className="card-header">
          <div className="card-subtitle">Today&apos;s sessions</div>
          <div className="text-xs text-grey">
            {todaySessions.length} session{todaySessions.length !== 1 ? 's' : ''}
          </div>
        </div>
        {todaySessions.length === 0 ? (
          <EmptyState icon="clock" title="No sessions yet" hint="Hit the big green button to start." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Punch in</th>
                <th>Punch out</th>
                <th>Duration</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {todaySessions.map((s, i) => {
                const inT = new Date(s.punch_in);
                const outT = s.punch_out ? new Date(s.punch_out) : null;
                // Today's portion only — a carried-over session's pre-midnight
                // minutes belong to yesterday, not this total.
                const dur = punchMsOnDate(s, today, Date.now());
                return (
                  <tr key={i}>
                    <td className="text-grey">{i + 1}</td>
                    <td className="font-mono">
                      {fmtTime(inT)}
                      {s.carriedOver ? (
                        <span className="text-xs text-grey"> (yesterday)</span>
                      ) : null}
                    </td>
                    <td className="font-mono">
                      {outT ? (
                        fmtTime(outT)
                      ) : (
                        <span className="text-green fw-medium">in progress</span>
                      )}
                    </td>
                    <td className="fw-medium">{durationMs(dur)}</td>
                    <td>{!outT ? <span className="badge">Active</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card mt-6">
        <div className="card-header">
          <div>
            <div className="card-subtitle">Last 14 days</div>
            <div className="text-xs text-grey mt-1">
              Each square = one day. Darker = more hours.
            </div>
          </div>
        </div>
        <div className="flex items-end gap-1 mt-3" style={{ flexWrap: 'wrap' }}>
          {heat.map((c) => (
            <div
              key={c.ds}
              title={`${c.ds} · ${c.hours.toFixed(1)}h`}
              className={heatCls(c.hours)}
              style={{ width: 28, height: 28, borderRadius: 4 }}
            />
          ))}
          <div className="flex items-center gap-1 ml-3 text-xs text-grey">
            less
            <div className="heat-cell" />
            <div className="heat-cell h1" />
            <div className="heat-cell h2" />
            <div className="heat-cell h3" />
            <div className="heat-cell h4" />
            more
          </div>
        </div>
      </div>

      <Modal
        open={!!forgot}
        onClose={() => setForgot(null)}
        title="Close your open session"
      >
        {forgot ? (
          <ForgotPunchOutModal
            session={forgot}
            expectedHrs={expectedHrs}
            onResolved={retryPunchIn}
            onClose={() => setForgot(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}
