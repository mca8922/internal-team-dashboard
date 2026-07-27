-- holidays had read/insert/delete policies but no UPDATE policy, so editing a
-- declared holiday's date/name in place (rather than delete + re-create) was
-- silently rejected by RLS. Adds the missing board-only update policy,
-- mirroring "holidays: board insert" / "holidays: board delete".
create policy "holidays: board update" on public.holidays
  for update using (public.is_board()) with check (public.is_board());
