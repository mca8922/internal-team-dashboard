-- reStrucAI - Tips: one AI-generated tip per member per day, shown as the
-- glowing bulb on the Dashboard. Mirrors the department_apps /
-- department_app_clicks config+log pattern (0044/0046).
--
-- A `tips` row is uniquely keyed by (user_id, tip_date), so "has today's tip
-- already been generated" is a single existence check — see
-- getOrGenerateTodayTip() in src/lib/actions.ts. Reading (or ignoring) it
-- never regenerates a new one until the next IST calendar day.

create table public.tips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- Snapshot of profile.department at generation time, so Board analytics can
  -- group by department even if the member later moves teams.
  department    text,
  tip_date      date not null,
  tip_text      text not null,
  -- True when there was no recent mood/energy to personalise against, so the
  -- tip fell back to a generic pick + a nudge to log mood/energy.
  is_generic    boolean not null default false,
  mood_used     text,
  energy_used   int,
  -- OpenRouter model slug used, kept for later audits/model changes.
  model         text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, tip_date)
);

create index tips_user_date_idx on public.tips (user_id, tip_date desc);
create index tips_dept_date_idx on public.tips (department, tip_date desc);

-- A tip can be opened more than once; every open is its own row so the Board
-- "Opened At" view can show the full list of timestamps, not just the last one.
create table public.tip_opens (
  id         uuid primary key default gen_random_uuid(),
  tip_id     uuid not null references public.tips (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  opened_at  timestamptz not null default now()
);

create index tip_opens_tip_idx on public.tip_opens (tip_id, opened_at desc);
create index tip_opens_user_idx on public.tip_opens (user_id, opened_at desc);

-- One reaction per tip (a tip already belongs to exactly one user), so
-- tip_id is the primary key and a reaction change is a plain upsert.
create table public.tip_feedback (
  tip_id     uuid primary key references public.tips (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reaction   text not null check (reaction in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tips enable row level security;
alter table public.tip_opens enable row level security;
alter table public.tip_feedback enable row level security;

-- tips: members create/read only their own; the Board reads everyone's for
-- the Tips nav section + analytics. No update/delete policy — a tip is
-- immutable once generated.
create policy "tips: insert own" on public.tips
  for insert with check (user_id = auth.uid());

create policy "tips: read self or board" on public.tips
  for select using (user_id = auth.uid() or public.is_board());

-- tip_opens: everyone may log their own opens; the Board reads all.
create policy "tip_opens: insert own" on public.tip_opens
  for insert with check (user_id = auth.uid());

create policy "tip_opens: read self or board" on public.tip_opens
  for select using (user_id = auth.uid() or public.is_board());

-- tip_feedback: a member may set/change/clear only their own reaction.
create policy "tip_feedback: insert own" on public.tip_feedback
  for insert with check (user_id = auth.uid());

create policy "tip_feedback: update own" on public.tip_feedback
  for update using (user_id = auth.uid());

create policy "tip_feedback: delete own" on public.tip_feedback
  for delete using (user_id = auth.uid());

create policy "tip_feedback: read self or board" on public.tip_feedback
  for select using (user_id = auth.uid() or public.is_board());
