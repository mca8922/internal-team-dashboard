-- Push notification subscriptions.
--
-- One row per browser/device per user. Created when the member enables browser
-- push in Settings; deleted when they disable it or the subscription expires
-- (the server cleans up 410/404 responses automatically).

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

-- Members manage their own push subscriptions only.
drop policy if exists "push_subscriptions: own" on push_subscriptions;
create policy "push_subscriptions: own" on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
