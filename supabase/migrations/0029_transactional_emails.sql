-- Transactional email controls + audit log.
--
-- Companion to the in-app `notifications` table: the same key events (leave
-- decided, goal assigned, punch missing) can also email the member. This adds
-- board-controlled switches and a full send log so the board can see exactly
-- who was emailed, how many, and why. Reuses the existing SMTP transport, so
-- nothing here leaves the free tier.

-- Per-member opt-out. Defaults to true so enabling the master switch reaches
-- everyone; the board can mute individuals.
alter table profiles
  add column if not exists transactional_emails_enabled boolean not null default true;

-- Single-row settings: the master switch plus a per-event-type switch. Starts
-- OFF — auto-emailing the team is opt-in.
create table if not exists transactional_email_settings (
  id          int primary key default 1 check (id = 1),
  enabled     boolean not null default false,  -- master on/off
  on_leave    boolean not null default true,   -- leave approved / declined
  on_goal     boolean not null default true,   -- goal assigned
  on_punch    boolean not null default true,   -- missed punch-out reminder
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
insert into transactional_email_settings (id) values (1) on conflict (id) do nothing;

alter table transactional_email_settings enable row level security;

-- Board reads and edits the settings; everyone else is blocked. (The mailer
-- reads them through the service-role client, which bypasses RLS.)
drop policy if exists "txn settings: board read" on transactional_email_settings;
create policy "txn settings: board read"
  on transactional_email_settings for select using (public.is_board());
drop policy if exists "txn settings: board update" on transactional_email_settings;
create policy "txn settings: board update"
  on transactional_email_settings for update using (public.is_board()) with check (public.is_board());

-- One row per email actually attempted, for the audit view.
create table if not exists transactional_email_logs (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid references profiles(id) on delete set null,
  recipient_email text not null,
  recipient_name  text not null,
  event_type      text not null,  -- leave_approved | leave_rejected | goal_assigned | punch_missing
  subject         text not null,
  status          text not null default 'sent' check (status in ('sent', 'failed')),
  error_message   text,
  created_at      timestamptz not null default now()
);
create index if not exists transactional_email_logs_created_idx
  on transactional_email_logs (created_at desc);

alter table transactional_email_logs enable row level security;

-- Board-only read; inserts come from the service-role mailer (bypasses RLS).
drop policy if exists "txn logs: board read" on transactional_email_logs;
create policy "txn logs: board read"
  on transactional_email_logs for select using (public.is_board());

-- Weekly retention prune already exists (migration 0028). Extend it to keep this
-- log bounded too: drop entries older than 90 days.
create or replace function public.prune_old_data()
returns void
language sql
as $$
  delete from public.notifications
   where is_read = true
     and created_at < now() - interval '60 days';

  update public.priya_email_logs
     set body_html = null
   where body_html is not null
     and status = 'sent'
     and sent_at < now() - interval '90 days';

  delete from public.transactional_email_logs
   where created_at < now() - interval '90 days';
$$;
