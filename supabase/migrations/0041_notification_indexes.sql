-- Indexes for the notification query paths added in the sectioned-bell work, so
-- they stay fast as the table grows instead of scanning every row.
--
--   1. The per-member read (bell + Notifications page): user_id, newest first.
--   2. The work-report debounce lookup (notifyReviewersOfReport): goal_id + type
--      within a recent window.
--   3. The retention prune (sweepOldNotifications + prune_old_data): read rows
--      older than the cutoff — a partial index on the read rows only.
--
-- NOTE: not auto-applied. Run once with `supabase db push` or in the Supabase
-- SQL editor.

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_goal_type_created_idx
  on public.notifications (goal_id, type, created_at)
  where goal_id is not null;

create index if not exists notifications_read_created_idx
  on public.notifications (created_at)
  where is_read = true;
