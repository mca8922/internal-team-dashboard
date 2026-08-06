-- MCA — a local mirror of the support tickets this team raises with reStrucAI.
--
-- READ THIS BEFORE USING THESE TABLES.
--
-- reStrucAI's database remains the SOURCE OF TRUTH for every ticket. The
-- support desk posts to reStrucAI's API and reads back from it; nothing on the
-- Support page is served from the rows below. What this migration adds is a
-- local, queryable RECORD of what our people asked for and where it got to —
-- so the history survives here even though the ticket itself does not live here.
--
-- That makes this a mirror, and a mirror can drift. Two ways it will:
--
--   1. A ticket moved on reStrucAI's side is only reflected here the next time
--      the reporter loads the Support page or opens that ticket. Nobody looking
--      at these tables is looking at live state.
--   2. Anything that happens purely over email — the actual back-and-forth —
--      is not captured at all, because reStrucAI does not store it either
--      (nothing writes an 'agent' message there today). What lands in
--      support_mirror_messages is the opening request plus status entries.
--
-- Treat these tables as an archive, never as an authority. If the two disagree,
-- reStrucAI is right.
--
-- Written by the support module's per-fork seam, src/support/support-mirror.ts.
-- Every write is best-effort and swallowed on failure: a support page must
-- never break because a mirror insert did.

-- ---------------------------------------------------------------------------
-- 1 — tickets
-- ---------------------------------------------------------------------------

create table if not exists public.support_mirror_tickets (
  -- reStrucAI's human reference (e.g. 'MCA-1043') is the natural key: it is
  -- what the reporter sees, and it is stable across both databases.
  ref            text primary key,
  -- Unlike reStrucAI's copy, we DO have a real user id here — these are our
  -- own people. Kept on delete cascade: an offboarded profile's tickets go
  -- with it, since the authoritative copy still exists on reStrucAI's side.
  reporter_id    uuid not null references public.profiles (id) on delete cascade,
  -- Denormalised deliberately. This is an archive, and it should still read
  -- correctly if the profile's name or work address changes later.
  reporter_name  text not null default '',
  reporter_email text not null default '',
  reporter_role  text not null default '',
  category       text not null default 'other'
                   check (category in ('bug', 'blocked', 'question', 'access', 'suggestion', 'other')),
  subject        text not null,
  -- Null when the row was first seen via the ticket LIST, which does not carry
  -- the body. Filled in when the reporter opens the thread.
  body           text,
  status         text not null default 'open'
                   check (status in ('open', 'in_progress', 'waiting_client', 'resolved', 'closed')),
  -- The page and browser string the report form disclosed to the reporter.
  context        jsonb not null default '{}'::jsonb,
  -- reStrucAI's timestamps, not ours — so the archive matches what the
  -- reporter was shown rather than when our mirror happened to run.
  remote_created_at timestamptz,
  remote_updated_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists support_mirror_tickets_reporter_idx
  on public.support_mirror_tickets (reporter_id, remote_updated_at desc);
create index if not exists support_mirror_tickets_status_idx
  on public.support_mirror_tickets (status, remote_updated_at desc);

-- ---------------------------------------------------------------------------
-- 2 — thread entries
-- ---------------------------------------------------------------------------

create table if not exists public.support_mirror_messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_ref   text not null references public.support_mirror_tickets (ref) on delete cascade,
  -- 'client' — the person who raised it
  -- 'agent'  — reStrucAI (reserved; nothing produces these yet)
  -- 'system' — status changes and other automatic entries
  author_type  text not null check (author_type in ('client', 'agent', 'system')),
  author_name  text not null default '',
  body         text not null,
  remote_created_at timestamptz not null,
  created_at   timestamptz not null default now(),
  -- The mirror re-reads the whole thread every time a ticket is opened, so the
  -- same entry arrives repeatedly. reStrucAI's messages carry no stable id we
  -- can rely on across databases, so identity here is the ticket plus who said
  -- what and when — enough to make the upsert idempotent.
  unique (ticket_ref, author_type, remote_created_at, body)
);

create index if not exists support_mirror_messages_ticket_idx
  on public.support_mirror_messages (ticket_ref, remote_created_at);

-- ---------------------------------------------------------------------------
-- 3 — RLS
-- ---------------------------------------------------------------------------
--
-- A support ticket often contains the reason someone could not do their job.
-- It is read by the person who raised it and by the Board, and by nobody else
-- — a Manager or Director has no business reading their reports' tickets.

alter table public.support_mirror_tickets enable row level security;
alter table public.support_mirror_messages enable row level security;

drop policy if exists "support mirror tickets: read own or board" on public.support_mirror_tickets;
create policy "support mirror tickets: read own or board" on public.support_mirror_tickets
  for select using (public.is_board() or reporter_id = auth.uid());

-- Only ever your own, and only as yourself. The module always writes as the
-- signed-in reporter, so there is no path that needs to insert for someone else.
drop policy if exists "support mirror tickets: insert own" on public.support_mirror_tickets;
create policy "support mirror tickets: insert own" on public.support_mirror_tickets
  for insert with check (reporter_id = auth.uid());

drop policy if exists "support mirror tickets: update own" on public.support_mirror_tickets;
create policy "support mirror tickets: update own" on public.support_mirror_tickets
  for update using (reporter_id = auth.uid()) with check (reporter_id = auth.uid());

drop policy if exists "support mirror messages: read own ticket or board" on public.support_mirror_messages;
create policy "support mirror messages: read own ticket or board" on public.support_mirror_messages
  for select using (
    public.is_board()
    or exists (
      select 1 from public.support_mirror_tickets t
      where t.ref = ticket_ref and t.reporter_id = auth.uid()
    )
  );

drop policy if exists "support mirror messages: insert own ticket" on public.support_mirror_messages;
create policy "support mirror messages: insert own ticket" on public.support_mirror_messages
  for insert with check (
    exists (
      select 1 from public.support_mirror_tickets t
      where t.ref = ticket_ref and t.reporter_id = auth.uid()
    )
  );

-- No delete policy on either table, for anyone. An archive that the subject of
-- it can quietly erase is not an archive. Removal is a Founder action through
-- the service role, or the cascade when a profile is deleted.
