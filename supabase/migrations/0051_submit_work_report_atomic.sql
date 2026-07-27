-- "Report Work" submit + tick used to be two separate client round-trips
-- (submitWorkReport upsert, then a toggle_checklist_item RPC once the first
-- one resolved). Under real-world timing — a slow connection, a realtime
-- router.refresh() landing mid-flight, a re-render dropping the second call
-- — the report could save while the tick silently failed (or vice versa),
-- so the member saw the completion celebration without the item actually
-- being marked done, and had to click "Submit Report" a second time.
--
-- This wraps both writes in ONE function/transaction: either both the report
-- and the tick land, or neither does. Re-submitting an edit to an
-- already-completed report does NOT re-tick it (preserves the original
-- done_at), matching the client's existing "don't re-celebrate" behavior.
create or replace function public.submit_work_report(
  p_item_id uuid,
  p_body text,
  p_report_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_already_done boolean;
begin
  insert into goal_work_reports (item_id, user_id, report_date, body, updated_at)
  values (p_item_id, v_uid, p_report_date, p_body, now())
  on conflict (item_id, user_id, report_date)
  do update set body = excluded.body, updated_at = now();

  select exists (
    select 1 from goal_checklist_completions
    where item_id = p_item_id and user_id = v_uid
  ) into v_already_done;

  if not v_already_done then
    perform public.toggle_checklist_item(p_item_id, true);
  end if;
end;
$$;
