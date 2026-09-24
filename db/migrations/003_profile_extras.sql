-- 003_profile_extras.sql — profile photo + order addresses (P4.5 / Problem 4.5).
--
-- NOTE: no new table — addresses are stored as a JSON array ON the profile
-- row (pragmatic per the build brief), so this migration only adds two
-- columns plus the private profile-photos storage bucket.
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor, in order,
-- after 001_init.sql and 002_app.sql (same as DEPLOY.md §1 step 3).

-- --------------------------------------------------------------------------
-- profiles: photo_path + addresses
-- --------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS photo_path text;           -- storage path in profile-photos

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS addresses jsonb NOT NULL DEFAULT '[]'::jsonb;  -- Address[] as JSON

-- --------------------------------------------------------------------------
-- Storage: private bucket for profile photos (signed URLs, 15-min expiry in app)
-- --------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', false)
ON CONFLICT (id) DO NOTHING;
