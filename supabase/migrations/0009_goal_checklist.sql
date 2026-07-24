-- reStrucAI — per-goal checklists.
--
-- The Board breaks a goal into checklist items. The members the goal is
-- visible to (direct assignees or same-department) tick items off
-- themselves, and the goal's `progress` is recomputed automatically from
-- the ratio of done items — see the trigger at the bottom.

-- ---------------------------------------------------------------------------
-- goal_checklist_items — one row per checklist line on a goal.
-- ---------------------------------------------------------------------------
create table if not exists goal_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references goals (id) on delete cascade,
  label       text not null,
  sort_order  int not null default 0,
  is_done     boolean not null default false,
  done_by     uuid references profiles (id) on delete set null,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists goal_checklist_goal_idx
  on goal_checklist_items (goal_id, sort_order);

alter table goal_checklist_items enable row level security;

-- Everyone authenticated may read checklist items (the app filters per goal,
-- consistent with the goals / goal_assignees tables).
drop policy if exists "checklist: read all" on goal_checklist_items;
create policy "checklist: read all" on goal_checklist_items
  for select using (auth.role() = 'authenticated');

-- Only the Board may create / edit / remove checklist items. Members tick
-- items through the toggle_checklist_item() function below, never directly,
-- so they can never rename or delete an item.
drop policy if exists "checklist: board insert" on goal_checklist_items;
create policy "checklist: board insert" on goal_checklist_items
  for insert with check (public.is_board());

drop policy if exists "checklist: board update" on goal_checklist_items;
create policy "checklist: board update" on goal_checklist_items
  for update using (public.is_board());

drop policy if exists "checklist: board delete" on goal_checklist_items;
create policy "checklist: board delete" on goal_checklist_items
  for delete using (public.is_board());

-- ---------------------------------------------------------------------------
-- toggle_checklist_item — lets a member tick / untick an item on a goal that
-- is visible to them. "Visible" mirrors the app's visibleGoals() rule: the
-- goal, or any ancestor up the parent chain, is assigned to the member OR
-- tagged to their department. SECURITY DEFINER so it can update the row
-- without the member needing a direct UPDATE policy.
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

  update goal_checklist_items
  set is_done = p_done,
      done_by = case when p_done then v_uid else null end,
      done_at = case when p_done then now() else null end
  where id = p_item_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_goal_progress — keeps goals.progress in step with the checklist.
-- Fires after any insert / update / delete on goal_checklist_items and sets
-- progress to round(done / total * 100). When a goal has no checklist items
-- the column is left untouched (the manual slider still owns it).
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
  select count(*), count(*) filter (where is_done)
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

drop trigger if exists goal_checklist_progress on goal_checklist_items;
create trigger goal_checklist_progress
  after insert or update or delete on goal_checklist_items
  for each row execute function public.sync_goal_progress();
