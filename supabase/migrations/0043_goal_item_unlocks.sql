-- Members tap to reveal their custom-day task descriptions. Each unlock is
-- recorded once per (item, member) so the box stays open across refreshes and
-- managers / board get an instant notification when it happens.
CREATE TABLE IF NOT EXISTS goal_item_unlocks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid        NOT NULL REFERENCES goal_checklist_items(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unlocked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);

ALTER TABLE goal_item_unlocks ENABLE ROW LEVEL SECURITY;

-- Members read/write their own unlocks.
CREATE POLICY "own_unlocks" ON goal_item_unlocks
  FOR ALL USING (user_id = auth.uid());

-- Board members and managers can read all unlocks (for context on the goals
-- page and for the notification logic — though the action uses the admin client
-- for the actual insert, so this policy only gates the client-side read).
CREATE POLICY "board_manager_read" ON goal_item_unlocks
  FOR SELECT USING (public.is_board() OR public.is_manager());

-- Realtime: members see their own unlock reflected immediately so the lock
-- overlay stays open after a browser refresh without a manual reload.
ALTER TABLE goal_item_unlocks REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'goal_item_unlocks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE goal_item_unlocks;
  END IF;
END $$;
