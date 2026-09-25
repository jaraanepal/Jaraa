-- 008_batch2.sql — Batch 2 dashboard features (D10–D18, A12–A20, P10–P18, C10–C18, U12–U20).
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor, in order,
-- after 001_init.sql .. 007_dashboard_features.sql (same as DEPLOY.md §1 step 3).
--
-- All statements are additive / IF (NOT) EXISTS, so re-running is safe.

-- --------------------------------------------------------------------------
-- Doctor: saved reply snippets (D12) — personal bilingual snippet library
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_snippets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body_en    text NOT NULL,
  body_ne    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snippets_doctor ON doctor_snippets(doctor_id);

-- --------------------------------------------------------------------------
-- Doctor: case bookmarks (D13)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_bookmarks (
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, doctor_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_doctor ON case_bookmarks(doctor_id);

-- --------------------------------------------------------------------------
-- Doctor: review checklists (D14) — per-case checklist with items
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_checklists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, doctor_id)
);
CREATE TABLE IF NOT EXISTS review_checklist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES review_checklists(id) ON DELETE CASCADE,
  label_en     text NOT NULL,
  label_ne     text,
  done         boolean NOT NULL DEFAULT false,
  sort         int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_items_cl ON review_checklist_items(checklist_id);

-- --------------------------------------------------------------------------
-- Doctor: photo re-requests (D16) — ask patient for specific angles
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  angles      text NOT NULL,                                   -- free text: which angles/views needed
  note        text,
  fulfilled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_requests_case ON photo_requests(case_id);

-- --------------------------------------------------------------------------
-- Admin: announcement banners (A13)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en   text NOT NULL,
  title_ne   text,
  body_en    text,
  body_ne    text,
  link       text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);

-- --------------------------------------------------------------------------
-- Admin: granular role permissions (A12)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role        text NOT NULL,                                   -- 'doctor' | 'admin' | 'pharmacy' | 'coach'
  permission  text NOT NULL,                                   -- e.g. 'kits.write', 'refunds.issue'
  granted     boolean NOT NULL DEFAULT true,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission)
);

-- --------------------------------------------------------------------------
-- Admin: login-attempt log (A15)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text,
  email      text,
  success    boolean NOT NULL,
  ip         text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(created_at DESC);

-- --------------------------------------------------------------------------
-- Admin: coupon / discount codes, cosmetic kits only (A16)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  kind           text NOT NULL DEFAULT 'percent',              -- 'percent' | 'fixed_npr'
  value          int NOT NULL CHECK (value > 0),
  max_uses       int,
  uses           int NOT NULL DEFAULT 0,
  min_order_npr  int NOT NULL DEFAULT 0,
  starts_at      timestamptz,
  ends_at        timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Admin: backup records (A19) — manual/automated backup status log
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  status      text NOT NULL DEFAULT 'ok',                      -- 'ok' | 'failed' | 'running'
  size_bytes  bigint,
  note        text,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backups_time ON backups(created_at DESC);

-- --------------------------------------------------------------------------
-- Admin: reusable notification templates (A20)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  title_en   text NOT NULL,
  title_ne   text,
  body_en    text,
  body_ne    text,
  link       text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Pharmacy: stock movement log (P10) — every stock change, who + why
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id     uuid NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  delta      int NOT NULL,
  reason     text,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_kit ON stock_movements(kit_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Pharmacy: packing checklist per order (P12)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packing_checks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  step       text NOT NULL,                                    -- e.g. 'kit', 'leaflet', 'invoice'
  done       boolean NOT NULL DEFAULT false,
  checked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, step)
);
CREATE INDEX IF NOT EXISTS idx_packing_checks_order ON packing_checks(order_id);

-- --------------------------------------------------------------------------
-- Pharmacy: kit batches with expiry (P17)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kit_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id      uuid NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  batch_no    text NOT NULL,
  expires_on  date,
  qty         int NOT NULL DEFAULT 0,
  supplier_id uuid,                                            -- FK added after suppliers table
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_batches_kit ON kit_batches(kit_id);

-- --------------------------------------------------------------------------
-- Pharmacy: supplier directory (P18)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  contact    text,
  phone      text,
  address    text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_kit_batches_supplier' AND table_name = 'kit_batches'
  ) THEN
    ALTER TABLE kit_batches
      ADD CONSTRAINT fk_kit_batches_supplier FOREIGN KEY (supplier_id)
      REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Coach: group challenges (C10)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenge_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en    text NOT NULL,
  title_ne    text,
  description_en text,
  description_ne text,
  starts_on   date,
  ends_on     date,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS challenge_group_members (
  group_id   uuid NOT NULL REFERENCES challenge_groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- --------------------------------------------------------------------------
-- Coach: milestone badges (C11)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge       text NOT NULL,                                   -- e.g. 'streak_7', 'first_rescan'
  awarded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_badges_user ON badges(user_id);

-- --------------------------------------------------------------------------
-- Coach: session summaries (C12)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_summaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_summaries_customer ON session_summaries(customer_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Coach: customer goals (C13)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_en    text NOT NULL,
  title_ne    text,
  target_date date,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_goals_customer ON customer_goals(customer_id);

-- --------------------------------------------------------------------------
-- Coach: habit-template library (C14)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS habit_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en       text NOT NULL,
  title_ne       text,
  description_en text,
  description_ne text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Coach: note templates (C16)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS note_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id   uuid REFERENCES users(id) ON DELETE CASCADE,     -- NULL = shared/global
  title      text NOT NULL,
  body_en    text NOT NULL,
  body_ne    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Coach: article assignments (C18)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid NOT NULL REFERENCES education_articles(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_article_assignments_user ON article_assignments(user_id);

-- --------------------------------------------------------------------------
-- Customer: symptom diary (U13) — free text, never AI-scored
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS symptom_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_symptom_entries_user ON symptom_entries(user_id, entry_date DESC);

-- --------------------------------------------------------------------------
-- Customer: water-intake tracker (U14)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_logs (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date   date NOT NULL DEFAULT CURRENT_DATE,
  glasses    int NOT NULL DEFAULT 0 CHECK (glasses >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, log_date)
);

-- --------------------------------------------------------------------------
-- Customer: sleep log (U15)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sleep_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date   date NOT NULL DEFAULT CURRENT_DATE,
  bedtime    text,
  wake_time  text,
  quality    int CHECK (quality BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_date)
);

-- --------------------------------------------------------------------------
-- Customer: notification preferences (U17)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_updates   boolean NOT NULL DEFAULT true,
  photo_requests boolean NOT NULL DEFAULT true,
  digest         boolean NOT NULL DEFAULT true,
  marketing      boolean NOT NULL DEFAULT false,
  quiet_from  text,                                            -- "22:00"
  quiet_to    text,                                            -- "07:00"
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Customer: emergency contacts (U20)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  phone      text NOT NULL,
  relation   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON emergency_contacts(user_id);

-- --------------------------------------------------------------------------
-- Customer: delivery instructions on profile (U19)
-- --------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS delivery_instructions text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_npr integer NOT NULL DEFAULT 0;

