'use client';

// Team pulse — the Board's "who is where, right now" card on the dashboard.
// Ported from the reStrucAI Internal Team Dashboard (Phase 3). The one
// difference: MCA has no In Office / WFH work mode, so roster rows carry no
// mode chip.
//
// Shape: one proportional bar (how the whole team splits across punched
// in / on leave / not yet, right now) sitting above a row of small pill
// chips (the same three counts, plus pending requests, each a hover/tap
// target). The bar answers "what does today look like" in one glance
// before any number is even read; the chips are where "who" lives — each
// opens the roster of the exact people it counts, with what each of them
// is actually doing: on the clock since 11:24 AM (ticking), left at 6:12 PM
// after 7h 40m, out sick until Friday, or a leave request still waiting on
// the Board.
//
// The "Not yet" chip also carries a small face-pile right on its face, with
// no interaction needed to see it. This card used to have a sibling further
// down the dashboard — "Flagged members" — showing the exact same people
// (not punched in, not on leave). Rather than say the same thing twice, that
// list now lives here, where the Board is already looking.
//
// Liveliness comes from three places, none of which needs a poll of its own:
//   - LiveData already refreshes this route on any punch/leave write, so the
//     server-computed buckets re-stream on their own.
//   - A 1s tick advances the running durations between those refreshes. It
//     starts from `nowMs` (stamped on the server) so the first client render
//     matches SSR exactly and hydration stays quiet.
//   - Realtime presence (usePresence) marks who is in the app this second,
//     which is a different question from who is punched in — and the gap
//     between the two ("in the app, not punched in") is worth seeing.
import * as React from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { usePresence } from '@/components/Presence';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { durationMs, fmtTime, fmtShort, fmtSince } from '@/lib/dates';
import type { LeaveType } from '@/lib/types';

// Short forms: both buckets that use these already say "leave" on the tile,
// so "Casual leave" would only spend width repeating it.
const LEAVE_LABEL: Record<LeaveType, string> = {
  casual: 'Casual',
  sick: 'Sick',
  emergency: 'Emergency',
  wfh: 'Work from home',
};

interface PulsePerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  department: string;
  deptColor: string;
  jobTitle: string;
}

export interface PulseWorking extends PulsePerson {
  lastOut: string | null;
  // Start of the session still running, or null when they have punched out
  // for now. Kept apart from `closedMs` so the open stretch can tick.
  openSince: string | null;
  closedMs: number;
  sessions: number;
}

export interface PulseAway extends PulsePerson {
  leaveType: LeaveType;
  halfDay: boolean;
  startDate: string;
  endDate: string;
}

export interface PulseRequest extends PulsePerson {
  // A member can have more than one request pending, so rows key off the
  // leave row's id, not the person's.
  reqId: string;
  leaveType: LeaveType;
  halfDay: boolean;
  startDate: string;
  endDate: string;
  days: number;
  askedAt: string;
  preApprovedBy: string | null;
}

export interface TeamPulseData {
  headcount: number;
  nowMs: number;
  working: PulseWorking[];
  away: PulseAway[];
  idle: PulsePerson[];
  requests: PulseRequest[];
}

// One clock for the whole card, so N ticking rows cost one interval and one
// re-render instead of N of each.
function useTick(startMs: number): number {
  const [now, setNow] = React.useState(startMs);
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function dateRange(start: string, end: string): string {
  return start === end ? fmtShort(start) : `${fmtShort(start)} – ${fmtShort(end)}`;
}

// One row of the roster, and every bucket uses the same three columns: face,
// person, value. Both text columns are exactly two lines — name over
// department on the left, value over its qualifier on the right — so a list
// of ten people reads as a table rather than as ten differently-shaped
// paragraphs.
//
// The job title is deliberately NOT a line of its own. It is the longest
// string in the row by far ("CEO | Director | Strategist") and it was the
// one thing making rows wrap to three and four lines; it lives in the row's
// tooltip instead, and in full on the profile this row links to.
//
// Also deliberately absent: a status that only restates the tile. A row
// under "Not yet" never says "no punch yet today" — the reader is hovering
// the words "Not yet" as they read it.
function PersonRow({
  person,
  accent,
  live,
  value,
  detail,
  note,
}: {
  person: PulsePerson;
  // Colour for the value column. Falls back to plain body text, so buckets
  // with nothing quantitative to show stay quiet rather than shouting.
  accent?: string;
  // A softly pulsing marker — only for states that are genuinely moving
  // (on the clock, in the app right now).
  live?: boolean;
  value?: React.ReactNode;
  detail?: React.ReactNode;
  // Third line, used only where the bucket genuinely has a story to tell
  // (who already accepted a request, how long it has been waiting).
  note?: React.ReactNode;
}) {
  const online = usePresence().has(person.id);
  return (
    <Link
      href={`/team/${person.id}`}
      className="pulse-row"
      title={person.jobTitle ? `${person.name} — ${person.jobTitle}` : person.name}
    >
      <span className="pulse-row-avatar">
        <Avatar name={person.name} src={person.avatarUrl} size="sm" />
        {online ? <span className="pulse-row-online" /> : null}
      </span>
      <span className="pulse-row-person">
        <span className="pulse-row-name">{person.name}</span>
        <span className="pulse-row-dept" style={{ color: person.deptColor }}>
          {person.department}
        </span>
        {note ? <span className="pulse-row-note">{note}</span> : null}
      </span>
      {value || detail ? (
        <span className="pulse-row-value">
          {value ? (
            <span className="pulse-row-value-main" style={accent ? { color: accent } : undefined}>
              {live ? (
                <span className="pulse-row-dot pulse-row-dot--live" style={{ background: accent }} />
              ) : null}
              {value}
            </span>
          ) : null}
          {detail ? <span className="pulse-row-value-sub">{detail}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}

function Chip({
  label,
  value,
  color,
  valueBg,
  align,
  preview,
  onOpenChange,
  children,
}: {
  label: string;
  value: number;
  color: string;
  // Tint behind the count — the same light-bg/saturated-text pairing the
  // app's own .badge already uses, so it stays readable in dark mode
  // instead of guessing at a white-on-accent contrast that only works on
  // some of the four colours (amber in particular is too pale in dark mode).
  valueBg: string;
  align: 'left' | 'right';
  // A glanceable extra shown right on the chip's face — for buckets where
  // knowing *who* matters even before the panel opens.
  preview?: React.ReactNode;
  // Lets the card raise its own stacking order while a panel is out, so the
  // panel paints over the cards below it instead of under them.
  onOpenChange: (open: boolean) => void;
  // The roster body. Mounted only while the panel is open — the ticking
  // durations inside it cost nothing the rest of the time.
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  // A tap pins the panel (touch has no hover); a second tap, Escape or a
  // click elsewhere releases it.
  const [pinned, setPinned] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Hover-out closes after a beat rather than instantly, so a pointer
  // travelling from the chip down into its panel (or cutting a corner on the
  // way) doesn't drop the panel mid-trip. Re-entering cancels the close.
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  React.useEffect(() => cancelClose, []);

  const notify = React.useRef(onOpenChange);
  notify.current = onOpenChange;
  React.useEffect(() => {
    notify.current(open);
  }, [open]);

  React.useEffect(() => {
    if (!pinned) return;
    const close = () => {
      setPinned(false);
      setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  return (
    <div
      ref={wrapRef}
      className={`pulse-chip${open ? ' is-open' : ''}`}
      style={{ ['--pulse-accent' as string]: color }}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (!pinned) scheduleClose();
      }}
    >
      <button
        type="button"
        className="pulse-chip-btn"
        aria-expanded={open}
        onClick={() => {
          setPinned((p) => !p);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned) setOpen(false);
        }}
      >
        <span className="pulse-chip-label">{label}</span>
        <span className="pulse-chip-value" style={{ background: valueBg, color }}>
          <AnimatedNumber value={value} />
        </span>
        {preview}
      </button>
      {open ? (
        <div className={`pulse-panel pulse-panel--${align}`} role="dialog" aria-label={label}>
          <div className="pulse-panel-head">
            <span>{label}</span>
            <span className="pulse-panel-count">{value}</span>
          </div>
          <div className="pulse-panel-body">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="pulse-group">{children}</div>;
}

// Who's behind a chip's number, at a glance — no hover, no click. Built for
// "Not yet": a board member should never have to open the panel just to see
// whether the flagged names are the usual suspects or someone new.
function Facepile({ people, max = 4 }: { people: PulsePerson[]; max?: number }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="pulse-facepile" aria-hidden="true">
      {shown.map((p) => (
        <span className="pulse-facepile-avatar" key={p.id}>
          <Avatar name={p.name} src={p.avatarUrl} size="sm" />
        </span>
      ))}
      {rest > 0 ? <span className="pulse-facepile-more">+{rest}</span> : null}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="pulse-empty">{children}</div>;
}

export function TeamPulse({ data }: { data: TeamPulseData }) {
  const now = useTick(data.nowMs);
  const online = usePresence();

  // How many panels are out. A count, not a boolean, because moving the
  // pointer from one tile to the next opens the second before the first has
  // closed — a boolean would flicker the card's z-index in that handover.
  const [openPanels, setOpenPanels] = React.useState(0);
  const setTileOpen = React.useCallback((open: boolean) => {
    setOpenPanels((n) => Math.max(0, n + (open ? 1 : -1)));
  }, []);

  const onClock = data.working.filter((w) => w.openSince);
  const wrapped = data.working.filter((w) => !w.openSince);

  const workedMs = (w: PulseWorking) =>
    w.closedMs + (w.openSince ? Math.max(0, now - new Date(w.openSince).getTime()) : 0);

  // The three shares of "where is everyone right now" — every profile is
  // exactly one of these, so the bar is a true partition of the team, not
  // three independent gauges. Pending requests is a different kind of fact
  // (asks waiting on the Board, not a place someone is) and sits outside it.
  const pct = (n: number) => (data.headcount === 0 ? 0 : (n / data.headcount) * 100);
  const workingPct = pct(data.working.length);
  const awayPct = pct(data.away.length);
  const idlePct = pct(data.idle.length);

  return (
    <div className={`card active-card pulse-card${openPanels > 0 ? ' is-open' : ''}`}>
      <div className="card-header">
        <div className="card-subtitle pulse-title">
          <span className="pulse-live-dot" aria-hidden="true" />
          Team pulse <span className="pulse-headcount">· {data.headcount} people</span>
        </div>
        <span className="badge badge-slate">Board view</span>
      </div>

      <div
        className="pulse-bar"
        role="img"
        aria-label={`${data.working.length} punched in, ${data.away.length} on leave, ${data.idle.length} not yet, out of ${data.headcount} people`}
      >
        <span
          className="pulse-bar-seg"
          style={{ width: `${workingPct}%`, background: 'var(--color-green-primary)' }}
        />
        <span
          className="pulse-bar-seg"
          style={{ width: `${awayPct}%`, background: 'var(--color-amber-vivid)' }}
        />
        <span className="pulse-bar-seg" style={{ width: `${idlePct}%`, background: 'var(--color-red)' }} />
      </div>

      <div className="pulse-chips">
        <Chip
          label="Punched in"
          value={data.working.length}
          color="var(--color-green-primary)"
          valueBg="var(--color-green-light)"
          align="left"
          onOpenChange={setTileOpen}
        >
          {data.working.length === 0 ? (
            <Empty>Nobody has punched in today.</Empty>
          ) : (
            <>
              {onClock.length > 0 ? <GroupLabel>On the clock · {onClock.length}</GroupLabel> : null}
              {onClock.map((w) => (
                <PersonRow
                  key={w.id}
                  person={w}
                  accent="var(--color-green-primary)"
                  live
                  value={durationMs(workedMs(w))}
                  detail={
                    <>
                      since {fmtTime(w.openSince!)}
                      {w.sessions > 1 ? ` · ${w.sessions} sessions` : ''}
                    </>
                  }
                />
              ))}
              {wrapped.length > 0 ? <GroupLabel>Left for now · {wrapped.length}</GroupLabel> : null}
              {wrapped.map((w) => (
                <PersonRow
                  key={w.id}
                  person={w}
                  value={durationMs(workedMs(w))}
                  detail={
                    <>
                      left {w.lastOut ? fmtTime(w.lastOut) : '—'}
                      {w.sessions > 1 ? ` · ${w.sessions} sessions` : ''}
                    </>
                  }
                />
              ))}
            </>
          )}
        </Chip>

        <Chip
          label="On leave"
          value={data.away.length}
          color="var(--color-amber-text)"
          valueBg="var(--color-amber-bg)"
          align="left"
          onOpenChange={setTileOpen}
        >
          {data.away.length === 0 ? (
            <Empty>Nobody is on leave today — full house.</Empty>
          ) : (
            data.away.map((a) => (
              <PersonRow
                key={a.id}
                person={a}
                accent="var(--color-amber-text)"
                value={
                  <>
                    {LEAVE_LABEL[a.leaveType]}
                    {a.halfDay ? ' · half day' : ''}
                  </>
                }
                detail={dateRange(a.startDate, a.endDate)}
              />
            ))
          )}
        </Chip>

        <Chip
          label="Not yet"
          value={data.idle.length}
          color="var(--color-red)"
          valueBg="var(--color-red-bg)"
          align="right"
          preview={<Facepile people={data.idle} max={3} />}
          onOpenChange={setTileOpen}
        >
          {data.idle.length === 0 ? (
            <Empty>Everyone is either on the clock or on leave.</Empty>
          ) : (
            // No status text here on purpose: the chip they are hovering
            // already says "Not yet". The only thing worth adding is that
            // someone is in the app but hasn't clocked on.
            data.idle.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                accent="var(--color-amber-text)"
                live={online.has(p.id)}
                value={online.has(p.id) ? 'In the app' : null}
              />
            ))
          )}
        </Chip>

        <Chip
          label="Pending reqs"
          value={data.requests.length}
          color="var(--color-slate)"
          valueBg="var(--color-slate-bg)"
          align="right"
          onOpenChange={setTileOpen}
        >
          {data.requests.length === 0 ? (
            <Empty>No leave requests waiting on the Board.</Empty>
          ) : (
            data.requests.map((r) => (
              <PersonRow
                key={r.reqId}
                person={r}
                accent="var(--color-slate)"
                value={
                  <>
                    {LEAVE_LABEL[r.leaveType]}
                    {r.halfDay ? ' · half day' : ` · ${r.days}d`}
                  </>
                }
                detail={dateRange(r.startDate, r.endDate)}
                note={
                  r.preApprovedBy
                    ? `Accepted by ${r.preApprovedBy}`
                    : `Asked ${fmtSince(r.askedAt)}`
                }
              />
            ))
          )}
        </Chip>
      </div>
    </div>
  );
}
