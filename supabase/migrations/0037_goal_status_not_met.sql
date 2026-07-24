-- reStrucAI — a fourth goal status: 'not_met'.
--
-- The three existing statuses (inactive / active / achieved) can't express a
-- goal that was WORKED ON but fell short of its target by the due date — the
-- only honest options were leaving it "Active/Overdue" (nagging red noise) or
-- marking it "Completed" (a lie that inflates achievement roll-ups).
--
-- 'not_met' is a settled negative outcome: like 'achieved' it is NOT counted as
-- overdue (the app's isOverdue / analytics exclude it) and its checklist is
-- frozen, but it is never counted as a success.
--
-- NOTE: run this migration by hand BEFORE deploying the code that writes
-- 'not_met' (a new enum value can't be used until this has committed).

alter type goal_status add value if not exists 'not_met';
