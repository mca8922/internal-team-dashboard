'use client';

// The report form. Opened from the Support page's "Report an issue" button —
// there is no "?" in the top bar on a client dashboard, so this is the one way
// in and it lives where people already went looking for it.
//
// Self-contained by design: no imports from the host app's component library,
// because a fork's `ui.tsx` may have drifted. Only `.btn`, `.icon-btn`,
// `.input`, `.textarea` and `.field-error` are assumed — base classes every
// fork of this dashboard has. Everything else comes from support.css.
//
// Two things here matter more than they look:
//
// 1. Context capture. The page, the browser and the reporter's role are
//    attached automatically. Most of a support conversation is spent
//    establishing those three things.
// 2. The disclosure line above the buttons. We say plainly what gets sent.
//    One sentence, and it turns an invisible collection into something the
//    person agreed to. Do not remove it.
//
// The category is a grid of cards rather than a dropdown: there are only six,
// a native select on a phone is a sheet inside a modal, and seeing all six at
// once is itself the prompt for "which of these is my problem?".
import * as React from 'react';
import {
  BODY_MAX,
  CATEGORY_HINT,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  SLA_HOURS,
  SUBJECT_MAX,
  htmlToText,
  validateTicketInput,
  type SupportCategory,
  type TicketDraft,
} from './support-shared';
import { raiseTicket } from './support-actions';
import { RichTextEditor } from '@/components/RichTextEditor';

export function SupportReportModal({
  onClose,
  onSent,
  draft,
}: {
  onClose: () => void;
  // Fired after a successful submit so the page can refresh its ticket list.
  onSent: () => void;
  // Optional starting values (see TicketDraft). Omitted, the form opens blank
  // on "bug" exactly as it always has — which is what every fork without an
  // assistant gets, with no code path of its own.
  draft?: TicketDraft;
}) {
  // Seeds only. Deliberately NOT synced to `draft` afterwards: once the modal
  // is open the person is typing, and a late prop change overwriting their
  // words would be the worst possible moment to do it.
  const [category, setCategory] = React.useState<SupportCategory>(draft?.category ?? 'bug');
  const [subject, setSubject] = React.useState(draft?.subject ?? '');
  const [body, setBody] = React.useState(draft?.body ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentRef, setSentRef] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // This form holds work in progress — a half-written report — so it does NOT
  // close on a backdrop click or on Escape. The ✕ in the corner is the one
  // deliberate way out, so a stray click or keypress can't drop what someone
  // has typed.

  const page = typeof window === 'undefined' ? '' : window.location.pathname;

  async function submit() {
    const invalid = validateTicketInput({ subject, body });
    if (invalid) return setError(invalid);
    setError(null);
    setBusy(true);
    const result = await raiseTicket({
      category,
      subject,
      body,
      page,
      userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    });
    setBusy(false);
    if (!result.ok || !result.ref) {
      return setError(result.error ?? 'Could not send that. Please try again.');
    }
    setSentRef(result.ref);
    onSent();
  }

  // Counted against the text the person typed, not the HTML the editor stores —
  // a markup-length counter ticks down while someone is only adding bold.
  const bodyLeft = BODY_MAX - htmlToText(body).length;

  return (
    <div className="sup-backdrop" role="presentation">
      <div
        className="sup-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Report an issue"
      >
        {sentRef ? (
          <div className="support-sent">
            <span className="support-sent-tick">
              <TickIcon />
            </span>
            <h3>Sent to reStrucAI</h3>
            <button
              type="button"
              className="support-sent-ref"
              title="Copy reference"
              onClick={() => {
                void navigator.clipboard?.writeText(sentRef);
                setCopied(true);
              }}
            >
              {sentRef}
              <span className="support-sent-copy">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <p className="support-sent-hint">
              We reply within {SLA_HOURS} working hours. You will get an email, and this request
              is now listed below.
            </p>
            <div className="support-sent-spam" role="note">
              <strong>Not seeing our email?</strong> A confirmation for{' '}
              <span className="support-sent-spam-ref">{sentRef}</span> has been sent to your
              registered address. If it is not in your inbox within a few minutes, please check
              your spam or junk folder and mark the message as “Not spam” so future updates
              arrive normally. Every reply to this request is sent to that same email address, so
              it is worth adding reStrucAI to your safe senders.
            </div>
            <div className="support-sent-actions">
              <button type="button" className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sup-modal-head">
              <div>
                <h3>Report an issue</h3>
                <p>We reply within {SLA_HOURS} working hours</p>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="help-form">
              <div className="help-field">
                <span className="help-label">What&apos;s this about?</span>
                <div className="help-cats" role="radiogroup" aria-label="Category">
                  {CATEGORY_ORDER.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={category === c}
                      className={`help-cat${category === c ? ' active' : ''}`}
                      onClick={() => setCategory(c)}
                    >
                      <span className="help-cat-label">{CATEGORY_LABEL[c]}</span>
                      <span className="help-cat-hint">{CATEGORY_HINT[c]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="help-field">
                <label className="help-label" htmlFor="sup-subject">
                  Subject
                </label>
                <input
                  id="sup-subject"
                  className="input"
                  value={subject}
                  maxLength={SUBJECT_MAX}
                  placeholder="Attendance shows absent but I was present"
                  onChange={(e) => setSubject(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="help-field">
                <div className="help-label-row">
                  <span className="help-label">Tell us what happened</span>
                  {/* Only near the ceiling — a counter on an empty box reads as
                      a word limit, which discourages the detail we want. */}
                  {bodyLeft < 500 ? (
                    <span className={`help-count${bodyLeft < 100 ? ' warn' : ''}`}>
                      {bodyLeft} left
                    </span>
                  ) : null}
                </div>
                {/* Rich text, stored as sanitized HTML — so a reply that quotes
                    the report, and the report itself, read with the same
                    formatting. The toolbar tints (never fills) and uses theme
                    tokens, so it stays legible in light and dark. */}
                <RichTextEditor
                  value={body}
                  onChange={(html) =>
                    setBody(html.length <= BODY_MAX ? html : body)
                  }
                  className="help-rte"
                  ariaLabel="Tell us what happened"
                  placeholder="What you expected, and what happened instead."
                />
              </div>

              <div className="support-disclosure">
                <span>
                  We will also send your name, your role, the page you are on (<code>{page}</code>
                  ), and your browser — so we can help without asking you for it.
                </span>
              </div>

              {error ? <div className="field-error">{error}</div> : null}

              <div className="help-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="button" className="btn" onClick={submit} disabled={busy}>
                  {busy ? 'Sending…' : 'Send to reStrucAI'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TickIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
