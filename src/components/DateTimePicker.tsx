'use client';

// Modern popover date + time picker — a styled drop-in replacement for the
// native <input type="datetime-local">. Same controlled contract: `value` is a
// `YYYY-MM-DDTHH:mm` wall-clock string ('' = empty) and `onChange` emits the
// same. The popover pairs the shared <CalendarMonth> with hour / minute / AM-PM
// columns; picking any part keeps the others and emits the combined value.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { CalendarMonth, toKey } from './CalendarMonth';

const POP_W = 476;
const POP_H = 380; // estimate used only to decide whether to flip above
const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59

// Parse a `YYYY-MM-DDTHH:mm` value into a date + 24h time (null when empty).
function parse(value: string): { date: Date; h24: number; m: number } | null {
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = (timePart || '00:00').split(':').map(Number);
  if (!y || !mo || !d) return null;
  return { date: new Date(y, mo - 1, d), h24: h || 0, m: mi || 0 };
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Select date & time…',
  ariaLabel,
  id,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);

  const parsed = parse(value);
  const date = parsed?.date ?? null;
  // Working time — from the value, or a sensible default (9:00 AM) until a value
  // exists, so picking the date first still yields a complete datetime.
  const h24 = parsed?.h24 ?? 9;
  const min = parsed?.m ?? 0;
  const h12 = h24 % 12 || 12;
  const ampm: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';

  const place = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = Math.min(r.left, vw - POP_W - 8);
    if (left < 8) left = 8;
    let top = r.bottom + 6;
    if (top + POP_H > vh - 8) top = Math.max(8, r.top - POP_H - 6);
    setPos({ top, left });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    place();
    // Centre the selected hour/minute/AM-PM in each scroll column on open.
    requestAnimationFrame(() => {
      popRef.current?.querySelectorAll<HTMLElement>('.dtpicker-timecol').forEach((col) => {
        const on = col.querySelector<HTMLElement>('.dtpicker-timeitem.on');
        if (on) col.scrollTop = on.offsetTop - col.clientHeight / 2 + on.clientHeight / 2;
      });
    });
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Emit a combined value from a date + 24h hour + minute. Falls back to today
  // for the date so changing the time first still produces a valid datetime.
  const emit = (d: Date | null, nextH24: number, nextM: number) => {
    const base = d ?? new Date();
    const key = toKey(new Date(base.getFullYear(), base.getMonth(), base.getDate()));
    onChange(`${key}T${pad(nextH24)}:${pad(nextM)}`);
  };

  const to24 = (hour12: number, ap: 'AM' | 'PM') =>
    ap === 'AM' ? hour12 % 12 : (hour12 % 12) + 12;

  const pickDay = (d: Date) => emit(d, h24, min);
  const pickHour = (hr: number) => emit(date, to24(hr, ampm), min);
  const pickMinute = (mm: number) => emit(date, h24, mm);
  const pickAmPm = (ap: 'AM' | 'PM') => emit(date, to24(h12, ap), min);

  const label = parsed
    ? `${parsed.date.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })} · ${h12}:${pad(min)} ${ampm}`
    : '';

  return (
    <div className={`datepicker${className ? ' ' + className : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={`input datepicker-trigger${open ? ' open' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <Icon name="calendar" size={15} />
        <span className={`datepicker-value${parsed ? '' : ' placeholder'}`}>
          {parsed ? label : placeholder}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              className="datepicker-pop dtpicker-pop"
              role="dialog"
              aria-label="Choose date and time"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: POP_W }}
            >
              <div className="dtpicker-body">
                <CalendarMonth value={date} onPick={pickDay} />
                <div className="dtpicker-time">
                  <div className="dtpicker-timecol" aria-label="Hour">
                    <div className="dtpicker-timecol-head">Hr</div>
                    {HOURS.map((hr) => (
                      <button
                        key={hr}
                        type="button"
                        className={`dtpicker-timeitem${hr === h12 ? ' on' : ''}`}
                        onClick={() => pickHour(hr)}
                      >
                        {pad(hr)}
                      </button>
                    ))}
                  </div>
                  <div className="dtpicker-timecol" aria-label="Minute">
                    <div className="dtpicker-timecol-head">Min</div>
                    {MINUTES.map((mm) => (
                      <button
                        key={mm}
                        type="button"
                        className={`dtpicker-timeitem${mm === min ? ' on' : ''}`}
                        onClick={() => pickMinute(mm)}
                      >
                        {pad(mm)}
                      </button>
                    ))}
                  </div>
                  <div className="dtpicker-timecol dtpicker-ampmcol" aria-label="AM or PM">
                    <div className="dtpicker-timecol-head">&nbsp;</div>
                    {(['AM', 'PM'] as const).map((ap) => (
                      <button
                        key={ap}
                        type="button"
                        className={`dtpicker-timeitem${ap === ampm ? ' on' : ''}`}
                        onClick={() => pickAmPm(ap)}
                      >
                        {ap}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="datepicker-foot">
                <button
                  type="button"
                  className="datepicker-foot-btn"
                  onClick={() => {
                    const now = new Date();
                    emit(now, now.getHours(), now.getMinutes());
                  }}
                >
                  Now
                </button>
                <div className="dtpicker-foot-right">
                  <button
                    type="button"
                    className="datepicker-foot-btn"
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="datepicker-foot-btn primary"
                    onClick={() => setOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
