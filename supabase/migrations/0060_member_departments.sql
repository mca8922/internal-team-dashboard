-- reStrucAI — multi-department members.
--
-- A person used to belong to exactly ONE department (profiles.department).
-- People genuinely split their time across departments, so a member can now
-- carry several. This follows the shape migration 0038 gave goals rather than
-- inventing a second one: `profiles.department` STAYS as the PRIMARY / home
-- department and a new `departments` array holds every department the person
-- belongs to, with the primary always element 0.
--
-- IMPORTANT — this is a LABEL, not a permission.
--
-- Migration 0058 made the department the security boundary, and it still is:
-- can_view_user() / can_manage_user(), the punches/logs/leaves/change_requests
-- policies and the assert_hierarchy_consistent() trigger all keep reading the
-- single `department` column. A member's extra departments therefore widen
-- NOBODY's reach — not the member's, and not a Director's. A Director of
-- "Audit" does not gain sight of someone whose primary is "Tax" just because
-- "Audit" appears in their list. That is deliberate: multi-department was asked
-- for as grouping/reporting information, and silently turning a label into an
-- access grant is exactly the kind of thing 0058 set out to stop.
--
-- The same applies to a Director or a Manager: they may be LISTED under several
-- departments, but the one they direct/head is still their primary (0058's
-- "a Director never spans two" holds for scope).
--
-- Editing the list is Founder-only, matching every other structural change
-- (see 0058) — enforced in setMemberDepartments() and mirrored by the trigger
-- below so a raw API write cannot go around it.
--
-- Run this by hand before deploying the code that reads/writes `departments`.

-- ---------------------------------------------------------------------------
-- 1 — the new column, backfilled from the existing single department so every
--     current member spans exactly their own. Founders (blank department) get
--     an empty array: they sit under no department at all.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists departments text[] not null default '{}';

update public.profiles
  set departments = array[btrim(department)]
  where array_length(departments, 1) is null
    and nullif(btrim(department), '') is not null;

-- Finding "everyone in department X" (primary or additional) is a containment
-- lookup, which needs a GIN index to stay cheap as the roster grows.
create index if not exists profiles_departments_idx
  on public.profiles using gin (departments);

-- ---------------------------------------------------------------------------
-- 2 — keep the array and the primary column in agreement, always.
--
-- Every existing writer of `profiles.department` (updateMemberDepartment,
-- renameDepartment, setMemberAsManager, the account-creation path) predates
-- this column and knows nothing about it. Rather than hunt down each one and
-- hope no future one is missed, the invariant is enforced here:
--
--   * departments[0] is ALWAYS btrim(department)
--   * no blanks, no duplicates
--   * a blank department (the Founders) means an empty array
--
-- When `department` alone moves — a rename, or a Founder moving someone
-- between departments — the OLD primary is dropped rather than demoted to an
-- extra: the member left that department, they did not pick up a second one.
-- When the caller supplies `departments` itself, it is taken at face value
-- (minus normalisation), because then the intent is explicit.
-- ---------------------------------------------------------------------------
create or replace function public.sync_member_departments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  home     text := nullif(btrim(new.department), '');
  drop_old boolean := false;
  extras   text[];
begin
  if tg_op = 'UPDATE' then
    -- The caller changed `department` and left `departments` untouched, so the
    -- array is stale: the old home has to go, not slide into second place.
    drop_old := new.department is distinct from old.department
                and new.departments is not distinct from old.departments;

    -- Founder-only, mirroring setMemberDepartments(). auth.uid() is null under
    -- the service role (account creation, seed scripts, other triggers), which
    -- is trusted server-side code and is let through.
    if new.departments is distinct from old.departments
       and auth.uid() is not null
       and not public.is_founder() then
      raise exception 'Only a Founder can change which departments a member belongs to.';
    end if;
  end if;

  -- Normalise the extras: trimmed, non-blank, de-duplicated (first mention
  -- wins), never the primary itself, and never the department just left.
  select coalesce(array_agg(d order by ord), '{}')
    into extras
  from (
    select d, min(ord) as ord
    from (
      select btrim(x) as d, ord
      from unnest(coalesce(new.departments, '{}'::text[])) with ordinality as t(x, ord)
    ) z
    where nullif(z.d, '') is not null
      and z.d is distinct from home
      and not (drop_old and z.d = btrim(old.department))
    group by d
  ) s;

  new.departments := case when home is null then '{}'::text[] else array[home] || extras end;
  return new;
end;
$$;

drop trigger if exists profiles_sync_departments on public.profiles;
create trigger profiles_sync_departments
  before insert or update of department, departments on public.profiles
  for each row execute function public.sync_member_departments();

-- A TRIGGER function is never meant to be called directly; PostgREST exposing
-- it at /rpc/ is pure surface area (same treatment as 0058's trigger).
revoke execute on function public.sync_member_departments() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 — normalise the rows the backfill above created (and any Founder row that
--     still carries a stale array) by running every profile through the
--     trigger once.
-- ---------------------------------------------------------------------------
update public.profiles set department = department;
