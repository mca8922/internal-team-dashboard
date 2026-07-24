'use client';

// A small "Replay celebration" button on the dashboard greeting, shown ONLY on
// a member's milestone day. Lets them re-watch / screen-record the celebration
// to share. It just dispatches the window event the MilestoneCelebration
// overlay (mounted in the Shell) listens for — no data is touched.
import * as React from 'react';
import { milestoneForToday } from '@/lib/milestones';
import type { UserRole } from '@/lib/types';

// Grand-tier milestones get the app-wide festive strip (which has its own Replay
// button), so this dashboard chip only covers the NON-grand tiers (gentle /
// medium) — guaranteeing exactly one Replay button on screen, never two.
const NON_GRAND_PREVIEW = new Set(['monthly', 'quarterly']);

export function MilestoneReplayButton({
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
  // Preview via `?celebrate=<tier>` — only the non-grand tiers (grand is the strip's job).
  const [previewTier, setPreviewTier] = React.useState<string | null>(null);
  React.useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('celebrate');
    setPreviewTier(c && NON_GRAND_PREVIEW.has(c) ? c : null);
  }, []);

  const showReal = !!real && real.tier !== 'grand';
  if (!showReal && !previewTier) return null;

  const replay = () =>
    window.dispatchEvent(
      new CustomEvent('restruc:replay-milestone', {
        detail: showReal ? {} : { tier: previewTier },
      }),
    );

  return (
    <button type="button" className="ms-replay-btn" onClick={replay}>
      <span aria-hidden>🎉</span> Replay celebration
    </button>
  );
}
