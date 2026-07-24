-- Priya AI HR — memory + reply tracking.
--
-- Two features land together because they share this one table:
--   1. Memory  — `memory_note` is a tiny summary Priya writes about each weekly
--      email (what she praised, what to follow up on). It is fed back into the
--      next week's prompt so she sounds continuous instead of starting cold.
--   2. Replies — when a member replies to one of Priya's emails, the daily IMAP
--      poll stores the reply on the original log row, matched via `message_id`
--      (the SMTP Message-ID we now save on send) against the reply's
--      In-Reply-To / References headers.
alter table priya_email_logs
  add column if not exists message_id       text,        -- SMTP Message-ID of the email Priya sent
  add column if not exists memory_note       text,        -- compact recap Priya writes for her own future context
  add column if not exists reply_text        text,        -- the member's reply body (any text, CTA or not)
  add column if not exists reply_message_id  text,        -- Message-ID of the reply (dedupes re-polls)
  add column if not exists replied_at        timestamptz; -- when the reply was received

-- Threading lookups: match an incoming reply's In-Reply-To to the sent email.
create index if not exists priya_email_logs_message_id_idx
  on priya_email_logs (message_id);

-- Dedupe guard so a re-poll never records or re-notifies the same reply twice.
create index if not exists priya_email_logs_reply_message_id_idx
  on priya_email_logs (reply_message_id);

-- The existing "board can read priya email logs" SELECT policy (migration 0022)
-- already covers these new columns, so the Board sees replies with no further
-- policy change. Writes go through the service-role admin client, which bypasses
-- RLS, so no INSERT/UPDATE policy is needed here either.
