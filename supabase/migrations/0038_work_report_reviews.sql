-- reStrucAI — work-report reviews (rating + comment) and "who assigned" record.
--
-- Once a member files a "Report Work" report on a checklist item, a Manager or
-- Board Member may rate it 1-5 stars and leave a comment. The member sees that
-- feedback on their own report, is notified for every review, and a 5-star
-- review triggers a celebration. This migration adds:
--   1. goal_assignees.assigned_by — who put this goal on the member's queue
--      (drives the "Assigned by ___" badge on the goal card).
--   2. goal_work_report_reviews — one editable review per (report, reviewer),
--      with RLS that lets the Board review anything and a Department Manager
--      review only reports on goals in the department they head.
--   3. Realtime publication for goal_work_report_reviews so a submitted review
--      reaches the member (and the reviewer) live, like reports and completions.

-- ---------------------------------------------------------------------------
-- 1 — who assigned the goal. Nullable: existing assignments predate this and a
-- self-assign / system assign may have no assigner.
-- ---------------------------------------------------------------------------
alter table goal_assignees
  add column if not exists assigned_by uuid references profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2 — reviews. One row per (work report, reviewer); re-reviewing edits in
-- place (unique constraint + app upsert). stars is constrained to 1..5.
-- ---------------------------------------------------------------------------
create table if not exists public.goal_work_report_reviews (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references goal_work_reports (id) on delete cascade,
  reviewer_id uuid not null references profiles (id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (report_id, reviewer_id)
);
create index if not exists goal_work_report_reviews_report_idx
  on public.goal_work_report_reviews (report_id);
create index if not exists goal_work_report_reviews_reviewer_idx
  on public.goal_work_report_reviews (reviewer_id);

alter table public.goal_work_report_reviews enable row level security;

-- Everyone authenticated may read reviews (the member sees feedback on their own
-- report; the app filters per report). Consistent with goal_work_reports.
drop policy if exists "wr reviews: read all" on public.goal_work_report_reviews;
create policy "wr reviews: read all" on public.goal_work_report_reviews
  for select using (auth.role() = 'authenticated');

-- A reviewer is the Board (any report) OR a Department Manager whose managed
-- department matches the report's goal department. Writes are limited to the
-- reviewer's OWN rows (reviewer_id = auth.uid()). Helper predicate so the three
-- write policies stay in lock-step.
create or replace function public.can_review_work_report(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_board()
    or (
      public.is_manager()
      and exists (
        select 1
        from goal_work_reports wr
        join goal_checklist_items ci on ci.id = wr.item_id
        join goals g on g.id = ci.goal_id
        where wr.id = p_report_id
          and g.department = public.my_managed_department()
      )
    );
$$;

drop policy if exists "wr reviews: reviewer insert" on public.goal_work_report_reviews;
create policy "wr reviews: reviewer insert" on public.goal_work_report_reviews
  for insert with check (
    reviewer_id = auth.uid() and public.can_review_work_report(report_id)
  );

drop policy if exists "wr reviews: reviewer update" on public.goal_work_report_reviews;
create policy "wr reviews: reviewer update" on public.goal_work_report_reviews
  for update using (
    reviewer_id = auth.uid() and public.can_review_work_report(report_id)
  ) with check (
    reviewer_id = auth.uid() and public.can_review_work_report(report_id)
  );

drop policy if exists "wr reviews: reviewer delete" on public.goal_work_report_reviews;
create policy "wr reviews: reviewer delete" on public.goal_work_report_reviews
  for delete using (
    reviewer_id = auth.uid() and public.can_review_work_report(report_id)
  );

-- ---------------------------------------------------------------------------
-- 3 — Realtime: publish reviews so a submitted/edited review refreshes the
-- member's card (and the reviewer's) live, like goal_work_reports does.
-- ---------------------------------------------------------------------------
alter table public.goal_work_report_reviews replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'goal_work_report_reviews'
  ) then
    execute 'alter publication supabase_realtime add table goal_work_report_reviews';
  end if;
end $$;
