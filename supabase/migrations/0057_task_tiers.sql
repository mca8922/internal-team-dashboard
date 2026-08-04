-- Task tiers — restructure the cascade.
--
-- Before: Yearly → Monthly → Weekly → Daily
-- After:  Yearly → Half-Yearly → Quarterly → Monthly → Daily
--
-- The 'weekly' tier is dropped and two new tiers ('half_yearly', 'quarterly')
-- are inserted between Yearly and Monthly. Postgres can add enum values but
-- cannot drop one, so `goal_level` is rebuilt from scratch rather than patched.
--
-- Data: there is no production task data yet, so this drops every Weekly task
-- outright. `goals.parent_id` is ON DELETE SET NULL, so the Daily tasks that
-- hung under a Weekly one survive as unlinked rather than disappearing — the
-- Tasks page surfaces those in its "Unlinked Tasks" section.

-- ---------------------------------------------------------------------------
-- 1 — drop the tier that no longer exists.
-- ---------------------------------------------------------------------------
delete from public.goals where level = 'weekly';

-- ---------------------------------------------------------------------------
-- 2 — rebuild goal_level with the five-tier ladder, in cascade order.
--     Round-trip through text: an in-place `alter type ... rename`/`add value`
--     cannot express a removal, and the column is the type's only consumer.
-- ---------------------------------------------------------------------------
alter table public.goals alter column level type text;
drop type goal_level;
create type goal_level as enum ('yearly', 'half_yearly', 'quarterly', 'monthly', 'daily');
alter table public.goals
  alter column level type goal_level using level::goal_level;

-- ---------------------------------------------------------------------------
-- 3 — unlink tasks whose parent is no longer a legal parent tier.
--     Monthly used to hang directly off Yearly; it now hangs off Quarterly. Any
--     surviving Monthly → Yearly link would render as a broken branch, so cut it
--     and let the task show up under "Unlinked Tasks" to be re-parented by hand.
-- ---------------------------------------------------------------------------
update public.goals g
   set parent_id = null
  from public.goals p
 where g.parent_id = p.id
   and (g.level, p.level) not in (
     ('half_yearly', 'yearly'),
     ('quarterly',   'half_yearly'),
     ('monthly',     'quarterly'),
     ('daily',       'monthly')
   );

-- ---------------------------------------------------------------------------
-- 4 — goal_templates.level is plain text (not the enum), so stale 'weekly'
--     templates would stay in the shared library but no longer match any tier.
--     Weekly was the lowest non-Daily tier; Monthly holds that slot now.
-- ---------------------------------------------------------------------------
update public.goal_templates set level = 'monthly' where level = 'weekly';

-- goal_saved_views needs no fixup: GoalViewConfig filters by department, status
-- and due window, never by tier.
