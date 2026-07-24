'use client';

// The shared month grid used by both DatePicker and DateTimePicker so every
// calendar in the app looks and behaves identically. It renders the month
// header (with ‹ › navigation), the weekday row and a 6×7 day grid, and calls
// `onPick` with the chosen day. Dates are bare wall-clock days (no timezone
// math), compared purely on local Y/M/D.
import * as React from 'react';
import { Icon } from './Icon';
import { addMonths } from '@/lib/dates';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Local YYYY-MM-DD key (no timezone conversion) — mirrors native date semantics.
export const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Monday-based weekday index (Mon=0 … Sun=6); the app anchors weeks on Monday.
const monIndex = (d: Date) => (d.getDay() + 6) % 7;

export function CalendarMonth({
  value,
  onPick,
  min,
  max,
}: {
  value: Date | null;
  onPick: (d: Date) => void;
  min?: string;
  max?: string;
}) {
  const today = new Date();
  const todayKey = toKey(today);
  // Which month the grid shows (the 1st of that month). Seeded from the value;
  // the picker re-mounts this on each open, so no re-sync effect is needed.
  const [view, setView] = React.useState<Date>(() => {
    const base = value ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // A 6×7 grid starting from the Monday on/before the 1st of the shown month.
  const cells = React.useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - monIndex(first));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const inRange = (d: Date) => {
    const k = toKey(d);
    if (min && k < min) return false;
    if (max && k > max) return false;
    return true;
  };

  const selKey = value ? toKey(value) : null;

  return (
    <div className="datepicker-cal">
      <div className="datepicker-head">
        <button
          type="button"
          className="datepicker-nav"
          aria-label="Previous month"
          onClick={() => setView((v) => addMonths(v, -1))}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="datepicker-title">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </span>
        <button
          type="button"
          className="datepicker-nav"
          aria-label="Next month"
          onClick={() => setView((v) => addMonths(v, 1))}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>

      <div className="datepicker-grid datepicker-dow">
        {WEEKDAYS.map((w) => (
          <span key={w} className="datepicker-dowcell">
            {w}
          </span>
        ))}
      </div>

      <div className="datepicker-grid">
        {cells.map((d) => {
          const k = toKey(d);
          const other = d.getMonth() !== view.getMonth();
          return (
            <button
              key={k}
              type="button"
              className={`datepicker-day${other ? ' other' : ''}${
                selKey === k ? ' selected' : ''
              }${k === todayKey ? ' today' : ''}`}
              disabled={!inRange(d)}
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
