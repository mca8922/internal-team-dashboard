-- Separate "communication email" for Priya to use when sending HR emails.
-- The login email (auth.users.email) is often a placeholder; this field holds
-- the inbox the member actually reads.
alter table profiles add column if not exists commute_email text;
