-- Protect the Founder account at the database level (defense in depth).
--
-- The Founder is identified by their IMMUTABLE Supabase user id (never by
-- email, which the Founder can change at will). Board members manage everyone
-- else, but they must never be able to modify, demote, or offboard the Founder
-- by updating that row directly. The server actions already enforce this in
-- application code; this RLS policy closes the gap for any direct (RLS-scoped)
-- write a board client might attempt.
--
-- NOTE: keep this id in sync with FOUNDER_USER_ID in src/lib/roles.ts.

create or replace function public.row_is_founder(target uuid)
returns boolean
language sql
immutable
as $$
  select target = '85e2c7ac-9cea-4678-aae7-2aaeebe9ee84'::uuid;
$$;

-- Replace the profiles UPDATE policy: you may always edit your own row, and
-- board may edit everyone EXCEPT the Founder.
drop policy if exists "profiles: update self or board" on profiles;
create policy "profiles: update self or board" on profiles
  for update using (
    id = auth.uid()
    or (public.is_board() and not public.row_is_founder(id))
  );
