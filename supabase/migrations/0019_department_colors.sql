-- Department accent colours.
--
-- Departments are still the distinct `department` string carried by each
-- profile and goal — this table only stores the colour the Board dedicates to
-- each one (Manage › Departments). The colour is a hex string used as an accent
-- across the app; it is rendered with low-opacity tints so it reads in both the
-- light and dark themes.

create table if not exists public.departments (
  name       text primary key,
  color      text not null default '#288A5D',
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;

-- Everyone authenticated can read the colour map (it styles team views).
create policy "departments: read all authenticated" on public.departments
  for select using (auth.role() = 'authenticated');

-- Only the Board may add / recolour / remove departments.
create policy "departments: board insert" on public.departments
  for insert with check (public.is_board());

create policy "departments: board update" on public.departments
  for update using (public.is_board());

create policy "departments: board delete" on public.departments
  for delete using (public.is_board());

-- Seed a row for every department already in use so the manager lists them all.
insert into public.departments (name)
  select distinct trim(department)
  from public.profiles
  where coalesce(trim(department), '') <> ''
on conflict (name) do nothing;
