-- Scope what a Director can READ to their own departments.
--
-- The bug: "goals: read all authenticated" (0002) let every signed-in account
-- read every task, and visibleGoals() in src/lib/queries.ts opened with
-- `if (profile.role === 'board') return goals`. A Director is board-level, so
-- they saw all 228 tasks across every department — Rohit Bohra, listed under
-- MCA and RBI, was reading Audit, GST and General alongside his own.
--
-- The rule now, matching visibleGoals():
--
--   * FOUNDERS read everything. Their reach comes from being a Founder, not
--     from a department — they sit under none (0058 sets their department to
--     ''), so any department test would scope them to nothing.
--   * A DIRECTOR reads the tasks of the departments they are LISTED under,
--     primary or additional (0060), plus anything assigned to them personally
--     so a task handed to them from outside those departments never vanishes
--     off their own checklist.
--   * A MANAGER reads the department they head, as the Goals page already
--     showed them.
--   * Everyone else reads what is assigned to them, what their department
--     holds, and the descendants of a task assigned to them (the cascade
--     inheritance visibleGoals() implements by walking parent_id).
--
-- Deliberately NOT the same rule that governs which PEOPLE a Director sees:
-- can_view_user() / canViewMember() scope that by director_id (0061), on
-- purpose. Tasks are scoped by department at the client's request. The two are
-- allowed to disagree, and they do — Rohit holds no director_id reports at all
-- yet must still see his departments' work.

-- ---------------------------------------------------------------------------
-- 1 — does the caller inherit this task from an assigned ancestor?
--
--     visibleGoals() walks parent_id upward and shows a task when IT or any
--     ancestor is assigned to the viewer. Only 4 of 228 tasks are parented
--     today and none currently inherit visibility this way, but leaving the
--     rule out of the policy would silently disable the feature the moment
--     someone builds a real cascade — the child would be filtered out by RLS
--     before the client ever got to walk to it.
--
--     SECURITY DEFINER so the walk itself is not re-filtered by the very policy
--     that calls it (which would recurse); STABLE so it is evaluated once per
--     distinct argument within a statement.
-- ---------------------------------------------------------------------------
create or replace function public.goal_ancestor_assigned_to_me(p_goal_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_cur uuid := p_goal_id;
  v_hops int := 0;
begin
  if v_uid is null then
    return false;
  end if;
  -- The ladder is five tiers deep (Yearly → Daily, 0057), so the cap is a
  -- guard against a cyclic parent_id rather than a real limit.
  while v_cur is not null and v_hops < 10 loop
    if exists (
      select 1 from goal_assignees ga where ga.goal_id = v_cur and ga.user_id = v_uid
    ) then
      return true;
    end if;
    select parent_id into v_cur from goals where id = v_cur;
    v_hops := v_hops + 1;
  end loop;
  return false;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2 — the read policy.
-- ---------------------------------------------------------------------------
drop policy if exists "goals: read all authenticated" on public.goals;
drop policy if exists "goals: read scoped" on public.goals;
create policy "goals: read scoped" on public.goals
  for select using (
    -- Founders: the whole company.
    public.row_is_founder(auth.uid())
    -- Assigned to me — a Director's own task from another department included.
    or exists (
      select 1 from goal_assignees ga
      where ga.goal_id = goals.id and ga.user_id = auth.uid()
    )
    -- Any department I am listed under. my_departments() (0064) returns the
    -- primary plus the additional ones, and drops blanks — so a Founder-style
    -- empty department matches nothing rather than everything.
    or coalesce(goals.departments, array[goals.department]) && public.my_departments()
    -- The department a Manager heads.
    or (public.is_manager() and goals.department = public.my_managed_department())
    -- Inherited from an assigned ancestor. Guarded on parent_id so the walk is
    -- skipped entirely for the 224-of-228 tasks that have no parent.
    or (goals.parent_id is not null and public.goal_ancestor_assigned_to_me(goals.id))
  );

-- ---------------------------------------------------------------------------
-- 3 — checklist items follow their task.
--
--     Narrowing `goals` alone would still leave every task's checklist labels
--     and descriptions world-readable through "checklist: read all", which is
--     where the actual content of a task lives — the titles would be hidden and
--     the substance would not.
--
--     goal_assignees and goal_checklist_completions are deliberately left as
--     they are: they hold id pairs and timestamps rather than content, and the
--     policy above reads goal_assignees, so gating that table on the same
--     helper would make the two mutually recursive.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_goal(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from goals g
    where g.id = p_goal_id
      and (
        public.row_is_founder(auth.uid())
        or exists (
          select 1 from goal_assignees ga
          where ga.goal_id = g.id and ga.user_id = auth.uid()
        )
        or coalesce(g.departments, array[g.department]) && public.my_departments()
        or (public.is_manager() and g.department = public.my_managed_department())
        or (g.parent_id is not null and public.goal_ancestor_assigned_to_me(g.id))
      )
  );
$fn$;

drop policy if exists "checklist: read all" on public.goal_checklist_items;
drop policy if exists "checklist: read scoped" on public.goal_checklist_items;
create policy "checklist: read scoped" on public.goal_checklist_items
  for select using (public.can_read_goal(goal_id));
