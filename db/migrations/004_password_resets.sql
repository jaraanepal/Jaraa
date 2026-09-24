-- ============================================================================
-- Jaraa PWA — app migration 003 (extends 002_app.sql)
-- Single-use password-reset tokens. Only the HMAC hash of each token is
-- stored; raw tokens travel only in the emailed reset link. Tokens expire
-- after 1 hour and are deleted on use. Idempotent; safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  text PRIMARY KEY,                     -- HMAC-SHA256 of the raw token
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                          -- set instead of delete when auditing
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pr_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_pr_expires ON password_resets(expires_at);
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
