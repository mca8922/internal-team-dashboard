'use client';

// A full-screen confetti shower + message card for the signed-in member's OWN
// birthday. Mounted once in Shell (see MilestoneCelebration / HolidayCelebration
// for the same pattern), so it plays no matter which page they land on.
//
// Plays once per (member, year) via localStorage, so it fires the first time
// they open the app on their birthday, not on every navigation/reload that
// day. Can be previewed/replayed any time via `?celebrate=birthday` — this
// does NOT require it to actually be your birthday, and does NOT mark it seen
// (so it can be replayed as many times as you like).
import * as React from 'react';
import { createPortal } from 'react-dom';
import { CardConfetti, BottomSparkle } from './ChecklistCelebration';
import { parseDate, fmtDate } from '@/lib/dates';

const SEEN_PREFIX = 'restruc:birthday:';
type Source = 'auto' | 'param';

function isTodayBirthday(dob: string | null): boolean {
  if (!dob) return false;
  const today = parseDate(fmtDate(new Date()));
  const b = parseDate(dob);
  return b.getMonth() === today.getMonth() && b.getDate() === today.getDate();
}

export function BirthdayCelebration({
  userId,
  name,
  dateOfBirth,
}: {
  userId: string;
  name: string;
  dateOfBirth: string | null;
}) {
  const [shown, setShown] = React.useState<Source | null>(null);
  const [confetti, setConfetti] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const real = isTodayBirthday(dateOfBirth);
  const seenKey = React.useCallback(
    () => `${SEEN_PREFIX}${userId}:${new Date().getFullYear()}`,
    [userId],
  );

  const play = (source: Source) => {
    setShown(source);
    setConfetti(true);
    setTimeout(() => setConfetti(false), 3200);
  };

  // Auto-play once per birthday per year.
  React.useEffect(() => {
    if (!real) return;
    try {
      if (localStorage.getItem(seenKey()) === '1') return;
    } catch {
      /* ignore */
    }
    play('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, seenKey]);

  // ?celebrate=birthday — preview/replay any time, regardless of the real date.
  React.useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('celebrate');
    if (c === 'birthday') play('param');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replay button / notification tap → window event, same mechanism as
  // MilestoneCelebration's `restruc:replay-milestone`.
  React.useEffect(() => {
    const onReplay = () => play('param');
    window.addEventListener('restruc:replay-birthday', onReplay);
    return () => window.removeEventListener('restruc:replay-birthday', onReplay);
  }, []);

  if (!mounted || !shown) return null;

  const close = () => {
    if (shown !== 'param' && real) {
      try {
        localStorage.setItem(seenKey(), '1');
      } catch {
        /* ignore */
      }
    }
    setShown(null);
  };

  const firstName = name.split(' ')[0] || name;

  return createPortal(
    <div
      className="ms-overlay ms-medium"
      role="dialog"
      aria-modal="true"
      aria-label="Birthday"
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
          🎂
        </div>
        <div className="ms-headline">
          {'Happy Birthday, '}
          <span className="text-shine">{firstName}</span>
          {'!'}
        </div>
        <div className="ms-sub">The whole team is wishing you a great day. 💚</div>
        <button type="button" className="btn ms-cta" onClick={close}>
          Thank you 🤍
        </button>
      </div>
    </div>,
    document.body,
  );
}
