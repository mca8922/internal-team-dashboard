'use client';

// Eases a displayed number from its previous value to a new one whenever
// `value` changes, instead of snapping straight to it — used anywhere a
// filter/range switch recomputes a stat server-side and the new number would
// otherwise just jump. Ease-out cubic over `durationMs`.
import * as React from 'react';

export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = '',
  durationMs = 650,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = React.useState(value);
  const fromRef = React.useRef(value);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return (
    <>
      {display.toFixed(decimals)}
      {suffix}
    </>
  );
}
