-- reStrucAI — recurring checklist items.
--
-- A checklist item can repeat (daily / weekdays / weekly / monthly / yearly)
-- so members see what is expected on an ongoing cadence. A recurring item
-- counts as "done" only while it was last completed within its current
-- period — no reset job is needed, the progress trigger below derives it
-- from done_at.

alter table goal_checklist_items
  add column if not exists recurrence text not null default 'once';

-- ---------------------------------------------------------------------------
-- sync_goal_progress — recomputed to be period-aware. A one-time item counts
-- once done; a recurring item counts only while done_at falls inside the
-- current day / week / month / year.
-- ---------------------------------------------------------------------------
create or replace function public.sync_goal_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_goal_id uuid := coalesce(new.goal_id, old.goal_id);
  v_total   int;
  v_done    int;
begin
  select
    count(*),
    count(*) filter (
      where is_done and (
        recurrence = 'once'
        or (recurrence in ('daily', 'weekdays') and done_at >= date_trunc('day',   now()))
        or (recurrence = 'weekly'               and done_at >= date_trunc('week',  now()))
        or (recurrence = 'monthly'              and done_at >= date_trunc('month', now()))
        or (recurrence = 'yearly'               and done_at >= date_trunc('year',  now()))
      )
    )
    into v_total, v_done
    from goal_checklist_items
    where goal_id = v_goal_id;

  if v_total > 0 then
    update goals
    set progress = round(v_done::numeric * 100 / v_total)::int
    where id = v_goal_id;
  end if;

  return null;
end;
$$;
