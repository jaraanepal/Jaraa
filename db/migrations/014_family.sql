-- 014_family.sql — P-7: family member profiles under one account.
-- Run in Supabase SQL Editor AFTER 013, in order. Additive only.
--
-- Privacy model: a member's scans/orders live under their OWN user account
-- (member_user_id). The owner sees the member list (names) but NEVER member
-- data until the member flips data_shared=true themselves.

CREATE TABLE IF NOT EXISTS family_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name           text NOT NULL,
  relation       text,
  status         text NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited','active')),
  invite_token   text UNIQUE,
  data_shared    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_family_members_owner  ON family_members(owner_id);
CREATE INDEX IF NOT EXISTS idx_family_members_member ON family_members(member_user_id);
