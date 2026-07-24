-- reStrucAI — two co-founders (Rajesh Bohra + Dharmesh Bohra) replace the
-- original single-founder model. row_is_founder() now checks membership in
-- a fixed set of two immutable Supabase user ids instead of equality against
-- one. Everything that already called row_is_founder(...) (the profiles
-- update policy from 0016, punch_change_requests policies from 0048) picks
-- this up automatically since Postgres re-evaluates the function body at
-- call time.
--
-- NOTE: keep these ids in sync with FOUNDER_USER_IDS in src/lib/roles.ts.
create or replace function public.row_is_founder(target uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select target = any (array[
    '21984019-ddda-42ac-9f10-191928c6c49e'::uuid, -- Rajesh Bohra
    '83d48348-eddf-4ec7-a72f-fdc1392beb59'::uuid  -- Dharmesh Bohra
  ]);
$$;
