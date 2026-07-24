-- reStrucAI — per-person goal assignment + department lock-down.

-- ---------------------------------------------------------------------------
-- goal_assignees — which members a goal is explicitly assigned to.
-- A member sees a goal if it is assigned to them OR tagged to their dept.
-- ---------------------------------------------------------------------------
create table if not exists goal_assignees (
  goal_id uuid not null references goals (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (goal_id, user_id)
);
create index if not exists goal_assignees_user_idx on goal_assignees (user_id);

alter table goal_assignees enable row level security;

-- Everyone authenticated may read assignments (the app filters per user).
drop policy if exists "goal_assignees: read all" on goal_assignees;
create policy "goal_assignees: read all" on goal_assignees
  for select using (auth.role() = 'authenticated');

-- Only the Board may assign / unassign.
drop policy if exists "goal_assignees: board insert" on goal_assignees;
create policy "goal_assignees: board insert" on goal_assignees
  for insert with check (public.is_board());

drop policy if exists "goal_assignees: board delete" on goal_assignees;
create policy "goal_assignees: board delete" on goal_assignees
  for delete using (public.is_board());

-- ---------------------------------------------------------------------------
-- Department / role lock-down.
--
-- The original 0002 policy let a member update their own profile row freely,
-- so they could change their own department or role. Replace it: a member may
-- update their own row ONLY if department and role stay unchanged. The Board
-- may still change anything.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: update self or board" on profiles;
create policy "profiles: update self or board" on profiles
  for update
  using (id = auth.uid() or public.is_board())
  with check (
    public.is_board()
    or (
      id = auth.uid()
      and department = (select p.department from public.profiles p where p.id = auth.uid())
      and role = (select p.role from public.profiles p where p.id = auth.uid())
    )
  );
