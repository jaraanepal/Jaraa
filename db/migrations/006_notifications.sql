-- 006_notifications.sql — in-app user notifications (P-6).
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor, in order,
-- after 001_init.sql .. 005_kit_details.sql (same as DEPLOY.md §1 step 3).
--
-- All statements are additive / IF NOT EXISTS so re-running is safe.

-- --------------------------------------------------------------------------
-- notifications: in-app inbox for users (plan approved, case submitted, …)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,                                   -- e.g. 'plan_approved', 'case_submitted', 'flags_resolved'
  title_en   text NOT NULL,
  title_ne   text,
  body_en    text,
  body_ne    text,
  link       text,                                            -- client route, e.g. '/plan'
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
