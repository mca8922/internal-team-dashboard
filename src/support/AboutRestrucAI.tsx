'use client';

// "About reStrucAI" — the one place in a client's dashboard that says who built
// it and how to reach them outside a ticket.
//
// Lives in the module rather than a fork because it is reStrucAI's own identity:
// a fork should never be maintaining our wordmark or our links. It renders on
// the Support page header, and a fork may also drop it on a locked/Phase-gated
// stand-in so the credit is reachable before the desk itself opens.
//
// The wordmark is CSS, not an image. Three reasons that matters: it stays sharp
// at any size and on any display, it recolours itself for light and dark
// without a second asset, and it costs no network request inside a modal that
// should open instantly.
//
// Self-contained by design, like the rest of the module: only `.btn`/`.icon-btn`
// are assumed from the host app. Everything else is the `.sup-about-*` block in
// support.css.
import * as React from 'react';

const WEBSITE_URL = 'https://www.restrucai.com';
const WEBSITE_LABEL = 'www.restrucai.com';
const FOUNDER_URL = 'https://www.linkedin.com/in/nishit-rathod/';
const FOUNDER_NAME = 'Nishit Rathod';

export function AboutRestrucAI() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button type="button" className="sup-about-trigger" onClick={() => setOpen(true)}>
        About reStrucAI
      </button>
      {open ? <AboutModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// The wordmark. Split so the accent colour sits at both ends and the stem stays
// ink: `re` … `Ai`. Used in the modal only. The trigger is plain text, because
// a logo shrunk to 15px stops reading as a logo and starts reading as clutter.
function RestrucMark() {
  return (
    <span className="sup-mark" aria-label="reStrucAI" role="img">
      <span className="sup-mark-accent">re</span>
      <span className="sup-mark-ink">Struc</span>
      <span className="sup-mark-accent">Ai</span>
    </span>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sup-backdrop" onClick={onClose} role="presentation">
      <div
        className="sup-modal sup-about"
        role="dialog"
        aria-modal="true"
        aria-label="About reStrucAI"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sits on the panel's outer edge rather than inside the padding, so it
            never competes with the wordmark for the top-right corner. */}
        <button type="button" className="sup-about-close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        {/* The sheen is decorative and runs once on open, not on a loop. A
            permanently animating panel reads as a banner ad, not as a product. */}
        <div className="sup-about-hero">
          <div className="sup-about-glow" aria-hidden="true" />
          <RestrucMark />
          <p className="sup-about-tagline">
            The team behind this dashboard. We build it and keep it running for you.
          </p>
        </div>

        <div className="sup-about-links">
          <a
            className="sup-about-link"
            href={WEBSITE_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="sup-about-link-icon" aria-hidden="true">
              <GlobeIcon />
            </span>
            <span className="sup-about-link-body">
              <span className="sup-about-link-label">Website</span>
              <span className="sup-about-link-value">{WEBSITE_LABEL}</span>
            </span>
            <span className="sup-about-link-go" aria-hidden="true">
              <ArrowIcon />
            </span>
          </a>

          <a
            className="sup-about-link"
            href={FOUNDER_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="sup-about-link-icon" aria-hidden="true">
              <LinkedInIcon />
            </span>
            <span className="sup-about-link-body">
              <span className="sup-about-link-label">Founder</span>
              <span className="sup-about-link-value">{FOUNDER_NAME} · LinkedIn</span>
            </span>
            <span className="sup-about-link-go" aria-hidden="true">
              <ArrowIcon />
            </span>
          </a>
        </div>

        <p className="sup-about-foot">
          Built and maintained by reStrucAI. For anything about this dashboard,
          raise it on the Support page and it reaches us directly.
        </p>
      </div>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.94 5.5a1.94 1.94 0 1 1-3.88 0a1.94 1.94 0 0 1 3.88 0ZM3.25 8.94h3.4V21h-3.4V8.94Zm5.53 0h3.26v1.65h.05c.45-.86 1.56-1.76 3.22-1.76c3.44 0 4.08 2.27 4.08 5.22V21h-3.4v-5.29c0-1.26-.02-2.89-1.76-2.89c-1.76 0-2.03 1.37-2.03 2.8V21h-3.4V8.94Z" />
    </svg>
  );
}

// Drawn rather than the ✕ glyph: a stroked cross keeps the same weight as the
// other icons here, where the character would inherit the body font.
function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
