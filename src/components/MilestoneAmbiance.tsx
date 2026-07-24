'use client';

// App-wide festive ambiance for a GRAND-tier milestone (interns every month,
// full/part-timers on a yearly). Mounted in the Shell, so it follows the member
// across every page that day — a slim celebratory strip with a Replay button.
// Tasteful + lightweight: one CSS gradient animation, no per-page cost, and it
// self-disables under prefers-reduced-motion. Distinct from the one-time popup
// (MilestoneCelebration) — this persists all day; the popup shows once.
import * as React from 'react';
import { milestoneForToday } from '@/lib/milestones';
import type { UserRole } from '@/lib/types';

const GRAND_PREVIEW = new Set(['intern', 'intern-final', 'yearly']);

// CSS-var carrier for the confetti pieces.
type Vars = React.CSSProperties & Record<string, string | number>;
const COLORS = ['#ffffff', '#d8f3e6', '#ffe08a', '#bfe3cf', '#ffd0a8'];

// An always-on confetti SHOWER pouring top→bottom across the strip. Fast,
// staggered negative delays + varied speeds so it's a continuous stream with no
// visible "loop restart". Pure transform/opacity, clipped to the strip.
function AmbianceConfetti() {
  const pieces = React.useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        id: i,
        left: Math.round(Math.random() * 100),
        size: 4 + Math.round(Math.random() * 4),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        dur: (0.85 + Math.random() * 0.95).toFixed(2), // ~0.85–1.8s ("light speed")
        delay: (-Math.random() * 2).toFixed(2),
        rot: Math.round(180 + Math.random() * 360),
        round: Math.random() < 0.5,
      })),
    [],
  );
  return (
    <span className="ms-amb-confetti" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`ms-amb-piece${p.round ? ' round' : ''}`}
          style={
            {
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              '--rot': `${p.rot}deg`,
            } as Vars
          }
        />
      ))}
    </span>
  );
}

export function MilestoneAmbiance({
  joinedDate,
  role,
  internshipMonths,
}: {
  joinedDate: string;
  role: UserRole;
  internshipMonths: number | null;
}) {
  const real = React.useMemo(
    () => milestoneForToday({ role, joined_date: joinedDate, internship_months: internshipMonths }),
    [role, joinedDate, internshipMonths],
  );
  // Preview support: `?celebrate=<grand tier>` shows the strip for verification.
  const [previewTier, setPreviewTier] = React.useState<string | null>(null);
  React.useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('celebrate');
    setPreviewTier(c && GRAND_PREVIEW.has(c) ? c : null);
  }, []);

  const realGrand = real?.tier === 'grand';
  if (!realGrand && !previewTier) return null;

  const n = internshipMonths ?? 3;
  const label = realGrand
    ? real!.label
    : previewTier === 'yearly'
      ? '1 year'
      : previewTier === 'intern-final'
        ? `Month ${n} of ${n}`
        : `Month ${Math.min(2, n)} of ${n}`;

  const replay = () =>
    window.dispatchEvent(
      new CustomEvent('restruc:replay-milestone', {
        detail: realGrand ? {} : { tier: previewTier },
      }),
    );

  return (
    <div className="ms-ambiance" role="note">
      <AmbianceConfetti />
      <span className="ms-ambiance-dot" aria-hidden>
        🎉
      </span>
      <span className="ms-ambiance-text">
        {"It's your milestone · "}
        <strong>{label}</strong>
        {' with reStrucAI!'}
      </span>
      <button type="button" className="ms-ambiance-btn" onClick={replay}>
        Replay 🎉
      </button>
    </div>
  );
}
