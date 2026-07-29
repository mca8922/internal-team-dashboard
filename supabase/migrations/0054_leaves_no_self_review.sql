-- reStrucAI — Board Members can't review their own leave request.
--
-- The 0015 fix closed the self-approval gap for non-Board owners, but the
-- Board-wide clause (is_board()) still let a Board Member update ANY leave
-- row for review purposes, including their own — so a Director (or a
-- Founder) could pre-approve, finalise, or reject their own request via the
-- API even though the app UI never offers that button. Reviewing your own
-- time off isn't a real review; another Board Member (a different Director,
-- or the other Founder) has to do it. reviewLeave() in the app layer already
-- throws in this case as a second guard, but RLS is the actual boundary.
--
-- Fix: the Board clause now requires user_id <> auth.uid(). The existing
-- owner clause (self-edit while still pending) is untouched, so a member
-- can still edit their own pending request's fields — just not flip its
-- own status via Board powers.

drop policy if exists "leaves: update own pending or board" on leaves;
create policy "leaves: update own pending or board" on leaves
  for update
  using (
    (user_id = auth.uid() and status = 'pending') or (public.is_board() and user_id <> auth.uid())
  )
  with check (
    (public.is_board() and user_id <> auth.uid())
    or (user_id = auth.uid() and status = 'pending')
  );
