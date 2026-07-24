-- reStrucAI — Department Managers (Heads of Department).
--
-- A Manager is a normal employee (their fte/pte/intern role is unchanged) who
-- the Board appoints to HEAD one department, with a Board-picked TEAM (a subset
-- of that department). A Manager gains scoped powers WITHOUT seeing daily logs:
--
--   * see their team members' profiles + punch-based analytics (NOT their logs)
--   * create / edit goals for their own department (delete stays Board-only)
--   * read communication-email logs sent to their department (read-only)
--   * request the Board change a team member's email / role / job title /
--     daily hours (joining date excluded) — see 0034_change_requests.sql
--
-- Modelled as flags on `profiles` rather than a new role, so the Manager keeps
-- their underlying employment type and their own personal punch/log/analytics.

-- ---------------------------------------------------------------------------
-- 1 — columns
--   is_manager          — this person is a Head of Department.
--   managed_department  — which department they head (Managers only).
--   manager_id          — on a TEAM MEMBER's row: points to their Head. The
--                         team is exactly the members whose manager_id = head.
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists is_manager boolean not null default false;
alter table profiles
  add column if not exists managed_department text;
alter table profiles
  add column if not exists manager_id uuid references profiles (id) on delete set null;

create index if not exists profiles_manager_idx on profiles (manager_id);

-- ---------------------------------------------------------------------------
-- 2 — SECURITY DEFINER helpers (mirror is_board()). DEFINER so a policy on
-- `profiles` can call them without recursively triggering profiles' own RLS.
-- ---------------------------------------------------------------------------

-- True when the caller is an active Department Manager.
create or replace function public.is_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_manager = true
  );
$$;

-- The department the caller heads (NULL if they are not a Manager).
create or replace function public.my_managed_department()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select managed_department from public.profiles where id = auth.uid();
$$;

-- True when `target` is a member of the caller's team (the caller is their Head).
create or replace function public.manages_user(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = target and manager_id = auth.uid()
  );
$$;

-- True when `target`'s department is the one the caller heads. Used to gate a
-- Manager's read of communication-email logs for their department. Returns
-- false when the caller heads nothing or `target` is null.
create or replace function public.manages_dept_recipient(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    target is not null
    and (select managed_department from public.profiles where id = auth.uid()) is not null
    and exists (
      select 1 from public.profiles p
      where p.id = target
        and p.department = (select managed_department from public.profiles where id = auth.uid())
    );
$$;

-- ---------------------------------------------------------------------------
-- 3 — profiles: a Manager may READ their team members' profiles. (No new
-- UPDATE power — Managers change a member only via a Board-approved request.)
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: read self or board" on profiles;
create policy "profiles: read self or board" on profiles
  for select using (
    id = auth.uid() or public.is_board() or public.manages_user(id)
  );

-- ---------------------------------------------------------------------------
-- 4 — punches: a Manager may READ their team's punches (hours / attendance for
-- analytics). Logs are deliberately NOT extended — a Manager never sees the
-- daily logs of their team.
-- ---------------------------------------------------------------------------
drop policy if exists "punches: read own or board" on punches;
create policy "punches: read own or board" on punches
  for select using (
    user_id = auth.uid() or public.is_board() or public.manages_user(user_id)
  );

-- ---------------------------------------------------------------------------
-- 5 — goals: a Manager may create / edit goals for the department they head.
-- Deletion stays Board-only (see 0002).
-- ---------------------------------------------------------------------------
drop policy if exists "goals: board insert" on goals;
create policy "goals: board insert" on goals
  for insert with check (
    public.is_board()
    or (public.is_manager() and department = public.my_managed_department())
  );

drop policy if exists "goals: board update" on goals;
create policy "goals: board update" on goals
  for update using (
    public.is_board()
    or (public.is_manager() and department = public.my_managed_department())
  )
  with check (
    public.is_board()
    or (public.is_manager() and department = public.my_managed_department())
  );

-- ---------------------------------------------------------------------------
-- 6 — goal_assignees: a Manager may assign / unassign within their department's
-- goals. Assigning is further limited to their own team members.
-- ---------------------------------------------------------------------------
drop policy if exists "goal_assignees: board insert" on goal_assignees;
create policy "goal_assignees: board insert" on goal_assignees
  for insert with check (
    public.is_board()
    or (
      public.is_manager()
      and public.manages_user(user_id)
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
  );

drop policy if exists "goal_assignees: board delete" on goal_assignees;
create policy "goal_assignees: board delete" on goal_assignees
  for delete using (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 7 — goal_checklist_items: a Manager may add / edit / remove checklist items
-- on goals in the department they head.
-- ---------------------------------------------------------------------------
drop policy if exists "checklist: board insert" on goal_checklist_items;
create policy "checklist: board insert" on goal_checklist_items
  for insert with check (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
  );

drop policy if exists "checklist: board update" on goal_checklist_items;
create policy "checklist: board update" on goal_checklist_items
  for update using (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_checklist_items.goal_id
          and g.department = public.my_managed_department()
      )
    )
  );

drop policy if exists "checklist: board delete" on goal_checklist_items;
create policy "checklist: board delete" on goal_checklist_items
  for delete using (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_checklist_items.goal_id
          and g.department = public.my_managed_department()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 8 — communication-email logs: a Manager may READ (only) the emails sent to
-- members of the department they head. Board read policies are left intact.
-- ---------------------------------------------------------------------------
drop policy if exists "priya logs: manager read dept" on priya_email_logs;
create policy "priya logs: manager read dept" on priya_email_logs
  for select using (public.manages_dept_recipient(recipient_id));

drop policy if exists "txn logs: manager read dept" on transactional_email_logs;
create policy "txn logs: manager read dept" on transactional_email_logs
  for select using (public.manages_dept_recipient(recipient_id));
