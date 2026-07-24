'use client';

// Owns the ONE useTransition shared by the range control and the page
// content below it, so switching ranges reads as a single smooth motion
// instead of an instant data swap:
//   1. Click a range → startTransition fires → content dims/blurs while the
//      new server payload streams in (still showing the OLD data, so nothing
//      goes blank).
//   2. New payload arrives → `contentKey` changes (computed server-side from
//      the resolved range) → React remounts the content fresh, which
//      re-triggers every chart's own built-in entrance/stagger animation
//      (BarChart/LineChart already animate in on mount) plus this wrapper's
//      own fade-and-lift entrance — and un-dims.
import * as React from 'react';
import { TeamRangeControl, type RangeMode } from './TeamRangeControl';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export function TeamAnalyticsShell({
  range,
  monthValue,
  isCurrentMonth,
  goLiveDate,
  todayStr,
  initialFrom,
  initialTo,
  contentKey,
  children,
}: {
  range: RangeMode;
  monthValue: string;
  isCurrentMonth: boolean;
  goLiveDate: string;
  todayStr: string;
  initialFrom: string;
  initialTo: string;
  // Identifies the resolved range (mode + actual dates) — changing it forces
  // the content below to remount so mount-triggered entrance animations
  // (charts, the fade-in) replay on every range change, not just the first.
  contentKey: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = React.useTransition();

  return (
    <>
      {FEATURE_FLAGS.analyticsFilters ? (
        <div className="mb-6">
          <TeamRangeControl
            range={range}
            monthValue={monthValue}
            isCurrentMonth={isCurrentMonth}
            goLiveDate={goLiveDate}
            todayStr={todayStr}
            initialFrom={initialFrom}
            initialTo={initialTo}
            pending={pending}
            startTransition={startTransition}
          />
        </div>
      ) : null}
      <div key={contentKey} className={`team-analytics-content${pending ? ' is-pending' : ''}`}>
        {children}
      </div>
    </>
  );
}
