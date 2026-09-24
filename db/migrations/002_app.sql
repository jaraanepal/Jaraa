-- ============================================================================
-- Jaraa PWA — app migration 002 (extends 001_init.sql)
-- Guest scans, password login for staff roles, consent granted flag,
-- refresh-token store, deletion requests. Idempotent; safe to re-run.
-- ============================================================================

-- guest drafts: contract allows POST /scans unauthenticated (user_id null)
ALTER TABLE scans ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS guest_token text;

-- email+password login for doctor/admin (TOTP 2FA: follow-up, see README)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;  -- reserved for TOTP follow-up

-- consents carry a granted boolean (withdrawal = new row, granted=false)
ALTER TABLE consents ADD COLUMN IF NOT EXISTS granted boolean NOT NULL DEFAULT true;

-- rotating refresh tokens (httpOnly cookie jaraa_rt)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash  text PRIMARY KEY,                     -- SHA-256 of the token
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- data-deletion requests (7-day SLA)
CREATE TABLE IF NOT EXISTS deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  note         text,
  status       text NOT NULL DEFAULT 'scheduled',    -- scheduled | completed | cancelled
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_del_user ON deletion_requests(user_id);
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

-- scan-photos bucket is created in 001; nothing to change here.
