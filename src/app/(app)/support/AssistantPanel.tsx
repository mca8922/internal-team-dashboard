'use client';

// The AI documentation assistant, embedded in the Support page.
//
// This file is app-specific on purpose: src/support/ is the portable ticket
// desk shared across client forks, and it knows nothing about any assistant.
// All it exposes is an optional `assistant` render prop and a `raiseTicket`
// handoff (see SupportPage.tsx) — everything about THIS widget lives here.
//
// The widget is loaded from the vendor's URL, never vendored or modified, per
// docs/INTEGRATION.md. `data-mode="embed"` stops it rendering its own floating
// bubble; it waits for mount() and then fills the container below.
import * as React from 'react';
import Script from 'next/script';
import { useSupportAssistant } from '@/support/SupportPage';

const WIDGET_SRC = 'https://rag-chatbot-eosin-two.vercel.app/widget.js';
const PUBLIC_KEY = 'pk_mca_dashboard_dev';
const MOUNT_ID = 'assistant-panel';

// Theme bridge.
//
// The widget renders into an OPEN shadow root, so the page's stylesheet cannot
// reach inside it — which is why it arrives white-on-white in dark mode. What
// does cross a shadow boundary is CSS custom properties: they inherit normally,
// and `all:initial` (which the widget sets on :host) explicitly does not reset
// them. So we append one stylesheet to its shadow root that restates the
// widget's own colours in terms of our theme tokens.
//
// The pay-off is that this needs no JS at all after injection: flipping
// <html data-theme> changes the tokens, the tokens are inherited through the
// boundary, and the widget repaints with the rest of the page — in the same
// frame, with the same transition. No listener to leak, nothing to re-run, and
// nothing that can drift out of step with the app's own switch.
//
// Everything here is an override of a rule the widget already ships. We do not
// change its layout, structure, or behaviour — only what colour it paints.
// Every surface the widget paints is restated here, INCLUDING ones that happen
// to be transparent in the version we read. The vendor ships this file from
// their own deploy and can change it under us without warning — they added a
// hard-coded `background:#fafaf9` to .thread while this integration was being
// built, which turned the whole conversation area white in dark mode. Relying
// on any surface staying transparent is relying on their next deploy.
const THEME_CSS = `
:host {
  /* The widget sets --accent inline on the host, so a stylesheet needs
     !important to win. Ours tracks the theme instead of being a fixed hex. */
  --accent: var(--color-green-primary, #1F5C3E) !important;
  /* Makes the textarea's caret, selection and scrollbars render dark natively
     rather than as light chrome sitting in a dark panel. */
  color-scheme: var(--assistant-color-scheme, light);
}

/* Panel frame and the conversation area behind the bubbles. */
.panel {
  background: var(--color-card, #FFFFFF);
  color: var(--color-black, #0B0B0B);
}
:host(.embed) .panel { border-color: var(--color-border, #ECECEA); }
.thread { background: var(--color-bg, #FAFAF9); }

/* Bubbles. The bot's is a card on the thread; the user's rides the accent. */
.msg.bot {
  background: var(--color-card, #FFFFFF);
  border-color: var(--color-border, #ECECEA);
  color: var(--color-black, #0B0B0B);
}
.msg li::marker { color: var(--color-green-primary, #1F5C3E); }
.msg blockquote { color: var(--color-grey-text, #848687); }
.msg hr { border-top-color: var(--color-border, #ECECEA); }
.msg code, .msg pre { background: rgba(127, 127, 127, 0.16); }
.err { color: var(--color-red, #C0392B); }

/* Composer. */
.form { border-top-color: var(--color-border, #ECECEA); }
.form textarea {
  background: var(--color-bg, #FAFAF9);
  color: var(--color-black, #0B0B0B);
  border-color: var(--color-border, #ECECEA);
}
.form textarea::placeholder { color: var(--color-grey-text, #848687); }
.form textarea:focus {
  border-color: var(--color-green-primary, #1F5C3E);
  /* Their focus ring is a pale green wash that disappears on a dark panel. */
  box-shadow: 0 0 0 3px var(--color-green-light, rgba(31, 92, 62, 0.28));
}

/* Match the rest of the page's theme cross-fade, so the widget does not snap
   to the new colours a beat before or after everything around it. */
.panel, .thread, .msg.bot, .form, .form textarea {
  transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .panel, .thread, .msg.bot, .form, .form textarea { transition: none; }
}
`;

// Marks the stylesheet so a second call (React StrictMode's double effect in
// development) does not stack duplicates in the shadow root.
const THEME_STYLE_FLAG = 'data-app-theme';

// The widget's host element carries this attribute; see its mount().
const WIDGET_HOST_SELECTOR = '[data-rag-widget]';

function applyWidgetTheme(container: HTMLElement | null): void {
  const widgetHost = container?.querySelector(WIDGET_HOST_SELECTOR);
  const shadow = (widgetHost as HTMLElement | null)?.shadowRoot;
  // A closed shadow root would give us null here. Nothing to do but leave the
  // widget with its own colours — never worth throwing over.
  if (!shadow || shadow.querySelector(`style[${THEME_STYLE_FLAG}]`)) return;
  const style = document.createElement('style');
  style.setAttribute(THEME_STYLE_FLAG, '');
  style.textContent = THEME_CSS;
  // Appended last so it wins against the widget's own rules at equal
  // specificity, without needing !important on every line.
  shadow.appendChild(style);
}

// Only the parts of the widget's API this file uses. Typed locally because the
// vendor ships no types — and a hand-written shape we can see beats `any`.
interface RagWidget {
  identify: (token: string) => RagWidget;
  mount: (target: string | Element) => RagWidget;
  on: (
    event: 'message' | 'unanswered' | 'limit',
    handler: (payload: { question: string; answer?: string; limit?: number }) => void,
  ) => void;
}

declare global {
  interface Window {
    RagWidget?: RagWidget;
  }
}

export function AssistantPanel() {
  // From SupportPage's assistant slot. Taken from context rather than a prop
  // because the route rendering this is a Server Component, which cannot hand a
  // function across the boundary.
  const api = useSupportAssistant();
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [detail, setDetail] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // `api.raiseTicket` is memoised by SupportPage, but keeping it in a ref means
  // the widget subscription below never has to re-run to pick up a new closure.
  const apiRef = React.useRef(api);
  apiRef.current = api;

  // Guards React 18 StrictMode's deliberate double-effect in development, which
  // would otherwise mount the widget twice into the same node.
  const startedRef = React.useRef(false);

  const start = React.useCallback(async () => {
    if (startedRef.current) return;
    const widget = window.RagWidget;
    if (!widget) return;
    startedRef.current = true;

    try {
      // Fetched on every page load rather than cached: the token expires after
      // an hour, and a stale one fails in a way the person cannot act on.
      const res = await fetch('/api/assistant-token');
      if (!res.ok) {
        // 401 means the session went stale under them; 503 means the secret
        // isn't wired up. Both are worth saying plainly rather than showing an
        // assistant that silently answers nothing.
        setDetail(
          res.status === 401
            ? 'Your session has expired. Refresh the page to sign back in.'
            : 'The assistant is not configured on this environment yet.',
        );
        setStatus('error');
        return;
      }
      const { token } = (await res.json()) as { token: string };

      widget.identify(token).mount('#' + MOUNT_ID);
      // Straight after mount(): the shadow root exists from the moment the
      // script ran, but its host only moves into our container here.
      applyWidgetTheme(panelRef.current);

      // Handoff: when the assistant has no grounded answer, or the person has
      // used up their daily questions, send them to the ticket form with what
      // they asked already filled in. We PREFILL only — the person still reads
      // it over and presses send themselves.
      widget.on('unanswered', ({ question }) => {
        apiRef.current.raiseTicket({
          category: 'question',
          subject: question.slice(0, 160),
          body:
            `I asked the assistant:\n\n"${question}"\n\n` +
            'It could not answer, so I am raising it here.',
        });
      });

      widget.on('limit', ({ question }) => {
        apiRef.current.raiseTicket({
          category: 'question',
          subject: (question ?? 'Question for the reStrucAI team').slice(0, 160),
          body:
            (question ? `I asked the assistant:\n\n"${question}"\n\n` : '') +
            'I have reached my daily question limit, so I am raising it here.',
        });
      });

      setStatus('ready');
    } catch {
      setDetail('The assistant could not be reached. You can raise a ticket instead.');
      setStatus('error');
    }
  }, []);

  return (
    <>
      {/* afterInteractive is the App Router equivalent of the vendor snippet's
          `defer`: injected once after hydration, and not re-run on re-render.
          onReady fires for a cached script too, which a plain onLoad does not. */}
      <Script
        src={WIDGET_SRC}
        data-key={PUBLIC_KEY}
        data-mode="embed"
        data-title="MCA Dashboard Assistant"
        strategy="afterInteractive"
        onReady={() => void start()}
        onError={() => {
          setDetail('The assistant could not be loaded. You can raise a ticket instead.');
          setStatus('error');
        }}
      />

      {status === 'error' ? (
        <div className="assistant-fallback">
          <p>{detail}</p>
          <button type="button" className="btn" onClick={() => api.raiseTicket()}>
            Raise a ticket instead
          </button>
        </div>
      ) : null}

      {/* Always rendered, even while loading: mount() needs this node to exist
          the moment the script is ready, and swapping it out for a spinner is
          what makes a widget mount into nothing. */}
      <div
        id={MOUNT_ID}
        ref={panelRef}
        className="assistant-panel"
        style={status === 'error' ? { display: 'none' } : undefined}
      >
        {status === 'loading' ? (
          <span className="assistant-loading">Starting the assistant…</span>
        ) : null}
      </div>

      <p className="assistant-foot">
        The assistant answers from the dashboard&rsquo;s documentation. If it cannot help,
        it will offer to raise a ticket with the reStrucAI team.
      </p>
    </>
  );
}
