-- reStrucAI — re-assert Goals v2 live-sync wiring (idempotent).
--
-- If 0012 applied cleanly this is a no-op. It exists because a partial apply of
-- 0012 (e.g. the SQL editor stopping at an error after the completions table was
-- already created) can leave the progress TRIGGERS or the Realtime PUBLICATION
-- membership missing — which is exactly what makes one member's checklist ticks
-- fail to appear live on another member's screen. Re-running this is safe.

-- ---------------------------------------------------------------------------
-- 1 — progress recompute + triggers (drives goals.progress AND the goals
--     Realtime UPDATE that refreshes other viewers).
-- ---------------------------------------------------------------------------
create or replace function public.recompute_goal_progress(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dow     int := extract(dow from now())::int;
  v_people  int;
  v_active  int;
  v_total   int;
  v_done    int;
begin
  select greatest(count(*), 1) into v_people
    from goal_assignees where goal_id = p_goal_id;

  select count(*) into v_active
    from goal_checklist_items ci
    where ci.goal_id = p_goal_id
      and (
        ci.recurrence <> 'custom' and ci.recurrence <> 'weekdays'
        or (ci.recurrence = 'weekdays' and v_dow between 1 and 5)
        or (ci.recurrence = 'custom'   and v_dow = any (ci.recur_days))
      );

  v_total := v_active * v_people;

  select count(*) into v_done
    from goal_checklist_completions cc
    join goal_checklist_items ci on ci.id = cc.item_id
    where ci.goal_id = p_goal_id
      and (
        ci.recurrence <> 'custom' and ci.recurrence <> 'weekdays'
        or (ci.recurrence = 'weekdays' and v_dow between 1 and 5)
        or (ci.recurrence = 'custom'   and v_dow = any (ci.recur_days))
      )
      and (
        ci.recurrence = 'once'
        or (ci.recurrence in ('daily', 'weekdays', 'custom') and cc.done_at >= date_trunc('day',   now()))
        or (ci.recurrence = 'weekly'                          and cc.done_at >= date_trunc('week',  now()))
        or (ci.recurrence = 'monthly'                         and cc.done_at >= date_trunc('month', now()))
        or (ci.recurrence = 'yearly'                          and cc.done_at >= date_trunc('year',  now()))
      )
      and (
        not exists (select 1 from goal_assignees ga where ga.goal_id = p_goal_id)
        or exists (
          select 1 from goal_assignees ga
          where ga.goal_id = p_goal_id and ga.user_id = cc.user_id
        )
      );

  if v_total > 0 then
    update goals
      set progress = least(100, round(v_done::numeric * 100 / v_total)::int)
      where id = p_goal_id;
  end if;
end;
$$;

create or replace function public.trg_progress_from_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_goal_progress(coalesce(new.goal_id, old.goal_id));
  return null;
end; $$;

create or replace function public.trg_progress_from_completion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_goal_id uuid;
begin
  select goal_id into v_goal_id from goal_checklist_items
    where id = coalesce(new.item_id, old.item_id);
  if v_goal_id is not null then
    perform public.recompute_goal_progress(v_goal_id);
  end if;
  return null;
end; $$;

create or replace function public.trg_progress_from_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_goal_progress(coalesce(new.goal_id, old.goal_id));
  return null;
end; $$;

drop trigger if exists goal_checklist_progress on goal_checklist_items;

drop trigger if exists goal_progress_item on goal_checklist_items;
create trigger goal_progress_item
  after insert or update or delete on goal_checklist_items
  for each row execute function public.trg_progress_from_item();

drop trigger if exists goal_progress_completion on goal_checklist_completions;
create trigger goal_progress_completion
  after insert or update or delete on goal_checklist_completions
  for each row execute function public.trg_progress_from_completion();

drop trigger if exists goal_progress_assignee on goal_assignees;
create trigger goal_progress_assignee
  after insert or delete on goal_assignees
  for each row execute function public.trg_progress_from_assignee();

-- ---------------------------------------------------------------------------
-- 2 — Realtime: completions must ship full rows and sit on the publication so
--     a teammate's tick streams to everyone viewing the goal.
-- ---------------------------------------------------------------------------
alter table goal_checklist_completions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'goal_checklist_completions'
  ) then
    execute 'alter publication supabase_realtime add table goal_checklist_completions';
  end if;
end $$;
