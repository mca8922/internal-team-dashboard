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

### Direct reports to a Director (done)

0058 answered "who can this Director *see*?" but not "who *answers* to them".
Migration `0059_director_reports.sql` adds `profiles.director_id` — on a
member's row it points at the Director they report to.

- It is a **reporting record, not a permission**. Visibility is still
  department-based, so 0059 changes no RLS policy: a Director could already
  see everyone in their department, this only says which of them report to
  them directly.
- `director_id` and `manager_id` are **independent** — a person may report to
  a Manager *and* straight to their Director at the same time. This is a
  dotted-line org, not a strict tree, so nothing forces the two to agree
  beyond both staying inside the one department.
- Rules enforced by the (extended) `assert_hierarchy_consistent` trigger: the
  target must be a real Director; both rows share the same non-blank
  department; a Director never reports to another Director, a Founder to no
  one, nobody to themselves. `canReportToDirector()` in `roles.ts` mirrors
  these for the UI and is covered by `roles.test.ts`.
- A second trigger, `release_director_reports`, detaches everyone pointing at
  a Director the moment they are demoted or moved department, so no dangling
  line survives. `updateMemberDepartment` clears both lines when a member
  moves; promoting someone to Director clears their own upward links.
- UI: **Founder-only** "Direct reports" panel on a Director in Manage member,
  listing the department split into Managers and Staff. Team cards show a
  "Reports to …" line naming both lines when present.
- Server action: `setDirectorReports(directorId, memberIds)`, Founder-gated,
  mirroring `setManagerTeam`.

### Multi-department members (done)

A person belonged to exactly one department. Migration `0060_member_departments.sql`
adds `profiles.departments text[]`, mirroring what 0038 did for goals:
`profiles.department` stays the **primary / home** department and the array
holds every department they are listed under, primary always element 0.

- It is a **label, not a permission**. 0058's boundary is untouched: no RLS
  policy, no `can_view_user()` / `can_manage_user()`, no
  `assert_hierarchy_consistent()` rule reads the array. A Tax Director does not
  gain sight of someone whose primary is Audit because "Tax" appears in their
  list, and the member gains nothing either. `canViewMember()` /
  `canManageMember()` in `roles.ts` deliberately stay primary-only, pinned by
  tests in `roles.test.ts`.
- **Directors and Managers can be listed under several departments too**, but
  the one they direct/head is still their primary — that is where their scope
  comes from, so 0058's "a Director never spans two" holds for *access*.
- A DB trigger `sync_member_departments` keeps the invariant: `departments[0]`
  is always `department`, no blanks, no duplicates. Every pre-0060 writer of
  `profiles.department` (`updateMemberDepartment`, `renameDepartment`,
  `setMemberAsManager`, account creation) therefore stays correct untouched.
  When `department` alone moves, the old primary is **dropped**, not demoted to
  an extra. The trigger also refuses a non-Founder write to the array, mirroring
  the action.
- Server action: `setMemberDepartments(memberId, extraDepartments)`,
  Founder-gated. It edits the extras only — the primary comes from
  `updateMemberDepartment`. Extras must already exist as departments (created in
  Team › Departments); the Founders themselves are rejected outright, since they
  sit under no department.
- `createTeamMember()` takes an optional `extraDepartments`, validated (and
  rejected for a non-Founder caller) *before* the auth user is created, so a bad
  list can't leave a half-configured account behind. The auth trigger only knows
  the primary, so the array is written in the same post-create patch.
- `renameDepartment` now rewrites the name inside members' arrays as well as
  goals'; `deleteDepartment` counts anyone listed under it, primary *or*
  additional, so a stale label can't survive a delete.
- UI: a Founder-only **"Multi department"** section in Manage member, below
  Department, and the same picker in Create account (hidden for a Director,
  who hires into their own department and nowhere else). Team cards keep their
  card in the **primary** department's block (duplicating a person per
  department would double-count every headcount) with the others as `+Name`
  chips; the member's profile page shows an "Also in …" line. The Team
  department filter matches primary *or* extras.

### A Director's scope is the staff assigned to them (done)

0058 gave a Director their whole department automatically; 0059 added
`director_id` as a *reporting record only*, because department membership had
already granted everything. Migration `0061_director_assigned_scope.sql`
inverts that — the Founder assigns staff to a Director, and **those
assignments are the Director's scope**:

```
Founder (no department, sees everything, assigns everything)
  └── Director        — role='board'
        └── exactly the people with director_id = that Director
```

- A Director no longer sees their department by default. They see themselves
  plus the people the Founder handed them. Two Directors may share a department
  and hold completely different teams; a Director with no assignments sees only
  themselves.
- **Deliberately not transitive**: a Director does not inherit sight of the
  staff under a Manager assigned to them. Those people are assigned
  individually or not at all — so a Manager can legitimately see someone their
  own Director cannot. Pinned by `roles.test.ts`.
- The department did not stop mattering, it changed job: it now decides
  **eligibility**, reading the member's whole `departments` list (0060). Putting
  "Audit" on someone whose primary is "GST" makes them assignable to an Audit
  Director without moving them out of GST — and grants nothing until the
  assignment is actually made. This is the one place multi-department changes an
  outcome.
- SQL: new `directs_user()`; `can_view_user()` / `can_manage_user()` swap their
  department arm for it, as do the `logs` / `leaves` read and `leaves` review
  policies. `punches`, `profiles` and `change_requests` follow automatically via
  the two predicates. TS mirrors are `canViewMember()` / `canManageMember()` —
  both now read `director_id`, not `department`.
- `assert_hierarchy_consistent` checks the candidate's whole `departments` list,
  and `departments` joined its column list so *removing* the department a
  reporting line rests on raises rather than silently severing it.
  `release_director_reports` now keeps the reports who also belong to a moving
  Director's new department instead of dropping all of them.
- `requireMemberScope()` in `actions.ts` moved from a department comparison to
  `director_id`. `setDirectorReports()` validates eligibility with
  `belongsToDepartment()`. `createTeamMember()` auto-assigns a hire to the
  **Director who created them** — otherwise a Director would fill in the form
  and immediately lose sight of the account.
- UI: the "Direct reports" panel is now a permission screen, not an org chart —
  its hint says so, candidates from another primary department carry a
  department badge, and an empty selection warns that the Director will see only
  themselves. The Team page subtitle reads "Assigned to you" rather than naming
  a department the counts no longer describe.

**Operational**: the migration backfills only members with **no** director yet,
handing them to their primary department's sole Director. It never overwrites an
existing assignment. Departments with no Director (currently *General*) keep
nobody assigned — those members are visible to the Founders alone.

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
