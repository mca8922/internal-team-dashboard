-- Removes the Priya (AI HR assistant) and Tips features entirely — both were
-- Phase 2 backlog items that are being dropped, not deferred. See PHASE.md.
--
-- 1) prune_old_data() (migration 0028, scheduled via pg_cron) touches
--    priya_email_logs directly, so it must be redefined BEFORE that table is
--    dropped or the nightly job starts erroring.
create or replace function public.prune_old_data()
returns void
language sql
as $$
  delete from public.notifications
   where is_read = true
     and created_at < now() - interval '60 days';
$$;

-- 2) Drop the Priya email audit log and the Tips tables (+ their child
--    tables) entirely — cascade takes their indexes/policies with them.
drop table if exists public.priya_email_logs cascade;
drop table if exists public.tip_feedback cascade;
drop table if exists public.tip_opens cascade;
drop table if exists public.tips cascade;

-- 3) Drop the per-member Priya opt-out column.
alter table public.profiles drop column if exists priya_enabled;

-- 4) Purge any leftover Priya notification rows and stop referencing the
--    retired types (no CHECK constraint on notifications.type, so this is
--    just a data cleanup — nothing structural depends on it).
delete from public.notifications
 where type in ('priya_reply_received', 'priya_email_pending');
