-- Per-day, per-member "skip this checklist item today" — used by the punch-out
-- guard. When a member is about to punch out with checklist items still due,
-- the app shows them the open items and offers a "Skip for today, do it
-- tomorrow" button for each. Skipping records a row here so the gate stops
-- nagging them today; tomorrow the item is due again as normal.

create table if not exists goal_checklist_skips (
  item_id   uuid not null references goal_checklist_items (id) on delete cascade,
  user_id   uuid not null references profiles (id) on delete cascade,
  skip_date date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id, skip_date)
);

create index if not exists goal_checklist_skips_user_idx
  on goal_checklist_skips (user_id, skip_date);

alter table goal_checklist_skips enable row level security;

-- A member can see and clear their own skips.
drop policy if exists "skips: own read" on goal_checklist_skips;
create policy "skips: own read" on goal_checklist_skips
  for select using (user_id = auth.uid());

drop policy if exists "skips: own delete" on goal_checklist_skips;
create policy "skips: own delete" on goal_checklist_skips
  for delete using (user_id = auth.uid());

-- Skipping goes through skip_checklist_item() — the RPC verifies the caller
-- may see the goal (mirrors toggle_checklist_item) before inserting.
create or replace function public.skip_checklist_item(p_item_id uuid)
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
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select goal_id into v_goal_id from goal_checklist_items where id = p_item_id;
  if v_goal_id is null then
    raise exception 'Checklist item not found';
  end if;

  with recursive chain as (
    select id, parent_id from goals where id = v_goal_id
    union all
    select g.id, g.parent_id
    from goals g join chain c on g.id = c.parent_id
  )
  select
    public.is_board()
    or exists (
      select 1 from chain c
      join goal_assignees ga on ga.goal_id = c.id
      where ga.user_id = v_uid
    )
  into v_can;

  if not v_can then
    raise exception 'Not allowed to skip this checklist item';
  end if;

  insert into goal_checklist_skips (item_id, user_id, skip_date)
  values (p_item_id, v_uid, current_date)
  on conflict (item_id, user_id, skip_date) do nothing;
end;
$$;
