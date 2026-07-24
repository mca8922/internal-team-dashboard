-- reStrucAI — per-user, per-type notification preferences.
--
-- Lets each member silence notification types they don't want, independently per
-- channel: the in-app bell and web-push. Opt-out model — a MISSING row means
-- both channels are on, so the table only ever holds a member's explicit mutes
-- and new notification types are enabled by default with no backfill.
--
--   • in_app — show in the bell + Notifications page (filtered in getNotifications
--              and skipped by the bell's realtime handler).
--   • push   — send a web-push (filtered centrally in lib/push.ts sendPush).
--
-- Private to each user: every policy is scoped to auth.uid(). No realtime.

create table if not exists public.notification_prefs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  type    text not null,
  in_app  boolean not null default true,
  push    boolean not null default true,
  primary key (user_id, type)
);
create index if not exists notification_prefs_user_idx
  on public.notification_prefs (user_id);

alter table public.notification_prefs enable row level security;

drop policy if exists "notification prefs: owner all" on public.notification_prefs;
create policy "notification prefs: owner all" on public.notification_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
