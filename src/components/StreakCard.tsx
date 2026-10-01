// The "Log streak" card. Lives in components/ (not under the dashboard route)
// because two surfaces show it:
//   - the Daily Log page's right rail (variant="rail"), always, in every state;
//   - the Dashboard (variant="card"), ONLY while the streak is live — the
//     page doesn't render it at all for 'ended' / 'none'.
// Both read the same streakHealth() (@/lib/streak) so they can never disagree.
//
// Kept deliberately simple: a fire emoji and the count, no milestone ring.
// What it adds over a bare number is the streak's *health* — an amber
// "Ends tonight" state while the run is still savable, and a dimmed
// "Streak lost" state (Daily Log only) once it has broken.
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { tierFor, type StreakState } from '@/lib/streak';
import { fmtRelative, parseDate } from '@/lib/dates';

export function StreakCard({
  streak,
  state,
  lost = 0,
  lostOn = null,
  variant = 'card',
}: {
  streak: number;
  state: StreakState;
  lost?: number;
  lostOn?: string | null;
  variant?: 'card' | 'rail';
}) {
  const tier = tierFor(streak);
  const ended = state === 'ended';
  const atRisk = state === 'at_risk';

  return (
    <div
      className={[
        variant === 'card' ? 'card streak-card' : 'streak-card streak-card--rail',
        atRisk ? 'is-at-risk' : '',
        ended ? 'is-ended' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--tier-color': tier.color } as React.CSSProperties}
    >
      <div className="streak-card-head">
        <span className="card-subtitle">Log streak</span>
        {atRisk ? (
          <span className="streak-chip is-risk">Ends tonight</span>
        ) : ended ? (
          <span className="streak-chip is-lost">Streak lost</span>
        ) : tier.label ? (
          <span className="streak-chip">{tier.label}</span>
        ) : null}
      </div>

      <div className="streak-card-body">
        <span className="streak-flame" aria-hidden>
          🔥
        </span>
        <div className="streak-count">
          <div className="streak-count-num">{ended ? lost : streak}</div>
          <div className="streak-count-label">
            {ended
              ? `day streak, last logged ${fmtRelative(parseDate(lostOn!)).toLowerCase()}`
              : streak === 0
                ? 'Log today to start a streak'
                : streak === 1
                  ? 'day. Keep it going.'
                  : 'working days in a row'}
          </div>
        </div>
      </div>

      {/* The one line that can still change the outcome — only while there is
          something the member can do about it. The Dashboard links straight
          to the editor; on the Daily Log page they are already in it. */}
      {atRisk ? (
        variant === 'card' ? (
          <Link href="/log" className="streak-alert">
            <Icon name="clock" size={12} />
            <span>Write today&apos;s log or it ends tonight</span>
            <Icon name="arrow-right" size={12} style={{ marginLeft: 'auto' }} />
          </Link>
        ) : (
          <div className="streak-alert">
            <Icon name="clock" size={12} />
            <span>Write something today or it ends tonight</span>
          </div>
        )
      ) : null}
    </div>
  );
}
