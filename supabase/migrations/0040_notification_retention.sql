-- Tightens notification retention from 60 days to 7 and runs the prune daily
-- (was weekly). Notifications are transient reminders, not records — once a
-- member has seen them they add up fast (every goal, leave, work report and
-- Priya reply), so a short window keeps the table light. The app also runs the
-- same 7-day sweep on the daily Priya cron (sweepOldNotifications) as a
-- redundant fast-path; both share the identical predicate, so they're idempotent.
--
-- Redefines public.prune_old_data() in place (keeping the email-body cleanup
-- from 0028 unchanged) and reschedules the existing pg_cron job. Idempotent:
-- re-running drops the prior schedule before recreating it.
--
-- NOTE: not auto-applied. Run once with `supabase db push` or in the Supabase
-- SQL editor. Requires pg_cron (already enabled by 0028).

create or replace function public.prune_old_data()
returns void
language sql
as $$
  -- Read notifications older than 7 days — members saw them long ago.
  delete from public.notifications
   where is_read = true
     and created_at < now() - interval '7 days';

  -- Drop the heavy stored HTML body of delivered emails after 90 days; the
  -- audit row (subject, status, memory_note, reply) is kept. Unchanged from 0028.
  update public.priya_email_logs
     set body_html = null
   where body_html is not null
     and status = 'sent'
     and sent_at < now() - interval '90 days';
$$;

-- Reschedule daily: 19:00 UTC (00:30 IST). Idempotent — unschedule any prior
-- job of this name first so re-running never stacks duplicates.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'restruc-prune-old-data') then
    perform cron.unschedule('restruc-prune-old-data');
  end if;
  perform cron.schedule(
    'restruc-prune-old-data',
    '0 19 * * *',
    'select public.prune_old_data();'
  );
end $$;
