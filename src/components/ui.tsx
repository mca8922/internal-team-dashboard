'use client';

// Shared UI primitives — Avatar, Button, Field, Badge-less helpers, Progress,
// Donut, Spark, EmptyState, Modal. Ported from the prototype's
// components-common.jsx.
import * as React from 'react';
import { Icon, type IconName } from './Icon';

// ---- Avatar ----
const AVATAR_PALETTE = ['#1F5C3E', '#163F2B', '#43454A', '#676F7E', '#2E7A52'];

export function Avatar({
  name = '',
  size = 'md',
  color,
  src,
}: {
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
  src?: string | null;
}) {
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const idx = ((name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0)) % AVATAR_PALETTE.length;
  const bg = color || AVATAR_PALETTE[idx];
  if (src) {
    return (
      <div
        className={`avatar avatar-${size}`}
        style={{ background: bg, padding: 0, overflow: 'hidden' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }
  return (
    <div className={`avatar avatar-${size}`} style={{ background: bg }}>
      {initials || '?'}
    </div>
  );
}

// ---- Button ----
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  // Shows an inline spinner and disables the button while an async action runs.
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    variant === 'secondary' && 'btn-secondary',
    variant === 'ghost' && 'btn-ghost',
    variant === 'danger' && 'btn-danger',
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? (
        <span className="btn-spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={14} />
      ) : null}
      {children}
    </button>
  );
}

// ---- Field ----
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {hint && !error ? <div className="text-xs text-grey">{hint}</div> : null}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

// ---- Progress ----
export function Progress({ value = 0, color }: { value?: number; color?: string }) {
  return (
    <div className="goal-progress">
      <div
        className="goal-progress-fill"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

// ---- Donut ----
export function Donut({
  data,
  size = 120,
  thickness = 18,
  total,
  // Hover is self-contained by default (each segment brightens + a native
  // <title> tooltip on hover). Pass activeIndex/onHoverIndex to let a parent
  // drive/observe it instead — e.g. a legend list that highlights the arc on
  // row hover and vice versa (see DonutCard). Passing them makes this a
  // controlled component: internal hover state stops mattering.
  activeIndex,
  onHoverIndex,
  interactive = true,
}: {
  data: { label?: string; value: number; color?: string }[];
  size?: number;
  thickness?: number;
  total?: number;
  activeIndex?: number | null;
  onHoverIndex?: (i: number | null) => void;
  interactive?: boolean;
}) {
  const [internalHover, setInternalHover] = React.useState<number | null>(null);
  const hovered = activeIndex !== undefined ? activeIndex : internalHover;
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  const sum = total || data.reduce((s, d) => s + d.value, 0) || 1;
  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ overflow: 'visible' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={thickness}
      />
      {data.map((d, i) => {
        const frac = d.value / sum;
        const dash = frac * c;
        const segOffset = offset;
        offset += dash;
        const isHovered = hovered === i;
        const isDimmed = hovered != null && !isHovered;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={d.color || 'var(--color-green-primary)'}
            strokeWidth={isHovered ? thickness + 3 : thickness}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-segOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
            className="donut-seg"
            style={
              {
                '--donut-draw-from': -segOffset + dash,
                '--donut-draw-to': -segOffset,
                animationDelay: `${i * 90}ms`,
                opacity: isDimmed ? 0.4 : 1,
                cursor: interactive ? 'pointer' : undefined,
                transition:
                  'stroke-width 200ms cubic-bezier(0.22,0.61,0.36,1), opacity 200ms ease, filter 200ms ease',
                filter: isHovered ? 'brightness(1.18) saturate(1.15)' : 'none',
              } as React.CSSProperties
            }
            onMouseEnter={
              interactive
                ? () => {
                    setInternalHover(i);
                    onHoverIndex?.(i);
                  }
                : undefined
            }
            onMouseLeave={
              interactive
                ? () => {
                    setInternalHover(null);
                    onHoverIndex?.(null);
                  }
                : undefined
            }
          >
            {interactive ? <title>{`${d.label ?? 'Value'}: ${d.value}`}</title> : null}
          </circle>
        );
      })}
    </svg>
  );
}

// ---- EmptyState ----
export function EmptyState({
  icon = 'sparkles',
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={42} stroke={1.2} />
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ---- Modal ----
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width,
  disableBackdropClose,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: number;
  disableBackdropClose?: boolean;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref so the focus/keydown effect below only
  // re-runs when `open` flips — not on every parent re-render. Otherwise a
  // parent that recreates its onClose on each keystroke (e.g. a form modal)
  // would re-run this effect and yank focus back to the first field mid-typing.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const disableBackdropCloseRef = React.useRef(disableBackdropClose);
  disableBackdropCloseRef.current = disableBackdropClose;

  React.useEffect(() => {
    if (!open) return;

    // Remember what was focused so we can restore it when the modal closes,
    // and move focus into the dialog (first field, else the dialog itself).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const first = focusables()[0];
    (first ?? dialogRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!disableBackdropCloseRef.current) onCloseRef.current();
        return;
      }
      // Trap Tab inside the dialog so keyboard focus can't wander to the page
      // behind the backdrop.
      if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && active === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={disableBackdropClose ? undefined : onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={width ? { width, maxWidth: 'calc(100vw - 32px)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <h2 className="modal-title">{title}</h2> : null}
        {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  );
}

// ---- Toggle ----
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        background: on ? 'var(--color-green-primary)' : 'var(--color-border)',
        position: 'relative',
        transition: 'background 120ms',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          width: 18,
          height: 18,
          background: '#fff',
          borderRadius: '50%',
          transition: 'left 160ms ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}
