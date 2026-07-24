-- reStrucAI — Goals v2.
--
-- 1. Adds a 'daily' goal level (cascade is now Yearly → Monthly → Weekly → Daily).
-- 2. Renames the 'in-progress' status to 'inactive' (statuses: Inactive, Active, Achieved).
-- 3. Adds a 'custom' checklist cadence with a set of weekdays (e.g. Mon/Wed/Fri).
-- 4. Makes checklist completion INDEPENDENT per assignee: each assigned member
--    completes the list on their own, so two assignees double the expected output.
--    Completions move from a single flag on the item to one row per (item, member).

-- ---------------------------------------------------------------------------
-- 1 + 2 — enum changes.
-- ---------------------------------------------------------------------------
alter type goal_level  add value if not exists 'daily';

-- Rename in place: existing 'in-progress' rows become 'inactive' automatically.
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'goal_status' and e.enumlabel = 'in-progress'
  ) then
    alter type goal_status rename value 'in-progress' to 'inactive';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 — custom-cadence weekdays. recur_days holds 0..6 (Sun..Sat); only read
-- when recurrence = 'custom'. Empty for every other cadence.
-- ---------------------------------------------------------------------------
alter table goal_checklist_items
  add column if not exists recur_days int[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 4 — per-assignee completions. One row = "this member finished this item",
-- with done_at stamping when (so a recurring item resets each period exactly
-- like before, but per person). Inserted/cleared only through
-- toggle_checklist_item() below, so members can never touch another's row.
-- ---------------------------------------------------------------------------
create table if not exists goal_checklist_completions (
  item_id  uuid not null references goal_checklist_items (id) on delete cascade,
  user_id  uuid not null references profiles (id) on delete cascade,
  done_at  timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists goal_checklist_completions_user_idx
  on goal_checklist_completions (user_id);

alter table goal_checklist_completions enable row level security;

-- Everyone authenticated may read completions (the app filters per goal/member,
-- consistent with the checklist + assignee tables). All writes go through the
-- security-definer toggle function, so there is no direct write policy.
drop policy if exists "checklist completions: read all" on goal_checklist_completions;
create policy "checklist completions: read all" on goal_checklist_completions
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- toggle_checklist_item — now records the CALLER's own completion. Visibility
-- check is unchanged (the goal, or an ancestor, is assigned to the member or
-- tagged to their department, or the caller is Board). Ticking upserts the
-- caller's row; unticking removes it.
-- ---------------------------------------------------------------------------
create or replace function public.toggle_checklist_item(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_goal_id uuid;
  v_can     boolean;
begin
  select goal_id into v_goal_id from goal_checklist_items where id = p_item_id;
  if v_goal_id is null then
    raise exception 'Checklist item not found';
  end if;

  with recursive chain as (
    select id, parent_id, department from goals where id = v_goal_id
    union all
    select g.id, g.parent_id, g.department
    from goals g join chain c on g.id = c.parent_id
  )
  select
    public.is_board()
    or exists (
      select 1 from chain c
      where c.department = (select department from profiles where id = v_uid)
         or exists (
           select 1 from goal_assignees ga
           where ga.goal_id = c.id and ga.user_id = v_uid
         )
    )
  into v_can;

  if not v_can then
    raise exception 'Not allowed to update this checklist';
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
-- recompute_goal_progress — combined % across every assignee.
--
--   progress = round( current completions / (active items × assignees) * 100 )
--
-- "active items" are the items due in the current period (custom/weekdays are
-- only due on their weekdays; daily every day; weekly/monthly/yearly through
-- the period; once always). A completion counts only while its done_at sits in
-- the current period. With no explicit assignees the denominator falls back to
-- one set (any visible member's completion counts), preserving prior behaviour.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_goal_progress(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dow     int := extract(dow from now())::int; -- 0=Sun..6=Sat
  v_people  int;
  v_active  int;   -- items due in the current period
  v_total   int;   -- active items × people
  v_done    int;   -- current completions on active items by assignees
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

-- Trigger wrappers — recompute when items, completions, or assignees change.
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

-- The old single-flag trigger is superseded by the three above.
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
-- Realtime — publish completions so one member's tick refreshes everyone live.
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
