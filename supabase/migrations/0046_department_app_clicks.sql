-- reStrucAI - App click tracking for the Launchpad analytics.
--
-- When a member opens an app tile, a row is written here. The Board reads
-- these via the App Analytics section at the bottom of the Apps page.
-- Members only ever see/affect their own rows; the Board sees everything.

create table if not exists public.department_app_clicks (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid not null references public.department_apps (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  clicked_at timestamptz not null default now()
);

-- Analytics queries filter by time window and group by app.
create index if not exists department_app_clicks_app_time_idx
  on public.department_app_clicks (app_id, clicked_at desc);

-- Future per-member self-view.
create index if not exists department_app_clicks_user_idx
  on public.department_app_clicks (user_id, clicked_at desc);

alter table public.department_app_clicks enable row level security;

-- Everyone may insert their own clicks (no faking another user's id).
create policy "app_clicks: insert own" on public.department_app_clicks
  for insert with check (user_id = auth.uid());

-- Members read their own rows; Board reads all.
create policy "app_clicks: read self or board" on public.department_app_clicks
  for select using (user_id = auth.uid() or public.is_board());
