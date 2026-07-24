-- reStrucAI — per-user Goals navigation preferences.
--
-- As the number of goals grows, the Goals page gains a scannable Table view plus
-- power tools (pinned favourites, saved views). Both are PER-USER and follow the
-- user across devices, so they live in the database rather than localStorage.
--
--   • goal_pins        — the handful of goals a user keeps at the top.
--   • goal_saved_views — named filter/sort/grouping presets (config as JSON,
--                        mirroring the GoalViewConfig shape in src/lib/types.ts).
--
-- Unlike goal_templates (shared, Board-managed), these are private to each user:
-- every policy is scoped to auth.uid(). No realtime — single-user data.

-- ── Pinned goals ────────────────────────────────────────────────────────────
create table if not exists public.goal_pins (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  goal_id    uuid not null references public.goals (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, goal_id)
);
create index if not exists goal_pins_user_idx on public.goal_pins (user_id);

alter table public.goal_pins enable row level security;

drop policy if exists "goal pins: owner all" on public.goal_pins;
create policy "goal pins: owner all" on public.goal_pins
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Saved views ─────────────────────────────────────────────────────────────
create table if not exists public.goal_saved_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists goal_saved_views_user_idx
  on public.goal_saved_views (user_id, created_at desc);

alter table public.goal_saved_views enable row level security;

drop policy if exists "goal saved views: owner all" on public.goal_saved_views;
create policy "goal saved views: owner all" on public.goal_saved_views
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
