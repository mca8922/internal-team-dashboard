-- reStrucAI Team Dashboard — auto-provision a profile row on signup.
--
-- The register form passes name / role / department in the signUp options
-- `data` payload; Supabase stores it in auth.users.raw_user_meta_data.
-- This trigger copies it into public.profiles so the app always has a
-- profile row to read immediately after sign-up.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, department)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'fte'),
    coalesce(new.raw_user_meta_data ->> 'department', 'General')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
