-- reStrucAI — live data sync + read-path indexes.
--
-- Part 1 puts the core domain tables on the `supabase_realtime` publication
-- (only `notifications` was published before — see 0008). With these added,
-- a single client-side channel can listen for any insert/update/delete and
-- soft-refresh the open page, so every member sees changes within ~1s with
-- no manual reload. RLS still applies to Realtime, so a client only ever
-- receives rows it is already allowed to read.
--
-- Part 2 adds the indexes the read path needs but the initial schema missed.

-- ---------------------------------------------------------------------------
-- Part 1 — Realtime publication.
--
-- REPLICA IDENTITY FULL makes Postgres ship the whole old row on UPDATE/DELETE
-- so Realtime can evaluate RLS against it (without it, RLS-filtered UPDATE and
-- DELETE events are dropped). These tables are small, so the extra WAL is
-- negligible. The publication ADDs are guarded so the migration is re-runnable.
-- ---------------------------------------------------------------------------
alter table punches        replica identity full;
alter table goals          replica identity full;
alter table goal_assignees replica identity full;
alter table goal_checklist_items replica identity full;
alter table leaves         replica identity full;
alter table logs           replica identity full;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array[
    'punches', 'goals', 'goal_assignees', 'goal_checklist_items', 'leaves', 'logs'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Part 2 — read-path indexes.
--
-- leaves(status): the app layout and dashboard count pending requests on
--   every render. goals(parent_id): the goal tree is walked parent->child on
--   every goals/dashboard render. goal_assignees(goal_id): assignee lookups
--   per goal (a user_id index already exists from 0007).
-- ---------------------------------------------------------------------------
create index if not exists leaves_status_idx        on leaves (status);
create index if not exists goals_parent_idx         on goals (parent_id);
create index if not exists goal_assignees_goal_idx  on goal_assignees (goal_id);
