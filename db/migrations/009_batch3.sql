-- 009_batch3.sql — Batch 3 dashboard features (D19–D27, A21–A29, P19–P27, C19–C27, U21–U29).
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor, in order,
-- after 001_init.sql .. 008_batch2.sql (same as DEPLOY.md §1 step 3).
--
-- All statements are additive / IF (NOT) EXISTS, so re-running is safe.

-- --------------------------------------------------------------------------
-- Doctor: second-opinion requests (D22)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS second_opinions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',                -- pending | accepted | declined | done
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_second_opinions_case ON second_opinions(case_id);
CREATE INDEX IF NOT EXISTS idx_second_opinions_reviewer ON second_opinions(reviewer_id, status);

-- --------------------------------------------------------------------------
-- Doctor: triage presets (D24) — one-tap priority presets, doctor-scoped
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS triage_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  priority   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_triage_presets_doctor ON triage_presets(doctor_id);

-- --------------------------------------------------------------------------
-- Doctor: case archive (D20) — additive column
-- --------------------------------------------------------------------------
ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- --------------------------------------------------------------------------
-- Admin: order disputes (A21) — separate queue from support tickets
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'open',                   -- open | in_review | resolved | rejected
  resolution  text,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(order_id);

-- --------------------------------------------------------------------------
-- Admin: reusable plan-item templates (A24) — doctors can insert into plans
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en   text NOT NULL,
  title_ne   text,
  items      jsonb NOT NULL DEFAULT '[]',                     -- PlanItemInput[]
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Admin: scheduled order CSV exports (A27)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS export_schedules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL DEFAULT 'orders',                  -- orders
  frequency  text NOT NULL DEFAULT 'weekly',                  -- daily | weekly | monthly
  is_active  boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Admin: per-staff onboarding checklist (A28)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_checklists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  items      jsonb NOT NULL DEFAULT '[]',                     -- [{key, done}]
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- --------------------------------------------------------------------------
-- Pharmacy: damaged-stock quarantine (P19)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quarantine (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id      uuid NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  qty         int NOT NULL DEFAULT 1,
  reason      text,
  status      text NOT NULL DEFAULT 'quarantined',            -- quarantined | released | written_off
  reported_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quarantine_kit ON quarantine(kit_id, status);

-- --------------------------------------------------------------------------
-- Pharmacy: packaging materials stock (P24)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packaging_materials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  qty           int NOT NULL DEFAULT 0,
  unit          text,
  low_threshold int NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Pharmacy: internal order notes (P27) — distinct from handover notes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(order_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Pharmacy: pack timer columns (P23); low-stock threshold (P26)
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_started_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_completed_at timestamptz;
ALTER TABLE kits ADD COLUMN IF NOT EXISTS low_stock_threshold int NOT NULL DEFAULT 5;

-- --------------------------------------------------------------------------
-- Coach: per-customer onboarding checklist (C24)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  steps      jsonb NOT NULL DEFAULT '[]',                     -- [{key, done}]
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- --------------------------------------------------------------------------
-- Coach: availability status (C26)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_availability (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'available',               -- available | on_leave
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id)
);

-- --------------------------------------------------------------------------
-- Coach: recurring nudges (C21) — additive column
-- --------------------------------------------------------------------------
ALTER TABLE scheduled_nudges ADD COLUMN IF NOT EXISTS recurrence text;

-- --------------------------------------------------------------------------
-- Coach: streak leaderboard opt-in (C19) — toggle shipped with the board
-- --------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS leaderboard_opt_in boolean NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- Customer/doctor: case Q&A messages (U21; doctor replies land in batch 5)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role text NOT NULL DEFAULT 'customer',               -- customer | doctor
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_messages_case ON case_messages(case_id, created_at);

-- --------------------------------------------------------------------------
-- Customer: follow-up review requests, appointment-free (U22)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id    uuid REFERENCES cases(id) ON DELETE SET NULL,
  reason     text,
  status     text NOT NULL DEFAULT 'pending',                 -- pending | done
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_requests_user ON review_requests(user_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Customer/admin: moderated community tips (U23 + A23)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_tips (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  body         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',               -- pending | approved | rejected
  moderated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_tips_status ON community_tips(status, created_at DESC);

-- --------------------------------------------------------------------------
-- Customer: loyalty points ledger (U25) — balance derived from orders + ledger
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_points (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points     int NOT NULL,                                    -- +earn / -redeem adjustments
  reason     text,
  order_id   uuid REFERENCES orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_points(user_id);

-- --------------------------------------------------------------------------
-- Customer: medication-free routine library (U29) — admin-curated
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routine_library (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en     text NOT NULL,
  title_ne     text,
  body_en      text NOT NULL,
  body_ne      text,
  category     text,
  is_published boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Customer: gift-a-kit order columns (U26)
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_recipient_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_recipient_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message text;

-- D26: transfer reason + from/to doctor ids persisted on case.transfer audit rows
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS detail text;
