'use client';

// Daily log editor — mood/energy/tags header + three Notion-style block-editor
// cards (Notes / Journal / Learning). Autosaves every 30s; ported from
// page-log.jsx.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { BlockEditor, BlockRender } from '@/components/BlockEditor';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { TagManagerModal } from './TagManagerModal';
import { saveLog, deleteLog } from '@/lib/actions';
import { fmtDate, fmtFriendly, parseDate, addDays, fmtRelative, fmtTime } from '@/lib/dates';
import type { Block } from '@/lib/types';

// Each mood gets a friendly label that surfaces as a hover tooltip. The
// emoji itself is what gets persisted to log.mood (DB shape unchanged).
const MOODS: { emoji: string; label: string }[] = [
  { emoji: '😞', label: 'Confused' },
  { emoji: '😐', label: 'Hard' },
  { emoji: '🙂', label: 'Good' },
  { emoji: '😊', label: 'Exciting' },
  { emoji: '🤩', label: 'Awesome' },
];

// Writing-surface textures the member can pick for the log cards. `blank`
// paints nothing; `dots` adds a dot pattern to the entire card background.
type PaperStyle = 'blank' | 'dots';
const PAPER_STYLES: { key: PaperStyle; label: string }[] = [
  { key: 'blank', label: 'Blank' },
  { key: 'dots', label: 'Dotted' },
];

interface LogState {
  mood: string;
  energyLevel: number;
  tags: string[];
  blocks: Block[];
  savedAt: string | null;
}

const uid = () => 'b_' + Math.random().toString(36).slice(2, 9);

// The three Notion-style sections every daily log is built around, so the
// whole team journals in a consistent format. The stored h3 heading text is
// kept stable (older logs are detected by JOURNAL/LEARNING_PROMPT); the card
// titles below are display-only.
const NOTES_PROMPT = 'Notes';
const JOURNAL_PROMPT = 'Journal your workday';
const LEARNING_PROMPT = 'What did you learn today that made you 1% better at work?';

// Plain text of a block, with any HTML markup stripped out.
const blockText = (b: Block) =>
  (b.content || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

// True once a block is an h3 heading carrying the given prompt text.
const isHeading = (b: Block, text: string) =>
  b.type === 'h3' && blockText(b).toLowerCase() === text.toLowerCase();

// True once a heading with the given prompt text exists anywhere in the list.
const hasPrompt = (blocks: Block[], text: string) =>
  blocks.some((b) => isHeading(b, text));

// The fresh-log template: each prompt is a heading followed by an empty line.
function journalTemplate(): Block[] {
  return [
    { id: uid(), type: 'h3', content: JOURNAL_PROMPT },
    { id: uid(), type: 'text', content: '' },
    { id: uid(), type: 'h3', content: LEARNING_PROMPT },
    { id: uid(), type: 'text', content: '' },
  ];
}

// Guarantee every log shows the section prompts:
//  - an empty log starts from the full template;
//  - an older log written before the template existed gets the prompts
//    added on top, so the structure is never missing;
//  - a log that already has the prompts is shown exactly as it was saved.
function seedLog(l: LogState): LogState {
  if (l.blocks.length === 0) {
    return { ...l, blocks: journalTemplate() };
  }
  if (!hasPrompt(l.blocks, JOURNAL_PROMPT) && !hasPrompt(l.blocks, LEARNING_PROMPT)) {
    return { ...l, blocks: [...journalTemplate(), ...l.blocks] };
  }
  return l;
}

// ---- section split / join ----
// The DB still stores one flat block array. The three cards are a view over
// it, delimited by the Journal / Learning h3 headings. On save we recombine.
interface Sections {
  notes: Block[];
  journal: Block[];
  learning: Block[];
}

type SectionKey = keyof Sections;

// Split the flat block array into the three card sections. Journal/Learning
// headings are always present after seedLog. The Notes section is everything
// before the Journal heading, minus a leading Notes heading if a previously
// saved log already carries one.
function splitSections(blocks: Block[]): Sections {
  let jIdx = blocks.findIndex((b) => isHeading(b, JOURNAL_PROMPT));
  let lIdx = blocks.findIndex((b) => isHeading(b, LEARNING_PROMPT));
  if (jIdx < 0) jIdx = 0;
  if (lIdx <= jIdx) lIdx = blocks.length;
  let notes = blocks.slice(0, jIdx);
  if (notes.length && isHeading(notes[0], NOTES_PROMPT)) notes = notes.slice(1);
  const journal = blocks.slice(jIdx + 1, lIdx);
  const learning = blocks.slice(lIdx + 1);
  return { notes, journal, learning };
}

// Rebuild the flat array for persistence: each section is preceded by its h3
// heading so the history view keeps showing the structure.
function joinSections(
  s: Sections,
  ids: { notes: string; journal: string; learning: string },
): Block[] {
  return [
    { id: ids.notes, type: 'h3', content: NOTES_PROMPT },
    ...s.notes,
    { id: ids.journal, type: 'h3', content: JOURNAL_PROMPT },
    ...s.journal,
    { id: ids.learning, type: 'h3', content: LEARNING_PROMPT },
    ...s.learning,
  ];
}

// Card metadata — order, display title, emoji and accent are all driven here.
// Display order: Journal first, then Learning, with the Notes ("Shift notes")
// card moved to the bottom. Persistence order is independent of this (see
// joinSections), so reordering here is purely a view change.
const CARDS: { key: SectionKey; title: string; emoji: string }[] = [
  { key: 'journal', title: 'Journal Your Workday', emoji: '✍️' },
  {
    key: 'learning',
    title: 'What did you learn today that made you 1% better at work?',
    emoji: '🚀',
  },
  { key: 'notes', title: 'Notes:', emoji: '📝' },
];

// Types the given text out one character at a time on mount, with a blinking
// caret, to greet the writer when they land on the page. Honours
// prefers-reduced-motion (renders the full text instantly). The heading that
// hosts it carries an aria-label, so this is purely visual.
function Typewriter({ text, speed = 60 }: { text: string; speed?: number }) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  const done = count >= text.length;
  return (
    <span className="typewriter" aria-hidden>
      {text.slice(0, count)}
      <span className={`typewriter__caret ${done ? 'is-done' : ''}`} />
    </span>
  );
}

// The learning card's question, with "1% better" wrapped in a shimmering
// span so it catches the eye.
const learningTitleNode = (
  <span aria-hidden>
    What did you learn today that made you{' '}
    <span className="text-shine">1% better</span> at work?
  </span>
);

// ---- Example guide ----
// Static example blocks used in the "How to log" reference popup.

// Covers all 12 slash-command block types across the three sections.
// Journal:  h2, bullet, divider, todo, callout
// Learning: h3, text, quote, numbered
// Notes:    h1, code, table
const EXAMPLE_JOURNAL: Block[] = [
  { id: 'eg-j0', type: 'h2', content: 'Tasks and updates' },
  { id: 'eg-j1', type: 'bullet', content: 'Finalized the onboarding flow UI; resolved 3 open feedback points from the design review' },
  { id: 'eg-j2', type: 'bullet', content: 'Paired with Priya on the API rate-limiting edge case; narrowed it to a missing backoff' },
  { id: 'eg-jd', type: 'divider', content: '' },
  { id: 'eg-j3', type: 'todo', content: 'Review and merge PR #42: auth token refresh', done: true },
  { id: 'eg-j4', type: 'todo', content: 'Follow up with design team on mobile breakpoint specs', done: false },
  { id: 'eg-j5', type: 'callout', variant: 'info', icon: '💡', content: 'Stand-up ran long today. Timebox team updates to 2 min each.' },
];

const EXAMPLE_LEARNING: Block[] = [
  { id: 'eg-l0', type: 'h3', content: 'Key insight' },
  { id: 'eg-l1', type: 'text', content: '<b>Promise.allSettled</b> is safer than <b>Promise.all</b> when you want results even if some calls fail. Used it to clean up our batch API calls.' },
  { id: 'eg-l2', type: 'quote', content: 'The best teams over-communicate progress, not just blockers.' },
  { id: 'eg-l3', type: 'h3', content: 'How to apply it' },
  { id: 'eg-l4', type: 'numbered', content: 'Find all Promise.all calls in the codebase' },
  { id: 'eg-l5', type: 'numbered', content: 'Replace with allSettled where partial failure is acceptable' },
];

const EXAMPLE_NOTES: Block[] = [
  { id: 'eg-n0', type: 'h1', content: 'Deployment notes' },
  { id: 'eg-n1', type: 'text', content: '<b>user_sessions</b> DB migration must run before the next deployment. Coordinate with DevOps.' },
  { id: 'eg-n2', type: 'code', content: 'SELECT * FROM user_sessions WHERE expires_at < NOW();' },
  {
    id: 'eg-n3',
    type: 'table',
    content: '',
    props: {
      headers: ['Task', 'Owner', 'Due Date'],
      rows: [
        ['Design handoff', 'Riya', 'Mon'],
        ['API integration', 'Karan', 'Wed'],
      ],
    },
  },
];

const GUIDE_CARDS = [
  { key: 'journal', emoji: '✍️', title: 'Journal Your Workday', blocks: EXAMPLE_JOURNAL },
  { key: 'learning', emoji: '🚀', title: 'What did you learn today that made you 1% better at work?', blocks: EXAMPLE_LEARNING },
  { key: 'notes', emoji: '📝', title: 'Notes', blocks: EXAMPLE_NOTES },
];

function LogGuideModal({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{ zIndex: 200, alignItems: 'flex-start', overflowY: 'auto', padding: '48px 16px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="How to log your work"
        style={{
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 660,
          padding: '28px 28px 22px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
          position: 'relative',
          margin: '0 auto',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 14, right: 14,
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            cursor: 'pointer',
            color: 'var(--color-grey-text)',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        {/* Header */}
        <div style={{ marginBottom: 22, paddingRight: 32 }}>
          <div style={{
            display: 'inline-block',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--color-green-primary)',
            background: 'var(--color-green-light)',
            padding: '2px 8px', borderRadius: 4, marginBottom: 10,
          }}>
            Reference
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: 'var(--color-black)' }}>
            How to log your work
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-grey-text)', lineHeight: 1.65 }}>
            Use this as a starting point. Each section has a purpose; fill them in your own words.
            Type{' '}
            <kbd style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              padding: '1px 6px', borderRadius: 4,
              fontFamily: 'monospace', fontSize: 11,
              color: 'var(--color-black)',
            }}>/</kbd>
            {' '}inside any card to pick a block type (bullet, todo, callout, table…).
          </p>
        </div>

        {/* Section cards — same .log-card system as the real editor (accent
            colour, header tint, icon ring per section) so this reference
            actually looks like what you'll get, not a flattened mock of it. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {GUIDE_CARDS.map((c) => (
            <section key={c.key} className={`log-card log-card--${c.key}`} style={{ overflow: 'hidden' }}>
              <header className="log-card__header">
                <span className="log-card__icon" aria-hidden>{c.emoji}</span>
                <span className="log-card__title">{c.title}</span>
              </header>
              <div className="log-card__body">
                <BlockRender blocks={c.blocks} />
              </div>
            </section>
          ))}
        </div>

        <p style={{
          marginTop: 18, marginBottom: 0,
          fontSize: 11, color: 'var(--color-grey-text)',
          textAlign: 'center', lineHeight: 1.5,
        }}>
          Example only. This will not be added to your log.
        </p>
      </div>
    </div>
  );
}

export function LogEditor({
  date,
  initialLog,
  isLeave,
  isHoliday,
  isWeekendDay,
  pastTags = [],
  tagStats = [],
}: {
  date: string;
  initialLog: LogState;
  isLeave: boolean;
  isHoliday: boolean;
  isWeekendDay: boolean;
  // Distinct tags the member has used before, most-used first — drives the
  // tag autocomplete so they reuse a consistent vocabulary.
  pastTags?: string[];
  // Same tags with how many logs carry each — feeds the tag manager's usage
  // pie chart. Superset of pastTags; kept separate since most callers only
  // need the plain names.
  tagStats?: { tag: string; count: number }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [log, setLog] = React.useState<LogState>(() => seedLog(initialLog));
  const [sections, setSections] = React.useState<Sections>(() =>
    splitSections(seedLog(initialLog).blocks),
  );
  // Member's "default block type on new log" preference (Settings → Editor).
  // Read from localStorage on mount; applied to new blocks the member adds.
  const [defaultBlock, setDefaultBlock] = React.useState<'text' | 'h2' | 'todo' | 'bullet'>('text');
  // Writing-surface texture (blank / dots / lines / grid). Purely visual, a
  // per-member preference shared across every day's log — stored alongside
  // defaultBlock in the same prefs blob.
  const [paper, setPaper] = React.useState<PaperStyle>('blank');
  React.useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem('restruc:prefs') || '{}');
      const v = prefs?.defaultBlock;
      if (v === 'text' || v === 'h2' || v === 'todo' || v === 'bullet') setDefaultBlock(v);
      if (PAPER_STYLES.some((p) => p.key === prefs?.paper)) setPaper(prefs.paper);
    } catch {
      /* corrupt/absent prefs — keep the defaults */
    }
  }, []);

  // Persist the paper choice back into the shared prefs blob so it sticks
  // across days and reloads.
  const changePaper = (v: PaperStyle) => {
    setPaper(v);
    try {
      const prefs = JSON.parse(localStorage.getItem('restruc:prefs') || '{}');
      localStorage.setItem('restruc:prefs', JSON.stringify({ ...prefs, paper: v }));
    } catch {
      /* ignore — the in-memory choice still applies for this session */
    }
  };

  const [tagInput, setTagInput] = React.useState('');
  // Tag autocomplete: whether the input is focused (controls dropdown
  // visibility) and which suggestion is keyboard-highlighted.
  const [tagFocused, setTagFocused] = React.useState(false);
  // -1 means "nothing highlighted" — Enter then adds the typed text rather than
  // a suggestion. Arrowing down moves into the list.
  const [tagHi, setTagHi] = React.useState(-1);
  const [saved, setSaved] = React.useState(true);
  const [showGuide, setShowGuide] = React.useState(false);
  const [showTagManager, setShowTagManager] = React.useState(false);
  // Bumped on delete so the BlockEditors re-seed from the reset sections
  // (they only re-read their blocks when resetKey changes).
  const [resetNonce, setResetNonce] = React.useState(0);
  const logRef = React.useRef(log);
  logRef.current = log;
  const sectionsRef = React.useRef(sections);
  sectionsRef.current = sections;
  // Stable ids for the three section headings so the persisted array doesn't
  // churn block ids on every save.
  const headingIds = React.useRef({ notes: uid(), journal: uid(), learning: uid() });

  // Defensive re-sync: if this component instance is reused for a different
  // day (the page also re-keys on date, so normally this is a fresh mount),
  // reseed the editor from that day's log instead of keeping stale state.
  React.useEffect(() => {
    const fresh = seedLog(initialLog);
    setLog(fresh);
    setSections(splitSections(fresh.blocks));
    setSaved(true);
    setTagInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const today = fmtDate(new Date());
  const isToday = date === today;
  const isPast = date < today;

  const set = (patch: Partial<LogState>) => {
    setLog((l) => ({ ...l, ...patch }));
    setSaved(false);
  };

  // One card's BlockEditor reported new content. BlockEditor echoes its seeded
  // blocks via its mount/reset effect — that call passes back the very same
  // array reference we handed it, so a reference check skips those no-op
  // echoes and keeps the page from flipping to "unsaved" on load/date-change.
  const updateSection = React.useCallback((key: SectionKey, blocks: Block[]) => {
    if (sectionsRef.current[key] === blocks) return;
    setSections((s) => ({ ...s, [key]: blocks }));
    setSaved(false);
  }, []);

  const persist = React.useCallback(async () => {
    const l = logRef.current;
    await saveLog({
      date,
      mood: l.mood,
      energyLevel: l.energyLevel,
      tags: l.tags,
      blocks: joinSections(sectionsRef.current, headingIds.current),
    });
    setSaved(true);
  }, [date]);

  // Autosave every 30s while there are unsaved changes.
  React.useEffect(() => {
    if (saved) return;
    const id = setInterval(persist, 30000);
    return () => clearInterval(id);
  }, [saved, persist]);

  // Flush unsaved changes when this editor instance goes away — e.g. Prev/Next
  // day (the page keys on `date`, so switching days unmounts it) or navigating
  // to another route entirely. Without this, whatever was typed since the last
  // 30s autosave tick was silently discarded. Reads through refs (kept current
  // on every render) so the cleanup sees the latest content, not stale closure
  // state from mount.
  const savedRef = React.useRef(saved);
  savedRef.current = saved;
  const persistRef = React.useRef(persist);
  persistRef.current = persist;
  React.useEffect(() => {
    return () => {
      if (!savedRef.current) persistRef.current();
    };
  }, []);

  // Warn on a hard close/reload — the one exit the unmount flush above can't
  // reach, since the page (and this effect's cleanup) never gets to run.
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saved) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saved]);

  const save = async () => {
    await persist();
    toast('Log saved');
  };

  // True once this date has a persisted log with content — delete is only
  // meaningful then. `savedAt` is set whenever the row exists in the DB.
  const logExists = initialLog.savedAt != null;

  // Whether any of the three sections carry real text.
  const isEmpty = (['notes', 'journal', 'learning'] as SectionKey[]).every((k) =>
    sections[k].every((b) => !blockText(b)),
  );

  // Ctrl/Cmd+S force-saves immediately — the instinct anyone with a visible
  // "Save" button reaches for, rather than waiting on the 30s autosave tick.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (saved && isEmpty) return; // nothing to save — matches the Save button's own disabled state
      persist().then(() => toast('Log saved'));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [persist, saved, isEmpty, toast]);

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this log?',
      message: `The log for ${fmtFriendly(parseDate(date))} will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete log',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    await deleteLog(date);
    toast('Log deleted');
    // Reset the editor to a fresh template for this date.
    setLog({ mood: '', energyLevel: 0, tags: [], blocks: [], savedAt: null });
    setSections(splitSections(journalTemplate()));
    setResetNonce((n) => n + 1);
    setSaved(true);
    router.refresh();
  };

  const addTag = (t: string) => {
    t = t.trim();
    if (!t || log.tags.includes(t)) return;
    set({ tags: [...log.tags, t] });
    setTagInput('');
    setTagHi(-1);
  };

  // Past tags not already on this log, narrowed by what's being typed, most-used
  // first. Shown as an autocomplete dropdown while the tag input is focused.
  const tagQuery = tagInput.trim().toLowerCase();
  const tagSuggestions = pastTags
    .filter((t) => !log.tags.includes(t))
    .filter((t) => !tagQuery || t.toLowerCase().includes(tagQuery))
    .slice(0, 8);
  const showTagSuggestions = tagFocused && tagSuggestions.length > 0;

  const goRel = (n: number) => router.push('/log?date=' + fmtDate(addDays(parseDate(date), n)));

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="flex items-center gap-2 mb-3">
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => goRel(-1)}>
            Prev day
          </Button>
          <Button size="sm" variant="ghost" onClick={() => router.push('/log?date=' + today)}>
            Today
          </Button>
          <Button size="sm" variant="ghost" onClick={() => goRel(1)}>
            Next day →
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" icon="help-circle" onClick={() => setShowGuide(true)}>
            How to log
          </Button>
          <Link href="/log/history" className="btn btn-secondary btn-sm">
            <Icon name="calendar" size={14} />
            History
          </Link>
          {logExists ? (
            <Button size="sm" variant="ghost" icon="trash" onClick={remove}>
              Delete
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={saved && isEmpty}>
            {saved ? '✓ Saved' : 'Save'}
          </Button>
        </div>

        <div className="editor-title-row">
          <div className="editor-date">{fmtFriendly(parseDate(date))}</div>
          {!isToday && isPast ? <span className="badge badge-amber">Backlog</span> : null}
          {isLeave ? <span className="badge badge-slate">On leave</span> : null}
          {isHoliday ? <span className="badge badge-slate">Holiday</span> : null}
          {isWeekendDay ? <span className="badge badge-slate">Weekend</span> : null}
        </div>
      </div>

      <div className="editor-layout">
        <div className="editor-main">
          <div className="log-cards" data-tour="log-editor" data-paper={paper}>
            {CARDS.map((c) => {
              const blocks = sections[c.key];
              const filled = blocks.some((b) => blockText(b));
              return (
                <section
                  key={c.key}
                  className={`log-card log-card--${c.key} ${filled ? 'is-filled' : ''}`}
                >
                  <header className="log-card__header">
                    <span className="log-card__icon" aria-hidden>
                      {c.emoji}
                    </span>
                    <h2 className="log-card__title" aria-label={c.title}>
                      {c.key === 'journal' ? (
                        <Typewriter text={c.title} />
                      ) : c.key === 'learning' ? (
                        learningTitleNode
                      ) : (
                        c.title
                      )}
                    </h2>
                    <span className="log-card__check" title="This section has content" aria-hidden>
                      <Icon name="check" size={13} />
                    </span>
                  </header>
                  <div className="log-card__body">
                    <BlockEditor
                      resetKey={`${date}:${resetNonce}`}
                      initialBlocks={blocks}
                      onChange={(b) => updateSection(c.key, b)}
                      defaultBlockType={defaultBlock}
                    />
                  </div>
                </section>
              );
            })}
          </div>

          <Link href="/goals" className="log-footer">
            <span className="log-footer__icon" aria-hidden>
              <Icon name="target" size={16} />
            </span>
            <span>
              Revisit the <span className="log-footer__link">Goals</span> assigned to you,
              mark your progress, and plan your next day.
            </span>
            <Icon name="arrow-right" size={14} style={{ marginLeft: 'auto', flexShrink: 0 }} />
          </Link>

          <div className="mt-8 text-xs text-grey text-center">
            Type{' '}
            <kbd
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                padding: '1px 6px',
                borderRadius: 3,
                fontFamily: 'monospace',
              }}
            >
              /
            </kbd>{' '}
            for blocks · Drag <Icon name="grip" size={12} /> to reorder · Enter to add a new block ·{' '}
            <kbd
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                padding: '1px 6px',
                borderRadius: 3,
                fontFamily: 'monospace',
              }}
            >
              Ctrl/Cmd+S
            </kbd>{' '}
            to save
          </div>
        </div>

        {/* Right rail — Mood, Energy and Tags stacked one after another. Stays
            pinned while the writer scrolls through the cards on the left. */}
        <aside className="editor-meta" data-tour="log-meta">
          <div className="editor-meta__field">
            <div className="text-xs text-grey fw-medium mb-1">Mood</div>
            <div className="mood-picker">
              {MOODS.map((m) => (
                <button
                  key={m.emoji}
                  className={`mood-btn ${log.mood === m.emoji ? 'selected' : ''}`}
                  data-label={m.label}
                  title={m.label}
                  aria-label={m.label}
                  onClick={() => set({ mood: m.emoji })}
                >
                  {m.emoji}
                </button>
              ))}
            </div>
            <div className="text-xs text-grey mt-1">How are you feeling?</div>
          </div>
          <div className="editor-meta__field">
            <div className="text-xs text-grey fw-medium mb-1">Energy</div>
            <div className="energy-picker">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className={`energy-star ${log.energyLevel >= n ? 'active' : ''}`}
                  data-label={String(n)}
                  title={`${n} / 5`}
                  role="button"
                  aria-label={`Energy ${n} of 5`}
                  onClick={() => set({ energyLevel: n })}
                >
                  ★
                </span>
              ))}
            </div>
            <div className="text-xs text-grey mt-1">How energized are you?</div>
          </div>
          <div className="editor-meta__field">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-grey fw-medium">Tags</div>
              {tagStats.length > 0 ? (
                <button type="button" className="tag-manage-btn" onClick={() => setShowTagManager(true)}>
                  <Icon name="chart" size={11} />
                  Manage
                </button>
              ) : null}
            </div>
            <div className="tag-autocomplete">
              <div className="tag-input-wrap">
                {log.tags.map((t) => (
                  <span key={t} className="tag-chip">
                    {t}
                    <button onClick={() => set({ tags: log.tags.filter((x) => x !== t) })}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    setTagHi(-1);
                  }}
                  onFocus={() => setTagFocused(true)}
                  // Delay so a click on a suggestion (onMouseDown) lands first.
                  onBlur={() => setTimeout(() => setTagFocused(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && showTagSuggestions) {
                      e.preventDefault();
                      setTagFocused(true);
                      setTagHi((i) => Math.min(i + 1, tagSuggestions.length - 1));
                    } else if (e.key === 'ArrowUp' && showTagSuggestions) {
                      e.preventDefault();
                      setTagHi((i) => Math.max(i - 1, -1));
                    } else if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      // Enter on a highlighted suggestion picks it; otherwise
                      // (and always for comma) the typed text is added.
                      if (e.key === 'Enter' && tagHi >= 0 && tagSuggestions[tagHi]) {
                        addTag(tagSuggestions[tagHi]);
                      } else {
                        addTag(tagInput);
                      }
                    } else if (e.key === 'Escape' && showTagSuggestions) {
                      e.preventDefault();
                      setTagFocused(false);
                    } else if (e.key === 'Backspace' && !tagInput && log.tags.length) {
                      set({ tags: log.tags.slice(0, -1) });
                    }
                  }}
                  placeholder="e.g. client-acme, bug-fix…"
                />
              </div>
              {showTagSuggestions ? (
                <ul className="tag-suggestions" role="listbox">
                  {tagSuggestions.map((t, i) => (
                    <li key={t} role="option" aria-selected={i === tagHi}>
                      <button
                        type="button"
                        className={`tag-suggestion${i === tagHi ? ' is-active' : ''}`}
                        // onMouseDown (not onClick) so it fires before the
                        // input's blur closes the dropdown.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addTag(t);
                        }}
                        onMouseEnter={() => setTagHi(i)}
                      >
                        <span className="tag-suggestion__hash" aria-hidden>#</span>
                        {t}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="text-xs text-grey mt-1" style={{ lineHeight: 1.5 }}>
              Short labels for what this day was about: a client, project, or
              kind of work. Press Enter or comma after each tag.
              {pastTags.length > 0 ? ' Past tags suggest as you type.' : ''}
            </div>
          </div>
          <div className="editor-meta__field">
            <div className="text-xs text-grey fw-medium mb-2">Choose Theme</div>
            <div className="paper-picker" role="group" aria-label="Writing paper theme">
              {PAPER_STYLES.map((p) => (
                <div key={p.key} className="paper-picker__item">
                  <button
                    type="button"
                    className={`paper-swatch paper-swatch--${p.key} ${paper === p.key ? 'is-active' : ''}`}
                    title={p.label}
                    aria-label={p.label}
                    aria-pressed={paper === p.key}
                    onClick={() => changePaper(p.key)}
                  />
                  <div className="paper-picker__label text-xs text-grey fw-medium">
                    {p.label}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-grey mt-2">Customize your writing surface.</div>
          </div>
          <div className="editor-meta__status text-xs text-grey">
            {saved
              ? `Last saved ${
                  log.savedAt
                    ? fmtRelative(new Date(log.savedAt)) + ' at ' + fmtTime(new Date(log.savedAt))
                    : 'just now'
                }`
              : 'Unsaved changes · autosaves every 30s'}
          </div>
        </aside>
      </div>

      {showGuide ? <LogGuideModal onClose={() => setShowGuide(false)} /> : null}
      {showTagManager ? (
        <TagManagerModal
          tagStats={tagStats}
          onClose={() => setShowTagManager(false)}
          // Both actions already persist to the DB directly — this just keeps
          // today's Tags chips in sync without re-flagging the log unsaved.
          onTagRenamed={(oldTag, newTag) =>
            setLog((l) =>
              l.tags.includes(oldTag)
                ? { ...l, tags: l.tags.map((t) => (t === oldTag ? newTag : t)) }
                : l,
            )
          }
          onTagDeleted={(tag) =>
            setLog((l) =>
              l.tags.includes(tag) ? { ...l, tags: l.tags.filter((t) => t !== tag) } : l,
            )
          }
        />
      ) : null}
    </div>
  );
}
