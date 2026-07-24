-- reStrucAI — Role & Responsibilities for Department Managers.
--
-- A Board-authored, formatted (HTML, sanitized on render) description of what a
-- Manager is accountable for. Stored on the Manager's own profile row and shown
-- at the top of their team view, above the members assigned to them.
--
-- No new RLS is needed: a Manager already reads their own profile (0033's
-- "profiles: read self or board" policy), and only the Board can write profiles.

alter table profiles
  add column if not exists manager_responsibilities text;
