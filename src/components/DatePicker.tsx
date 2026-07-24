'use client';

// Modern popover date picker — a styled drop-in replacement for the browser's
// native <input type="date"> so date fields match the app's look instead of the
// OS calendar. Same controlled contract as the native input: `value` is a
// YYYY-MM-DD string ('' = empty) and `onChange` emits the same shape.
//
// The month grid is the shared <CalendarMonth>; this component adds the trigger,
// the Today/Clear footer and a portal (position:fixed) so the calendar is never
// clipped by a scrollable modal body (.modal has overflow-y:auto) and always
// paints above it.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { CalendarMonth, toKey } from './CalendarMonth';
import { parseDate } from '@/lib/dates';

const POP_W = 300;
const POP_H = 358; // estimate used only to decide whether to flip above

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select a date…',
  ariaLabel,
  id,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
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

  const selected = value ? parseDate(value) : null;
  const today = new Date();

  // Anchor the fixed popover to the trigger; flip above when it would overflow.
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

  const pick = (d: Date) => {
    onChange(toKey(d));
    setOpen(false);
  };

  const label = selected
    ? selected.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
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
        <span className={`datepicker-value${selected ? '' : ' placeholder'}`}>
          {selected ? label : placeholder}
        </span>
        <Icon name="chevron-down" size={14} />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              className="datepicker-pop"
              role="dialog"
              aria-label="Choose date"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: POP_W }}
            >
              <CalendarMonth value={selected} onPick={pick} min={min} max={max} />
              <div className="datepicker-foot">
                <button
                  type="button"
                  className="datepicker-foot-btn"
                  onClick={() => pick(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
                >
                  Today
                </button>
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
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
