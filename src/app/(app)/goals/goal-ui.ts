// Shared display helpers + constants for the Goals views (cascade card, table,
// command palette, breadcrumb). Pulled out of GoalsView so the Table view and
// friends reuse the exact same status labels, tier metadata and due-date logic
// instead of duplicating (or risking an import cycle with GoalsView).
import { fmtShort, parseDate, daysBetween } from '@/lib/dates';
import { deriveGoalStatus } from '@/lib/goal-progress';
import type { Goal, GoalLevel, GoalStatus } from '@/lib/types';

export const STATUS: Record<GoalStatus, { label: string; cls: string }> = {
  inactive: { label: 'Not-Active', cls: 'badge-slate' },
  active: { label: 'Active', cls: 'badge-amber' },
  achieved: { label: 'Completed', cls: 'badge' },
  // Worked on but fell short of the target — a settled negative outcome, styled
  // distinct from the automatic red "Overdue" badge (muted violet).
  not_met: { label: 'Not met', cls: 'badge-violet' },
};

// Per-level display + which level its children are.
export const LEVEL_META: Record<
  GoalLevel,
  {
    label: string;
    tone: 'hero' | 'half' | 'quarter' | 'monthly' | 'daily';
    child: GoalLevel | null;
  }
> = {
  yearly: { label: 'Yearly Task', tone: 'hero', child: 'half_yearly' },
  half_yearly: { label: 'Half-Yearly Milestone', tone: 'half', child: 'quarterly' },
  quarterly: { label: 'Quarterly Milestone', tone: 'quarter', child: 'monthly' },
  monthly: { label: 'Monthly Task', tone: 'monthly', child: 'daily' },
  daily: { label: 'Daily Task', tone: 'daily', child: null },
};

// Tier order used to sort filtered results top-down (Yearly → Daily).
export const LEVEL_ORDER: GoalLevel[] = [
  'yearly',
  'half_yearly',
  'quarterly',
  'monthly',
  'daily',
];

// Lowercase tier word for inline copy, e.g. the collapse toggle's "4 quarterly".
export const LEVEL_WORD: Record<GoalLevel, string> = {
  yearly: 'yearly',
  half_yearly: 'half-yearly',
  quarterly: 'quarterly',
  monthly: 'monthly',
  daily: 'daily',
};

// The tier a task of `level` hangs under, or null for the top tier — the exact
// inverse of LEVEL_META[...].child. Drives the parent picker and the migration's
// notion of a legal parent link.
export const PARENT_LEVEL: Record<GoalLevel, GoalLevel | null> = {
  yearly: null,
  half_yearly: 'yearly',
  quarterly: 'half_yearly',
  monthly: 'quarterly',
  daily: 'monthly',
};

// Days from today to the goal's due date (negative = past). null if no due date.
export const daysToDue = (g: Goal): number | null =>
  g.due_date ? daysBetween(new Date(), parseDate(g.due_date)) : null;

// The status derivation and the past-due test live in @/lib/goal-progress
// beside the completion tally they read — one rule, one place, and unit-testable
// without this module. Re-exported here so every Goals view keeps importing its
// display helpers from goal-ui.
export { deriveGoalStatus, isGoalPastDue as isPastDue } from '@/lib/goal-progress';

// Overdue = past due and not yet settled. A goal that reads "Completed" OR
// "Not met" is a closed outcome, so it never nags as overdue.
export const isOverdue = (g: Goal, status: GoalStatus = deriveGoalStatus(g)): boolean => {
  const d = daysToDue(g);
  return d !== null && d < 0 && status !== 'achieved' && status !== 'not_met';
};

// Due within the next `days` days (today counts as 0). Settled goals
// (Completed / Not met) are excluded — they need no more attention.
export const dueWithin = (
  g: Goal,
  days: number,
  status: GoalStatus = deriveGoalStatus(g),
): boolean => {
  const d = daysToDue(g);
  return d !== null && d >= 0 && d <= days && status !== 'achieved' && status !== 'not_met';
};

// Graduated deadline-proximity state for card styling. Settled goals
// (Completed / Not met) never escalate — same rule isOverdue/dueWithin use.
// today gets its own spotlight (brighter than the 1-3 day "urgent" band)
// rather than blending into it.
export type DueUrgency = 'normal' | 'approaching' | 'urgent' | 'today' | 'overdue';

export const dueUrgency = (g: Goal, status: GoalStatus = deriveGoalStatus(g)): DueUrgency => {
  if (status === 'achieved' || status === 'not_met') return 'normal';
  const d = daysToDue(g);
  if (d === null) return 'normal';
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 3) return 'urgent';
  if (d <= 7) return 'approaching';
  return 'normal';
};

export function dueLine(g: Goal): string {
  if (!g.due_date) return 'No due date';
  const part = fmtShort(parseDate(g.due_date));
  const d = daysBetween(new Date(), parseDate(g.due_date));
  if (d < 0) return `Due ${part} · overdue`;
  if (d === 0) return `Due ${part} · today`;
  return `Due ${part} · ${d}d left`;
}

// Strip HTML so rich-text descriptions are searchable as plain words.
export const plainText = (html: string | null | undefined) =>
  (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Every department a goal spans. Prefers the multi-department `departments`
// array; falls back to the single primary `department` for any legacy/empty row.
export const goalDepts = (g: Goal): string[] =>
  g.departments && g.departments.length ? g.departments : g.department ? [g.department] : [];

// Does the goal belong to department `d`? (multi-department aware)
export const goalInDept = (g: Goal, d: string): boolean => goalDepts(g).includes(d);
