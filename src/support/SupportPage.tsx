'use client';

// The client's whole Support page — one component, so the fork's route file is
// three lines and there is nothing to wire up wrong.
//
// Reached from a Support entry in the sidebar, not a "?" in the top bar. That
// is the deliberate difference from reStrucAI's own dashboard: a client's team
// is a handful of people who raise a request occasionally, and a nav entry is
// what they will actually find. A topbar icon is for staff who live in the app.
//
// Layout mirrors reStrucAI's own /support so the two read as one product:
// page header, ticket list, detail in a modal. The one addition is the
// "Report an issue" button in the header — with no "?", this page is the only
// way in, so raising a request has to be the most obvious thing on it.
//
// A ticket is a record of state, not a chat: what was asked, and where it got
// to. There is no reply box, because the conversation happens over email and
// two places to look is how a reply gets missed.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { STATUS_LABEL, STATUS_TONE, SLA_HOURS, timeAgo, type TicketDraft } from './support-shared';
import { openMyTicket, resolveTicket } from './support-actions';
import { SupportReportModal } from './SupportReportModal';
import { AboutRestrucAI } from './AboutRestrucAI';
import type { RemoteTicket, RemoteTicketDetail } from './support-api';

// What the page hands DOWN to an assistant pane, so the pane can send someone
// into the ticket flow without knowing anything about how this page works.
export interface SupportAssistantApi {
  // Switch to the ticket tab and open the report form, optionally pre-filled.
  // Opens the form; never sends it — the person still reviews and submits.
  raiseTicket: (draft?: TicketDraft) => void;
}

// Delivered by context rather than as a prop on the slot, because the slot has
// to cross the server/client boundary: the fork's route is a Server Component,
// and a function prop there fails with "Functions cannot be passed directly to
// Client Components". An element serializes fine; a callback does not. Context
// resolves on the client at render time, so the pane still gets its API.
const AssistantContext = React.createContext<SupportAssistantApi | null>(null);

// The two sides of the switch, in render order. Kept as data so the markup,
// the roving tabindex and the arrow-key handler can never disagree about how
// many options there are or which one sits on the left.
const SEG_TABS = [
  { id: 'assistant', label: 'Ask the assistant' },
  { id: 'ticket', label: 'Raise a ticket' },
] as const;

// For use inside the node passed as `assistant`. Throws rather than returning
// null so a pane rendered outside the slot fails loudly in development instead
// of silently losing its handoff to the ticket form.
export function useSupportAssistant(): SupportAssistantApi {
  const api = React.useContext(AssistantContext);
  if (!api) {
    throw new Error('useSupportAssistant must be used inside SupportPage\'s `assistant` slot.');
  }
  return api;
}

export function SupportPage({
  tickets,
  assistant,
}: {
  tickets: RemoteTicket[];
  // Optional. A fork with no assistant passes nothing and gets the page exactly
  // as it has always been — no tabs, no wrapper, no second code path to keep
  // working. A plain node, so a Server Component route can pass it; the pane
  // reads its handoff API from useSupportAssistant() rather than a prop.
  assistant?: React.ReactNode;
}) {
  const router = useRouter();
  const [reporting, setReporting] = React.useState(false);
  const [openRef, setOpenRef] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<TicketDraft | undefined>(undefined);
  // The assistant answers questions; the ticket desk is where you go when it
  // could not. Defaulting to the assistant is what makes that the cheaper of
  // the two to try first.
  const [tab, setTab] = React.useState<'assistant' | 'ticket'>('assistant');
  const hasAssistant = !!assistant;

  // Stable across renders so the pane can register widget event handlers once
  // in an effect rather than tearing them down on every parent render.
  const api = React.useMemo<SupportAssistantApi>(
    () => ({
      raiseTicket: (d) => {
        setDraft(d);
        setTab('ticket');
        setReporting(true);
      },
    }),
    [],
  );

  // Arrow / Home / End move between tabs, as a tablist is expected to. Focus
  // follows the selection so the next Tab press leaves the control rather than
  // landing on the option that was just moved away from.
  const segRef = React.useRef<HTMLDivElement>(null);
  const onSegKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Home';
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'End';
    if (!back && !forward) return;
    e.preventDefault();
    const next = back ? 'assistant' : 'ticket';
    setTab(next);
    segRef.current
      ?.querySelectorAll<HTMLButtonElement>('.sup-seg-btn')
      [next === 'assistant' ? 0 : 1]?.focus();
  };

  const closeReport = () => {
    setReporting(false);
    // Drop the draft with the modal, so re-opening the form by hand later
    // starts blank rather than resurrecting a question from an hour ago.
    setDraft(undefined);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Support</h1>
          <div className="page-subtitle">
            {hasAssistant
              ? `Ask the assistant, or raise it with the reStrucAI team — we reply within ${SLA_HOURS} working hours.`
              : `Raise anything with the reStrucAI team. We reply within ${SLA_HOURS} working hours.`}
          </div>
        </div>
        <div className="page-header-actions">
          {/* Secondary to "Report an issue" on purpose: this page exists to get
              a request raised, and who we are is context, not the task. */}
          <AboutRestrucAI />
          <button type="button" className="btn" onClick={() => setReporting(true)}>
            Report an issue
          </button>
        </div>
      </div>

      {hasAssistant ? (
        <div
          ref={segRef}
          className="sup-seg"
          role="tablist"
          aria-label="How would you like help?"
          // Drives the highlight's position in CSS, so there is one source of
          // truth for which side is active rather than a class on each button.
          data-pane={tab}
        >
          {/* The moving highlight. Purely decorative — the buttons above it
              carry all the state and all the semantics. */}
          <span className="sup-seg-thumb" aria-hidden="true" />
          {SEG_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`sup-tab-${id}`}
              aria-controls={`sup-panel-${id}`}
              aria-selected={tab === id}
              // Roving tabindex: one stop for the whole control, then the
              // arrow keys move within it — what a tablist is expected to do.
              tabIndex={tab === id ? 0 : -1}
              className="sup-seg-btn"
              onClick={() => setTab(id)}
              onKeyDown={onSegKey}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Both panes stay mounted and cross-fade; the inactive one is lifted out
          of flow rather than display:none'd. Two reasons, and neither is
          decoration:
            - The widget mounts into a real DOM node. Unmounting the pane would
              destroy the panel and lose the conversation someone is mid-way
              through — which is exactly when we hand them to the ticket form.
            - display:none cannot transition, and it forces a full relayout of a
              520px panel on every switch, which is what makes a tab feel like a
              page load. Fading opacity keeps the switch on the compositor. */}
      <div className={hasAssistant ? 'sup-panes' : undefined}>
        {assistant ? (
          <AssistantContext.Provider value={api}>
            <div
              className="sup-pane"
              data-active={tab === 'assistant'}
              role="tabpanel"
              id="sup-panel-assistant"
              aria-labelledby="sup-tab-assistant"
            >
              {assistant}
            </div>
          </AssistantContext.Provider>
        ) : null}

        <div
          className={hasAssistant ? 'sup-pane' : undefined}
          data-active={hasAssistant ? tab === 'ticket' : undefined}
          role={hasAssistant ? 'tabpanel' : undefined}
          id={hasAssistant ? 'sup-panel-ticket' : undefined}
          aria-labelledby={hasAssistant ? 'sup-tab-ticket' : undefined}
        >
      {tickets.length === 0 ? (
        <div className="sup-empty">
          <h3>You have not raised anything yet</h3>
          <p>
            Something looking wrong, a page not working, or just a question — tell us and we will
            take it from there.
          </p>
          <button type="button" className="btn" onClick={() => setReporting(true)}>
            Report an issue
          </button>
        </div>
      ) : (
        <div className="support-list">
          {tickets.map((t) => (
            <button
              key={t.ref}
              type="button"
              className="support-row"
              onClick={() => setOpenRef(t.ref)}
            >
              <span className="support-row-main">
                <span className="support-row-top">
                  <span className="support-ref">{t.ref}</span>
                  <span className="support-row-subject">{t.subject}</span>
                </span>
                <span className="support-row-sub">Updated {timeAgo(t.updated_at)}</span>
              </span>
              <span className="support-row-meta">
                <span className={`badge ${STATUS_TONE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
              </span>
            </button>
          ))}
        </div>
      )}

        </div>
      </div>

      {reporting ? (
        <SupportReportModal
          draft={draft}
          onClose={closeReport}
          // The list is server-rendered, so a new ticket only appears after the
          // route re-runs. Refreshing on send means the person sees their
          // request land in the list they are already looking at.
          onSent={() => router.refresh()}
        />
      ) : null}

      {openRef ? (
        <TicketDetail
          ticketRef={openRef}
          onClose={() => setOpenRef(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function TicketDetail({
  ticketRef,
  onClose,
  onChanged,
}: {
  ticketRef: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [ticket, setTicket] = React.useState<RemoteTicketDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Fetched on open rather than up front: most people open one ticket, and
  // pulling every ticket's history to render a list nobody scrolled is waste.
  const load = React.useCallback(async () => {
    const result = await openMyTicket(ticketRef);
    if (result.ok && result.ticket) {
      setTicket(result.ticket);
      setError(null);
    } else {
      setError(result.error ?? 'Could not load that ticket.');
    }
  }, [ticketRef]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function resolve() {
    if (busy) return;
    setBusy(true);
    const result = await resolveTicket(ticketRef);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? 'Could not update that.');
    await load();
    onChanged();
  }

  const isClosed = ticket?.status === 'resolved' || ticket?.status === 'closed';
  const request = ticket?.messages[0];
  const history = ticket?.messages.slice(1) ?? [];

  return (
    <div className="sup-backdrop" onClick={onClose} role="presentation">
      <div
        className="sup-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Ticket ${ticketRef}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sup-modal-head">
          <div>
            <h3>{ticket?.subject ?? ticketRef}</h3>
            <p>
              {ticketRef}
              {ticket ? ` · ${STATUS_LABEL[ticket.status]}` : ''}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error ? <div className="field-error">{error}</div> : null}
        {!ticket && !error ? <p className="support-row-sub">Loading…</p> : null}

        {ticket ? (
          <div className="support-thread">
            {request ? (
              <div className="support-request">
                <div className="support-msg-head">
                  <span className="support-msg-author">You asked</span>
                  <span className="support-msg-time">{timeAgo(request.created_at)}</span>
                </div>
                <div className="support-msg-body">{request.body}</div>
              </div>
            ) : null}

            <div className="support-history">
              {history.length ? (
                history.map((m, i) => (
                  <div key={i} className="support-history-row">
                    <span className="support-history-dot" aria-hidden="true" />
                    <span>{m.body}</span>
                    <span className="support-history-when">{timeAgo(m.created_at)}</span>
                  </div>
                ))
              ) : (
                <div className="support-history-row">
                  <span className="support-history-dot" aria-hidden="true" />
                  <span>With the reStrucAI team. We will be in touch by email.</span>
                </div>
              )}
            </div>

            {!isClosed ? (
              <div className="support-detail-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resolve}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Mark as resolved'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
