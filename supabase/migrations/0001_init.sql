-- reStrucAI Team Dashboard — initial schema
-- 7 domain tables, all keyed off auth.users via the profiles table.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type user_role   as enum ('board', 'fte', 'pte', 'intern');
create type goal_level  as enum ('yearly', 'monthly', 'weekly');
create type goal_status as enum ('active', 'in-progress', 'achieved');
create type leave_type  as enum ('casual', 'sick', 'emergency', 'wfh');
create type leave_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user. Replaces the prototype "users" store.
-- ---------------------------------------------------------------------------
create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  name              text not null,
  email             text not null unique,
  role              user_role not null default 'fte',
  department        text not null default 'General',
  joined_date       date not null default current_date,
  confirmed_by_board boolean not null default false,
  is_active         boolean not null default true,
  leave_balance     jsonb not null default '{"casual": 12, "sick": 10, "emergency": 3}'::jsonb,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- punches — one row per punch session (the prototype nested these per day).
-- ---------------------------------------------------------------------------
create table punches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  work_date   date not null,
  punch_in    timestamptz not null,
  punch_out   timestamptz,
  created_at  timestamptz not null default now()
);
create index punches_user_date_idx on punches (user_id, work_date);

-- ---------------------------------------------------------------------------
-- logs — one daily work log per user/day. blocks holds the block-editor JSON.
-- ---------------------------------------------------------------------------
create table logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  log_date     date not null,
  mood         text default '',
  energy_level int not null default 0,
  tags         text[] not null default '{}',
  blocks       jsonb not null default '[]'::jsonb,
  is_draft     boolean not null default false,
  saved_at     timestamptz not null default now(),
  unique (user_id, log_date)
);
create index logs_user_date_idx on logs (user_id, log_date);

-- ---------------------------------------------------------------------------
-- goals — yearly -> monthly -> weekly cascade via parent_id self-reference.
-- ---------------------------------------------------------------------------
create table goals (
  id           uuid primary key default gen_random_uuid(),
  level        goal_level not null,
  title        text not null,
  description  text default '',
  due_date     date,
  department   text default 'Strategy',
  status       goal_status not null default 'active',
  progress     int not null default 0,
  sort_order   int not null default 0,
  parent_id    uuid references goals (id) on delete set null,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- leaves — time-off requests with board approval workflow.
-- ---------------------------------------------------------------------------
create table leaves (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  type         leave_type not null,
  start_date   date not null,
  end_date     date not null,
  reason       text default '',
  is_half_day  boolean not null default false,
  status       leave_status not null default 'pending',
  reviewed_by  uuid references profiles (id) on delete set null,
  review_note  text default '',
  created_at   timestamptz not null default now()
);
create index leaves_user_idx on leaves (user_id);

-- ---------------------------------------------------------------------------
-- holidays — company-wide days off.
-- ---------------------------------------------------------------------------
create table holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null,
  is_national  boolean not null default true
);

-- ---------------------------------------------------------------------------
-- company — single-row mission/vision record.
-- ---------------------------------------------------------------------------
create table company (
  id         int primary key default 1,
  mission    text default '',
  vision     text default '',
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint company_singleton check (id = 1)
);
insert into company (id) values (1) on conflict do nothing;
