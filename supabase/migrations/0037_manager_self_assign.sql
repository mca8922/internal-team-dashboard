-- reStrucAI — let a Department Manager assign a goal to THEMSELVES.
--
-- 0033 limited a Manager's goal_assignees insert to their Board-picked team
-- (manages_user(user_id)). A Manager heads a department but is not their own
-- "team member", so they could never put a goal on their own queue. The Board
-- wants Managers to assign goals to themselves as well as the team the Board
-- picks in the manage modal — so we widen the insert to also allow the caller
-- assigning their own id, still scoped to a goal in the department they head.
--
-- Self-assigned goals are ordinary department goals: the Board sees and manages
-- them like everything else (no special status).

drop policy if exists "goal_assignees: board insert" on goal_assignees;
create policy "goal_assignees: board insert" on goal_assignees
  for insert with check (
    public.is_board()
    or (
      public.is_manager()
      and (public.manages_user(user_id) or user_id = auth.uid())
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
  );
