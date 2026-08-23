-- Executives create their own tasks, and add their own checklist items.
--
-- Until now creating a task was Board/Manager work (0002 + 0033) and every
-- checklist item belonged to the whole task. Two new powers land here:
--
--   1. An EXECUTIVE (anyone who is neither Board nor a Department Manager)
--      may create a task at any tier, in a department they belong to,
--      ASSIGNED TO THEMSELVES ONLY — and may edit it afterwards. They may
--      never delete it: deletion stays with the Board (Founders + Directors),
--      exactly as 0002 left it. Managers, as before, create and edit but never
--      delete.
--
--   2. A member may add a PERSONAL checklist item to any task they are a
--      participant on — including one a Director assigned them. It is theirs
--      alone: only they see it on their list, only they can tick it, and only
--      the Board can remove it. `owner_id` carries this; NULL keeps the old
--      meaning (a shared item everyone on the task owes).
--
-- Attribution rides along: goals gain updated_at/updated_by so a card can show
-- when it was last really EDITED (checklist ticks and the progress trigger
-- deliberately do not touch it — those are daily work, not modifications), and
-- checklist items gain created_by.

-- ---------------------------------------------------------------------------
-- 1 — columns.
-- ---------------------------------------------------------------------------
alter table public.goals
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

alter table public.goal_checklist_items
  -- NULL = a shared item (the Board/Manager assigned it to everyone on the
  -- task). Non-null = a personal item, visible and tickable only by that
  -- member. ON DELETE CASCADE: a removed account takes its own items with it,
  -- leaving the shared checklist untouched.
  add column if not exists owner_id uuid references public.profiles (id) on delete cascade,
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

create index if not exists goal_checklist_owner_idx
  on public.goal_checklist_items (goal_id, owner_id);

-- ---------------------------------------------------------------------------
-- 2 — helpers.
-- ---------------------------------------------------------------------------

-- Every department the caller is listed under — primary plus the additional
-- ones from 0060. Mirrors departmentsOf() in src/lib/roles.ts. Blank entries
-- are dropped so someone under NO department matches nothing (see the
-- NO_DEPARTMENT note in roles.ts) rather than everything.
create or replace function public.my_departments()
returns text[]
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    array(
      select distinct d
      from profiles p,
           lateral unnest(array[p.department] || coalesce(p.departments, array[]::text[])) as d
      where p.id = auth.uid()
        and d is not null
        and btrim(d) <> ''
    ),
    array[]::text[]
  );
$fn$;

-- Is the caller someone who ticks this task's checklist? A named assignee, or
-- — on the legacy tasks that predate the "every task has an assignee" rule —
-- any member of its department. Same test toggle_checklist_item() applies
-- before accepting a tick, so "can I add an item here" and "can I tick an item
-- here" can never drift apart.
create or replace function public.is_goal_participant(p_goal_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  if exists (select 1 from goal_assignees where goal_id = p_goal_id and user_id = v_uid) then
    return true;
  end if;
  if exists (select 1 from goal_assignees where goal_id = p_goal_id) then
    return false;  -- the task HAS assignees and the caller is not one of them
  end if;
  return exists (
    select 1 from goals g
    where g.id = p_goal_id
      and btrim(g.department) <> ''
      and g.department = (select department from profiles where id = v_uid)
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3 — goals: an executive may create a task for themselves, and edit the tasks
--     they created. Delete is untouched — still "goals: board delete" from
--     0002, so Founders and Directors alone remove a task.
--
--     The self-assignment half cannot be expressed here (assignees live in a
--     child table written after this row), so it is enforced in createGoal();
--     what RLS pins down is that the creator stamps THEMSELVES on created_by
--     and picks a department they actually belong to, and that an edit can
--     never re-stamp created_by onto someone else.
-- ---------------------------------------------------------------------------
drop policy if exists "goals: board insert" on public.goals;
create policy "goals: board insert" on public.goals
  for insert with check (
    public.is_board()
    or (public.is_manager() and department = public.my_managed_department())
    or (created_by = auth.uid() and department = any (public.my_departments()))
  );

drop policy if exists "goals: board update" on public.goals;
create policy "goals: board update" on public.goals
  for update using (
    public.is_board()
    or (public.is_manager() and department = public.my_managed_department())
    or created_by = auth.uid()
  )
  with check (
    public.is_board()
    or (public.is_manager() and department = public.my_managed_department())
    or (created_by = auth.uid() and department = any (public.my_departments()))
  );

-- Archiving is a soft delete — the task vanishes from every live view (0044) —
-- so it has to obey the same "Founders and Directors only" rule the hard delete
-- does. The UPDATE policy above cannot express it: a policy sees only the new
-- row, and archiving is an UPDATE that merely stamps archived_at. A trigger can
-- compare OLD to NEW, so the rule lives here instead. Without it, opening the
-- update policy to a task's creator would have quietly handed every executive a
-- delete button by another name.
create or replace function public.assert_goal_archive_is_board()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- auth.uid() is null on a service-role / maintenance connection, which
  -- bypasses RLS outright anyway — gating those here would only break the
  -- server's own jobs without closing anything a member could reach.
  if new.archived_at is distinct from old.archived_at
     and auth.uid() is not null
     and not public.is_board() then
    raise exception 'Only a Founder or Director can archive or restore a task';
  end if;
  return new;
end;
$fn$;

drop trigger if exists goals_archive_is_board on public.goals;
create trigger goals_archive_is_board
  before update on public.goals
  for each row execute function public.assert_goal_archive_is_board();

-- ---------------------------------------------------------------------------
-- 4 — goal_assignees: the creator of a task may put THEMSELVES on it (and take
--     themselves back off, which is how the delete-all/insert-all rewrite in
--     replaceAssigneesAndNotify works). Never anyone else: user_id is pinned to
--     auth.uid(), so an executive cannot hand work to a colleague.
-- ---------------------------------------------------------------------------
drop policy if exists "goal_assignees: board insert" on public.goal_assignees;
create policy "goal_assignees: board insert" on public.goal_assignees
  for insert with check (
    public.is_board()
    or (
      public.is_manager()
      and public.manages_user(user_id)
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
    or (
      user_id = auth.uid()
      and exists (select 1 from goals g where g.id = goal_id and g.created_by = auth.uid())
    )
  );

drop policy if exists "goal_assignees: board delete" on public.goal_assignees;
create policy "goal_assignees: board delete" on public.goal_assignees
  for delete using (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
    or (
      user_id = auth.uid()
      and exists (select 1 from goals g where g.id = goal_id and g.created_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5 — goal_checklist_items: personal items.
--
--     INSERT — two new arms. A participant may add an item OWNED BY THEMSELVES
--     (owner_id and created_by both pinned to auth.uid(), so they can neither
--     plant a shared item nor an item on someone else's list); and the task's
--     own CREATOR may write its shared checklist, which is what lets an
--     executive give the task they just made a checklist through the normal
--     form. That second arm is safe precisely because goal_assignees above pins
--     a non-board creator to themselves: a "shared" item on a task like that
--     can only ever be owed by the one person who made it.
--
--     UPDATE — they may rename / re-describe their own item, and edit the
--     checklist of a task they created. The WITH CHECK re-asserts owner_id,
--     which is what stops an edit from converting someone's personal item into
--     a shared one everybody suddenly owes.
--
--     DELETE — a personal item is NEVER removable by the member who added it;
--     that is Founder/Director work alone (the Manager arm is narrowed to
--     shared items for the same reason). A creator may still drop a SHARED line
--     from the checklist of a task they made — that is editing their own task,
--     not erasing a record of work someone committed to.
-- ---------------------------------------------------------------------------
drop policy if exists "checklist: board insert" on public.goal_checklist_items;
create policy "checklist: board insert" on public.goal_checklist_items
  for insert with check (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
    or (
      owner_id = auth.uid()
      and created_by = auth.uid()
      and public.is_goal_participant(goal_id)
    )
    or exists (select 1 from goals g where g.id = goal_id and g.created_by = auth.uid())
  );

drop policy if exists "checklist: board update" on public.goal_checklist_items;
create policy "checklist: board update" on public.goal_checklist_items
  for update using (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
    or owner_id = auth.uid()
    or exists (select 1 from goals g where g.id = goal_id and g.created_by = auth.uid())
  )
  with check (
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
    or owner_id = auth.uid()
    or exists (select 1 from goals g where g.id = goal_id and g.created_by = auth.uid())
  );

drop policy if exists "checklist: board delete" on public.goal_checklist_items;
create policy "checklist: board delete" on public.goal_checklist_items
  for delete using (
    public.is_board()
    or (
      public.is_manager()
      and owner_id is null
      and exists (
        select 1 from goals g
        where g.id = goal_id and g.department = public.my_managed_department()
      )
    )
    or (
      owner_id is null
      and exists (select 1 from goals g where g.id = goal_id and g.created_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 6 — toggle_checklist_item: a personal item is tickable by its OWNER only.
--     Everything else (assignee-only completion, the completions row it writes)
--     is 0014 unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.toggle_checklist_item(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid          uuid := auth.uid();
  v_goal_id      uuid;
  v_owner_id     uuid;
  v_has_assignee boolean;
  v_can          boolean;
begin
  select goal_id, owner_id into v_goal_id, v_owner_id
    from goal_checklist_items where id = p_item_id;
  if v_goal_id is null then
    raise exception 'Checklist item not found';
  end if;

  -- A personal item belongs to one member. Nobody else ticks it — not a
  -- teammate on the same task, not the Board.
  if v_owner_id is not null and v_owner_id <> v_uid then
    raise exception 'This checklist item belongs to another member';
  end if;

  select exists (select 1 from goal_assignees where goal_id = v_goal_id)
    into v_has_assignee;

  if v_has_assignee then
    select exists (
      select 1 from goal_assignees
      where goal_id = v_goal_id and user_id = v_uid
    ) into v_can;
  else
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
$fn$;

-- ---------------------------------------------------------------------------
-- 7 — recompute_goal_progress: owner-aware.
--
--     0013 counted (due items) x (assignees) — every item owed by everyone.
--     A personal item is owed by ONE member, so the denominator becomes a sum
--     over assignees of the items each of them actually owes:
--
--       total = (due shared items) x (assignees)
--             + (due personal items whose owner is an assignee)
--
--     Dilip adding an item therefore lengthens Dilip's own list and the task's
--     combined %, and leaves his teammates' denominators exactly where they
--     were. Mirrored on the client by computeGoalProgress() in
--     src/lib/goal-progress.ts — keep the two in step.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_goal_progress(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_dow      int := extract(dow from now())::int;
  v_people   int;
  v_shared   int;
  v_personal int;
  v_total    int;
  v_done     int;
begin
  select greatest(count(*), 1) into v_people
    from goal_assignees where goal_id = p_goal_id;

  -- Due-today shared items: owed once by every assignee.
  select count(*) into v_shared
    from goal_checklist_items ci
    where ci.goal_id = p_goal_id
      and ci.owner_id is null
      and (
        ci.recurrence <> 'custom' and ci.recurrence <> 'weekdays'
        or (ci.recurrence = 'weekdays' and v_dow between 1 and 5)
        or (ci.recurrence = 'custom'   and v_dow = any (ci.recur_days))
      );

  -- Due-today personal items: owed once, by their owner, and only while that
  -- owner is still on the task (an unassigned member's leftovers count for
  -- nobody). On a task with no assignees at all there is no one to attribute
  -- them to, so they are skipped there too.
  select count(*) into v_personal
    from goal_checklist_items ci
    where ci.goal_id = p_goal_id
      and ci.owner_id is not null
      and exists (
        select 1 from goal_assignees ga
        where ga.goal_id = p_goal_id and ga.user_id = ci.owner_id
      )
      and (
        ci.recurrence <> 'custom' and ci.recurrence <> 'weekdays'
        or (ci.recurrence = 'weekdays' and v_dow between 1 and 5)
        or (ci.recurrence = 'custom'   and v_dow = any (ci.recur_days))
      );

  v_total := v_shared * v_people + v_personal;

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
      -- A personal item only ever counts for the member who owns it.
      and (ci.owner_id is null or ci.owner_id = cc.user_id)
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
$fn$;

-- ---------------------------------------------------------------------------
-- 8 — no backfill needed: every checklist item that exists today was written by
--     the Board or a Manager for the whole task, so owner_id stays NULL and
--     keeps its existing shared behaviour. created_by stays NULL for them too —
--     "Added by" simply does not render on a row that predates this migration,
--     rather than claiming a name we do not actually have.
-- ---------------------------------------------------------------------------
