'use client';

// Error boundary for every authenticated route. A failed data fetch or a thrown
// render previously left a blank screen; this catches it inside the app shell
// and offers a one-click retry (reset re-renders the segment) plus a path home.
//
// Not built on the shared EmptyState — that's reused all over the app for
// neutral "nothing here yet" states, which should stay plain. A full-page
// crash gets its own bespoke, slightly cheeky treatment instead: the bot
// signals it's interactive through motion (sonar rings + a periodic tap
// ripple) rather than a floating text badge, and each action renders as a
// proper card — icon, title, one-line description — instead of a plain
// button row, filling the page with intent instead of a few small pills
// stranded in a lot of empty space.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { reportError } from '@/lib/actions';

const QUIPS = [
  "Even reStrucAI's brain needs a reboot sometimes.",
  'Our bot tripped over its own wires.',
  "That wasn't supposed to happen — the bot is as surprised as you.",
  'Somewhere, a semicolon is to blame.',
  'The bot swears it was like this when it got here.',
  'On the bright side, at least it failed loudly.',
];

// Remembers, per browser, that someone has already discovered the bot is
// clickable — so the tap-ripple hint stops appearing once it's done its job
// instead of nagging on every future crash.
const DISCOVERED_KEY = 'errorBotDiscovered';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const toast = useToast();
  // Stable per-mount, not random — re-rolling on every reset() would feel
  // arbitrary rather than "picked once for this crash". Clicking the bot
  // below deliberately cycles forward from here instead.
  const [quipIdx, setQuipIdx] = useState(
    () => Math.abs(hashCode(error.digest || error.message || '')) % QUIPS.length,
  );
  const [bonkNonce, setBonkNonce] = useState(0);
  const [showHint, setShowHint] = useState(true);
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    // Surface the error in the browser console / Vercel logs for debugging.
    console.error(error);
  }, [error]);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISCOVERED_KEY) === '1') setShowHint(false);
    } catch {
      // localStorage blocked (private browsing etc.) — just leave the hint on.
    }
  }, []);

  const bonk = () => {
    setQuipIdx((i) => (i + 1) % QUIPS.length);
    setBonkNonce((n) => n + 1);
    setShowHint(false);
    try {
      localStorage.setItem(DISCOVERED_KEY, '1');
    } catch {
      // best-effort only
    }
  };

  // Next.js stamps server-thrown errors with a digest (a reference into the
  // server logs); fall back to our own hash for client-thrown ones so there's
  // always SOME short code to quote when reporting it.
  const incidentCode = (error.digest || Math.abs(hashCode(error.message || 'error')).toString(16))
    .slice(0, 8)
    .toUpperCase();

  const sendReport = async () => {
    if (reportState === 'sending' || reportState === 'sent') return;
    setReportState('sending');
    try {
      const res = await reportError({
        incidentCode,
        message: error.message || 'Unknown error',
        pageUrl: typeof window !== 'undefined' ? window.location.href : '',
      });
      if (!res.ok) throw new Error(res.error || 'Could not send the report.');
      setReportState('sent');
      toast('Sent — the team has been emailed with this incident.');
    } catch (e) {
      setReportState('idle');
      toast((e as Error).message || 'Could not send the report.', 'error');
    }
  };

  return (
    <div className="error-page">
      <div className="error-state">
        <button
          type="button"
          className="error-bot-btn"
          onClick={bonk}
          aria-label="Tap the bot for another excuse"
          title="Tap the bot for another excuse"
        >
          <span className="error-bot-sonar r1" aria-hidden />
          <span className="error-bot-sonar r2" aria-hidden />
          {showHint ? <span className="error-bot-tap-ripple" aria-hidden /> : null}
          <span key={bonkNonce} className="error-bot-bonk">
            <span className="error-state-icon">
              <Icon name="bot" size={64} stroke={1.2} />
            </span>
          </span>
        </button>

        <h3>Well, that&apos;s embarrassing.</h3>
        <p>{QUIPS[quipIdx]}</p>
        <p className="error-state-sub">Give the bot a tap for another excuse, or pick an option below.</p>

        <div className="error-action-list">
          <button type="button" className="error-action-card" onClick={reset}>
            <span className="error-action-icon">
              <Icon name="refresh" size={19} />
            </span>
            <span className="error-action-text">
              <span className="error-action-title">Try again</span>
              <span className="error-action-desc">Reload this page and see if it sticks this time.</span>
            </span>
            <Icon name="chevron-right" size={16} />
          </button>

          <Link href="/dashboard" className="error-action-card">
            <span className="error-action-icon">
              <Icon name="home" size={19} />
            </span>
            <span className="error-action-text">
              <span className="error-action-title">Back to dashboard</span>
              <span className="error-action-desc">Head back to a page that&apos;s still working.</span>
            </span>
            <Icon name="chevron-right" size={16} />
          </Link>

          <button
            type="button"
            className={`error-action-card${reportState === 'sent' ? ' done' : ''}`}
            onClick={sendReport}
            aria-busy={reportState === 'sending'}
          >
            <span className="error-action-icon">
              {reportState === 'sending' ? (
                <span className="error-action-spinner" aria-hidden />
              ) : (
                <Icon name={reportState === 'sent' ? 'check' : 'mail'} size={19} />
              )}
            </span>
            <span className="error-action-text">
              <span className="error-action-title">
                {reportState === 'sent'
                  ? 'Reported to the team'
                  : reportState === 'sending'
                    ? 'Sending…'
                    : 'Report to the team'}
              </span>
              <span className="error-action-desc">One click emails this incident straight to the team.</span>
            </span>
            <span className="error-action-incident">#{incidentCode}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Small, deterministic string hash — just enough to pick a stable "random"
// quip / incident code per error without pulling in a dependency.
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}
