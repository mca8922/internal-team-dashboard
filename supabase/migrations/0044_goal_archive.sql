-- 0044_goal_archive.sql
-- Soft-archive support for the Goals cleanup feature.
--
-- The Board cleans up old goals in two ways:
--   • Archive  → set archived_at (hidden from every view, but retained and
--                fully restorable). archived_at IS NULL means the goal is live.
--   • Delete   → permanent removal (existing `goals: board delete` policy);
--                child rows cascade away.
--
-- No new RLS is needed: the existing `goals: board update` policy already lets
-- the Board write these columns, and `goals: board delete` covers permanent
-- deletion. getGoals() filters `archived_at is null` so archived goals drop out
-- of the cascade, dashboard, team and analytics views automatically.

alter table goals add column if not exists archived_at timestamptz;
alter table goals
  add column if not exists archived_by uuid references profiles (id) on delete set null;

-- Speeds up the `archived_at is null` filter on every goals read.
create index if not exists goals_archived_idx on goals (archived_at);
