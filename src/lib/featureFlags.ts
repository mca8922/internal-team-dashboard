// Central switchboard for features that exist in the codebase but are
// temporarily out of scope. Flip a flag to bring a feature back — nothing
// else needs to move. See PHASE.md for what's hidden and why.

export const FEATURE_FLAGS = {
  dailyLog: false,
  punchRequests: false,
  teamRequests: false,
  emails: false,
  apps: false,
  analyticsFilters: false,
  goalsCleanup: false,
  settingsNotifications: false,
  // Full notification pipeline: goal/leave/punch/work-report bell items +
  // toasts + the /notifications history list. While off, only the two
  // undismissable device reminders (upload avatar, change password) show —
  // everything else renders as a locked "Unlocks in Phase 2" row instead.
  notificationsFull: false,
  // reStrucAI support desk — OPEN to everyone (Phase 2 unlock). Never
  // role-gated: an offboarded or read-only account keeps Support even when it
  // is the only Tools entry left. While off, the nav entry stayed VISIBLE but
  // locked and /support rendered an "Unlocks in Phase 2" state; the route must
  // not call the support API while locked — see (app)/support/page.tsx.
  // Requires SUPPORT_API_URL + SUPPORT_API_KEY server-side (no NEXT_PUBLIC_).
  support: true,
  // Internship progress, flagged members, milestone replay.
  // Team pulse, department check-in, and the streak card are always on —
  // see dashboard/page.tsx.
  dashboardExtras: true,
} as const;
