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
import { STATUS_LABEL, STATUS_TONE, SLA_HOURS, timeAgo } from './support-shared';
import { openMyTicket, resolveTicket } from './support-actions';
import { SupportReportModal } from './SupportReportModal';
import { AboutRestrucAI } from './AboutRestrucAI';
import type { RemoteTicket, RemoteTicketDetail } from './support-api';

export function SupportPage({ tickets }: { tickets: RemoteTicket[] }) {
  const router = useRouter();
  const [reporting, setReporting] = React.useState(false);
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Support</h1>
          <div className="page-subtitle">
            Raise anything with the reStrucAI team. We reply within {SLA_HOURS} working hours.
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

      {reporting ? (
        <SupportReportModal
          onClose={() => setReporting(false)}
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
