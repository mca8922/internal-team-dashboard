// Shared streak logic — pure, no data fetching, no server-only imports.
//
// logHasContent / logStreak used to live in queries.ts, which pulls in the
// server Supabase client, so they could neither be unit-tested nor be used by
// a client component. They live here now and queries.ts re-exports them, so
// every existing `import { logStreak } from '@/lib/queries'` keeps working.
//
// tierFor() is read by the Team Analytics heatmap (a compact per-row flame +
// number), so it and the cards agree on colors/labels for the same length.
import { fmtDate, startOfDay, addDays, daysBetween, isWorkingDay, GO_LIVE_DATE } from './dates';
import type { Block, WorkLog } from './types';

// True once a log carries actual typed text, not just the day's seeded
// section headings. LogEditor autosaves every 30s (and on unmount) with no
// emptiness check, so `blocks` is never actually empty — a day the member
// opened but never wrote in still gets the three h3 prompts + blank text
// blocks persisted. Mirrors LogEditor's own `isEmpty` check (h3 headings
// are structural, not content) so "logged" means the same thing everywhere
// this gets checked — streaks, calendars, dashboards, team views.
export function logHasContent(blocks: Block[] | null | undefined): boolean {
  if (!blocks || !blocks.length) return false;
  return blocks.some((b) => {
    if (b.type === 'h3') return false;
    return (b.content || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
  });
}

type LogRow = Pick<WorkLog, 'log_date' | 'blocks'>;

// Consecutive working days (Mon–Fri, on/after go-live) with a non-empty log,
// counted back from the most recent working day. Today only breaks the
// streak if it is itself a past working day with no log — an as-yet-unlogged
// "today" doesn't reset a streak built on prior days.
//
// `asOf` is the day the count walks back from (default: today). streakHealth
// re-runs it as of a member's last written day to measure a run that broke.
export function logStreak(logs: LogRow[], asOf: Date | string = new Date()): number {
  const logged = new Set(
    logs.filter((l) => logHasContent(l.blocks)).map((l) => l.log_date),
  );
  let streak = 0;
  let d = startOfDay(asOf);
  const todayStr = fmtDate(asOf);
  for (let i = 0; i < 400; i++) {
    if (!isWorkingDay(d)) {
      d = addDays(d, -1);
      if (fmtDate(d) < GO_LIVE_DATE) break;
      continue;
    }
    const ds = fmtDate(d);
    if (logged.has(ds)) {
      streak += 1;
    } else if (ds !== todayStr) {
      break; // a past working day with no log ends the streak
    }
    d = addDays(d, -1);
    if (fmtDate(d) < GO_LIVE_DATE) break;
  }
  return streak;
}

// ---- streak health -------------------------------------------------------
//
// How a streak is DOING, as opposed to how long it is. Ported from the
// reStrucAI Internal Team Dashboard, but on MCA's own streak rule above
// (weekends pause; every other unlogged past working day breaks it).
//
// 'safe'     a live streak with nothing owed today (written, or a weekend).
// 'at_risk'  a live streak that ends at IST midnight tonight unless they
//            write something: today is a working day with no log yet.
// 'ended'    no live streak, but a run of at least STREAK_LOSS_MIN days
//            broke within the last STREAK_LOSS_GRACE_DAYS.
// 'none'     no live streak and nothing recent worth naming.
//
// The Dashboard shows the card only while the streak is live (safe /
// at_risk); 'ended' is surfaced on the Daily Log page only.
export type StreakState = 'safe' | 'at_risk' | 'ended' | 'none';

export interface StreakHealth {
  // The live streak, exactly as logStreak() reports it. While 'at_risk' this
  // counts up to the last working day — today hasn't been earned yet.
  streak: number;
  state: StreakState;
  // Only set when 'ended': the length of the run that broke, and the last
  // day they wrote (the day they remember).
  lost: number;
  lostOn: string | null;
}

export const STREAK_LOSS_GRACE_DAYS = 7;
export const STREAK_LOSS_MIN = 3;

export function streakHealth(logs: LogRow[], asOf: Date | string = new Date()): StreakHealth {
  const streak = logStreak(logs, asOf);
  const todayStr = fmtDate(asOf);

  if (streak > 0) {
    const writtenToday = logs.some((l) => l.log_date === todayStr && logHasContent(l.blocks));
    return {
      streak,
      state: !isWorkingDay(asOf) || writtenToday ? 'safe' : 'at_risk',
      lost: 0,
      lostOn: null,
    };
  }

  // No live streak. Did one end recently enough to still be worth naming?
  // Re-running logStreak as of the last written day measures the run that
  // was standing when it stopped.
  let last: string | null = null;
  for (const l of logs) {
    if (l.log_date > todayStr || !logHasContent(l.blocks)) continue;
    if (!last || l.log_date > last) last = l.log_date;
  }
  if (last && daysBetween(last, asOf) <= STREAK_LOSS_GRACE_DAYS) {
    const lost = logStreak(logs, last);
    if (lost >= STREAK_LOSS_MIN) return { streak: 0, state: 'ended', lost, lostOn: last };
  }
  return { streak: 0, state: 'none', lost: 0, lostOn: null };
}

export interface StreakTier {
  label: string | null;
  color: string;
  glow: string;
}

// Streak length -> a color/label tier. streak <= 0 still gets a (neutral,
// unlit) tier so callers can render off one code path instead of branching
// for the empty state.
export function tierFor(streak: number): StreakTier {
  if (streak <= 0) {
    return { label: null, color: 'var(--color-grey-text)', glow: 'rgba(132,134,135,0.28)' };
  }
  if (streak < 7) {
    return { label: 'Just started', color: 'var(--color-green-primary)', glow: 'rgba(40,138,93,0.4)' };
  }
  if (streak < 30) {
    return { label: 'On a roll', color: 'var(--color-amber-text)', glow: 'rgba(217,119,6,0.4)' };
  }
  if (streak < 100) {
    return { label: 'Blazing', color: '#EA580C', glow: 'rgba(234,88,12,0.42)' };
  }
  return { label: 'Legendary', color: 'var(--color-violet)', glow: 'rgba(109,74,174,0.42)' };
}
