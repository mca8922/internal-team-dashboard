'use client';

// Right-side brand panel for the login page. Premium dark experience:
// a static (non-animated) Mahesh Chandra & Associates wordmark + tagline,
// a headline, a subtle pulsing radial glow, and a cycling carousel through
// the firm's 7 core principles. Hidden on mobile via the .auth-art rule.
//
// No external animation libraries — CSS transitions + a single setInterval
// (cleaned up on unmount).
import * as React from 'react';

// ---- the 7 core principles ----
const PRINCIPLES: { num: string; title: string; desc: string }[] = [
  {
    num: '01',
    title: 'Ownership First',
    desc: 'Own the engagement end to end. No hand-offs, no excuses.',
  },
  {
    num: '02',
    title: 'Speed with Quality',
    desc: 'Meet every deadline, but sign only work you stand behind.',
  },
  {
    num: '03',
    title: 'Precision & Diligence',
    desc: 'Every figure, filing, and working paper double-checked.',
  },
  {
    num: '04',
    title: 'Regulatory Vigilance',
    desc: 'Stay current with tax law, audit standards, and compliance.',
  },
  {
    num: '05',
    title: 'Client Impact',
    desc: 'Measure success by the value clients actually feel.',
  },
  {
    num: '06',
    title: 'Clear Communication',
    desc: 'Say it simply, write it down, leave no ambiguity.',
  },
  {
    num: '07',
    title: 'Continuous Improvement',
    desc: 'A little better every day compounds into excellence.',
  },
];

const ROTATE_MS = 4200;
const EXIT_MS = 420; // matches the fade-up-out transition

export function BrandPanel() {
  const [active, setActive] = React.useState(0);
  // 'enter' = card rolls in from the right; 'exit' = card fades up and out.
  const [phase, setPhase] = React.useState<'enter' | 'exit'>('enter');
  // when true the card is parked off-screen-right (pre-roll-in position)
  const [parked, setParked] = React.useState(false);

  // Auto-rotate: exit the current card, then advance and roll the next in.
  React.useEffect(() => {
    const id = setInterval(() => {
      setPhase('exit');
      window.setTimeout(() => {
        setActive((i) => (i + 1) % PRINCIPLES.length);
        setPhase('enter');
      }, EXIT_MS);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  // On every card change, briefly park the card off-screen-right, then
  // release it on the next frame so the CSS transition rolls it in.
  React.useEffect(() => {
    if (phase !== 'enter') return;
    setParked(true);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setParked(false));
    });
    return () => cancelAnimationFrame(raf);
  }, [active, phase]);

  const jumpTo = (i: number) => {
    if (i === active) return;
    setPhase('enter');
    setActive(i);
  };

  const p = PRINCIPLES[active];

  return (
    <div className="brand-panel">
      {/* subtle pulsing radial glow, bottom-right */}
      <div className="brand-glow" aria-hidden="true" />

      <div className="brand-content">
        {/* brand wordmark — coded (not an image), plain static text with no
            ignite/glow animation, per the sidebar's animated wordmark. */}
        <div className="brand-mark">
          <div className="brand-wordmark">
            <span className="brand-wordmark-line">MAHESH CHANDRA</span>
            <span className="brand-wordmark-line">&amp; ASSOCIATES</span>
          </div>
        </div>

        <div className="brand-headline-block">
          <h2 className="brand-headline">Chartered Accountants</h2>
          <p className="brand-subtitle">Track engagements. Log hours. Meet every deadline.</p>
          <p className="brand-principles-cue">Remember Your CORE Principles</p>
        </div>

        {/* principles carousel — one card at a time, rolls in from the right */}
        <div className="brand-carousel">
          <div
            className={[
              'principle-card',
              phase === 'exit' ? 'is-out' : '',
              parked ? 'roll-start' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {/* sticky-note number badge */}
            <div className="principle-sticky">{p.num}</div>

            <div className="principle-title">{p.title}</div>
            <div className="principle-desc">{p.desc}</div>
          </div>

          {/* progress dots */}
          <div className="principle-dots" role="tablist" aria-label="Core principles">
            {PRINCIPLES.map((pr, i) => (
              <button
                key={pr.num}
                type="button"
                className={`principle-dot ${i === active ? 'active' : ''}`}
                aria-label={`${pr.num} ${pr.title}`}
                aria-selected={i === active}
                onClick={() => jumpTo(i)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
