-- Adds a department tag to notifications so the bell + Notifications page can
-- group activity by department (Board view) and separate team vs personal
-- (Manager view). Goal-related notifications carry the goal's department;
-- leave / punch / Priya / milestone notifications stay null and fall under a
-- "Company / General" section in the UI.
--
-- NOTE: not auto-applied. Run once with `supabase db push` or paste into the
-- Supabase SQL editor (same as the other migrations in this folder).

alter table public.notifications
  add column if not exists department text;

-- Backfill existing goal-linked rows from their goal's department, so the new
-- sections are populated for history that predates this column.
update public.notifications n
   set department = g.department
  from public.goals g
 where n.goal_id = g.id
   and n.department is null;
