-- Publish `holidays` on Realtime so declaring/removing a holiday refreshes
-- everyone live (topbar badge + shell-mounted confetti shower), the same way
-- goal_work_reports etc. already do. See src/components/LiveData.tsx.
alter table public.holidays replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'holidays'
  ) then
    execute 'alter publication supabase_realtime add table holidays';
  end if;
end $$;
