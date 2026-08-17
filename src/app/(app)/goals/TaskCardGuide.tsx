'use client';

// "?" beside the Tasks title → a legend for how a task card looks in every
// situation. Deliberately available to everyone, not just the Board: a member
// reading the cascade is exactly who needs to know why one card is orange.
//
// The swatches are driven by the same CSS variables as the real cards
// (--color-gold-darker, --color-amber-text, --color-orange, …), so the legend
// cannot drift from the cards it describes — retint a card and the legend
// retints with it, in both light and dark theme.
import * as React from 'react';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/ui';

// One row of the legend: a miniature card in the state, and what it means.
// `accent`/`tint` are raw var() strings so a row renders the true colors.
function Row({
  accent,
  tint,
  glow,
  when,
  meaning,
  dim,
}: {
  accent: string;
  tint?: string;
  glow?: boolean;
  when: string;
  meaning: string;
  dim?: boolean;
}) {
  return (
    <div className="tcg-row">
      <span
        className={`tcg-chip${glow ? ' tcg-chip--glow' : ''}`}
        style={{
          borderLeftColor: accent,
          background: tint ?? 'var(--color-card)',
          ...(glow ? ({ '--tcg-glow': accent } as React.CSSProperties) : {}),
        }}
        aria-hidden
      />
      <div className="tcg-text">
        <div className="tcg-when" style={{ color: accent, opacity: dim ? 0.85 : 1 }}>
          {when}
        </div>
        <div className="tcg-meaning">{meaning}</div>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="tcg-section">
      <h3 className="tcg-section-title">{title}</h3>
      {note ? <p className="tcg-section-note">{note}</p> : null}
      <div className="tcg-rows">{children}</div>
    </section>
  );
}

export function TaskCardGuide() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        className="tcg-trigger"
        onClick={() => setOpen(true)}
        aria-label="What do the task card colours mean?"
        title="What do the card colours mean?"
      >
        <Icon name="help-circle" size={15} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reading a task card"
        subtitle="Every colour a card can take, and what it is telling you"
        width={620}
      >
        <div className="tcg">
          {/* The idea in plain prose, before any of the detail. The copy lives
              in one <p> so it flows as sentences; the flex row here has exactly
              two children, the colour rail and that paragraph. */}
          <div className="tcg-lede">
            <span className="tcg-ramp" aria-hidden>
              <i style={{ background: 'var(--color-gold-darker)' }} />
              <i style={{ background: 'var(--color-amber-text)' }} />
              <i style={{ background: 'var(--color-orange)' }} />
              <i style={{ background: 'var(--color-red)' }} />
            </span>
            <p className="tcg-lede-text">
              A task card changes colour as its due date gets closer. It holds its own
              tier colour until roughly a week out, then moves through gold and amber,
              turns orange on the day it is due, and goes red once the date has passed.
              The colour tells you how much time is left — not just that something is
              already late.
            </p>
          </div>

          <Section
            title="As the deadline approaches"
            note="Open tasks only. The colour is worked out fresh each day, so a card moves along on its own."
          >
            <Row
              accent="var(--color-slate)"
              when="More than 7 days away"
              meaning="Nothing special — the card keeps its own tier colour."
            />
            <Row
              accent="var(--color-gold-darker)"
              tint="var(--color-gold-light)"
              when="4 to 7 days away"
              meaning="Gold. Worth putting on your radar this week."
            />
            <Row
              accent="var(--color-amber-text)"
              tint="var(--color-amber-bg)"
              when="1 to 3 days away"
              meaning="Amber. Getting urgent — this needs time booked for it."
            />
            <Row
              accent="var(--color-orange)"
              tint="var(--color-orange-bg)"
              glow
              when="Due today"
              meaning="Orange, with a glow ring around the card. Impossible to miss."
            />
            <Row
              accent="var(--color-red)"
              tint="var(--color-red-bg)"
              when="Past its due date"
              meaning="Red, and an “Overdue” badge appears next to the status."
            />
          </Section>

          <Section
            title="Once it is settled"
            note="A finished task is a record, not something that still needs attention — so it never heats up, even long past its date."
          >
            <Row
              accent="var(--color-green-primary)"
              tint="var(--color-green-light)"
              dim
              when="Completed"
              meaning="Green, with the text settled back. Done and closed."
            />
            <Row
              accent="var(--color-violet)"
              tint="var(--color-violet-bg)"
              dim
              when="Not met"
              meaning="Violet. Worked on, but fell short — a closed outcome, not a warning."
            />
          </Section>

          <Section
            title="The tier it belongs to"
            note="The left edge when no deadline colour is in play."
          >
            <Row accent="var(--color-green-primary)" when="Yearly Task" meaning="The top of the cascade." />
            <Row accent="var(--color-gold-darker)" when="Half-Yearly Milestone" meaning="Hangs under a Yearly task." />
            <Row accent="var(--color-violet)" when="Quarterly Milestone" meaning="Hangs under a Half-Yearly one." />
            <Row accent="var(--color-slate)" when="Monthly Task" meaning="Hangs under a Quarterly one." />
            <Row accent="var(--color-amber-text)" when="Daily Task" meaning="The smallest step, under a Monthly task." />
          </Section>

          <div className="tcg-foot">
            <Icon name="sparkles" size={14} />
            <span>
              A card also glows green for a moment when you arrive from a notification, and
              its checklist locks the day after its due date.
            </span>
          </div>
        </div>
      </Modal>
    </>
  );
}
