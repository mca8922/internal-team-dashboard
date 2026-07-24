-- reStrucAI — checklist completion is for ASSIGNEES only.
--
-- The board edits/oversees goals; it does not do the work. Previously
-- toggle_checklist_item() let any board member (and any same-department member)
-- tick an item, so a board member's ticks were recorded even though they are
-- not assigned — making the goal read differently for different people.
--
-- New rule, matching the per-person UI exactly:
--   • If the goal has explicit assignees → only those assignees may tick.
--   • If the goal has NO assignees → any member of its department may tick
--     (the shared "department goal" fallback).
--   • Board membership grants NO tick rights on its own — a board member must
--     be an assignee (or in the department of an unassigned goal) to tick.

create or replace function public.toggle_checklist_item(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_goal_id      uuid;
  v_has_assignee boolean;
  v_can          boolean;
begin
  select goal_id into v_goal_id from goal_checklist_items where id = p_item_id;
  if v_goal_id is null then
    raise exception 'Checklist item not found';
  end if;

  select exists (select 1 from goal_assignees where goal_id = v_goal_id)
    into v_has_assignee;

  if v_has_assignee then
    -- Only the named assignees may complete this goal's checklist.
    select exists (
      select 1 from goal_assignees
      where goal_id = v_goal_id and user_id = v_uid
    ) into v_can;
  else
    -- Unassigned (department) goal: any member of its department may tick.
    select (
      (select department from goals where id = v_goal_id)
      = (select department from profiles where id = v_uid)
    ) into v_can;
  end if;

  if not v_can then
    raise exception 'Only members assigned to this goal can complete its checklist';
  end if;

  if p_done then
    insert into goal_checklist_completions (item_id, user_id, done_at)
    values (p_item_id, v_uid, now())
    on conflict (item_id, user_id) do update set done_at = now();
  else
    delete from goal_checklist_completions
    where item_id = p_item_id and user_id = v_uid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clean up the stray completions already recorded by non-assignees (e.g. a
-- board member ticking a goal they only oversee). Only rows on goals that DO
-- have assignees are removed; genuine department-goal ticks are kept. The
-- completion trigger recomputes each affected goal's progress automatically.
-- ---------------------------------------------------------------------------
delete from goal_checklist_completions cc
using goal_checklist_items ci
where ci.id = cc.item_id
  and exists (select 1 from goal_assignees ga where ga.goal_id = ci.goal_id)
  and not exists (
    select 1 from goal_assignees ga2
    where ga2.goal_id = ci.goal_id and ga2.user_id = cc.user_id
  );
