-- reStrucAI — a Manager's team can be picked from anywhere on someone's
-- department list, not just their primary.
--
-- 0061 extended Director→report eligibility to read a candidate's WHOLE
-- `departments` list (0060), so someone whose primary is GST could be handed
-- to an Audit Director once Audit was added to their list. The equivalent
-- Manager→team check was left on the old rule — a candidate's PRIMARY
-- department only — which is inconsistent and, in practice, confusing:
-- adding a department to someone (or to a Manager) visibly does nothing for
-- team assignment, even though the identical action visibly does something
-- for Director assignment.
--
-- This brings the two in line: a candidate is eligible for a Manager's team
-- when the Manager's `managed_department` is anywhere on the candidate's
-- department list, primary or additional.
--
-- Nothing about WHO can see a team member changes — canViewMember() already
-- keys off manager_id directly (`target.manager_id === viewer.id`), never off
-- department. This migration only widens who is ELIGIBLE to be picked for
-- that manager_id link in the first place.
--
-- Run this by hand before deploying the code that depends on it.

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
  -- Every department this row belongs to, primary first — built once and
  -- shared by both branches below, exactly like the eligibility check 0061
  -- already runs for director_id.
  my_depts := coalesce(new.departments, '{}'::text[]);
  if my_dept is not null then
    my_depts := array[my_dept] || my_depts;
  end if;

  -- manager_id: the team member must belong to the department their head
  -- runs — reading the WHOLE department list (0060), same rule as director_id
  -- below. A candidate whose primary is elsewhere can still join once the
  -- manager's department is added to their list.
  if new.manager_id is not null then
    select nullif(btrim(managed_department), '') into head_dept
    from public.profiles where id = new.manager_id;
    if head_dept is null then
      raise exception 'Assigned manager does not head a department.';
    end if;
    if not (head_dept = any(my_depts)) then
      raise exception 'A team member must belong to their manager''s department (%) — add it to their departments first.', head_dept;
    end if;
  end if;

  -- director_id: the reporting line to a Director, and their scope (0061).
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

    if dir.dept is null or not (dir.dept = any(my_depts)) then
      raise exception 'A direct report must belong to their Director''s department (%) — add it to their departments first.', dir.dept;
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
