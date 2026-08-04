-- reStrucAI — department-scoped hierarchy.
--
-- Before this migration the org was flat above the department line: every
-- `role = 'board'` account (a "Director") could see and manage every person in
-- the company, and `department` was nothing but a grouping label.
--
-- From here the chain is four levels deep and the DEPARTMENT is the security
-- boundary:
--
--   Founder (no department, sees everything, assigns everything)
--     └── Department
--           └── Director        — role='board', profiles.department = the one
--           │                     department they direct
--                 └── Manager   — is_manager + managed_department
--                       └── Staff (fte / pte / intern)
--
-- Rules encoded here:
--   * A Director sees only the people of their OWN department (its managers and
--     its staff) — never another department's directors, managers or staff.
--   * Several Directors may share one department; a Director never spans two
--     (they have exactly one `department` value).
--   * A department with NO Director is covered by the Founders alone.
--   * The Founders sit under no department. Their `department` is set to the
--     empty string here, and every scope check below treats blank as "matches
--     nothing" — so an unassigned person is never silently exposed to a peer.
--     The Founders' reach comes from is_founder(), not from a department.
--
-- Scope: this migration silos PEOPLE and the data owned by a person (profiles,
-- punches, logs, leaves). Company-wide records that belong to no one — goals,
-- holidays, company mission — keep their existing read rules.

-- ---------------------------------------------------------------------------
-- 1 — the Founders belong to no department.
-- `department` stays NOT NULL; the empty string is the "no department" value
-- and is deliberately never equal to another blank under the helpers below.
-- ---------------------------------------------------------------------------
update profiles set department = '' where public.row_is_founder(id);

-- ---------------------------------------------------------------------------
-- 2 — SECURITY DEFINER scope helpers. DEFINER so a policy on `profiles` can
-- read `profiles` without recursively triggering its own RLS.
-- ---------------------------------------------------------------------------

-- True when the caller is one of the Founders (immutable user ids, see 0049).
create or replace function public.is_founder()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.row_is_founder(auth.uid());
$$;

-- The department the caller belongs to. NULL when they are a Founder or the
-- field is blank — NULL never equals NULL in the comparisons below, so an
-- unassigned account matches nobody rather than matching every other blank.
create or replace function public.my_department()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select nullif(btrim(department), '') from public.profiles where id = auth.uid();
$$;

-- True when the caller is a Director: board-level, but not a Founder. A
-- Founder is board-level too, yet their power comes from is_founder() and is
-- not department-bound, so they are excluded here on purpose.
create or replace function public.is_director()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_board() and not public.row_is_founder(auth.uid());
$$;

-- True when `target` sits in the same department as the caller. Blank on
-- either side is a non-match (see my_department()).
create or replace function public.same_department(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target
      and nullif(btrim(p.department), '') is not null
      and nullif(btrim(p.department), '') = public.my_department()
  );
$$;

-- The single read predicate for "may the caller see this person?".
--   * Founders see everyone.
--   * Everyone sees themselves.
--   * A Director sees their own department only.
--   * A Manager keeps the team read granted in 0033.
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
    or (public.is_director() and public.same_department(target))
    or public.manages_user(target);
$$;

-- The write predicate for "may the caller edit this person's row?". Narrower
-- than can_view_user: Managers get no write power (they raise change requests
-- instead, see 0034) and the Founder rows stay frozen against everyone but
-- their own owner.
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
      or (public.is_director() and public.same_department(target))
    );
$$;

-- ---------------------------------------------------------------------------
-- 3 — profiles: replace the flat board-wide read/write with the scoped ones.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: read self or board" on profiles;
create policy "profiles: read self or board" on profiles
  for select using (public.can_view_user(id));

-- 0016 let any board member edit any non-Founder row. Now a Director may only
-- edit their own department; the Founders may edit anyone but each other.
drop policy if exists "profiles: update self or board" on profiles;
create policy "profiles: update self or board" on profiles
  for update using (
    id = auth.uid() or public.can_manage_user(id)
  );

-- ---------------------------------------------------------------------------
-- 4 — punches / logs / leaves follow the person they belong to.
-- ---------------------------------------------------------------------------
drop policy if exists "punches: read own or board" on punches;
create policy "punches: read own or board" on punches
  for select using (public.can_view_user(user_id));

drop policy if exists "punches: delete own or board" on punches;
create policy "punches: delete own or board" on punches
  for delete using (
    user_id = auth.uid() or public.can_manage_user(user_id)
  );

-- Logs stay Board-tier only — a Manager never sees their team's daily logs
-- (0033), so this uses the director predicate directly rather than
-- can_view_user().
drop policy if exists "logs: read own or board" on logs;
create policy "logs: read own or board" on logs
  for select using (
    user_id = auth.uid()
    or public.is_founder()
    or (public.is_director() and public.same_department(user_id))
  );

drop policy if exists "leaves: read own or board" on leaves;
create policy "leaves: read own or board" on leaves
  for select using (
    user_id = auth.uid()
    or public.is_founder()
    or (public.is_director() and public.same_department(user_id))
  );

-- A Director reviews only their own department's leave; 0054 already blocks
-- reviewing your own request, and that check is preserved here.
drop policy if exists "leaves: update own pending or board" on leaves;
create policy "leaves: update own pending or board" on leaves
  for update using (
    (user_id = auth.uid() and status = 'pending')
    or (
      user_id <> auth.uid()
      and (
        public.is_founder()
        or (public.is_director() and public.same_department(user_id))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5 — change requests (0034): a Manager raises these for their own team; the
-- Board reviews them. A Director must only ever see and review the ones about
-- their OWN department's people, so both policies move onto can_view_user /
-- can_manage_user rather than the flat is_board().
-- ---------------------------------------------------------------------------
drop policy if exists "change requests: read board or own" on public.change_requests;
create policy "change requests: read board or own" on public.change_requests
  for select using (
    manager_id = auth.uid() or public.can_view_user(member_id)
  );

drop policy if exists "change requests: board update" on public.change_requests;
create policy "change requests: board update" on public.change_requests
  for update using (public.can_manage_user(member_id));

-- ---------------------------------------------------------------------------
-- 6 — a Manager's team must stay inside the department they head, and a
-- Director's department is the scope they were given. Guard both at the DB
-- level so a stray write cannot build a cross-department link.
-- ---------------------------------------------------------------------------
create or replace function public.assert_hierarchy_consistent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  head_dept text;
begin
  if new.manager_id is not null then
    select nullif(btrim(managed_department), '') into head_dept
    from public.profiles where id = new.manager_id;
    if head_dept is null then
      raise exception 'Assigned manager does not head a department.';
    end if;
    if nullif(btrim(new.department), '') is distinct from head_dept then
      raise exception 'A team member must belong to the department their manager heads.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_hierarchy_consistent on profiles;
create trigger profiles_hierarchy_consistent
  before insert or update of manager_id, department on profiles
  for each row execute function public.assert_hierarchy_consistent();

-- It is a TRIGGER function; it is never meant to be invoked directly, and
-- PostgREST exposing it at /rpc/ is pure surface area.
revoke execute on function public.assert_hierarchy_consistent() from anon, authenticated;
