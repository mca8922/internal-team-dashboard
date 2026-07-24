-- reStrucAI — multi-department goals.
--
-- A goal used to belong to exactly ONE department (goals.department). The Board
-- now wants a goal to span several departments so members from any of them can
-- be assigned (e.g. a Sales & Growth goal that also involves an AI Engineering
-- person). Rather than rework every read of goals.department, we KEEP that
-- column as the goal's PRIMARY / home department (used for analytics grouping,
-- reporting-template selection and back-compat) and ADD a `departments` array
-- holding every department the goal spans (the primary is always element 0).
--
-- Cross-department selection is a Board-only capability in the UI; managers stay
-- scoped to the single department they head, so no RLS change is required here
-- (the Board's goals/goal_assignees policies are already unrestricted).
--
-- Run this by hand before deploying the code that reads/writes `departments`.

-- 1 — the new column, backfilled from the existing single department so every
--     current goal spans exactly its own department.
alter table public.goals
  add column if not exists departments text[] not null default '{}';

update public.goals
  set departments = array[department]
  where (departments is null or array_length(departments, 1) is null)
    and department is not null
    and department <> '';

-- 2 — ticking an UNASSIGNED (department) goal: allow any member whose department
--     is one of the goal's departments (was: the single goals.department). Named
--     assignees are unaffected — they can always tick, cross-department or not.
create or replace function public.toggle_checklist_item(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid             uuid := auth.uid();
  v_goal_id         uuid;
  v_has_assignee    boolean;
  v_can             boolean;
  v_report_required boolean;
  v_dept            text;
begin
  select goal_id into v_goal_id from goal_checklist_items where id = p_item_id;
  if v_goal_id is null then
    raise exception 'Checklist item not found';
  end if;

  select exists (select 1 from goal_assignees where goal_id = v_goal_id)
    into v_has_assignee;

  if v_has_assignee then
    -- Only the named assignees may complete this goal's checklist.
    select exists (
      select 1 from goal_assignees
      where goal_id = v_goal_id and user_id = v_uid
    ) into v_can;
  else
    -- Unassigned (department) goal: any member of ANY of its departments may tick.
    select department into v_dept from profiles where id = v_uid;
    select exists (
      select 1 from goals g
      where g.id = v_goal_id
        and (v_dept = any(g.departments) or v_dept = g.department)
    ) into v_can;
  end if;

  if not v_can then
    raise exception 'Only members assigned to this goal can complete its checklist';
  end if;

  if p_done then
    -- Report-work gate: completing this item requires a report for today.
    select coalesce(report_required, false) into v_report_required
      from goal_checklist_items where id = p_item_id;
    if v_report_required and not exists (
      select 1 from goal_work_reports
      where item_id = p_item_id
        and user_id = v_uid
        and report_date >= current_date
    ) then
      raise exception 'Please report your work before completing this task';
    end if;

    insert into goal_checklist_completions (item_id, user_id, done_at)
    values (p_item_id, v_uid, now())
    on conflict (item_id, user_id) do update set done_at = now();
  else
    delete from goal_checklist_completions
    where item_id = p_item_id and user_id = v_uid;
  end if;
end;
$$;
