'use client';

// Task lock overlay for custom-day checklist items.
//
// Two modes:
//   ClickableLockBox — shown on the item's actual due day. Member taps it and
//     the box physically "breaks open" (top half flies up, bottom half flies
//     down) revealing the task description underneath. The unlock is persisted
//     server-side so the box stays open after a refresh, and board + dept
//     manager are notified instantly.
//
//   StaticLockBox — shown on days before the item is due this week. Read-only:
//     tells the member which day(s) it will unlock on.
//
// In both cases the description is always in the DOM (underneath the overlay)
// so the reveal animation genuinely uncovers content rather than inserting it.
import * as React from 'react';
import { Icon } from './Icon';
import { unlockGoalItem } from '@/lib/actions';
import { recurrenceLabel } from '@/lib/recurrence';
import type { GoalChecklistItem } from '@/lib/types';

type LockState = 'locked' | 'breaking' | 'open';

export function ClickableLockBox({
  item,
  onUnlocked,
}: {
  item: Pick<GoalChecklistItem, 'id' | 'recurrence' | 'recur_days'>;
  onUnlocked: () => void;
}) {
  const [state, setState] = React.useState<LockState>('locked');

  const handleClick = () => {
    if (state !== 'locked') return;
    // Fire unlock server-side (no await — don't block the animation).
    void unlockGoalItem(item.id);
    setState('breaking');
    // After the CSS split animation completes, signal the parent to show desc.
    setTimeout(() => {
      setState('open');
      onUnlocked();
    }, 680);
  };

  if (state === 'open') return null;

  return (
    <div
      className={`task-lock task-lock-clickable${state === 'breaking' ? ' task-lock-breaking' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      aria-label="Tap to reveal today's task"
    >
      {/* Background halves that fly apart on break */}
      <div className="task-lock-half task-lock-top-half" aria-hidden />
      <div className="task-lock-half task-lock-bottom-half" aria-hidden />
      {/* Content floats above both halves — always centred in the lock */}
      <div className={`task-lock-content${state === 'breaking' ? ' task-lock-content-breaking' : ''}`}>
        <span className="task-lock-icon-wrap">
          <Icon name="lock" size={22} />
        </span>
        <span className="task-lock-label">Tap to unlock</span>
        <span className="task-lock-hint">Today&apos;s task is ready</span>
      </div>
      {/* Security scan line + shimmer */}
      {state === 'locked' && <div className="task-lock-scan" aria-hidden />}
      {state === 'locked' && <div className="task-lock-shimmer" aria-hidden />}
    </div>
  );
}

export function StaticLockBox({
  item,
}: {
  item: Pick<GoalChecklistItem, 'recurrence' | 'recur_days'>;
}) {
  return (
    <div className="task-lock task-lock-static" aria-label="Not yet available">
      <span className="task-lock-icon-wrap">
        <Icon name="lock" size={17} />
      </span>
      <span className="task-lock-label">Locked</span>
      <span className="task-lock-avail">Available {recurrenceLabel(item)}</span>
    </div>
  );
}
