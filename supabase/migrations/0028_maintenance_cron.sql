-- Scheduled maintenance via pg_cron — DB-side cleanup that keeps the project
-- comfortably inside Supabase's free 500MB database quota.
--
-- Why pg_cron and not a Vercel cron: the Hobby plan allows only 2 cron jobs and
-- both are already spent on Priya (weekly-review + poll-replies). pg_cron ships
-- with the Supabase free tier and runs entirely inside Postgres, so this needs
-- no extra Vercel function, no outbound HTTP, and no secret.
--
-- NOTE: this migration is not auto-applied. Run it once with `supabase db push`
-- or paste it into the Supabase SQL editor. If `create extension pg_cron` is
-- rejected, enable pg_cron first under Dashboard > Database > Extensions, then
-- re-run.

create extension if not exists pg_cron;

-- Frees the two largest growth sources on the free DB while keeping the audit
-- trail intact:
--   1. Read notifications older than 60 days — members saw them long ago.
--   2. The stored HTML body of weekly/welcome emails that were delivered
--      ('sent') more than 90 days ago. The audit row (subject, status,
--      memory_note, reply) stays; only the heavy body_html is dropped. Failed
--      and pending rows keep their HTML so the board can still retry them.
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
$$;

-- Schedule weekly: Sundays 19:00 UTC (00:30 IST Monday). Idempotent — drop any
-- prior job of the same name before recreating it, so re-running this migration
-- never stacks duplicate schedules.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'restruc-prune-old-data') then
    perform cron.unschedule('restruc-prune-old-data');
  end if;
  perform cron.schedule(
    'restruc-prune-old-data',
    '0 19 * * 0',
    'select public.prune_old_data();'
  );
end $$;
