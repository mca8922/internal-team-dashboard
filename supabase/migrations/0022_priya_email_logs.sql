-- Priya AI HR email send log. Every email Priya sends is recorded here so
-- Board members can audit what was sent, to whom, and whether it succeeded.
create table priya_email_logs (
  id              uuid        primary key default gen_random_uuid(),
  recipient_id    uuid        references profiles(id) on delete set null,
  recipient_email text        not null,
  recipient_name  text        not null,
  email_type      text        not null check (email_type in ('weekly_review', 'welcome')),
  subject         text        not null,
  status          text        not null default 'sent' check (status in ('sent', 'failed')),
  error_message   text,
  week_start_date date,
  sent_at         timestamptz not null default now()
);

alter table priya_email_logs enable row level security;

-- Board members can read all logs; non-board cannot access at all.
create policy "board can read priya email logs"
  on priya_email_logs for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'board'
    )
  );
