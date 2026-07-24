'use client';

// Time-range control for Team Analytics — a segmented preset row (7/14/30
// days, All time) plus two special modes: Month (reuses the existing
// MonthStepper — same ?m=YYYY-MM param and current-month clamp already used
// on Personal Analytics) and Custom (a from/to date range, reusing the
// existing DatePicker). All modes drive the page via search params.
//
// `pending`/`startTransition` come from the parent TeamAnalyticsShell rather
// than being owned here, so the SAME in-flight flag both dims this control's
// buttons AND cross-fades the page content below it — one navigation, one
// pending state, no chance of the two drifting out of sync.
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { DatePicker } from '@/components/DatePicker';
import { MonthStepper } from '@/components/MonthStepper';
import { Button } from '@/components/ui';

export type RangeMode = '7' | '14' | '30' | 'all' | 'custom' | 'month';

const PRESETS: { id: RangeMode; label: string }[] = [
  { id: '7', label: '7 days' },
  { id: '14', label: '14 days' },
  { id: '30', label: '30 days' },
  { id: 'all', label: 'All time' },
];

export function TeamRangeControl({
  range,
  monthValue,
  isCurrentMonth,
  goLiveDate,
  todayStr,
  initialFrom,
  initialTo,
  pending,
  startTransition,
}: {
  range: RangeMode;
  monthValue: string;
  isCurrentMonth: boolean;
  goLiveDate: string;
  todayStr: string;
  // Whatever the CURRENTLY active range resolves to (any mode) — seeds the
  // Custom pickers so switching into Custom starts from where you already
  // were, instead of a blank/default range.
  initialFrom: string;
  initialTo: string;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [from, setFrom] = React.useState(initialFrom);
  const [to, setTo] = React.useState(initialTo);

  // Custom mode's pickers should reflect the range you were just on when you
  // switch into it, not stale leftover state from an earlier visit.
  React.useEffect(() => {
    setFrom(initialFrom);
    setTo(initialTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFrom, initialTo]);

  const setRange = (id: RangeMode, extra?: Record<string, string>) => {
    const sp = new URLSearchParams();
    sp.set('range', id);
    if (extra) for (const [k, v] of Object.entries(extra)) sp.set(k, v);
    startTransition(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
  };

  const applyCustom = () => {
    if (!from || !to || from > to) return;
    setRange('custom', { from, to });
  };

  return (
    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
      <div className={`gb-viewswitch${pending ? ' is-pending' : ''}`}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`gb-viewswitch-btn${range === p.id ? ' active' : ''}`}
            onClick={() => setRange(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`gb-viewswitch-btn${range === 'month' ? ' active' : ''}`}
          onClick={() => setRange('month')}
        >
          Month
        </button>
        <button
          type="button"
          className={`gb-viewswitch-btn${range === 'custom' ? ' active' : ''}`}
          onClick={() => setRange('custom', { from: initialFrom, to: initialTo })}
        >
          Custom
        </button>
      </div>

      {range === 'month' ? (
        <MonthStepper value={monthValue} canNext={!isCurrentMonth} />
      ) : null}

      {range === 'custom' ? (
        <div className="flex items-center gap-2">
          <DatePicker
            value={from}
            onChange={setFrom}
            min={goLiveDate}
            max={to || todayStr}
            placeholder="From"
            ariaLabel="Range start"
            className="team-range-date"
          />
          <span className="text-grey text-sm">–</span>
          <DatePicker
            value={to}
            onChange={setTo}
            min={from || goLiveDate}
            max={todayStr}
            placeholder="To"
            ariaLabel="Range end"
            className="team-range-date"
          />
          <Button size="sm" onClick={applyCustom} disabled={!from || !to || from > to}>
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}
