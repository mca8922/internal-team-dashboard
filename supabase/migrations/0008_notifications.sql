-- reStrucAI — real-time goal-assignment notifications.
--
-- A `notifications` row is created for a member each time the Board assigns
-- them to a goal. The table is added to the `supabase_realtime` publication
-- so the dashboard can subscribe to INSERTs and surface them live in the
-- notifications bell — no page refresh needed.

-- ---------------------------------------------------------------------------
-- notifications — one row per delivered notification.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  type        text not null default 'goal_assigned',
  title       text not null,
  body        text not null default '',
  href        text not null default '',
  goal_id     uuid references goals (id) on delete cascade,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on notifications (user_id, created_at desc);

alter table notifications enable row level security;

-- A member reads ONLY their own notifications. Realtime reuses this policy,
-- so a subscribed client can never receive another member's rows.
drop policy if exists "notifications: read own" on notifications;
create policy "notifications: read own" on notifications
  for select using (user_id = auth.uid());

-- Only the Board creates notifications (when assigning goals). is_board() in
-- the WITH CHECK lets a board member write a row for ANY member.
drop policy if exists "notifications: board insert" on notifications;
create policy "notifications: board insert" on notifications
  for insert with check (public.is_board());

-- A member may update their own notifications (mark them read).
drop policy if exists "notifications: update own" on notifications;
create policy "notifications: update own" on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A member may delete (dismiss) their own notifications.
drop policy if exists "notifications: delete own" on notifications;
create policy "notifications: delete own" on notifications
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime — add the table to the `supabase_realtime` publication so INSERTs
-- are streamed to subscribed clients. Guarded so this migration is safe to
-- re-run: ALTER PUBLICATION ... ADD TABLE errors if the table is already in
-- the publication.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
