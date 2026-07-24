-- reStrucAI — allow members to delete their own daily logs.
--
-- The original 0002_rls.sql gave the `logs` table SELECT / INSERT / UPDATE
-- policies but no DELETE policy. With RLS enabled and no matching policy,
-- every DELETE is silently denied — which broke the "delete a log" feature.

drop policy if exists "logs: delete own" on logs;
create policy "logs: delete own" on logs
  for delete using (user_id = auth.uid());
