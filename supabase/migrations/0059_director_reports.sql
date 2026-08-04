-- reStrucAI — direct reports to a Director.
--
-- 0058 made the DEPARTMENT the security boundary: a Director sees their whole
-- department and nothing else. That answers "who can this Director see?", but
-- not "who actually answers to them?" — every member of the department was
-- implicitly theirs, with no way to record an actual reporting line.
--
-- This adds `profiles.director_id`: on a member's row it points at the Director
-- they report to. It is a REPORTING record, not a permission — visibility is
-- still department-based, so no RLS policy changes here. A Director could
-- already see everyone in their department; this says which of them answer to
-- them directly.
--
--   Audit
--   └── Aditya Bohra (Director)
--         ├── Kabir Joshi (Manager)      director_id = Aditya
--         │     └── Priya S.             manager_id  = Kabir
--         └── Rahul M.                   director_id = Aditya, no manager
--
-- A person may hold BOTH links at once (a Manager's team member who is also a
-- Director's direct report). The two are independent by design — this is a
-- dotted-line org, not a strict tree — so nothing here forces them to agree
-- beyond both staying inside the one department.

-- ---------------------------------------------------------------------------
-- 1 — the column.
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists director_id uuid references profiles (id) on delete set null;

create index if not exists profiles_director_idx on profiles (director_id);

-- ---------------------------------------------------------------------------
-- 2 — consistency. Extends the 0058 trigger rather than adding a second one,
-- so every hierarchy rule is enforced in one place and fires on one pass.
--
-- Rules for director_id:
--   * the target must be an active Director (role='board', not a Founder)
--   * both rows must sit in the SAME department — a cross-department reporting
--     line would point out of the silo 0058 established
--   * a Director is not assigned to another Director, and nobody reports to
--     themselves; Founders report to no one
-- ---------------------------------------------------------------------------
create or replace function public.assert_hierarchy_consistent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  head_dept     text;
  dir           record;
  my_dept       text := nullif(btrim(new.department), '');
begin
  -- manager_id: the team member must belong to the department their head runs.
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

  -- director_id: the reporting line to a Director.
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

    select role, nullif(btrim(department), '') as dept, is_active
      into dir
    from public.profiles where id = new.director_id;

    if dir is null or dir.role <> 'board' or public.row_is_founder(new.director_id) then
      raise exception 'Direct reports can only be assigned to a Director.';
    end if;
    if my_dept is null or my_dept is distinct from dir.dept then
      raise exception 'A direct report must belong to the same department as their Director.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_hierarchy_consistent on profiles;
create trigger profiles_hierarchy_consistent
  before insert or update of manager_id, director_id, department, role on profiles
  for each row execute function public.assert_hierarchy_consistent();

revoke execute on function public.assert_hierarchy_consistent() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 — releasing a Director. When someone stops being a Director (demoted, or
-- moved to another department), the reports pointing at them would violate the
-- rules above on their next write. Detach them at the moment the Director
-- changes, so the org never holds a dangling line.
-- ---------------------------------------------------------------------------
create or replace function public.release_director_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'board'
     and (new.role <> 'board' or nullif(btrim(new.department), '')
          is distinct from nullif(btrim(old.department), ''))
  then
    update public.profiles set director_id = null where director_id = old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_release_director_reports on profiles;
create trigger profiles_release_director_reports
  after update of role, department on profiles
  for each row execute function public.release_director_reports();

revoke execute on function public.release_director_reports() from anon, authenticated;
