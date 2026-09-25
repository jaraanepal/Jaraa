-- 006_notifications.sql — in-app user notifications (P-6).
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor, in order,
-- after 001_init.sql .. 005_kit_details.sql (same as DEPLOY.md §1 step 3).
--
-- Background: migration 001 created a `notifications` table for a planned
-- scheduled-notification queue (columns channel/template/payload/
-- scheduled_for/sent_at) that was never wired to any server code. P-6 reuses
-- that table name for the in-app inbox, so this migration RESHAPES the
-- existing table instead of creating it. The legacy columns are unused by
-- any code and are removed; the P-6 inbox columns are added.
--
-- All statements are additive / IF (NOT) EXISTS, so re-running is safe.

-- If 001 was somehow skipped, create the table with the final shape directly.
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL DEFAULT 'general',                 -- e.g. 'plan_approved', 'case_submitted', 'flags_resolved'
  title_en   text NOT NULL DEFAULT '',
  title_ne   text,
  body_en    text,
  body_ne    text,
  link       text,                                            -- client route, e.g. '/plan'
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Drop the legacy queue index (it references columns removed below).
DROP INDEX IF EXISTS idx_notif_due;

-- Remove the unused legacy queue columns. No server code ever read or wrote
-- them, and keeping the legacy NOT NULL columns (channel, template) would
-- break P-6 inserts.
ALTER TABLE notifications DROP COLUMN IF EXISTS channel;
ALTER TABLE notifications DROP COLUMN IF EXISTS template;
ALTER TABLE notifications DROP COLUMN IF EXISTS payload;
ALTER TABLE notifications DROP COLUMN IF EXISTS scheduled_for;
ALTER TABLE notifications DROP COLUMN IF EXISTS sent_at;

-- Add the P-6 in-app inbox columns.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type     text NOT NULL DEFAULT 'general';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title_en text NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title_ne text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body_en  text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body_ne  text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link      text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at   timestamptz;

-- Inbox indexes.
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
