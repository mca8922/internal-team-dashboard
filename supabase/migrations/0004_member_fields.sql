-- reStrucAI — per-member target hours, avatar, and offboarding support.

-- ---------------------------------------------------------------------------
-- profiles: new columns
-- ---------------------------------------------------------------------------
alter table profiles
  -- Board-set daily target hours. NULL means "use the role default"
  -- (8h for board/fte/intern, 4h for pte).
  add column if not exists daily_target_hours numeric,
  -- Public URL of the member's avatar in the `avatars` storage bucket.
  add column if not exists avatar_url text,
  -- When set, the member has left the org: hidden by default, login blocked.
  add column if not exists left_at timestamptz;

-- ---------------------------------------------------------------------------
-- avatars storage bucket — public read, owner-scoped write.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone may view avatars (the bucket is public).
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');

-- A user may upload/replace/delete only files under their own user-id folder
-- (path convention: `<auth.uid()>/avatar.<ext>`).
drop policy if exists "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
