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
| `notificationsFull` | Bell + `/notifications` history for goal/leave/punch/work-report events, incl. their toasts/chimes and teammate punch-in/out toasts, PLUS the dashboard birthday banner (wishes + private replies). Only the three undismissable device reminders (upload avatar, change password, add date of birth) stay on; everything else shows a locked "Unlocks in Phase 2" row/state instead | `NotificationsBell.tsx`, `notifications/NotificationsHistory.tsx`, `dashboard/page.tsx`, `dashboard/BirthdayBanner.tsx` |
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

## Task tiers — cascade restructure (done)

The Tasks cascade was **Yearly → Monthly → Weekly → Daily**. It is now
**Yearly → Half-Yearly → Quarterly → Monthly → Daily**: the Weekly tier is
gone, and two tiers were inserted between Yearly and Monthly.

- `goal_level` is a Postgres enum, which cannot drop a value, so migration
  `0057_task_tiers.sql` rebuilds the type. It deletes every Weekly task (there
  was no production task data), cuts any parent link that is no longer
  tier-legal so the task lands in "Unlinked Tasks" instead of a broken branch,
  and remaps `goal_templates.level = 'weekly'` to `'monthly'`.
- The tier ladder is defined once in `src/app/(app)/goals/goal-ui.ts`
  (`LEVEL_META`, `LEVEL_ORDER`, `PARENT_LEVEL`, `LEVEL_WORD`). Changing the
  cascade again means editing those plus the `GoalLevel` union in
  `src/lib/types.ts` — everything else derives from them.
- `src/lib/fiscal.ts` holds the FY Apr–Mar period math (H1 Apr–Sep, H2 Oct–Mar;
  Q1 Apr–Jun … Q4 Jan–Mar). A new task's due date defaults to its period end and
  the form shows the period beside the date field. Covered by `fiscal.test.ts`.
- Dashboard: "This week's tasks" used to filter on the Weekly *tier*. With that
  tier gone it now selects open tasks whose **due date** falls in the current
  Mon–Sun week, across every tier — which is what the "Week N" label beside it
  already implied. The rest of the dashboard has not been revisited for the new
  tiers yet.
- The checklist-item `weekly` *recurrence* is unrelated to the tier and stays.
  Monthly, now the lowest tier that groups work, inherits the fine-grained
  cadences (weekdays / daily / custom) that Weekly used to allow.

## Department-scoped hierarchy (done)

The org used to be flat above the department line: every `role = 'board'`
account (a "Director") saw and managed the whole company, and `department` was
only a grouping label. The chain is now four levels deep and the **department
is the security boundary** — migration `0058_department_scope.sql`:

```
Founder (no department, sees everything, assigns everything)
  └── Department
        └── Director   — role='board', profiles.department = the one they run
              └── Manager   — is_manager + managed_department
                    └── Staff (fte / pte / intern)
```

- A Director sees only their own department's people; several Directors may
  share a department, none spans two. A department with no Director is covered
  by the Founders alone. The Founders sit under **no** department —
  `profiles.department` is `''` for them and every scope check treats blank as
  "matches nothing", so unassigned accounts are never exposed to each other.
- SQL predicates `can_view_user()` / `can_manage_user()` replace the flat
  `is_board()` in the read/write policies for `profiles`, `punches`, `logs`,
  `leaves` and `change_requests`. Their TypeScript mirrors are
  `canViewMember()` / `canManageMember()` in `src/lib/roles.ts`, covered by
  `roles.test.ts` — the two must stay in agreement.
- **Structural changes are Founder-only**: `updateMemberRole`,
  `updateMemberDepartment`, `setMemberAsManager`, `unsetManager`,
  `setManagerTeam`, `renameDepartment`, `deleteDepartment`, and creating a
  Director. A Director runs the department they were given but cannot widen
  their own scope, appoint a peer, or pull an outsider in. Day-to-day member
  fields (target hours, job title, DOB, onboard date, offboard/reinstate) stay
  with the Director, scoped by `requireMemberScope()` in `actions.ts`.
- A DB trigger (`assert_hierarchy_consistent`) rejects any `manager_id` that
  crosses a department, so a stray write cannot build a cross-silo link.
- Team page: the standalone "Directors" section is gone. Every non-Founder now
  sits in their own department block, ordered Director → Manager → staff, with
  the department's Director named in the block header.

**Not scoped by this change** (deliberately — the ask was people, not tasks):
goals/tasks, holidays and the company record stay company-wide readable, and
`getProfileBriefs()` still resolves goal-assignee names/avatars through the
service role, so a shared cross-department task can still surface a name.

**Operational step after deploying**: each Director's `profiles.department`
must be set to the department they actually run — that field is now what
grants their scope.

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
- Full notification pipeline — goal/leave/punch/work-report bell items,
  toasts, teammate punch-in/out toasts, `/notifications` history, and the
  dashboard birthday wishing card (`notificationsFull`) — explicitly
  deferred by the user to Phase 2; only the avatar/password/date-of-birth
  device reminders stay on in Phase 1

Date of birth + auto-computed Age are always-on core profile fields (same
tier as name/avatar) — set by a member in Settings or corrected by the Board
in Manage Member (Teams), not gated by any flag. Only the birthday wishing
card/notifications are Phase-2 gated (see `notificationsFull` above); the
personal "add your DOB" reminder and the birthday sweep that stores the
notification row always run.

`dashboardExtras` (internship progress, flagged members, milestone replay)
was flipped back to `true` ahead of the rest of this list, after a report
that the internship progress bar was missing for interns.

Priya and Tips are NOT on this list — see "Removed" above. They were cut
from the codebase, not flag-gated, so bringing either back is new work.
