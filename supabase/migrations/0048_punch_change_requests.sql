-- reStrucAI — Punch time change requests.
--
-- A team member cannot edit their own punch history directly. Instead they
-- submit a request: either a MISSED PUNCH (add a punch-in/out for a day with
-- none recorded) or a DAY STATUS change (reclassify a day as leave — casual /
-- sick / emergency / wfh, optionally half-day). Only the Founder reviews and
-- approves (which applies the change to `punches` or `leaves`) or rejects it
-- with a required note. Nothing changes on the member until then.
--
-- Capped at 5 requests per calendar month per member (pending + approved +
-- rejected; a withdrawn request frees its slot) — enforced in application
-- code (src/lib/actions.ts), not here.

create table if not exists public.punch_change_requests (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references profiles (id) on delete cascade,
  work_date              date not null,
  request_type           text not null
                           check (request_type in ('missed_punch', 'day_status')),
  requested_punch_in     timestamptz,
  requested_punch_out    timestamptz,
  requested_leave_type   leave_type,
  requested_is_half_day  boolean,
  reason                 text not null,
  status                 text not null default 'pending'
                           check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by            uuid references profiles (id) on delete set null,
  review_note            text not null default '',
  created_at             timestamptz not null default now(),
  reviewed_at            timestamptz
);

create index if not exists punch_change_requests_user_created_idx
  on public.punch_change_requests (user_id, created_at desc);
create index if not exists punch_change_requests_status_idx
  on public.punch_change_requests (status, created_at desc);

alter table public.punch_change_requests enable row level security;

-- The Founder sees every request; a member sees only their own.
drop policy if exists "punch change requests: read own or founder" on public.punch_change_requests;
create policy "punch change requests: read own or founder" on public.punch_change_requests
  for select using (user_id = auth.uid() or public.row_is_founder(auth.uid()));

-- A member may raise a request for themselves only.
drop policy if exists "punch change requests: insert own" on public.punch_change_requests;
create policy "punch change requests: insert own" on public.punch_change_requests
  for insert with check (user_id = auth.uid());

-- A member may withdraw (pending -> withdrawn) only their own pending request.
-- The Founder may update any row to any status (approve / reject).
drop policy if exists "punch change requests: withdraw own or founder review" on public.punch_change_requests;
create policy "punch change requests: withdraw own or founder review" on public.punch_change_requests
  for update using (
    (user_id = auth.uid() and status = 'pending') or public.row_is_founder(auth.uid())
  ) with check (
    (user_id = auth.uid() and status = 'withdrawn') or public.row_is_founder(auth.uid())
  );
