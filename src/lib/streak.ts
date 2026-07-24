// Shared streak-tier logic — pure, no data fetching. Used by the Dashboard's
// StreakCard (a flame badge + milestone ring) and the Team Analytics heatmap
// (a compact per-row flame + number), so both read the same colors/labels for
// the same streak length instead of drifting out of sync in two places.

export interface StreakTier {
  label: string | null;
  color: string;
  glow: string;
}

// Streak length -> a color/label tier. streak <= 0 still gets a (neutral,
// unlit) tier so callers can render off one code path instead of branching
// for the empty state.
export function tierFor(streak: number): StreakTier {
  if (streak <= 0) {
    return { label: null, color: 'var(--color-grey-text)', glow: 'rgba(132,134,135,0.28)' };
  }
  if (streak < 7) {
    return { label: 'Just started', color: 'var(--color-green-primary)', glow: 'rgba(40,138,93,0.4)' };
  }
  if (streak < 30) {
    return { label: 'On a roll', color: 'var(--color-amber-text)', glow: 'rgba(217,119,6,0.4)' };
  }
  if (streak < 100) {
    return { label: 'Blazing', color: '#EA580C', glow: 'rgba(234,88,12,0.42)' };
  }
  return { label: 'Legendary', color: 'var(--color-violet)', glow: 'rgba(109,74,174,0.42)' };
}
