-- Optional free-text description for each checklist item — shown beneath the
-- label so the Board can clarify what "done" means without bloating the title.
alter table goal_checklist_items
  add column if not exists description text not null default '';
