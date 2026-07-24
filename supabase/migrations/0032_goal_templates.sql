-- reStrucAI — shared goal templates (blueprints).
--
-- Goal templates were previously stored per-browser in localStorage, so a
-- template one Board Member saved was invisible to the others. This moves them
-- into the database so every Board Member shares the same library.
--
-- A template is a reusable goal shape: its tier, department, title, description
-- and checklist (stored as JSON, mirroring the goal form's checklist rows —
-- including each item's recurrence and "Report Work" flag).

create table if not exists public.goal_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  level       text not null,
  department  text not null default '',
  title       text not null default '',
  description text not null default '',
  checklist   jsonb not null default '[]'::jsonb,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists goal_templates_created_idx
  on public.goal_templates (created_at desc);

alter table public.goal_templates enable row level security;

-- Everyone authenticated may read templates (the library is shared).
drop policy if exists "goal templates: read all" on public.goal_templates;
create policy "goal templates: read all" on public.goal_templates
  for select using (auth.role() = 'authenticated');

-- Only the Board may create / edit / remove templates.
drop policy if exists "goal templates: board insert" on public.goal_templates;
create policy "goal templates: board insert" on public.goal_templates
  for insert with check (public.is_board());

drop policy if exists "goal templates: board update" on public.goal_templates;
create policy "goal templates: board update" on public.goal_templates
  for update using (public.is_board());

drop policy if exists "goal templates: board delete" on public.goal_templates;
create policy "goal templates: board delete" on public.goal_templates
  for delete using (public.is_board());

-- Realtime so a template saved by one Board Member appears for the others live.
alter table public.goal_templates replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'goal_templates'
  ) then
    execute 'alter publication supabase_realtime add table goal_templates';
  end if;
end $$;
