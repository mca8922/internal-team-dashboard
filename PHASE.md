# Project phases

Source of truth for what's currently in scope. Check this before adding or
re-enabling a feature; update it (mark items done, add new phases) whenever
scope changes.

Feature visibility is controlled centrally in `src/lib/featureFlags.ts`
(`FEATURE_FLAGS`). Flipping a flag from `false` to `true` re-enables a
feature — no code needs to move.

## Phase 2 — status

Every `FEATURE_FLAGS` entry is **on** except `emails`, which stays deferred
until there's a further requirement. Order they were unlocked in, each
verified with `tsc --noEmit` + `vitest run` + `next build` before moving to
the next:

`support` → `teamRequests` → `punchRequests` → `goalsCleanup` →
`analyticsFilters` → `apps` → `settingsNotifications` → `notificationsFull` →
`dailyLog`.

**Daily Log (`dailyLog`) is a flag flip only** — no behavior changed beyond
what the flag already gated. In particular, punch in/out
(`PunchConsole`, `punchIn`/`punchOut` in `actions.ts`) has no reference to
logs anywhere in the codebase and was confirmed independent before the flip:
a member who never writes a log can punch in and out completely normally,
same as when the flag was off.

`punchRequests` / `teamRequests` / `goalsCleanup`: their server actions
(`submitPunchChangeRequest`, `submitChangeRequest`, `archiveGoals` /
`restoreGoals` / `deleteGoals`, …) were never flag-gated — only the UI entry
points were. `goalsCleanup`'s destructive actions are further backstopped by
"goals: board update/delete" RLS, so the flag was UX polish on top of a real
DB-level restriction, not the only gate.

`settingsNotifications` / `notificationsFull`: notification rows and
`sendPush()` already fire unconditionally regardless of these flags (and
still do — that didn't change). These two flags only unlock the *reading*
side: the Settings prefs UI, and the bell/toast/history UI. Sound prefs
(punch/presence/notification chimes) already defaulted to on and were
already playing before `settingsNotifications` was flipped; that flag only
exposed the toggle to turn them off. Push was and remains a no-op without
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL`, which aren't set in
this environment.

`apps`: works with an empty app list — the Board adds each department's
tools from the page itself now that it's reachable.

See "Phase 2 — Backlog" below for the per-flag detail table this replaces,
kept for the historical "what each flag hides" reference.

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
  assignment is actually made. (0062 below extends the same rule to a
  Manager's team.)
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

### A Manager's team can also be picked from an additional department (done)

Reported by the client: adding extra departments to an executive (and to a
Manager) visibly changed nothing about who that Manager could pick for their
team — the picker still only matched a candidate's **primary** department,
even though the identical setup (extra departments + an assignment) already
worked for Director → staff (0061). Migration
`0062_manager_team_multi_department.sql` closes that gap by applying the same
rule to `manager_id`:

- `assert_hierarchy_consistent()`'s `manager_id` branch now checks the
  candidate's whole `departments` list (primary or additional), the same
  `my_depts` construction the `director_id` branch already used. Removing the
  department a team link rests on raises rather than silently detaching it,
  same as the Director side.
- `setManagerTeam()` in `actions.ts` swapped its primary-only comparison for
  `belongsToDepartment()`, mirroring `setDirectorReports()`.
- UI: the "Team in `<department>`" picker in Manage member now shows anyone
  who belongs to that department, primary or additional, with a department
  chip on anyone picked in via an extra — the same treatment the "Direct
  reports" panel already had.
- **Nothing about who can SEE a team member changed** — `canViewMember()` /
  `canManageMember()` still key off `manager_id` directly, never off
  department, so this migration only widens who is *eligible* to receive that
  link in the first place.

## reStrucAI Support desk (Phase 2 — UNLOCKED for everyone)

A **Support** entry in the sidebar's Tools group (`/support`) is how this
team raises requests with reStrucAI, follows their status, and closes them
out. Built and verified in Phase 1 but gated; `FEATURE_FLAGS.support` is now
**`true`** — the first Phase 2 unlock, open to every account with no role
gate.

The gate it used to sit behind is still in the code and still correct, in
case it is ever closed again: while locked the nav entry stayed **visible
with a padlock** rather than disappearing, and `/support` rendered an
"Unlocks in Phase 2" state. That gate returns *before* `listMyTickets()`, so
a locked desk makes no API call, sends no reporter email to reStrucAI, and
writes no mirror rows. Locking it also cut off offboarded / read-only
accounts — the people the entry exists for — which is part of why it went
first.

**Which address a ticket carries:** `getSupportUser()` in
`src/support/current-user.ts` sends `profiles.commute_email` (the
"Communication email" field in Manage Member) and falls back to
`profiles.email`, the login username, when it is blank. That one value is
both the reply-to on a new ticket *and* the key tickets are read back by
(`listMyTickets`, `getTicket`, close). So filling in a Communication email
**after** someone has filed tickets makes reStrucAI see a new reporter and
drops their earlier tickets out of their own list — every active member
should have one set.

**reStrucAI's database is the source of truth.** Tickets are posted to
reStrucAI's support API and read back from it; nothing the Support page
renders comes from our tables.

**A local mirror was added afterwards, at the operator's request** (migration
`0062_support_mirror.sql` — `support_mirror_tickets`, `support_mirror_messages`).
It is an **archive, not an authority**: written best-effort by the module's
per-fork seam `src/support/support-mirror.ts`, and read by nothing in the app.
Two known drifts, accepted deliberately:

- A ticket that moves on reStrucAI's side updates here only the next time the
  reporter loads Support or opens that ticket. These rows are never live.
- The email back-and-forth is **not** captured, because reStrucAI does not
  store it either — nothing writes an `agent` message there today. What lands
  locally is the opening request plus status entries.

If the two ever disagree, reStrucAI is right.

- `src/support/` is a **shared module**, copied byte-identical into every
  client fork. Do not patch it here; a fix belongs upstream so it reaches
  every fork. `current-user.ts` is the one file that is per-fork, and this
  fork's schema matched the stub as-is (`profiles` → name, `commute_email`
  || `email`, `job_title` || `role`).
- `support.css` is appended verbatim to `globals.css` under a marked
  banner. Re-append on module updates rather than editing in place.
- Two env vars, server-side only: `SUPPORT_API_URL` and `SUPPORT_API_KEY`.
  **`SUPPORT_API_KEY` must never carry a `NEXT_PUBLIC_` prefix** — the three
  server files guard this with `server-only`, so a client import fails the
  build rather than shipping the key.
- Flag-gated (`support`, now on) but deliberately **not role-gated**: an
  offboarded or read-only account keeps Support even when it is the only Tools
  entry left. Someone locked out of their own record is exactly who needs to
  reach us.
- Reached from the sidebar only — **no "?" button in the top bar**, which is
  the deliberate difference from reStrucAI's own dashboard. There is also no
  reply box: a ticket records state, and the conversation happens over email.

### Support desk — formatting, table, spam notice (done)

Three module changes, made here and to be carried upstream to `client-module/`
so every fork gets them (`git pull` on the module folder):

- **Rich-text bodies.** Ticket messages come back from reStrucAI as HTML; they
  were rendered as raw text, so `<b>`/`<div>` tags showed literally. They now
  render through the shared `RichText` (sanitized `dangerouslySetInnerHTML`).
  "Tell us what happened" uses `RichTextEditor` instead of a plain `<textarea>`,
  so the report is authored with the same bold/italic/list/highlight formatting
  a reply uses. `validateTicketInput` flattens the HTML (`htmlToText` in
  `support-shared.ts`) for its min-length / blank checks; the `BODY_MAX` cap
  still runs against the stored markup. The module now depends on
  `@/components/RichTextEditor` + `@/lib/sanitize` + `isomorphic-dompurify` —
  see the README.
- **Ticket list is a table.** `TicketTable` in `SupportPage.tsx`: sortable
  columns (Reference / Subject / Status / Updated), a search box and a status
  filter. Folds to stacked cards under 720px via `data-label` — no second DOM.
- **Spam-folder notice.** The "Sent to reStrucAI" confirmation now carries an
  amber advisory: check spam/junk if the confirmation email is missing, mark it
  "Not spam", add reStrucAI to safe senders, and note that every reply comes to
  that same address.

- **Report form no longer closes on backdrop click or Escape.** It holds a
  half-written report, so the ✕ in the corner is the only way out — a stray
  click or keypress can't discard what someone typed. `TicketDetail` (a
  read-only state record) still closes both ways.

`support.css` was edited and **re-appended** to `globals.css` under its banner
(lines were replaced in place, block boundaries unchanged).

## Executive task powers (done — `executiveTasks`, migration 0064)

Creating a task used to be Board/Manager work. It no longer is: an
**Executive** — the Team modals' third tier, meaning anyone who is neither a
Director (`role: 'board'`) nor a Department Manager (`is_manager`) — can now
create and manage their own work. Scope, exactly:

| Power | Executive | Manager | Director / Founder |
|---|---|---|---|
| Create a task | any tier, **self-assigned only**, in a department they belong to | department they head, their own team | anything |
| Edit a task | only the ones **they created** — title, description, due date, status, checklist | department they head | anything |
| Reassign / duplicate | no | their team | yes |
| **Delete or archive** | **no** | **no** | **yes** |

Deletion is the line the whole feature is drawn against. Archiving is a soft
delete (0044 hides an archived task from every live view), so opening the
goals UPDATE policy to a task's creator would have handed every executive a
delete button by another name. It can't be expressed in a policy — archiving
is an UPDATE, and a policy only sees the new row — so the
`goals_archive_is_board` trigger in 0064 compares OLD to NEW and refuses it.

### Attribution

`goals` gained `updated_at` / `updated_by`; `created_by` already existed. Every
task card now shows **"Added by <name> · date · time"** and, once edited,
**"Edited · date · time"** — to everyone who can see the card, not just
leadership. Only `updateGoal` and `setGoalAssignees` move `updated_at`:
checklist ticks, the progress trigger and the deadline sweep deliberately leave
it alone, so "Edited" means the task changed, not that somebody did the day's
work on it. `updated_by` is recorded but not rendered — surfacing it later is a
render change, not a migration.

### Personal checklist steps

`goal_checklist_items.owner_id` is the whole mechanism. NULL — every row
written before 0064 — means a **shared** step, assigned by leadership and owed
by everyone on the task. Non-null means a **personal** step the member added to
their own list on any task assigned to them, including one a Director wrote.

- Only its owner sees it, and only its owner can tick it
  (`toggle_checklist_item` refuses everyone else).
- **It cannot be removed by the member who added it** — that is a Founder's or
  Director's call. Renaming is allowed; deleting is not, and there is no delete
  control anywhere in `GoalChecklist`. The Manager delete arm is narrowed to
  shared items for the same reason.
- It carries a **title and a rich-text description**, written in the same
  editor the Board's checklist uses (bold/italic/lists/links). The description
  starts collapsed behind "Add description" — most steps are a title and
  nothing else. Editing reopens both fields; a blank description is normalised
  to `''` server-side so leftover `<p><br></p>` never reopens the editor.
- **Executives only.** A Director or Manager who happens to be an assignee does
  not get the composer: they already edit that task's real checklist, and a
  second private list would split the record of the same work in two. Enforced
  in `addPersonalChecklistItem`, not just hidden in the UI — 0064's RLS is
  deliberately wider (any participant), so the action is where the rule lives.
- It is styled apart — violet spine, tinted panel, "Self-added" badge — for
  **every** viewer, including the Director reading the per-member panel, so
  assigned work and volunteered work never blur together. **The spine is a
  `::before`, not an inset `box-shadow`** — `.goal-check-row:hover` and
  `.board-cl-item:hover` both set `box-shadow: var(--shadow-card)`, and since
  box-shadow is one property the hover value REPLACED the spine, so the violet
  bar vanished exactly when the row was being looked at. Restating it per
  hover/done/not-due state fixed the known cases and would have broken on the
  next state added; a pseudo-element owns a property nothing else touches.
- It never travels: excluded from "Save as template", from Duplicate, and from
  the edit form's checklist (which would otherwise let a save silently delete
  someone's step — `syncChecklist` filters on `owner_id is null` server-side
  for the same reason).

Progress became owner-aware in the same migration. `recompute_goal_progress`
and its client mirror `computeGoalProgress` now sum what each assignee actually
owes — `(shared due items × assignees) + (personal due items whose owner is an
assignee)` — instead of the old `items × people`. So a member adding a step
lengthens their own row and moves the task's combined %, and leaves every
teammate's denominator exactly where it was.

### Timestamps and assignment, on every task

**Every checklist row** — assigned or self-added, on the member's own list and
in the Board's per-member panel — now shows **"Added · date · time"** beside
the existing **completion** stamp. No backfill was needed: `created_at` has
been on `goal_checklist_items` since 0009, so all 595 pre-existing rows carry
it.

**Every task card** shows who assigned it, to **every** viewer — not just to
the person it was handed to, which is all the old badge did. A Director reading
another member's task now sees the same "Assigned by ‹name›" that member sees.

`assigned_by` is per assignee row, so a task could in principle carry two
assigners; in practice it cannot, because `setGoalAssignees` rewrites every row
with one editor's id, and all 259 rows in the database agree per task. Where
they ever did diverge, the viewer's own row wins, so they see who assigned
*them*.

A task whose every row names its own holder as the assigner reads
**"Self-assigned · ‹name›"** in violet instead. This is not only executives:
**172 of the 219 assigned tasks** in the database today are Directors and
Managers who created a task and gave it to themselves, and 181 of those 189
rows have that same person as the task's `created_by`, so the label is the
accurate description of what happened rather than a data artifact. It still
names the person, so it is no less transparent than the "Assigned by" form — it
just stops a card reading "Assigned by Priyanka" on Priyanka's own task.

### Notification

An executive creating a task notifies **their Director** (`director_id` from
0061, falling back to the Founders when nobody is assigned to them), type
`member_task_created`. Adding a personal step notifies nobody — the badge and
the per-member panel are the record.

### Flag

`executiveTasks` hides the "Add my task" button, the Edit control on a task an
executive created, and the "Add your own step" composer. It does **not** hide
personal steps that already exist — their owner keeps seeing and ticking them,
because hiding work someone committed to would silently drop it — and it does
not roll back 0064's RLS.

## Director task scope (done — migration 0065)

**The bug.** `visibleGoals()` opened with `if (profile.role === 'board') return
goals`, and the `goals` table carried `"goals: read all authenticated"` from
0002. A Director is board-level, so every Director read all 228 tasks across
every department — Rohit Bohra, listed under MCA and RBI, was seeing Audit, GST
and General too.

**The rule now.** A Director sees the tasks of the departments they are LISTED
under — primary or additional (0060) — plus anything assigned to them
personally, so a task handed to them from outside those departments never
vanishes off their own checklist. Founders are exempt and still read everything:
they sit under no department (0058 sets it to `''`), so a department test would
scope them to nothing, and scoping them would have stopped Rajesh seeing Rohit's
tasks at all.

| Viewer | Before | After |
|---|---|---|
| Rajesh / Dharmesh (Founders) | 228 | 228 |
| Rohit Bohra (MCA, RBI) | 228 | **92** |
| Salma (MCA, General) | 228 | 162 |
| Vipul / Dilip / Adityavikram (3 depts each) | 228 | 142 |

**This is NOT the same rule that scopes PEOPLE.** `canViewMember()` /
`can_view_user()` scope who a Director can see by `director_id` (0061), on
purpose — `roles.ts` says outright that a Director's scope "is not their
department". Tasks are scoped by department at the client's explicit request.
The two rules are allowed to disagree, and they do: Rohit holds no `director_id`
reports at all, so the 0061 rule would have shown him 11 tasks and looked
broken.

**Enforced in both halves.** `visibleGoals()` is the UI half; the
`"goals: read scoped"` policy in 0065 is the real one, so the rows are not
merely hidden — a Director cannot read another department's task through the
API either. `"checklist: read all"` was narrowed the same way via
`can_read_goal()`, because leaving it open would have hidden the task titles
while leaving their checklist labels and descriptions world-readable, which is
where the actual content lives.

The policy also keeps a `goal_ancestor_assigned_to_me()` arm so the cascade
inheritance `visibleGoals()` implements (a task is visible if any ancestor is
assigned to you) is not silently disabled at the DB layer. Only 4 of 228 tasks
are parented today and none currently inherit visibility, but the walk is there
for when a real cascade is built. It is guarded on `parent_id is not null`, so
224 of 228 rows skip the function entirely.

Everything downstream of `visibleGoals()` was checked rather than assumed: the
Goals page's `allGoals`, archived list, department picker and assignee picker
all keyed off `isBoard` and would have handed a Director org-wide data through
the back door — they now key off `isFounder`. Verified unaffected: the dashboard
(already routes through `visibleGoals`), Team's `goalDeptCounts` (feeds a
Founder-only modal, and `deleteDepartment()` re-counts server-side under
`requireFounder()`), and cross-department parent links (zero in the data, so no
cascade is orphaned). Team Analytics goal figures now narrow to a Director's own
departments, which follows from the same rule.

`visibleGoals()` moved to `src/lib/goal-visibility.ts` so it is unit-testable
without `queries.ts`'s Supabase server client — the same split
`notif-events.ts` made from `notify-email.ts`. `queries.ts` re-exports it, so
every existing import still resolves. Covered by `visible-goals.test.ts`.

### The management surface follows the Director, not the tier

Scoping Directors surfaced a second bug behind the first. `GoalsView`
early-returns a stripped layout when `yearly.length === 0 && viewMode ===
'cascade'`, and that branch rendered no `BoardGoalsToolbar` and no
`BoardHealthStrip` — no search, no department/status/due filters, no
totals strip.

Nobody hit it before because every board account could see all 19 yearly tasks
in the company. Scoping by department is what started routing a real Director
down it: **Rohit Bohra's departments (MCA, RBI) hold no yearly task at all** —
92 tasks, all monthly and daily — so he lost the entire management surface the
moment his scope was narrowed. Every other Director has yearly tasks in scope
and never saw the difference.

The branch now renders the toolbar and the health strip in the same order the
main layout does, and its list is driven by the same `results` set, so the
filters that appear actually filter. Having no top-tier task says nothing about
whether a Director needs to search or see their totals.

Their strip is scoped like everything else — Rohit sees 92 / 76 active / 11
overdue / 16 completed, not the company's 228 / 123 / 34 / 105.

### Known gap, deliberately left

The policy's department arm applies to everyone, so an EXECUTIVE listed under
several departments can still read those departments' tasks through the API —
Ashok Nemade (General, Audit, GST, MCA) reads 227 of 228. That is not a
regression (they read all 228 before) and the UI still shows them only their
assigned tasks, but it is looser than the UI. Tightening it to
"assigned to me, or an unassigned task in my department" would match the UI
exactly and affects only the 9 tasks that currently have no assignee — not done
here because the request was specifically about Directors.

## Task templates opened to every member (done — migration 0066)

The shared task-template library (`goal_templates`, migration 0032) was
Board-only to create, edit and delete. It is now open: **any member** can save
a task as a template and spin a task up from one, so the whole team builds the
shared blueprints. **Deleting** a template is still limited — to the member who
created it, or any Board Member — so nobody can wipe another team's blueprints.

- **UI.** The "Templates" button on the Goals page (`GoalsView`) no longer sits
  behind `canAdmin`; "Mission & vision" and "Report templates" still do. "Save
  as template" moved out of the Board-only quick-actions menu into a standalone
  card action gated by `canManageCard` — the Board, a Manager in scope, or an
  Executive over a task they created. New `canUseTemplates` prop on `CardCtx`
  (always true today) carries the gate. The delete control in the Templates
  modal shows only to the template's creator or the Board.
- **Server.** `createGoalTemplate` / `deleteGoalTemplate` dropped `requireBoard`
  for `requireUser`; delete re-checks creator-or-board before the DELETE.
  `GoalTemplate` gained `createdBy`.
- **RLS.** 0066 replaces the three `is_board()` write policies with
  `created_by = auth.uid() or public.is_board()` for update/delete, and an
  `authenticated` insert that pins `created_by` to the caller. Read policy
  (everyone authenticated) is unchanged.
- Rides the `executiveTasks` flag by consequence: a non-manager only reaches the
  Goals page header actions when that flag is on.

## Phase 2 — Backlog (historical: what each flag hid in Phase 1)

All of these are now unlocked — see "Phase 2 — status" above. Table kept for
what each flag gates, in case one is ever switched back off:
- ~~reStrucAI Support desk (`support`)~~ — **done**; open to everyone, see
  its section above
- ~~Daily Log, incl. its Analytics/Settings tie-ins (`dailyLog`)~~ — **done**
- ~~Punch-time change requests (`punchRequests`)~~ — **done**
- ~~Team Requests / change-request inbox (`teamRequests`)~~ — **done**
- Emails (`emails`) — **still off**, deferred until there's a requirement
- ~~Apps / Launchpad (`apps`)~~ — **done**
- ~~Analytics filters, personal and team (`analyticsFilters`)~~ — **done**
- ~~Goals cleanup/export (`goalsCleanup`)~~ — **done**
- ~~Settings → Notifications section (`settingsNotifications`)~~ — **done**
- ~~Full notification pipeline — goal/leave/punch/work-report bell items,
  toasts, teammate punch-in/out toasts, `/notifications` history, and the
  dashboard birthday wishing card (`notificationsFull`)~~ — **done**

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
