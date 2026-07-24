-- reStrucAI — "Report Work" before completing a checklist task.
--
-- When the Board turns ON "Report Work" for a checklist item, the assigned
-- member must write a short work report (one per day, per item) before they may
-- tick THAT item complete. Reports are rich text, guided by a per-department
-- template the Board maintains, and are visible to the Board for oversight.
--
-- This migration adds:
--   1. goal_checklist_items.report_required — the per-item toggle.
--   2. report_templates — one reporting template per department (Board-edited).
--   3. goal_work_reports — one report per (checklist item, member, day).
--   4. a report gate inside toggle_checklist_item().
--   5. Realtime publication for goal_work_reports so a submitted report is live.
--
-- NOTE: an earlier draft of this migration attached "Report Work" to the whole
-- goal. The two statements below remove those artifacts so this file is safe to
-- (re-)run whether or not the per-goal version was ever applied.
alter table goals drop column if exists report_required;
drop table if exists public.goal_work_reports cascade;

-- ---------------------------------------------------------------------------
-- 1 — per-item toggle.
-- ---------------------------------------------------------------------------
alter table goal_checklist_items
  add column if not exists report_required boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2 — department reporting templates. Keyed by the department string (the same
-- string carried on profiles/goals). Body is stored HTML (rich text), shown to
-- members as a starting point so they report in a consistent shape.
-- ---------------------------------------------------------------------------
create table if not exists public.report_templates (
  department text primary key,
  body       text not null default '',
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.report_templates enable row level security;

-- Everyone authenticated may read the templates (members need their dept's one).
drop policy if exists "report templates: read all" on public.report_templates;
create policy "report templates: read all" on public.report_templates
  for select using (auth.role() = 'authenticated');

-- Only the Board may create / edit / remove templates.
drop policy if exists "report templates: board insert" on public.report_templates;
create policy "report templates: board insert" on public.report_templates
  for insert with check (public.is_board());

drop policy if exists "report templates: board update" on public.report_templates;
create policy "report templates: board update" on public.report_templates
  for update using (public.is_board());

drop policy if exists "report templates: board delete" on public.report_templates;
create policy "report templates: board delete" on public.report_templates
  for delete using (public.is_board());

-- ---------------------------------------------------------------------------
-- 3 — work reports. One row per member per checklist item per day. report_date
-- is the member's local (IST) calendar day, supplied by the client so it lines
-- up with the same "due today" logic the checklist uses.
-- ---------------------------------------------------------------------------
create table if not exists public.goal_work_reports (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references goal_checklist_items (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  report_date date not null,
  body        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (item_id, user_id, report_date)
);
create index if not exists goal_work_reports_item_idx
  on public.goal_work_reports (item_id);
create index if not exists goal_work_reports_user_idx
  on public.goal_work_reports (user_id);

alter table public.goal_work_reports enable row level security;

-- Everyone authenticated may read reports (the Board oversees them; the app
-- filters per item/member, consistent with the checklist + completions tables).
drop policy if exists "work reports: read all" on public.goal_work_reports;
create policy "work reports: read all" on public.goal_work_reports
  for select using (auth.role() = 'authenticated');

-- A member may write (and edit) only their OWN reports.
drop policy if exists "work reports: insert own" on public.goal_work_reports;
create policy "work reports: insert own" on public.goal_work_reports
  for insert with check (user_id = auth.uid());

drop policy if exists "work reports: update own" on public.goal_work_reports;
create policy "work reports: update own" on public.goal_work_reports
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "work reports: delete own" on public.goal_work_reports;
create policy "work reports: delete own" on public.goal_work_reports
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4 — gate ticking behind a same-day report. Rebuilds toggle_checklist_item()
-- on top of the assignee-only rule from 0014, adding: if the item has
-- report_required ON, a member may only TICK it once they have a report for
-- today. (Un-ticking is always allowed so a misclick can be undone.)
--
-- The gate uses `report_date >= current_date` rather than equality: the member
-- supplies their IST calendar day, which is always on/after the UTC date the DB
-- sees, so this never wrongly blocks a genuine same-day report near midnight.
-- ---------------------------------------------------------------------------
create or replace function public.toggle_checklist_item(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid             uuid := auth.uid();
  v_goal_id         uuid;
  v_has_assignee    boolean;
  v_can             boolean;
  v_report_required boolean;
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
    -- Report-work gate: completing this item requires a report for today.
    select coalesce(report_required, false) into v_report_required
      from goal_checklist_items where id = p_item_id;
    if v_report_required and not exists (
      select 1 from goal_work_reports
      where item_id = p_item_id
        and user_id = v_uid
        and report_date >= current_date
    ) then
      raise exception 'Please report your work before completing this task';
    end if;

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
-- 5 — Realtime: publish work reports so a submitted report refreshes the Board
-- (and the member's own card) live, like completions do.
-- ---------------------------------------------------------------------------
alter table public.goal_work_reports replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'goal_work_reports'
  ) then
    execute 'alter publication supabase_realtime add table goal_work_reports';
  end if;
end $$;
