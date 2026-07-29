'use client';

// The shared month grid used by both DatePicker and DateTimePicker so every
// calendar in the app looks and behaves identically. It renders a typed-date
// input (DD-MM-YYYY), the month header (with ‹ › navigation that also opens a
// month grid and a year grid for fast long-range jumps) and a 6×7 day grid,
// and calls `onPick` with the chosen day. Dates are bare wall-clock days (no
// timezone math), compared purely on local Y/M/D.
import * as React from 'react';
import { Icon } from './Icon';
import { addMonths } from '@/lib/dates';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const YEARS_PER_PAGE = 12;

// Local YYYY-MM-DD key (no timezone conversion) — mirrors native date semantics.
export const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDMY = (d: Date) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;

// Reformats raw keystrokes into DD-MM-YYYY as the user types (digits only —
// dashes are inserted automatically, so pasting "27102020" or "27-10-2020"
// both land the same way).
function formatTyping(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

// Strict DD-MM-YYYY parse — rejects "31-02-2026" etc. (no month-end rollover).
function parseDMY(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

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
  // 'days' is the normal grid; 'months' / 'years' are fast-jump pickers
  // reached by clicking the header title, so choosing a distant year (e.g. a
  // birth year) doesn't mean clicking ‹ hundreds of times.
  const [mode, setMode] = React.useState<'days' | 'months' | 'years'>('days');
  const [yearPage, setYearPage] = React.useState(() => view.getFullYear() - (view.getFullYear() % YEARS_PER_PAGE));

  const selKey = value ? toKey(value) : null;
  const [typed, setTyped] = React.useState(() => (value ? toDMY(value) : ''));
  const [typedError, setTypedError] = React.useState(false);

  // Keep the typed field in sync when the selected date changes from outside
  // the input itself (day-grid clicks, month/year picks, Today/Clear).
  React.useEffect(() => {
    setTyped(selKey ? toDMY(value as Date) : '');
    setTypedError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  const keyInRange = (k: string) => {
    if (min && k < min) return false;
    if (max && k > max) return false;
    return true;
  };

  const commitTyped = () => {
    if (!typed.trim()) {
      setTypedError(false);
      return;
    }
    const d = parseDMY(typed);
    if (!d || !keyInRange(toKey(d))) {
      setTypedError(true);
      return;
    }
    setTypedError(false);
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setMode('days');
    onPick(d);
  };

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

  const inRange = (d: Date) => keyInRange(toKey(d));

  const monthInRange = (y: number, m: number) => {
    if (!min && !max) return true;
    const first = toKey(new Date(y, m, 1));
    const last = toKey(new Date(y, m + 1, 0));
    if (max && first > max) return false;
    if (min && last < min) return false;
    return true;
  };

  const yearInRange = (y: number) => {
    if (!min && !max) return true;
    if (max && `${y}-01-01` > max) return false;
    if (min && `${y}-12-31` < min) return false;
    return true;
  };

  const openYears = () => {
    setYearPage(view.getFullYear() - (view.getFullYear() % YEARS_PER_PAGE));
    setMode('years');
  };

  return (
    <div className="datepicker-cal">
      <div className="datepicker-typerow">
        <input
          type="text"
          inputMode="numeric"
          className={`datepicker-typeinput${typedError ? ' error' : ''}`}
          placeholder="DD-MM-YYYY"
          value={typed}
          onChange={(e) => {
            setTyped(formatTyping(e.target.value));
            setTypedError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTyped();
            }
          }}
          onBlur={commitTyped}
          aria-label="Type a date as DD-MM-YYYY"
        />
        {typedError && <span className="datepicker-typeerr">Invalid date</span>}
      </div>

      {mode === 'days' && (
        <>
          <div className="datepicker-head">
            <button
              type="button"
              className="datepicker-nav"
              aria-label="Previous month"
              onClick={() => setView((v) => addMonths(v, -1))}
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <button type="button" className="datepicker-title datepicker-title-btn" onClick={() => setMode('months')}>
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </button>
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
        </>
      )}

      {mode === 'months' && (
        <>
          <div className="datepicker-head">
            <button
              type="button"
              className="datepicker-nav"
              aria-label="Previous year"
              onClick={() => setView((v) => new Date(v.getFullYear() - 1, v.getMonth(), 1))}
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <button type="button" className="datepicker-title datepicker-title-btn" onClick={openYears}>
              {view.getFullYear()}
            </button>
            <button
              type="button"
              className="datepicker-nav"
              aria-label="Next year"
              onClick={() => setView((v) => new Date(v.getFullYear() + 1, v.getMonth(), 1))}
            >
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
          <div className="datepicker-grid datepicker-mgrid">
            {MONTHS.map((name, i) => (
              <button
                key={name}
                type="button"
                className={`datepicker-mcell${i === view.getMonth() ? ' selected' : ''}${
                  i === today.getMonth() && view.getFullYear() === today.getFullYear() ? ' today' : ''
                }`}
                disabled={!monthInRange(view.getFullYear(), i)}
                onClick={() => {
                  setView(new Date(view.getFullYear(), i, 1));
                  setMode('days');
                }}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'years' && (
        <>
          <div className="datepicker-head">
            <button
              type="button"
              className="datepicker-nav"
              aria-label="Previous years"
              onClick={() => setYearPage((p) => p - YEARS_PER_PAGE)}
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <span className="datepicker-title">
              {yearPage} – {yearPage + YEARS_PER_PAGE - 1}
            </span>
            <button
              type="button"
              className="datepicker-nav"
              aria-label="Next years"
              onClick={() => setYearPage((p) => p + YEARS_PER_PAGE)}
            >
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
          <div className="datepicker-grid datepicker-mgrid">
            {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPage + i).map((y) => (
              <button
                key={y}
                type="button"
                className={`datepicker-mcell${y === view.getFullYear() ? ' selected' : ''}${
                  y === today.getFullYear() ? ' today' : ''
                }`}
                disabled={!yearInRange(y)}
                onClick={() => {
                  setView(new Date(y, view.getMonth(), 1));
                  setMode('months');
                }}
              >
                {y}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
