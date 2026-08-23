// Central switchboard for features that exist in the codebase but are
// temporarily out of scope. Flip a flag to bring a feature back — nothing
// else needs to move. See PHASE.md for what's hidden and why.

export const FEATURE_FLAGS = {
  // Daily Log nav/page, log history, dashboard log widgets, Analytics energy
  // chart + tag frequency, Settings Editor section. Punch in/out
  // (PunchConsole, punchIn/punchOut) has no reference to logs anywhere and
  // stays fully independent — confirmed before flipping this, per an explicit
  // requirement that logging must never gate punching.
  dailyLog: true,
  // Punch-time change-request card on the Punch page. PunchConsole (the
  // actual punch in/out button) is unconditional above and unaffected either
  // way — this only adds the request card beneath it.
  punchRequests: true,
  // Requests nav item + /team/requests — the Board's account-change-request
  // inbox, and a manager's own "Request change" button on their team cards.
  // The Founder-only "Punch requests" tab on this same page is unaffected by
  // this flag; it's gated purely on role (isFounder), see requests/page.tsx.
  teamRequests: true,
  emails: false,
  // Apps / Launchpad nav item + /apps. Works empty — the Board adds each
  // department's tools via the page itself once it's open; department_apps
  // + department_app_clicks have existed since migrations 0044-0046.
  apps: true,
  // Month/Week stepper + CSV export on Personal Analytics; range control
  // (7/14/30/all/month/custom) on Team Analytics. Team Analytics is already
  // role-gated ahead of this (board, or a manager's own ManagerTeamAnalytics
  // branch) independent of this flag.
  analyticsFilters: true,
  // "Clean up" button + archive/export/restore modal on Goals (Board only,
  // canDelete={isBoard}). Its archiveGoals/restoreGoals/deleteGoals actions
  // are further backstopped by "goals: board update/delete" RLS, so this UI
  // gate was never the only thing standing between a member and a delete.
  goalsCleanup: true,
  // Settings → Notifications card (push/sound toggles) + per-event
  // NotificationPrefsCard. Sound prefs already default to on and play today
  // (sound.ts's isSoundEnabled() falls back to true with no stored pref) —
  // this only exposes the toggle. Push is a no-op without VAPID env vars
  // (push.ts / PushManager.tsx both guard for their absence), and
  // notification rows + sendPush() already fire unconditionally regardless
  // of notificationsFull, so per-type prefs here are already load-bearing.
  settingsNotifications: true,
  // Full notification pipeline: goal/leave/punch/work-report bell items +
  // toasts + the /notifications history list + the dashboard birthday
  // wishing card. Notification rows and sendPush() already fire
  // unconditionally regardless of this flag (see settingsNotifications above)
  // — this only unlocks the bell/toast/history UI reading them back. Birthday
  // message privacy is enforced server-side in getBirthdayCelebrants
  // (migration 0056_birthday_privacy.sql), not just hidden by this flag.
  notificationsFull: true,
  // reStrucAI support desk — OPEN to everyone (Phase 2 unlock). Never
  // role-gated: an offboarded or read-only account keeps Support even when it
  // is the only Tools entry left. While off, the nav entry stayed VISIBLE but
  // locked and /support rendered an "Unlocks in Phase 2" state; the route must
  // not call the support API while locked — see (app)/support/page.tsx.
  // Requires SUPPORT_API_URL + SUPPORT_API_KEY server-side (no NEXT_PUBLIC_).
  support: true,
  // Executives creating their own tasks (the "Add my task" button + the Edit
  // control on a task they created) and adding self-added checklist steps to
  // any task on their list. Off, this restores the Board/Manager-only surface
  // exactly: no create button for members, no "Add your own step" composer.
  //
  // It does NOT hide personal steps that already exist — they keep rendering,
  // and their owner keeps ticking them, because hiding work someone committed
  // to would silently drop it off their list. It also does not roll back
  // migration 0064's RLS: the database still permits what the UI stops
  // offering, which is the same shape every other flag here has.
  executiveTasks: true,
  // Internship progress, flagged members, milestone replay.
  // Team pulse, department check-in, and the streak card are always on —
  // see dashboard/page.tsx.
  dashboardExtras: true,
} as const;
