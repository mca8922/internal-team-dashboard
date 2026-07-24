-- reStrucAI - Department Apps (the Launchpad).
--
-- Each department has dedicated, independently-deployed tools its members use
-- (e.g. Social Media's alina-picks + alina-blake-travel-map). Rather than absorb
-- those apps into this codebase (which would kill their independent deploy
-- lifecycle), the dashboard acts as the hub that INDEXES and GATES them. A row
-- here is just a registered link: a name, a URL, and which department it belongs
-- to. Members see only their own department's apps (plus company-wide ones);
-- the Board curates the whole list (Manage > Apps).
--
-- This is Layer 1 of the launchpad. Shared identity (SSO) and optional in-shell
-- embedding build on this same registry later, without changing anything here.

create table if not exists public.department_apps (
  id          uuid primary key default gen_random_uuid(),
  -- The department this app belongs to (matches the `department` string on
  -- profiles/goals). NULL = company-wide, visible to everyone.
  department  text,
  name        text not null,
  description text not null default '',
  url         text not null,
  -- An Icon name (see components/Icon.tsx). Defaults to the generic monitor.
  icon        text not null default 'monitor',
  -- Lower sorts first within a department; ties break on name.
  sort_order  int  not null default 0,
  -- Hidden-but-kept apps stay registered without showing to members.
  is_active   boolean not null default true,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists department_apps_dept_idx
  on public.department_apps (department, sort_order, name);

alter table public.department_apps enable row level security;

-- Read: the Board sees every app (active or not, for management). Everyone else
-- sees only ACTIVE apps that are company-wide (department is null) or belong to
-- THEIR OWN department. The department lookup is a scalar subquery on the
-- caller's own profile row, which their own RLS already lets them read.
drop policy if exists "department_apps: read scoped" on public.department_apps;
create policy "department_apps: read scoped" on public.department_apps
  for select using (
    public.is_board()
    or (
      is_active = true
      and (
        department is null
        or department = (select p.department from public.profiles p where p.id = auth.uid())
      )
    )
  );

-- Only the Board may register / edit / remove apps.
drop policy if exists "department_apps: board insert" on public.department_apps;
create policy "department_apps: board insert" on public.department_apps
  for insert with check (public.is_board());

drop policy if exists "department_apps: board update" on public.department_apps;
create policy "department_apps: board update" on public.department_apps
  for update using (public.is_board());

drop policy if exists "department_apps: board delete" on public.department_apps;
create policy "department_apps: board delete" on public.department_apps
  for delete using (public.is_board());
