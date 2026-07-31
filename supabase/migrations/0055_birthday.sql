-- Date of birth on profiles, plus a birthday_wishes table so teammates can
-- post a wish on someone's birthday and the birthday person can reply.

alter table profiles add column if not exists date_of_birth date;

create table if not exists birthday_wishes (
  id                uuid primary key default gen_random_uuid(),
  birthday_user_id  uuid not null references profiles (id) on delete cascade,
  author_id         uuid not null references profiles (id) on delete cascade,
  message           text not null,
  parent_id         uuid references birthday_wishes (id) on delete cascade,
  created_at        timestamptz not null default now()
);
create index if not exists birthday_wishes_bday_idx on birthday_wishes (birthday_user_id, created_at);

alter table birthday_wishes enable row level security;

-- Everyone can see the company's birthday wishes (company-wide celebration).
drop policy if exists "birthday_wishes: read all authenticated" on birthday_wishes;
create policy "birthday_wishes: read all authenticated" on birthday_wishes
  for select using (auth.role() = 'authenticated');

-- A member may only post as themselves; the postBirthdayWish server action
-- additionally verifies it's actually that person's birthday today and that
-- only the birthday person may reply to a wish.
drop policy if exists "birthday_wishes: insert own" on birthday_wishes;
create policy "birthday_wishes: insert own" on birthday_wishes
  for insert with check (author_id = auth.uid());

-- Realtime — same guarded pattern as notifications (0008_notifications.sql).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'birthday_wishes'
  ) then
    alter publication supabase_realtime add table birthday_wishes;
  end if;
end $$;
