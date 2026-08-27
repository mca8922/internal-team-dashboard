// Labels and validation shared by this module's client and server halves.
// No imports at all — deliberately, so it can be pulled into a Client Component
// without dragging anything server-side along with it.
//
// Kept in sync by hand with src/lib/support-shared.ts in the reStrucAI repo.
// The overlap is small and stable (five categories, five statuses); a shared
// package would cost more to maintain across forks than it saves.

export type SupportCategory = 'bug' | 'blocked' | 'question' | 'access' | 'suggestion' | 'other';

export type SupportStatus = 'open' | 'in_progress' | 'waiting_client' | 'resolved' | 'closed';

// The response promise shown on the form. Change it here and it changes
// everywhere the fork mentions it.
export const SLA_HOURS = 24;

export const CATEGORY_LABEL: Record<SupportCategory, string> = {
  bug: 'Something looks wrong',
  blocked: "Can't do something",
  question: 'Question',
  access: 'Access & login',
  suggestion: 'Suggestion',
  other: 'Something else',
};

// One line of "what this actually covers" under each card. People pick the
// right category when they recognise their own situation in it, not when they
// parse the label.
export const CATEGORY_HINT: Record<SupportCategory, string> = {
  bug: 'A number, date or name is wrong',
  blocked: 'A button or page will not work',
  question: 'Not sure how something works',
  access: 'Cannot sign in or reach a page',
  suggestion: 'An idea to make this better',
  other: 'Anything that does not fit above',
};

export const CATEGORY_ORDER: SupportCategory[] = [
  'bug',
  'blocked',
  'question',
  'access',
  'suggestion',
  'other',
];

// "Waiting on you" is correct from the reporter's side — this module only ever
// renders for them.
export const STATUS_LABEL: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_client: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const STATUS_TONE: Record<SupportStatus, string> = {
  open: 'badge-amber',
  in_progress: 'badge-violet',
  waiting_client: 'badge-slate',
  resolved: '',
  closed: 'badge-slate',
};

export const SUBJECT_MAX = 160;
export const BODY_MAX = 4000;

// A pre-filled starting point for the report form, handed in by whatever sent
// the person here — today, an AI assistant that could not answer their
// question. Every field is optional and every one only ever seeds the form's
// INITIAL state: the person still edits and sends it themselves. Nothing in
// this module submits a draft on anyone's behalf.
export interface TicketDraft {
  category?: SupportCategory;
  subject?: string;
  body?: string;
}

export function validateTicketInput(input: { subject: string; body: string }): string | null {
  if (input.subject.trim().length < 3) return 'Please add a short subject.';
  if (input.subject.length > SUBJECT_MAX) return `Subject must be under ${SUBJECT_MAX} characters.`;
  if (input.body.trim().length < 10) return 'Please describe what happened in a little more detail.';
  if (input.body.length > BODY_MAX) return `Description must be under ${BODY_MAX} characters.`;
  return null;
}

// Short "3 hours ago" for the ticket list. Local to this module so it does not
// depend on whatever date helpers a given fork happens to have.
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
