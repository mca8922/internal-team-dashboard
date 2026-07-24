-- reStrucAI Team Dashboard — Row Level Security
--
-- Role model (mirrors the prototype FEATURES map):
--   * board  — sees and manages everything
--   * others — see only their own punches / logs / leaves
-- Goals, holidays and company are readable by all authenticated users;
-- only board may write them.

-- ---------------------------------------------------------------------------
-- is_board() — SECURITY DEFINER so a policy on `profiles` can check the
-- caller's role without recursively triggering profiles' own RLS.
-- ---------------------------------------------------------------------------
create or replace function public.is_board()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'board'
  );
$$;

alter table profiles enable row level security;
alter table punches  enable row level security;
alter table logs     enable row level security;
alter table goals    enable row level security;
alter table leaves   enable row level security;
alter table holidays enable row level security;
alter table company  enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles: read self or board" on profiles
  for select using (id = auth.uid() or public.is_board());

create policy "profiles: insert self" on profiles
  for insert with check (id = auth.uid());

create policy "profiles: update self or board" on profiles
  for update using (id = auth.uid() or public.is_board());

-- ---------------------------------------------------------------------------
-- punches
-- ---------------------------------------------------------------------------
create policy "punches: read own or board" on punches
  for select using (user_id = auth.uid() or public.is_board());

create policy "punches: write own" on punches
  for insert with check (user_id = auth.uid());

create policy "punches: update own" on punches
  for update using (user_id = auth.uid());

create policy "punches: delete own or board" on punches
  for delete using (user_id = auth.uid() or public.is_board());

-- ---------------------------------------------------------------------------
-- logs
-- ---------------------------------------------------------------------------
create policy "logs: read own or board" on logs
  for select using (user_id = auth.uid() or public.is_board());

create policy "logs: write own" on logs
  for insert with check (user_id = auth.uid());

create policy "logs: update own" on logs
  for update using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- goals — everyone reads, board writes
-- ---------------------------------------------------------------------------
create policy "goals: read all authenticated" on goals
  for select using (auth.role() = 'authenticated');

create policy "goals: board insert" on goals
  for insert with check (public.is_board());

create policy "goals: board update" on goals
  for update using (public.is_board());

create policy "goals: board delete" on goals
  for delete using (public.is_board());

-- ---------------------------------------------------------------------------
-- leaves — owner manages own requests, board reviews all
-- ---------------------------------------------------------------------------
create policy "leaves: read own or board" on leaves
  for select using (user_id = auth.uid() or public.is_board());

create policy "leaves: insert own" on leaves
  for insert with check (user_id = auth.uid());

-- owner may edit a still-pending request; board may review any.
create policy "leaves: update own pending or board" on leaves
  for update using (
    (user_id = auth.uid() and status = 'pending') or public.is_board()
  );

-- ---------------------------------------------------------------------------
-- holidays — everyone reads, board writes
-- ---------------------------------------------------------------------------
create policy "holidays: read all authenticated" on holidays
  for select using (auth.role() = 'authenticated');

create policy "holidays: board insert" on holidays
  for insert with check (public.is_board());

create policy "holidays: board delete" on holidays
  for delete using (public.is_board());

-- ---------------------------------------------------------------------------
-- company — everyone reads, board writes
-- ---------------------------------------------------------------------------
create policy "company: read all authenticated" on company
  for select using (auth.role() = 'authenticated');

create policy "company: board update" on company
  for update using (public.is_board());
