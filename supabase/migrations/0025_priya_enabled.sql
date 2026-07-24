-- Per-member toggle: when false, Priya skips this member entirely (no email,
-- no log entry, no notification). Defaults to true for all existing members.
alter table profiles add column if not exists priya_enabled boolean not null default true;
