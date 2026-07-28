'use client';

// A full-screen confetti shower + a message card for a Board-declared holiday,
// mounted once in Shell (see MilestoneCelebration for the same pattern) so it
// plays no matter which page a member lands on. Reuses the milestone
// celebration's overlay/card classes and confetti piece generator — only the
// trigger + "seen" bookkeeping is holiday-specific.
//
// The card names the holiday so the confetti reads as "this is why", and stays
// until dismissed (click anywhere / the CTA); the confetti itself fades on its
// own after ~3s.
//
// Plays once per (member, holiday date) via localStorage, so it fires the
// first time each member opens the app on the holiday, not on every
// navigation or reload that day.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { CardConfetti, BottomSparkle } from './ChecklistCelebration';

const SEEN_PREFIX = 'restruc:holiday:';

const prettyDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

export function HolidayCelebration({ date, name }: { date: string; name: string }) {
  const [show, setShow] = React.useState(false);
  const [confetti, setConfetti] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const key = `${SEEN_PREFIX}${date}`;
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
    } catch {
      /* ignore — worst case it replays on the next load */
    }
    setShow(true);
    setConfetti(true);
    const t = setTimeout(() => setConfetti(false), 3200);
    return () => clearTimeout(t);
  }, [date, name]);

  if (!mounted || !show) return null;

  const close = () => setShow(false);

  return createPortal(
    <div
      className="ms-overlay ms-medium"
      role="dialog"
      aria-modal="true"
      aria-label="Holiday"
      onClick={close}
    >
      {confetti ? (
        <div className="ms-confetti-full" aria-hidden>
          <CardConfetti count={120} lifespanMs={2900} />
        </div>
      ) : null}
      <div className="ms-card" onClick={(e) => e.stopPropagation()}>
        <BottomSparkle />
        <div className="ms-emoji" aria-hidden>
          🎉
        </div>
        <div className="ms-headline">
          <span className="text-shine">{name}</span>
        </div>
        <div className="ms-sub">
          {prettyDate(date)}
          <br />
          {'The office is closed today. Enjoy the day off!'}
        </div>
        <button type="button" className="btn ms-cta" onClick={close}>
          {'Thank you'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
