-- ---------------------------------------------------------------------------
-- 0068 — goals.progress becomes a COMPLETION tally, and it is finally correct.
--
-- Three bugs, one function. `recompute_goal_progress` (0013, rewritten in 0064)
-- counted only what was due TODAY, and counted it wrong:
--
--   1. On a task with NO assignees it took `greatest(count(*), 1)` as the
--      person multiplier and then counted raw completion ROWS. Two members
--      ticking the same step counted twice, so a task could read 100% with
--      items nobody had touched. Now each item counts ONCE, done if any
--      teammate completed it — deduplicated per item.
--   2. It only ever described today. A task whose steps were all finished last
--      week recomputed to 0%, and past its due date the card had nothing left
--      to show, which is where the "0/0 0%" headers came from. The tally now
--      covers the WHOLE checklist and every completion ever recorded, so it is
--      a statement about the task rather than about the calendar day.
--   3. Nothing said whether a task had a checklist at all, so a status could
--      not be derived from it without loading the checklist. `checklist_units`
--      now carries the denominator: 0 means "nothing to measure", i.e. the
--      task keeps its manual progress slider and its manual status.
--
-- The denominator is unchanged in shape from 0064 — each assignee owes the
-- shared steps plus their own personal ones:
--
--   units = (shared items) × (assignees) + (personal items owned by an assignee)
--
-- Mirrored on the client by computeGoalProgress() in src/lib/goal-progress.ts
-- (its `completionPct`) and read by deriveGoalStatus() in goals/goal-ui.ts —
-- keep all three in step.
-- ---------------------------------------------------------------------------

alter table goals
  add column if not exists checklist_units int not null default 0;

comment on column goals.checklist_units is
  'Units of work the checklist is worth: (shared items x assignees) + personal items, or the shared item count when the task has no assignees. 0 = no checklist, so progress and status are manual. Maintained by recompute_goal_progress().';

create or replace function public.recompute_goal_progress(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_people   int;
  v_shared   int;
  v_personal int;
  v_total    int;
  v_done     int;
begin
  select count(*) into v_people
    from goal_assignees where goal_id = p_goal_id;

  select count(*) into v_shared
    from goal_checklist_items ci
    where ci.goal_id = p_goal_id and ci.owner_id is null;

  -- Personal steps count once, for their owner, and only while that owner is
  -- still on the task (an unassigned member's leftovers count for nobody).
  select count(*) into v_personal
    from goal_checklist_items ci
    where ci.goal_id = p_goal_id
      and ci.owner_id is not null
      and exists (
        select 1 from goal_assignees ga
        where ga.goal_id = p_goal_id and ga.user_id = ci.owner_id
      );

  if v_people > 0 then
    -- Assignee-scoped: one unit per (assignee, item they owe).
    v_total := v_shared * v_people + v_personal;

    select count(*) into v_done
      from goal_checklist_completions cc
      join goal_checklist_items ci on ci.id = cc.item_id
      join goal_assignees ga
        on ga.goal_id = p_goal_id and ga.user_id = cc.user_id
      where ci.goal_id = p_goal_id
        -- A personal item only ever counts for the member who owns it.
        and (ci.owner_id is null or ci.owner_id = cc.user_id);
  else
    -- No assignees (a department task): one unit per SHARED item, done if any
    -- teammate completed it. `exists` is the dedup — two people ticking the
    -- same step is still one step done, which is what 0064 got wrong.
    -- Personal steps have nobody to attribute them to, so they sit this out.
    v_total := v_shared;

    select count(*) into v_done
      from goal_checklist_items ci
      where ci.goal_id = p_goal_id
        and ci.owner_id is null
        and exists (
          select 1 from goal_checklist_completions cc where cc.item_id = ci.id
        );
  end if;

  if v_total > 0 then
    update goals
      set progress = least(100, round(v_done::numeric * 100 / v_total)::int),
          checklist_units = v_total
      where id = p_goal_id;
  else
    -- No checklist to measure: leave `progress` alone (it is the Board's manual
    -- slider) and record that there is nothing behind it.
    update goals set checklist_units = 0 where id = p_goal_id and checklist_units <> 0;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- One-time backfill: every existing task carries a progress computed by the old
-- rules (and no checklist_units at all), so recompute the lot once. Archived
-- tasks included — they are restorable, and a restored task should not come
-- back with a stale number.
-- ---------------------------------------------------------------------------
do $$
declare
  g record;
begin
  for g in select id from goals loop
    perform public.recompute_goal_progress(g.id);
  end loop;
end;
$$;
