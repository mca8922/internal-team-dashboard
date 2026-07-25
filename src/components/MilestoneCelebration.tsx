'use client';

// App-wide tenure-milestone celebration. Mounted once in the Shell. On a
// member's milestone day it auto-plays a tiered celebration (gentle / medium /
// grand "celebration mode") once, remembered per-occasion in localStorage. It
// can be REPLAYED any time — via the dashboard "Replay" button (a
// `restruc:replay-milestone` window event) or a `?celebrate=<tier>` URL param
// (also used by the milestone notification's link and for previews). Replaying
// is pure UI — it never re-sends anything. Reduced-motion users get the static
// card (confetti CSS already self-disables under prefers-reduced-motion).
import * as React from 'react';
import { createPortal } from 'react-dom';
import { CardConfetti, BottomSparkle } from './ChecklistCelebration';
import { milestoneForToday, type Milestone } from '@/lib/milestones';
import type { UserRole } from '@/lib/types';

const SEEN_PREFIX = 'restruc:milestone:';
type Source = 'auto' | 'replay' | 'param';

const firstName = (name: string) => name.split(' ')[0] || name;

// Build a stand-in milestone for the `?celebrate=<tier>` preview / replay link.
function synthFromTier(tier: string, internshipMonths: number | null): Milestone | null {
  const n = internshipMonths ?? 3;
  switch (tier) {
    case 'monthly':
      return { months: 2, tier: 'gentle', kind: 'monthly', key: 'preview', label: '2 months', internshipMonths: null };
    case 'quarterly':
      return { months: 3, tier: 'medium', kind: 'quarterly', key: 'preview', label: '3 months', internshipMonths: null };
    case 'yearly':
      return { months: 12, tier: 'grand', kind: 'yearly', key: 'preview', label: '1 year', internshipMonths: null };
    case 'intern':
      return { months: Math.min(2, n), tier: 'grand', kind: 'intern', key: 'preview', label: `Month ${Math.min(2, n)} of ${n}`, internshipMonths: n };
    case 'intern-final':
      return { months: n, tier: 'grand', kind: 'intern-final', key: 'preview', label: `Month ${n} of ${n}`, internshipMonths: n };
    default:
      return null;
  }
}

function copyFor(
  m: Milestone,
  fn: string,
): { headline: string; sub: React.ReactNode; cta: string } {
  // The big 🎉/medal lives at the top, so headlines carry no emoji. No
  // em-dashes. The CTA heart is white (🤍) — visible on the green button; the
  // sub-line heart is green (💚) on the card. The name shimmers (text-shine),
  // matching the dashboard greeting. Text is wrapped in {'...'} expressions so
  // apostrophes don't trip the no-unescaped-entities lint rule.
  const cta = 'Thank you 🤍';
  const N = <span className="text-shine">{fn}</span>;
  switch (m.kind) {
    case 'intern-final':
      return {
        headline: `${m.label}. What a journey!`,
        sub: (
          <>
            {'Thank you for being part of Mahesh Chandra & Associates, '}
            {N}
            {'.'}
            <br />
            {"You'll always be one of us. 💚"}
          </>
        ),
        cta,
      };
    case 'intern':
      return {
        headline: `${m.label} with Mahesh Chandra & Associates!`,
        sub: (
          <>
            {'Thank you for everything you bring'}
            <br />
            {'to the team, '}
            {N}
            {'.'}
          </>
        ),
        cta,
      };
    case 'yearly':
      return {
        headline: `${m.label} at Mahesh Chandra & Associates!`,
        sub: (
          <>
            {"Here's to everything you've built with us, "}
            {N}
            <br />
            {"and all that's ahead. 💚"}
          </>
        ),
        cta,
      };
    case 'quarterly':
      return {
        headline: `${m.label} in!`,
        sub: (
          <>
            {'Proud to have you, '}
            {N}
            {'.'}
          </>
        ),
        cta,
      };
    default:
      return {
        headline: `${m.label} with Mahesh Chandra & Associates`,
        sub: (
          <>
            {"Glad you're here, "}
            {N}
            {'.'}
          </>
        ),
        cta,
      };
  }
}

// The hero element at the TOP of the card: a clean "year(s)" medal for the
// yearly tier, otherwise the celebratory 🎉.
function TopVisual({ m }: { m: Milestone }) {
  if (m.kind === 'yearly') {
    const years = Math.round(m.months / 12);
    return (
      <div className="ms-badge" aria-hidden>
        <span className="ms-badge-num">{years}</span>
        <span className="ms-badge-lbl">{years === 1 ? 'YEAR' : 'YEARS'}</span>
      </div>
    );
  }
  return (
    <div className="ms-emoji" aria-hidden>
      🎉
    </div>
  );
}

// Intern progress dots (months done of the tenure), shown below the message.
function InternDots({ m }: { m: Milestone }) {
  if ((m.kind !== 'intern' && m.kind !== 'intern-final') || !m.internshipMonths) return null;
  return (
    <div className="ms-dots" aria-hidden>
      {Array.from({ length: m.internshipMonths }, (_, i) => (
        <span key={i} className={`ms-dot${i < m.months ? ' on' : ''}`} />
      ))}
    </div>
  );
}

export function MilestoneCelebration({
  userId,
  name,
  joinedDate,
  role,
  internshipMonths,
}: {
  userId: string;
  name: string;
  joinedDate: string;
  role: UserRole;
  internshipMonths: number | null;
}) {
  const real = React.useMemo(
    () => milestoneForToday({ role, joined_date: joinedDate, internship_months: internshipMonths }),
    [role, joinedDate, internshipMonths],
  );
  const [shown, setShown] = React.useState<{ m: Milestone; source: Source } | null>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const seenKey = React.useCallback((k: string) => `${SEEN_PREFIX}${userId}:${k}`, [userId]);

  // Auto-play once per occasion.
  React.useEffect(() => {
    if (!real) return;
    try {
      if (localStorage.getItem(seenKey(real.key)) === '1') return;
    } catch {
      /* ignore */
    }
    setShown({ m: real, source: 'auto' });
  }, [real, seenKey]);

  // ?celebrate=<tier> — replay the real one if it matches, else a preview.
  React.useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('celebrate');
    if (!c) return;
    if (real && (c === 'auto' || c === real.kind)) {
      setShown({ m: real, source: 'replay' });
      return;
    }
    const synth = synthFromTier(c, internshipMonths);
    if (synth) setShown({ m: synth, source: 'param' });
  }, [real, internshipMonths]);

  // Replay button / notification → window event. An optional `detail.tier`
  // replays a specific tier (used by the preview/replay button); otherwise it
  // replays today's real milestone.
  React.useEffect(() => {
    const onReplay = (e: Event) => {
      const tier = (e as CustomEvent<{ tier?: string }>).detail?.tier;
      if (tier) {
        const synth = synthFromTier(tier, internshipMonths);
        if (synth) setShown({ m: synth, source: 'param' });
        return;
      }
      if (real) setShown({ m: real, source: 'replay' });
    };
    window.addEventListener('restruc:replay-milestone', onReplay);
    return () => window.removeEventListener('restruc:replay-milestone', onReplay);
  }, [real, internshipMonths]);

  if (!mounted || !shown) return null;
  const { m, source } = shown;
  const { headline, sub, cta } = copyFor(m, firstName(name));

  const close = () => {
    if (source !== 'param' && real) {
      try {
        localStorage.setItem(seenKey(real.key), '1');
      } catch {
        /* ignore */
      }
    }
    setShown(null);
  };

  return createPortal(
    <div
      className={`ms-overlay ms-${m.tier}`}
      role="dialog"
      aria-modal="true"
      aria-label="Tenure milestone"
      onClick={close}
    >
      {m.tier === 'grand' ? (
        <div className="ms-confetti-full" aria-hidden>
          <CardConfetti count={70} />
        </div>
      ) : null}
      <div className={`ms-card ms-card-${m.tier}`} onClick={(e) => e.stopPropagation()}>
        {m.tier !== 'grand' ? <CardConfetti count={m.tier === 'medium' ? 40 : 24} /> : null}
        <BottomSparkle />
        <TopVisual m={m} />
        <div className="ms-headline">{headline}</div>
        <div className="ms-sub">{sub}</div>
        <InternDots m={m} />
        <button type="button" className="btn ms-cta" onClick={close}>
          {cta}
        </button>
      </div>
    </div>,
    document.body,
  );
}
