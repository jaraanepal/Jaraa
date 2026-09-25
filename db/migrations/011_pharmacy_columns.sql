-- 011_pharmacy_columns.sql — schema catch-up for the pharmacy tools.
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor AFTER 001..010,
-- in order. Safe to run on any DB state: every statement is additive
-- (IF NOT EXISTS), so it is a no-op for columns already added by 005/007/008/009/010.
--
-- Why this file exists:
--   1. orders.shipping_address was referenced by the server (checkout insert,
--      pharmacy queue/manifest/label/zone-stats) and the client (customer
--      name/phone/city on every order card) but was NEVER created by any of
--      001..010 — checkout and P14 zone stats 500 without it.
--   2. If the deploy DB is behind on 007..010, the pharmacy code degrades
--      gracefully (server retries without the missing column), but the
--      features themselves need their columns — this file adds them all so a
--      single run brings a behind DB up to date for pharmacy use.

-- --------------------------------------------------------------------------
-- orders.shipping_address — MISSING from every migration 001..010.
-- jsonb: { name, phone, city, address_line }. Written at checkout.
-- --------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address jsonb;

-- --------------------------------------------------------------------------
-- 007_dashboard_features catch-up (pharmacy: courier assignment)
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_id text;

-- --------------------------------------------------------------------------
-- 008_batch2 catch-up (pharmacy: delivery instructions, coupons)
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_npr integer NOT NULL DEFAULT 0;

-- --------------------------------------------------------------------------
-- 009_batch3 catch-up (pharmacy: pack timer, gifts, low-stock threshold)
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_started_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_completed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_recipient_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_recipient_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message text;
ALTER TABLE kits  ADD COLUMN IF NOT EXISTS low_stock_threshold int NOT NULL DEFAULT 5;

-- --------------------------------------------------------------------------
-- 010_batch4 catch-up (pharmacy: rush flag)
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_rush boolean NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- 005_kit_details catch-up (pharmacy stock tools need kits.stock)
-- --------------------------------------------------------------------------
ALTER TABLE kits ADD COLUMN IF NOT EXISTS stock int NOT NULL DEFAULT 0 CHECK (stock >= 0);
