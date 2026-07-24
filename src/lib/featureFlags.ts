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
  // Internship progress, flagged members, milestone replay.
  // Team pulse, department check-in, and the streak card are always on —
  // see dashboard/page.tsx.
  dashboardExtras: false,
} as const;
