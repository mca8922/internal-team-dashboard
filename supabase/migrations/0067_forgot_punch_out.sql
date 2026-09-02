-- reStrucAI — "forgot to punch out" forced correction.
--
-- When a member left a punch session open on an earlier day (it crossed
-- midnight and has now been running longer than STALE_PUNCH_HOURS), they can
-- no longer punch in for a new session until they tell us when they actually
-- left. Filing that correction:
--   * closes the dangling session immediately at the time they enter
--     (provisional — the Founder still reviews it), and
--   * raises a punch_change_request of the new type 'forgot_punch_out',
--     linked to the punch row via punch_id, so the Founder can adjust the
--     exact in/out on review.
--
-- It is NOT capped by the monthly request limit and ignores the
-- current/previous-month window — the member has no other way to clear the
-- block, and it records their own account of their hours, not a dispute.
-- Enforced in application code (src/lib/actions.ts), same as the 5/month cap.

alter table public.punch_change_requests
  drop constraint if exists punch_change_requests_request_type_check;
alter table public.punch_change_requests
  add constraint punch_change_requests_request_type_check
  check (request_type in ('missed_punch', 'day_status', 'forgot_punch_out'));

-- The dangling session a 'forgot_punch_out' request is closing. NULL for the
-- two older request types. ON DELETE SET NULL so a Founder deleting the punch
-- outright doesn't cascade-delete the request history.
alter table public.punch_change_requests
  add column if not exists punch_id uuid references public.punches (id) on delete set null;
