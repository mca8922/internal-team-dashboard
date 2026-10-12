-- "Delete option for everyone": a Board-controlled switch that lets the person
-- who CREATED a task remove it themselves — plus an audit trail of every
-- removal, whoever made it.
--
-- Until now deleting and archiving were the Board's alone (0002's
-- "goals: board delete" policy and 0064's goals_archive_is_board trigger).
-- That stays the default. What changes:
--
--   1. company.member_task_delete — one switch, flipped by any Director or
--      Founder from the Clean up modal. Off by default, so applying this
--      migration changes nobody's powers until the Board opts in.
--
--   2. While it is ON, an Executive or Manager may archive, restore and
--      permanently delete a task they CREATED (created_by = auth.uid()). Never
--      one a Director or Manager assigned them, and never anyone else's —
--      a Manager's department-wide edit rights do not stretch to removal.
--
--   3. goal_activity_log — one row per archive / restore / delete, written by
--      triggers on goals, so no code path (card button, bulk cleanup, a raw
--      API call) can remove a task without leaving a record. A deleted task's
--      row is gone, so the log keeps a snapshot: title, tier, departments,
--      who created it and who was assigned.

-- ---------------------------------------------------------------------------
-- 1 — the switch.
-- ---------------------------------------------------------------------------
alter table public.company
  add column if not exists member_task_delete boolean not null default false;

-- Read through a SECURITY DEFINER helper so the delete policy and the archive
-- trigger don't depend on the caller's own read access to `company`.
create or replace function public.member_task_delete_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((select member_task_delete from company where id = 1), false);
$fn$;

-- ---------------------------------------------------------------------------
-- 2 — delete: the Board, or the task's creator while the switch is on.
-- ---------------------------------------------------------------------------
drop policy if exists "goals: board delete" on public.goals;
create policy "goals: board delete" on public.goals
  for delete using (
    public.is_board()
    or (created_by = auth.uid() and public.member_task_delete_enabled())
  );

-- Archive / restore: same rule. Replaces 0064's body; the trigger itself is
-- unchanged. The creator test reads OLD so an edit can't re-stamp created_by
-- onto itself in the same statement that archives the row.
create or replace function public.assert_goal_archive_is_board()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.archived_at is distinct from old.archived_at
     and auth.uid() is not null
     and not public.is_board()
     and not (old.created_by = auth.uid() and public.member_task_delete_enabled()) then
    raise exception 'Only a Founder or Director can archive or restore this task';
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3 — the activity log.
-- ---------------------------------------------------------------------------
create table if not exists public.goal_activity_log (
  id            uuid primary key default gen_random_uuid(),
  -- No FK: the whole point is to outlive a deleted task.
  goal_id       uuid not null,
  action        text not null check (action in ('archived', 'restored', 'deleted')),
  -- Who did it. NULL actor = a service-role / maintenance connection.
  actor_id      uuid references public.profiles (id) on delete set null,
  actor_name    text,
  -- founder | director | manager | executive | system — the tier at the time,
  -- so a later promotion doesn't rewrite history.
  actor_role    text not null,
  -- Snapshot of the task as it was.
  title         text not null,
  level         text,
  department    text,
  departments   text[],
  created_by    uuid references public.profiles (id) on delete set null,
  creator_name  text,
  assignee_names text[] not null default '{}',
  due_date      date,
  occurred_at   timestamptz not null default now()
);

create index if not exists goal_activity_log_occurred_idx
  on public.goal_activity_log (occurred_at desc);

alter table public.goal_activity_log enable row level security;

-- Read: Founders see everything; a Director sees entries for their own
-- departments (the same department scope 0065 gives them on live tasks, so the
-- log can't leak another department's task titles); anyone sees what they did
-- themselves. No insert/update/delete policies — only the triggers below
-- (SECURITY DEFINER) write here, so the record can't be edited or erased.
drop policy if exists "goal_activity_log: read scoped" on public.goal_activity_log;
create policy "goal_activity_log: read scoped" on public.goal_activity_log
  for select using (
    public.row_is_founder(auth.uid())
    or (
      public.is_board()
      and (
        departments && public.my_departments()
        or department = any (public.my_departments())
      )
    )
    or actor_id = auth.uid()
  );

create or replace function public.goal_actor_role(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when p_uid is null then 'system'
    when public.row_is_founder(p_uid) then 'founder'
    when (select role from profiles where id = p_uid) = 'board' then 'director'
    when coalesce((select is_manager from profiles where id = p_uid), false) then 'manager'
    else 'executive'
  end;
$fn$;

create or replace function public.log_goal_activity(p_goal public.goals, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  insert into goal_activity_log (
    goal_id, action, actor_id, actor_name, actor_role,
    title, level, department, departments,
    created_by, creator_name, assignee_names, due_date
  ) values (
    p_goal.id,
    p_action,
    v_uid,
    (select name from profiles where id = v_uid),
    public.goal_actor_role(v_uid),
    p_goal.title,
    p_goal.level::text,
    p_goal.department,
    p_goal.departments,
    p_goal.created_by,
    (select name from profiles where id = p_goal.created_by),
    coalesce(
      array(
        select p.name from goal_assignees ga
        join profiles p on p.id = ga.user_id
        where ga.goal_id = p_goal.id
        order by p.name
      ),
      '{}'
    ),
    p_goal.due_date
  );
end;
$fn$;

-- BEFORE DELETE, not AFTER: the assignee rows cascade away with the task, so
-- the snapshot has to be taken while they still exist. Same transaction — a
-- delete that fails rolls its log row back with it.
create or replace function public.goals_log_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.log_goal_activity(old, 'deleted');
  return old;
end;
$fn$;

drop trigger if exists goals_log_delete on public.goals;
create trigger goals_log_delete
  before delete on public.goals
  for each row execute function public.goals_log_delete();

create or replace function public.goals_log_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.archived_at is distinct from old.archived_at then
    perform public.log_goal_activity(
      new,
      case when new.archived_at is null then 'restored' else 'archived' end
    );
  end if;
  return null;
end;
$fn$;

drop trigger if exists goals_log_archive on public.goals;
create trigger goals_log_archive
  after update of archived_at on public.goals
  for each row execute function public.goals_log_archive();
