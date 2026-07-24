-- reStrucAI — two-stage leave approval.
--
-- A leave request now needs two sign-offs before it is finalised:
--   1. A Board Member (e.g. Aditya) "accepts" it — this records a
--      pre-approval and pings the Founder. The request stays `pending` and
--      no balance is deducted yet.
--   2. The Founder (Nishit) finalises it — the request becomes `approved`
--      and the requester's balance is deducted.
-- The Founder may also accept directly, which finalises in one step. Only
-- the Founder may permanently delete a leave log (handled in the app via the
-- service-role client, mirroring the other Founder-only deletions).
--
-- pre_approved_by / pre_approved_at let the UI show
-- "Accepted by X · awaiting final approval".

alter table public.leaves
  add column if not exists pre_approved_by uuid references public.profiles (id) on delete set null,
  add column if not exists pre_approved_at timestamptz;
