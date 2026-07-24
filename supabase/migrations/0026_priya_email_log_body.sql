-- Store the generated HTML body so failed emails can be retried without
-- calling the AI again.
alter table priya_email_logs add column if not exists body_html text;
