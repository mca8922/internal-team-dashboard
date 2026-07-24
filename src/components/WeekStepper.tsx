'use client';

// A compact week filter for the "Hours per day" chart — same pattern as
// MonthStepper, just stepping by 7 days instead of by month. Prev/next arrows
// step the `?w=YYYY-MM-DD` search param (the Monday of the selected week,
// which the server reads to pick the week); the centre label jumps back to
// the current week. `canNext` is false when the selected week is already the
// current one, so you can never browse into the future.
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Icon } from '@/components/Icon';

function shift(ds: string, deltaDays: number) {
  const [y, m, d] = ds.split('-').map(Number);
  const next = new Date(y, m - 1, d + deltaDays);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export function WeekStepper({
  value,
  label,
  canNext,
}: {
  // The selected week's Monday, YYYY-MM-DD.
  value: string;
  // What the centre button shows — "This week" or an explicit date range;
  // computed by the caller so this component stays date-formatting-agnostic.
  label: string;
  canNext: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const go = (ds: string | null) => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (ds) sp.set('w', ds);
    else sp.delete('w'); // clearing returns to the current week
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className={`month-stepper${pending ? ' is-pending' : ''}`}>
      <button
        type="button"
        className="month-stepper-nav"
        aria-label="Previous week"
        onClick={() => go(shift(value, -7))}
      >
        <Icon name="chevron-left" size={15} />
      </button>
      <button
        type="button"
        className="month-stepper-label"
        title="Jump to current week"
        onClick={() => go(null)}
      >
        {label}
      </button>
      <button
        type="button"
        className="month-stepper-nav"
        aria-label="Next week"
        disabled={!canNext}
        onClick={() => go(shift(value, 7))}
      >
        <Icon name="chevron-right" size={15} />
      </button>
    </div>
  );
}
