'use client';

// In-card celebration for a completed checklist item. Two coordinated, fully
// CSS-driven effects so they stay buttery smooth (transform/opacity only, no
// per-frame JS):
//   • <BottomSparkle/> — a shine + sparkles that sweep left→right along the
//                        bottom edge of the checklist card.
//   • <CardConfetti/>  — confetti raining top→bottom across the whole card
//                        (the checklist box and its description combined).
//
// Both are presentational and time-boxed; the parent mounts them on completion
// (keyed by a nonce so re-ticking replays them) and unmounts them after the
// animation window. They render nothing interactive (aria-hidden, pointer-events
// none) and respect prefers-reduced-motion via CSS.
import * as React from 'react';

// Brand greens first, then a festive spread.
const COLORS = ['#288A5D', '#34B27B', '#7FD1A8', '#FFC94D', '#FF8A5C', '#5C9DFF', '#E36FB0'];

// A CSS custom property carried via inline style needs a loose cast.
type Vars = React.CSSProperties & Record<string, string | number>;

export function CardConfetti({
  count = 20,
  // Total celebration window. Piece fall-durations + staggered delays are scaled
  // to fill it, so the rain keeps arriving for roughly this long.
  lifespanMs = 1300,
}: {
  count?: number;
  lifespanMs?: number;
}) {
  const pieces = React.useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        drift: Math.random() * 60 - 30, // px sideways
        spin: Math.random() * 720 - 360, // deg
        // Fall over ~0.45–0.65× the window, staggered across the first ~half of
        // it, so the last pieces land close to lifespanMs.
        dur: lifespanMs * 0.45 + Math.random() * lifespanMs * 0.2, // ms
        delay: Math.random() * lifespanMs * 0.5, // ms
        round: Math.random() < 0.4,
        size: 5 + Math.random() * 4,
      })),
    [count, lifespanMs],
  );

  return (
    <span className="cl-confetti" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`cl-piece${p.round ? ' round' : ''}`}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDelay: `${p.delay}ms`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`,
              '--dur': `${p.dur}ms`,
            } as Vars
          }
        />
      ))}
    </span>
  );
}

export function BottomSparkle({ durationMs }: { durationMs?: number }) {
  return (
    <span className="cl-sweep" aria-hidden>
      <span
        className="cl-sweep-runner"
        style={durationMs ? ({ animationDuration: `${durationMs}ms` } as Vars) : undefined}
      >
        <span className="cl-sweep-shine" />
        <span className="cl-spark" style={{ left: '14%', bottom: '5px', '--d': '0ms' } as Vars} />
        <span className="cl-spark" style={{ left: '46%', bottom: '8px', '--d': '120ms' } as Vars} />
        <span className="cl-spark" style={{ left: '76%', bottom: '4px', '--d': '60ms' } as Vars} />
      </span>
    </span>
  );
}
