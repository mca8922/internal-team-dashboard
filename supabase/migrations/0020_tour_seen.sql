-- Track whether a member has completed the onboarding tour.
-- Stored server-side so the tour only fires once per account, not once per browser.
alter table public.profiles
  add column if not exists tour_seen boolean not null default false;
