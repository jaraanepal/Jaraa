-- 019_referrals_wallet.sql — P-13 referrals + P-14 wallet.
-- Run in Supabase SQL Editor AFTER 018, in order. Additive only.
--
-- Root Coins reward CONSISTENCY, never spend. No real-money cash-out exists.

-- P-13: one referral code per user.
CREATE TABLE IF NOT EXISTS referral_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- P-13: attribution. status flips to 'completed' ONLY after the referred
-- user completes a Root Scan (anti-fraud) — never on signup alone.
CREATE TABLE IF NOT EXISTS referrals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id  uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);

-- P-13: immutable coin ledger (no updates/deletes by convention).
CREATE TABLE IF NOT EXISTS coin_ledger (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     int NOT NULL,
  reason     text NOT NULL,
  ref_type   text,
  ref_id     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coin_ledger_user ON coin_ledger(user_id);

-- P-14: per-user wallet (NPR balance) for cashback + COD change.
CREATE TABLE IF NOT EXISTS wallets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_npr int NOT NULL DEFAULT 0 CHECK (balance_npr >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- P-14: immutable wallet transaction ledger.
CREATE TABLE IF NOT EXISTS wallet_txns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id  uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount_npr int NOT NULL CHECK (amount_npr > 0),
  kind       text NOT NULL CHECK (kind IN ('cashback','cod_change','adjustment')),
  ref        text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_wallet ON wallet_txns(wallet_id);
