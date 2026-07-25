# Project phases

Source of truth for what's currently in scope. Check this before adding or
re-enabling a feature; update it (mark items done, add new phases) whenever
scope changes.

Feature visibility is controlled centrally in `src/lib/featureFlags.ts`
(`FEATURE_FLAGS`). Flipping a flag from `false` to `true` re-enables a
feature — no code needs to move.

## Phase 1 — Scope down to 6 core features (done)

Removed the `graphify` knowledge-graph tooling entirely (it was config-only,
no code dependency):
- Deleted the `## graphify` section from `CLAUDE.md`.
- Removed the `graphify-out/` entry from `.gitignore`.
- Deleted `.graphifyignore`.
- Cleared the two graphify `PreToolUse` hooks from `.claude/settings.json`.

Scoped the dashboard down so every role (board / manager / member) sees only:
**Punch In/Out, Goals (no cleanup/export), Leaves, Analytics (no filters,
same simple view for team, no energy/tag charts), Team, Settings (no
Notifications section, no Editor section)**. Existing role permissions
(`src/lib/roles.ts` `canAccess()`) still govern who sees what *within* those
6 — this phase only trims the surface area.

The main Dashboard page keeps: Punch In/Out, Streak (simple fire-emoji
card), Team pulse (board), Department check-in (board), This week's goals,
Quick actions, Pending leave requests (board) — always on, not flag-gated.

Everything else stays in the codebase, gated off via `FEATURE_FLAGS`
(all `false` for now):

| Flag | Hides | Where |
|---|---|---|
| `dailyLog` | Daily Log nav/page, log history, dashboard "Recent logs"/"Open today's log"/"Log today's work", Analytics energy chart + tag frequency, Settings Editor section | `Shell.tsx`, `log/page.tsx`, `log/history/page.tsx`, `dashboard/page.tsx`, `analytics/page.tsx`, `settings/SettingsView.tsx` |
| `punchRequests` | Punch-time change-request card (missed punch / day-status request) on the Punch page | `punch/page.tsx` |
| `teamRequests` | "Requests" nav item + `/team/requests` page (leave/account change-request inbox) | `Shell.tsx`, `team/requests/page.tsx` |
| `emails` | "Emails" nav item + `/email` page | `Shell.tsx`, `email/page.tsx` |
| `apps` | "Apps" nav item + `/apps` page | `Shell.tsx`, `apps/page.tsx` |
| `analyticsFilters` | Month/Week stepper + CSV export on Personal Analytics; range control (7/14/30/all/month/custom) on Team Analytics | `analytics/page.tsx`, `analytics/team/page.tsx`, `analytics/team/TeamAnalyticsShell.tsx` |
| `goalsCleanup` | "Clean up" button + archive/export/restore modal on Goals | `goals/GoalsView.tsx` |
| `settingsNotifications` | "Notifications" card (push/sound toggles) + per-event notification prefs card on Settings | `settings/SettingsView.tsx` |
| ~~`dashboardExtras`~~ | ~~Internship progress card, flagged members card, milestone replay button~~ — re-enabled, see below | `dashboard/page.tsx` |

## Removed (not gated, deleted entirely)

**Priya (AI HR assistant) and Tips** were removed outright rather than
flag-gated — they were Phase 2 backlog items that got cut, not deferred.
Re-adding either is a from-scratch build, not a flag flip:

- Deleted `/priya`, `/api/priya/*`, `/tips`, `/tips/analytics` pages and
  `src/lib/priya/`, `src/lib/tips/`, `src/lib/openrouter.ts`.
- Removed the `priya` / `tips` nav items, the `TipsBulb` dashboard widget,
  the `priya_email_pending` / `priya_reply_received` notification types, and
  every reference across `actions.ts`, `queries.ts`, `types.ts`,
  `notif-sections.ts`, `NotificationsBell.tsx`, `NotificationsHistory.tsx`,
  `milestones.ts` (milestone emails — the in-app celebration ping stays),
  `email-shell.ts` (Priya's welcome/milestone HTML renderers), and the
  Board `/email` admin page (dropped the "HR emails (Priya)" section from
  `ManagerEmailView.tsx`).
- The shared SMTP sender moved from `src/lib/priya/mailer.ts` to
  `src/lib/mailer.ts` since transactional emails (`emails` flag) still use it.
- The two Vercel cron jobs Priya owned (`/api/priya/weekly-review`,
  `/api/priya/poll-replies`) are gone; the non-Priya maintenance sweeps that
  rode along on `poll-replies` (missed punch-outs, goal deadlines, work
  anniversaries, stale notifications) now run from a new `/api/cron/daily`
  route — see `vercel.json`.
- Database: migration `0050_remove_priya_and_tips.sql` dropped
  `priya_email_logs`, `tips`, `tip_opens`, `tip_feedback` and
  `profiles.priya_enabled`, and redefined `prune_old_data()` (the pg_cron
  job from migration 0028) to stop touching `priya_email_logs`.

## Phase 2 — Backlog (re-enable when ready)

Flip the flag in `src/lib/featureFlags.ts` for whichever of these should
come back:
- Daily Log, incl. its Analytics/Settings tie-ins (`dailyLog`)
- Punch-time change requests (`punchRequests`)
- Team Requests / change-request inbox (`teamRequests`)
- Emails (`emails`)
- Apps / Launchpad (`apps`)
- Analytics filters, personal and team (`analyticsFilters`)
- Goals cleanup/export (`goalsCleanup`)
- Settings → Notifications section (`settingsNotifications`) — explicitly
  deferred by the user to Phase 2

`dashboardExtras` (internship progress, flagged members, milestone replay)
was flipped back to `true` ahead of the rest of this list, after a report
that the internship progress bar was missing for interns.

Priya and Tips are NOT on this list — see "Removed" above. They were cut
from the codebase, not flag-gated, so bringing either back is new work.
