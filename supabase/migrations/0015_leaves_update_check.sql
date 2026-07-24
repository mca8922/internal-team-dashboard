-- reStrucAI — close the leave self-approval gap.
--
-- The 0002 "leaves: update own pending or board" policy had a USING clause but
-- no WITH CHECK. USING only decides which existing rows a caller may target; it
-- does NOT constrain the NEW values written. So a member could call the REST API
-- directly on their own *pending* request and set status = 'approved' (or
-- reassign user_id), self-approving leave without any Board sign-off. The app UI
-- never does this, but RLS — not the app — is the security boundary.
--
-- Fix: add a WITH CHECK so a non-Board owner may edit their own request ONLY
-- while it stays theirs and still pending. The Board (and Founder, who is a
-- Board member) keep full review powers via is_board().

drop policy if exists "leaves: update own pending or board" on leaves;
create policy "leaves: update own pending or board" on leaves
  for update
  using (
    (user_id = auth.uid() and status = 'pending') or public.is_board()
  )
  with check (
    public.is_board()
    or (user_id = auth.uid() and status = 'pending')
  );
