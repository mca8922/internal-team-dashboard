-- reStrucAI — a Director's scope becomes the staff ASSIGNED to them.
--
-- 0058 made the department the security boundary: a Director saw everyone in
-- their department, automatically. 0059 then added `director_id` as a pure
-- REPORTING record on top of that — it said who answered to whom, but granted
-- nothing, because department membership had already granted everything.
--
-- That is now inverted. The Founder assigns staff to a Director, and those
-- assignments ARE the Director's scope:
--
--   Founder (no department, sees everything, assigns everything)
--     └── Director        — role='board'
--           └── exactly the people with director_id = that Director
--
-- A Director no longer sees their department by default. They see themselves,
-- plus the people the Founder handed them, and nothing else. Two Directors may
-- share a department and hold completely different, non-overlapping teams.
--
-- Deliberately NOT transitive: a Director does not inherit sight of the staff
-- under a Manager who reports to them. If those people should be visible, they
-- are assigned individually. (Managers keep the team read granted in 0033, so a
-- Manager can still see more of their own team than their Director does unless
-- the Founder assigns the same people up.)
--
-- The department does NOT disappear — it now decides ELIGIBILITY rather than
-- access: a member may be assigned to a Director when that Director's
-- department is one the member belongs to, primary OR additional (0060). This
-- is where the multi-department list earns its keep: putting "Audit" on someone
-- whose primary is "GST" makes them assignable to an Audit Director, without
-- moving them out of GST and without, on its own, showing them to anyone.
--
-- Run this by hand before deploying the code that depends on it.

-- ---------------------------------------------------------------------------
-- 1 — the new scope predicate: "does the caller direct this person?"
-- ---------------------------------------------------------------------------
create or replace function public.directs_user(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target and p.director_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 2 — read/write predicates. Same shape as 0058, with the Director arm swapped
-- from "same department" to "assigned to me".
-- ---------------------------------------------------------------------------
create or replace function public.can_view_user(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_founder()
    or target = auth.uid()
    or (public.is_director() and public.directs_user(target))
    or public.manages_user(target);
$$;

create or replace function public.can_manage_user(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    not public.row_is_founder(target)
    and (
      public.is_founder()
      or (public.is_director() and public.directs_user(target))
    );
$$;

-- ---------------------------------------------------------------------------
-- 3 — the three policies that spell the old rule out inline rather than going
-- through can_view_user(). Logs stay Board-tier only (a Manager never sees
-- their team's daily logs, 0033), so they keep using the director arm directly.
-- ---------------------------------------------------------------------------
drop policy if exists "logs: read own or board" on logs;
create policy "logs: read own or board" on logs
  for select using (
    user_id = auth.uid()
    or public.is_founder()
    or (public.is_director() and public.directs_user(user_id))
  );

drop policy if exists "leaves: read own or board" on leaves;
create policy "leaves: read own or board" on leaves
  for select using (
    user_id = auth.uid()
    or public.is_founder()
    or (public.is_director() and public.directs_user(user_id))
  );

-- A Director reviews leave only for the people assigned to them; 0054's
-- "never review your own request" rule is preserved.
drop policy if exists "leaves: update own pending or board" on leaves;
create policy "leaves: update own pending or board" on leaves
  for update using (
    (user_id = auth.uid() and status = 'pending')
    or (
      user_id <> auth.uid()
      and (
        public.is_founder()
        or (public.is_director() and public.directs_user(user_id))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4 — eligibility. A direct report must share a department with their Director,
-- but "share" now reads the member's whole `departments` list (0060), not just
-- their primary. Everything else about the line is unchanged.
--
-- `departments` joins the trigger's column list so that REMOVING the department
-- a reporting line rests on is caught. It raises rather than silently detaching:
-- severing a reporting line is the Founder's decision, not a side effect of
-- editing a label.
--
-- Note this trigger fires BEFORE profiles_sync_departments (0060) — alphabetical
-- order — so `new.departments` here is still the caller's raw array. The primary
-- is folded in explicitly below rather than relying on that normalisation.
-- ---------------------------------------------------------------------------
create or replace function public.assert_hierarchy_consistent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  head_dept text;
  dir       record;
  my_dept   text := nullif(btrim(new.department), '');
  my_depts  text[];
begin
  -- manager_id: the team member must belong to the department their head runs.
  -- Unchanged — a Manager's team is still drawn on the PRIMARY department, so
  -- an extra department does not put someone under another department's head.
  if new.manager_id is not null then
    select nullif(btrim(managed_department), '') into head_dept
    from public.profiles where id = new.manager_id;
    if head_dept is null then
      raise exception 'Assigned manager does not head a department.';
    end if;
    if my_dept is distinct from head_dept then
      raise exception 'A team member must belong to the department their manager heads.';
    end if;
  end if;

  -- director_id: the reporting line to a Director, and now their scope.
  if new.director_id is not null then
    if new.director_id = new.id then
      raise exception 'A member cannot report to themselves.';
    end if;
    if public.row_is_founder(new.id) then
      raise exception 'A Founder does not report to a Director.';
    end if;
    if new.role = 'board' then
      raise exception 'A Director does not report to another Director.';
    end if;

    select role, nullif(btrim(department), '') as dept
      into dir
    from public.profiles where id = new.director_id;

    if dir is null or dir.role <> 'board' or public.row_is_founder(new.director_id) then
      raise exception 'Direct reports can only be assigned to a Director.';
    end if;

    my_depts := coalesce(new.departments, '{}'::text[]);
    if my_dept is not null then
      my_depts := array[my_dept] || my_depts;
    end if;

    if dir.dept is null or not (dir.dept = any(my_depts)) then
      raise exception 'A direct report must belong to their Director''s department (% ) — add it to their departments first.', dir.dept;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_hierarchy_consistent on profiles;
create trigger profiles_hierarchy_consistent
  before insert or update of manager_id, director_id, department, departments, role on profiles
  for each row execute function public.assert_hierarchy_consistent();

revoke execute on function public.assert_hierarchy_consistent() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5 — releasing a Director. Demotion still drops every line pointing at them.
-- A Director MOVING department no longer has to drop all of them: the reports
-- who also belong to the new department stay, the rest are released.
-- ---------------------------------------------------------------------------
create or replace function public.release_director_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_dept text := nullif(btrim(new.department), '');
begin
  if old.role = 'board' and new.role <> 'board' then
    update public.profiles set director_id = null where director_id = old.id;
  elsif old.role = 'board'
        and new_dept is distinct from nullif(btrim(old.department), '') then
    update public.profiles p
      set director_id = null
    where p.director_id = old.id
      and (new_dept is null or not (new_dept = any(coalesce(p.departments, '{}'::text[]))));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_release_director_reports on profiles;
create trigger profiles_release_director_reports
  after update of role, department on profiles
  for each row execute function public.release_director_reports();

revoke execute on function public.release_director_reports() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6 — backfill. Without this every Director would wake up seeing nobody, since
-- before today nothing needed to record who was theirs.
--
-- Rule: an unassigned member is handed to their PRIMARY department's Director
-- where that department has exactly one. Existing assignments are left alone —
-- they were made deliberately.
--
-- Departments with no Director (currently "General") keep nobody assigned:
-- there is no one to assign them to, and the Founders still see everyone.
-- ---------------------------------------------------------------------------
update public.profiles m
set director_id = d.id
from (
  select nullif(btrim(department), '') as dept, min(id::text)::uuid as id, count(*) as n
  from public.profiles
  where role = 'board'
    and not public.row_is_founder(id)
    and nullif(btrim(department), '') is not null
  group by nullif(btrim(department), '')
) d
where d.n = 1
  and m.director_id is null
  and m.role <> 'board'
  and not public.row_is_founder(m.id)
  and nullif(btrim(m.department), '') = d.dept;

-- One-off for the current org: Audit is the only department with TWO Directors
-- (Adityavikram Bohra and Dilip Pandey), so the rule above skipped it. Its
-- still-unassigned staff go to Adityavikram; Dilip keeps the report he already
-- had. Guarded on finding exactly one Director by that name, so it is a no-op
-- anywhere the data differs.
update public.profiles m
set director_id = (
  select id from public.profiles
  where name = 'Adityavikram Bohra' and role = 'board'
    and nullif(btrim(department), '') = 'Audit'
)
where m.director_id is null
  and m.role <> 'board'
  and not public.row_is_founder(m.id)
  and nullif(btrim(m.department), '') = 'Audit'
  and (
    select count(*) from public.profiles
    where name = 'Adityavikram Bohra' and role = 'board'
      and nullif(btrim(department), '') = 'Audit'
  ) = 1;
