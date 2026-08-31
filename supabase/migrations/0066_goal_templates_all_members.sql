-- reStrucAI — open the shared task-template library to every member.
--
-- Templates were Board-only to create/edit/delete (migration 0032). Product
-- decision: any authenticated member may now create and use templates, so the
-- whole team can build up the shared blueprint library. Deleting a template is
-- still limited — to the member who created it, or any Board Member — so one
-- person can't wipe another team's blueprints.

-- Anyone authenticated may add a template. `created_by` is set by the app to
-- the caller; we also pin it here so a row can't be inserted under someone
-- else's name.
drop policy if exists "goal templates: board insert" on public.goal_templates;
drop policy if exists "goal templates: member insert" on public.goal_templates;
create policy "goal templates: member insert" on public.goal_templates
  for insert with check (
    auth.role() = 'authenticated'
    and (created_by is null or created_by = auth.uid())
  );

-- Editing a template: its creator, or any Board Member.
drop policy if exists "goal templates: board update" on public.goal_templates;
drop policy if exists "goal templates: creator or board update" on public.goal_templates;
create policy "goal templates: creator or board update" on public.goal_templates
  for update using (created_by = auth.uid() or public.is_board());

-- Deleting a template: its creator, or any Board Member.
drop policy if exists "goal templates: board delete" on public.goal_templates;
drop policy if exists "goal templates: creator or board delete" on public.goal_templates;
create policy "goal templates: creator or board delete" on public.goal_templates
  for delete using (created_by = auth.uid() or public.is_board());
