'use client';

// A full-screen confetti shower for a Board-declared holiday, mounted once in
// Shell (see MilestoneCelebration for the same pattern) so it plays no matter
// which page a member lands on. Reuses the milestone celebration's own
// full-viewport overlay class (position: fixed, inset: 0) and confetti piece
// generator — only the trigger + "seen" bookkeeping is holiday-specific.
//
// Plays once per (member, holiday date) via localStorage, so it fires the
// first time each member opens the app on the holiday, not on every
// navigation or reload that day.
import * as React from 'react';
import { CardConfetti } from './ChecklistCelebration';

const SEEN_PREFIX = 'restruc:holiday:';

export function HolidayCelebration({ date, name }: { date: string; name: string }) {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const key = `${SEEN_PREFIX}${date}`;
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
    } catch {
      /* ignore — worst case it replays on the next load */
    }
    setShow(true);
    const t = setTimeout(() => setShow(false), 3200);
    return () => clearTimeout(t);
  }, [date, name]);

  if (!show) return null;
  return (
    <div className="ms-confetti-full" aria-hidden>
      <CardConfetti count={120} lifespanMs={2900} />
    </div>
  );
}
