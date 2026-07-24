-- reStrucAI — Manager change requests.
--
-- A Department Manager cannot edit a team member's account directly. Instead
-- they submit a CHANGE REQUEST for one field (email / role / job title / daily
-- target hours — joining date is intentionally excluded). The Board reviews a
-- pending-requests inbox and approves (which applies the change) or rejects it.
-- Nothing changes on the member until the Board approves.

create table if not exists public.change_requests (
  id              uuid primary key default gen_random_uuid(),
  manager_id      uuid not null references profiles (id) on delete cascade,
  member_id       uuid not null references profiles (id) on delete cascade,
  field           text not null
                    check (field in ('email', 'role', 'job_title', 'daily_target_hours')),
  current_value   text,
  requested_value text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by     uuid references profiles (id) on delete set null,
  review_note     text not null default '',
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

create index if not exists change_requests_status_idx
  on public.change_requests (status, created_at desc);
create index if not exists change_requests_manager_idx
  on public.change_requests (manager_id, created_at desc);

alter table public.change_requests enable row level security;

-- The Board sees every request; a Manager sees only the ones they raised.
drop policy if exists "change requests: read board or own" on public.change_requests;
create policy "change requests: read board or own" on public.change_requests
  for select using (public.is_board() or manager_id = auth.uid());

-- A Manager may raise a request for one of THEIR OWN team members.
drop policy if exists "change requests: manager insert own" on public.change_requests;
create policy "change requests: manager insert own" on public.change_requests
  for insert with check (
    manager_id = auth.uid()
    and public.is_manager()
    and public.manages_user(member_id)
  );

-- Only the Board may review (approve / reject) a request.
drop policy if exists "change requests: board update" on public.change_requests;
create policy "change requests: board update" on public.change_requests
  for update using (public.is_board());

-- Realtime so the Board's inbox and the Manager's request list update live.
alter table public.change_requests replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'change_requests'
  ) then
    execute 'alter publication supabase_realtime add table change_requests';
  end if;
end $$;
