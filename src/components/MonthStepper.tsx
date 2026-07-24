'use client';

// A compact month filter for the analytics charts. Prev/next arrows step the
// `?m=YYYY-MM` search param (which the server reads to pick the month); the
// centre label jumps back to the current month. `canNext` is false when the
// selected month is already the current one, so you can never browse the future.
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Icon } from '@/components/Icon';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function shift(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function MonthStepper({ value, canNext }: { value: string; canNext: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Non-blocking navigation: the click registers instantly (button press +
  // pending state) while the new month streams in, instead of freezing on the
  // server round-trip.
  const [pending, startTransition] = React.useTransition();

  const go = (ym: string | null) => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (ym) sp.set('m', ym);
    else sp.delete('m'); // clearing returns to the current month
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const [y, m] = value.split('-').map(Number);

  return (
    <div className={`month-stepper${pending ? ' is-pending' : ''}`}>
      <button
        type="button"
        className="month-stepper-nav"
        aria-label="Previous month"
        onClick={() => go(shift(value, -1))}
      >
        <Icon name="chevron-left" size={15} />
      </button>
      <button
        type="button"
        className="month-stepper-label"
        title="Jump to current month"
        onClick={() => go(null)}
      >
        {MONTHS[m - 1]} {y}
      </button>
      <button
        type="button"
        className="month-stepper-nav"
        aria-label="Next month"
        disabled={!canNext}
        onClick={() => go(shift(value, 1))}
      >
        <Icon name="chevron-right" size={15} />
      </button>
    </div>
  );
}
