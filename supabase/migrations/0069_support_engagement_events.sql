-- ---------------------------------------------------------------------------
-- 0069 — Support engagement log.
--
-- A plain, human-readable audit of how the team uses the Support surface:
--
--   * "Viewed Support page"        — the Support page was opened
--   * "Opened About reStrucAI"     — the "About reStrucAI" modal was opened
--   * "Clicked a link"             — one of the three modal links was clicked
--                                    (Website / Nishit Rathod – LinkedIn / Referral)
--
-- One row per event. Nothing in the UI changes — an invisible fire-and-forget
-- handler writes here. Read it straight from the Supabase Table Editor: the
-- member's name and email are stored on the row, plus an IST date and time
-- split out for easy scanning alongside the full timestamp.
-- ---------------------------------------------------------------------------

create table if not exists public.support_engagement_events (
  id             bigint generated always as identity primary key,

  -- Full instant the event happened (UTC under the hood).
  occurred_at    timestamptz not null default now(),

  -- The same instant, pre-split in India Standard Time (filled by the trigger
  -- below) so the Table Editor is readable without timezone math.
  event_date     date,
  event_time_ist text,

  -- Who did it. Name + email are snapshotted onto the row so the log stays
  -- readable on its own; user_id links back to the live profile.
  member_name    text not null,
  member_email   text not null,
  user_id        uuid not null references public.profiles (id) on delete cascade,

  -- What they did, in words.
  action         text not null
                   check (action in ('Viewed Support page', 'Opened About reStrucAI', 'Clicked a link')),

  -- Only set when action = 'Clicked a link'.
  link           text
                   check (link is null or link in ('Website', 'Nishit Rathod – LinkedIn', 'Referral')),
  link_url       text
);

comment on table public.support_engagement_events is
  'Human-readable log of Support-page and "About reStrucAI" engagement. One row per event. Read via the Table Editor.';

-- Keep the IST date/time columns in lockstep with occurred_at. Done in a
-- trigger rather than a generated column because AT TIME ZONE is not immutable.
create or replace function public.support_engagement_fill_ist()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.event_date     := (new.occurred_at at time zone 'Asia/Kolkata')::date;
  new.event_time_ist := to_char(new.occurred_at at time zone 'Asia/Kolkata', 'HH24:MI');
  return new;
end;
$$;

create trigger support_engagement_fill_ist_trg
  before insert or update of occurred_at on public.support_engagement_events
  for each row execute function public.support_engagement_fill_ist();

-- Newest first is the common read.
create index if not exists support_engagement_events_time_idx
  on public.support_engagement_events (occurred_at desc);

alter table public.support_engagement_events enable row level security;

-- Everyone may record their own events (can't forge another user's id).
create policy "support_engagement: insert own" on public.support_engagement_events
  for insert with check (user_id = auth.uid());

-- Reading the log is Board-only in-app; the Table Editor (service role) always
-- sees everything regardless.
create policy "support_engagement: read board" on public.support_engagement_events
  for select using (public.is_board());
