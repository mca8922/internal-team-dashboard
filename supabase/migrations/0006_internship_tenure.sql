-- reStrucAI — intern tenure.
--
-- The Board sets an internship length (in months) for intern accounts.
-- The tenure runs from the intern's joined_date; the dashboard shows the
-- progress through it. NULL means no tenure has been set yet.

alter table profiles
  add column if not exists internship_months integer;
