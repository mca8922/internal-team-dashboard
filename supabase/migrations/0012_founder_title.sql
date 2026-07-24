-- Adds a free-form job title shown on profile cards (e.g. "Founder · CEO",
-- "Board · CTO"). Separate from the role (which controls permissions).
alter table public.profiles
  add column if not exists job_title text not null default '';
