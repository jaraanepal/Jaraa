-- 012_returns_refunds.sql — P-5: customer return requests + refund lifecycle.
-- Run in Supabase SQL Editor AFTER 001..011, in order. Additive only.

-- Customer return requests (one per order enforced in app logic; DB allows history).
CREATE TABLE IF NOT EXISTS return_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'requested'
              CHECK (status IN ('requested','approved','rejected','picked_up','completed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_user  ON return_requests(user_id);

-- Refund lifecycle status (refunds table created by 007 without a status).
ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','approved','rejected','processed'));
