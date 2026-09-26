-- 022_milestones_messaging.sql — P-17: milestone definitions + coach messaging.
-- Run in Supabase SQL Editor AFTER 021, in order. Additive only.

-- Admin-defined milestones (e.g. "7-day streak", "first re-scan").
CREATE TABLE IF NOT EXISTS milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en       text NOT NULL,
  title_ne       text,
  title_ro       text,
  description_en text,
  description_ne text,
  kind           text NOT NULL DEFAULT 'custom',
  threshold      int,
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Achievements: one row per (milestone, user).
CREATE TABLE IF NOT EXISTS user_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achieved_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (milestone_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_milestones_user ON user_milestones(user_id);

-- Coach messaging: one thread per customer (get-or-create).
CREATE TABLE IF NOT EXISTS coach_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  coach_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Messages: client_message_id makes app-side sends idempotent.
CREATE TABLE IF NOT EXISTS coach_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         uuid NOT NULL REFERENCES coach_threads(id) ON DELETE CASCADE,
  sender_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role       text NOT NULL,
  body              text NOT NULL,
  client_message_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, client_message_id)
);
CREATE INDEX IF NOT EXISTS idx_coach_messages_thread ON coach_messages(thread_id);
