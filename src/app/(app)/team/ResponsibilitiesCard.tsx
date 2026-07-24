'use client';

// The manager's "Role & Responsibilities" panel. Short write-ups render in full;
// long ones collapse to a faded preview with a "Read details" toggle that rolls
// the panel open/closed with a smooth, measured height animation (the wow bit).
import * as React from 'react';
import { Icon } from '@/components/Icon';
import { RichText } from '@/components/RichTextEditor';

// Preview height (px) when collapsed. Content taller than this (plus a little
// slack so we never hide just a line or two) gets the toggle.
const COLLAPSED_MAX = 240;
const SLACK = 40;

export function ResponsibilitiesCard({
  value,
  accent,
}: {
  value: string;
  accent: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [needsToggle, setNeedsToggle] = React.useState(false);
  // Animated max-height. Always a concrete px string for tall content (so BOTH
  // open and close transitions have real numbers to glide between), or 'none'
  // for short content that never needs clamping.
  const [maxH, setMaxH] = React.useState<string>(`${COLLAPSED_MAX}px`);
  const viewportRef = React.useRef<HTMLDivElement>(null);

  // Decide whether collapsing is needed, and size the panel to match `open`.
  // scrollHeight reports full content height regardless of the current clamp,
  // so this stays accurate whether collapsed or expanded. Runs on mount, on
  // text change, and whenever `open` flips.
  React.useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const full = el.scrollHeight;
    const tall = full > COLLAPSED_MAX + SLACK;
    setNeedsToggle(tall);
    if (!tall) setMaxH('none');
    else setMaxH(open ? `${full}px` : `${COLLAPSED_MAX}px`);
  }, [value, open]);

  // While open, keep the panel sized to its content if the window reflows it
  // (e.g. a resize rewraps the text taller). scrollHeight sees past the clamp.
  React.useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const el = viewportRef.current;
      if (el) setMaxH(`${el.scrollHeight}px`);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  // Expand/collapse, and on EXPAND let the page glide down by exactly the
  // amount being revealed — so the view rides the content as it rolls open
  // instead of the new text appearing off-screen below the fold.
  const toggle = () => {
    const el = viewportRef.current;
    if (!open && el) {
      const revealed = el.scrollHeight - el.clientHeight; // hidden height
      setOpen(true);
      if (revealed > 0) {
        // Next frame: the panel has begun unfurling — scroll in step with it.
        requestAnimationFrame(() =>
          window.scrollBy({ top: revealed, behavior: 'smooth' }),
        );
      }
    } else {
      setOpen(false);
    }
  };

  return (
    <div
      className="card rr-card mb-4"
      style={{ '--dept': accent } as React.CSSProperties}
    >
      <div className="rr-card-head">
        <h2 className="rr-card-title">Role &amp; Responsibilities</h2>
        <span className="rr-card-rule" aria-hidden />
      </div>

      <div
        className={`rr-viewport${needsToggle && !open ? ' is-collapsed' : ''}`}
        style={{ maxHeight: maxH }}
        ref={viewportRef}
      >
        <RichText value={value} className="rr-card-body" />
        {needsToggle && !open ? <span className="rr-fade" aria-hidden /> : null}
      </div>

      {needsToggle ? (
        <div className="rr-toggle-wrap">
          <button
            type="button"
            className="rr-toggle"
            aria-expanded={open}
            onClick={toggle}
          >
            <span>{open ? 'Show less' : 'Read details'}</span>
            <span className={`rr-toggle-chevron${open ? ' is-open' : ''}`} aria-hidden>
              <Icon name="chevron-down" size={15} />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
