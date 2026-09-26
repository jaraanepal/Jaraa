-- 015_sync.sql — P-8: offline-first server support (idempotency records).
-- Run in Supabase SQL Editor AFTER 014, in order. Additive only.
--
-- Generic idempotency: any mutation sent with an Idempotency-Key header stores
-- its response here (scoped per user + scope string). Replays return the
-- stored response instead of re-executing. The sync-delta endpoint itself
-- needs no new tables (it reads orders/notifications/checkins by updated_at).

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      text NOT NULL,
  response   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idempotency_user ON idempotency_keys(user_id);
