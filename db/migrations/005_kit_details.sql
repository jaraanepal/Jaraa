-- 005_kit_details.sql — rich kit catalogue fields for admin kit management
-- (P: admin kit CRUD + kit image uploads).
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor, in order,
-- after 001_init.sql .. 004_password_resets.sql (same as DEPLOY.md §1 step 3).
--
-- All columns are additive (IF NOT EXISTS) so re-running is safe.

-- --------------------------------------------------------------------------
-- kits: catalogue detail columns
-- --------------------------------------------------------------------------
ALTER TABLE kits
  ADD COLUMN IF NOT EXISTS category text;                                  -- e.g. 'hair-oil', 'shampoo', 'combo'

ALTER TABLE kits
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';            -- public kit-images URLs

ALTER TABLE kits
  ADD COLUMN IF NOT EXISTS whats_included text;                            -- what's inside the kit

ALTER TABLE kits
  ADD COLUMN IF NOT EXISTS usage_instructions text;                        -- how to use

ALTER TABLE kits
  ADD COLUMN IF NOT EXISTS stock int NOT NULL DEFAULT 0 CHECK (stock >= 0); -- units on hand

ALTER TABLE kits
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- kits did not have an updated_at trigger (unlike users/orders); add it now.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_kits_updated') THEN
    CREATE TRIGGER trg_kits_updated BEFORE UPDATE ON kits
      FOR EACH ROW EXECUTE FUNCTION jaraa_updated_at();
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Storage: PUBLIC bucket for kit catalogue images (unlike scan-photos /
-- profile-photos, these are marketing assets and must be publicly readable).
-- The server always writes with the service-role key, so no storage RLS
-- policies are needed for writes; reads are public by bucket flag.
-- --------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('kit-images', 'kit-images', true)
ON CONFLICT (id) DO NOTHING;
