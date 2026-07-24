-- Priya milestone emails — additive, safe to run on a live DB.
--
-- Lets Priya's tenure-milestone emails (work-anniversary celebrations) be logged
-- in the same table as her weekly reviews and welcomes, so they show up in the
-- Priya analytics. Two new email_type values plus a per-occasion key so a
-- milestone email is only sent once per member per occasion.

-- 1) Allow the new email types. Drop the old CHECK and re-add it widened.
alter table public.priya_email_logs
  drop constraint if exists priya_email_logs_email_type_check;

alter table public.priya_email_logs
  add constraint priya_email_logs_email_type_check
  check (email_type in ('weekly_review', 'welcome', 'milestone', 'milestone_sendoff'));

-- 2) Per-occasion de-dupe key (e.g. "<userId>:m3"). Null for older rows.
alter table public.priya_email_logs
  add column if not exists milestone_key text;

create index if not exists priya_email_logs_milestone_idx
  on public.priya_email_logs (recipient_id, email_type, milestone_key);
