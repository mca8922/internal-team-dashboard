-- Rework birthday_wishes so a wish's MESSAGE TEXT is private between the
-- sender and the celebrant it was addressed to — everyone else may only ever
-- learn WHO wished, never what was said. A reply is now a pair of columns on
-- the same row (the celebrant replies to their own wish-thread) rather than a
-- separate child row.
--
-- RLS on the base table restricts SELECT to the sender or the celebrant, so
-- the message/reply text can never reach a bystander's browser. A
-- SECURITY DEFINER function (same pattern as is_board/is_manager/etc. in
-- 0002_rls.sql) exposes just the non-sensitive "who wished, and were they
-- replied to" facts to everyone, for the "Already wished" chip list.

alter table birthday_wishes drop column if exists parent_id;
alter table birthday_wishes add column if not exists reply_message text;
alter table birthday_wishes add column if not exists reply_created_at timestamptz;

drop policy if exists "birthday_wishes: read all authenticated" on birthday_wishes;
drop policy if exists "birthday_wishes: insert own" on birthday_wishes;
drop policy if exists "birthday_wishes: read own sent or own received" on birthday_wishes;
drop policy if exists "birthday_wishes: celebrant replies" on birthday_wishes;

-- Only the sender can read their own wish's full row; only the celebrant can
-- read the full rows of wishes addressed to them (both need the message).
create policy "birthday_wishes: read own sent or own received" on birthday_wishes
  for select using (author_id = auth.uid() or birthday_user_id = auth.uid());

create policy "birthday_wishes: insert own" on birthday_wishes
  for insert with check (author_id = auth.uid());

-- A reply is the celebrant updating their own reply_message/reply_created_at
-- on a wish addressed to them. postBirthdayWish's replacement
-- (replyToBirthdayWish) is the real gate on WHICH columns get touched; this
-- policy just scopes the row.
create policy "birthday_wishes: celebrant replies" on birthday_wishes
  for update using (birthday_user_id = auth.uid()) with check (birthday_user_id = auth.uid());

create or replace function public.birthday_wishers(targets uuid[])
returns table (
  id uuid,
  birthday_user_id uuid,
  author_id uuid,
  created_at timestamptz,
  has_reply boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select id, birthday_user_id, author_id, created_at, (reply_message is not null) as has_reply
  from birthday_wishes
  where birthday_user_id = any(targets)
  order by created_at asc;
$$;

grant execute on function public.birthday_wishers(uuid[]) to authenticated;

-- The UI no longer relies on client-side Realtime for this table (data is
-- reshaped per-viewer server-side to protect message privacy; the UI
-- refreshes via router.refresh() after sending). Drop it from the realtime
-- publication so a future subscriber can't inadvertently receive full rows
-- Realtime's postgres_changes doesn't RLS-filter by default.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'birthday_wishes'
  ) then
    alter publication supabase_realtime drop table birthday_wishes;
  end if;
end $$;
