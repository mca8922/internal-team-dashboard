-- Allow 'pending' status so Priya can mark members who are missing a
-- communication email without wasting an AI generation call.
alter table priya_email_logs
  drop constraint if exists priya_email_logs_status_check;

alter table priya_email_logs
  add constraint priya_email_logs_status_check
  check (status in ('sent', 'failed', 'pending'));
