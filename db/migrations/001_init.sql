-- ============================================================================
-- Jaraa PWA — initial schema (v1)
-- Blueprint §8: 22 core tables + OTP store. Run in the Jaraa Supabase project
-- SQL editor (a NEW project — never the Nepal Shop's).
-- Idempotent where practical; safe to re-run.
-- ============================================================================

-- ---------- enums ----------
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('customer','doctor','admin','pharmacy','coach'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE scan_status AS ENUM ('draft','submitted','in_review','reviewed','flagged'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE case_status AS ENUM ('queued','in_review','reviewed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE plan_status AS ENUM ('draft','approved'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE plan_item_kind AS ENUM ('habit','product','consult','referral'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE product_kind AS ENUM ('cosmetic','prescription'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_status AS ENUM ('pending','paid','fulfilling','shipped','delivered','cancelled','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending','succeeded','failed','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE consult_status AS ENUM ('requested','scheduled','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE photo_angle AS ENUM ('hairline','crown','parting','temples','shedding'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notif_channel AS ENUM ('sms','push','inapp','email'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION jaraa_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

-- ---------- 1. users ----------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text UNIQUE NOT NULL,                 -- E.164, e.g. +97798XXXXXXXX
  email         text,
  role          user_role NOT NULL DEFAULT 'customer',
  language      text NOT NULL DEFAULT 'ne',           -- ne | en
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION jaraa_updated_at();

-- ---------- 2. profiles ----------
CREATE TABLE IF NOT EXISTS profiles (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name              text,
  age_band          text,                             -- 16-22 | 23-30 | 31-40 | 41-50 | 50+
  gender            text,                             -- female | male | other
  is_minor          boolean NOT NULL DEFAULT false,
  guardian_name     text,
  guardian_phone    text,
  guardian_consented_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_profiles_updated ON profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION jaraa_updated_at();

-- ---------- 3. consents (immutable log) ----------
CREATE TABLE IF NOT EXISTS consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,                          -- photo | teleconsult | marketing | data
  version     text NOT NULL DEFAULT 'v1',
  granted_at  timestamptz NOT NULL DEFAULT now(),
  ip          text
);
CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(user_id);

-- ---------- 4. otp_codes (DB-backed OTP; spike logic ported to SQL) ----------
CREATE TABLE IF NOT EXISTS otp_codes (
  phone         text PRIMARY KEY,                     -- E.164
  code_hash     text NOT NULL,                        -- HMAC-SHA256(phone:code), secret in env
  expires_at    timestamptz NOT NULL,
  attempts_left int NOT NULL DEFAULT 3,
  request_count int NOT NULL DEFAULT 1,               -- per rolling hour window
  window_start  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- 5. scans ----------
CREATE TABLE IF NOT EXISTS scans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        scan_status NOT NULL DEFAULT 'draft',
  current_stage int NOT NULL DEFAULT 1,               -- 1 Kahani .. 4 Root Map
  version       int NOT NULL DEFAULT 1,
  active_path   text,                                 -- postpartum | medical-flag | young-starter | stress | sparse-story | standard
  answers       jsonb NOT NULL DEFAULT '{}',          -- stage-3 chat answers
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id);
DROP TRIGGER IF EXISTS trg_scans_updated ON scans;
CREATE TRIGGER trg_scans_updated BEFORE UPDATE ON scans FOR EACH ROW EXECUTE FUNCTION jaraa_updated_at();

-- ---------- 6. timeline_events ----------
CREATE TABLE IF NOT EXISTS timeline_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id          uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  event_type       text NOT NULL,                      -- shedding_onset | illness_fever | childbirth | crash_diet | medication_change | stress_period | moved_city_water | hair_treatment | other
  occurred_on      date,
  position_months_ago int,                             -- position on the 24-month timeline
  note             text,
  followup_answers jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tl_scan ON timeline_events(scan_id);

-- ---------- 7. photos ----------
CREATE TABLE IF NOT EXISTS photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id       uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  angle         photo_angle NOT NULL,
  storage_path  text NOT NULL,                        -- private bucket path
  thumb_path    text,
  consent_id    uuid REFERENCES consents(id),
  ai_quality    jsonb,                                -- Gemini quality check result (never a diagnosis)
  width         int,
  height        int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, angle)
);
CREATE INDEX IF NOT EXISTS idx_photos_scan ON photos(scan_id);

-- ---------- 8. root_scores ----------
CREATE TABLE IF NOT EXISTS root_scores (
  scan_id   uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  root      text NOT NULL,                            -- nutrition | stress_sleep | hormones | scalp | damage | medical_family
  score     int NOT NULL CHECK (score BETWEEN 0 AND 100),
  signals   jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scan_id, root)
);

-- ---------- 9. red_flags ----------
CREATE TABLE IF NOT EXISTS red_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id     uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  flag_type   text NOT NULL,                          -- RF1..RF7
  detail      text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rf_scan ON red_flags(scan_id);

-- ---------- 10. scan_rules (adaptive engine, admin-editable) ----------
CREATE TABLE IF NOT EXISTS scan_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority          int NOT NULL,
  trigger_condition jsonb NOT NULL,                   -- e.g. {"pin":"childbirth","within_months":12}
  action            text NOT NULL,                    -- activate_path | raise_flag | prune | extra_questions
  action_params     jsonb NOT NULL DEFAULT '{}',
  copy_ne           text,
  copy_en           text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------- 11. cases ----------
CREATE TABLE IF NOT EXISTS cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id           uuid NOT NULL UNIQUE REFERENCES scans(id) ON DELETE CASCADE,
  assigned_doctor_id uuid REFERENCES users(id),
  priority          int NOT NULL DEFAULT 0,           -- red-flag cases sort first
  sla_due_at        timestamptz,                      -- review within 24h of submit
  status            case_status NOT NULL DEFAULT 'queued',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status, priority DESC);
DROP TRIGGER IF EXISTS trg_cases_updated ON cases;
CREATE TRIGGER trg_cases_updated BEFORE UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION jaraa_updated_at();

-- ---------- 12. photo_annotations ----------
CREATE TABLE IF NOT EXISTS photo_annotations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id   uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  doctor_id  uuid NOT NULL REFERENCES users(id),
  shape      jsonb NOT NULL,                           -- {type:"circle"|"arrow", x,y,...} in relative coords
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ann_photo ON photo_annotations(photo_id);

-- ---------- 13. plans ----------
CREATE TABLE IF NOT EXISTS plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id     uuid NOT NULL REFERENCES users(id),
  status        plan_status NOT NULL DEFAULT 'draft',
  version       int NOT NULL DEFAULT 1,
  review_notes  text,
  rescan_due_on date,
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_plans_updated ON plans;
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION jaraa_updated_at();

-- ---------- 14. plan_items ----------
CREATE TABLE IF NOT EXISTS plan_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id   uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  kind      plan_item_kind NOT NULL,
  title_ne  text,
  title_en  text,
  detail    jsonb NOT NULL DEFAULT '{}',
  sort      int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_plan ON plan_items(plan_id);

-- ---------- 15. products ----------
CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ne     text,
  name_en     text NOT NULL,
  kind        product_kind NOT NULL DEFAULT 'cosmetic',  -- prescription rows inert while flag OFF
  price_npr   int NOT NULL CHECK (price_npr >= 0),
  image_url   text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 16. kits ----------
CREATE TABLE IF NOT EXISTS kits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid REFERENCES plans(id),              -- null = templated kit
  name_ne     text,
  name_en     text NOT NULL,
  product_ids uuid[] NOT NULL DEFAULT '{}',
  total_npr   int NOT NULL CHECK (total_npr >= 0),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 17. orders ----------
CREATE TABLE IF NOT EXISTS orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no        text UNIQUE NOT NULL,                -- human-readable, e.g. JR-2026-000123
  user_id         uuid NOT NULL REFERENCES users(id),
  kit_id          uuid REFERENCES kits(id),
  status          order_status NOT NULL DEFAULT 'pending',
  subtotal_npr    int NOT NULL DEFAULT 0,
  shipping_npr    int NOT NULL DEFAULT 0,
  total_npr       int NOT NULL DEFAULT 0,
  payment_method  text,                                -- esewa | khalti | cod
  idempotency_key text UNIQUE NOT NULL,
  fulfilment_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION jaraa_updated_at();

-- ---------- 18. payments ----------
CREATE TABLE IF NOT EXISTS payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider     text NOT NULL,                          -- esewa | khalti | cod
  provider_ref text,
  amount_npr   int NOT NULL,
  status       payment_status NOT NULL DEFAULT 'pending',
  webhook_log  jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- ---------- 19. consults (booking UI + API built; FLAGGED OFF until legal) ----------
CREATE TABLE IF NOT EXISTS consults (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  doctor_id   uuid REFERENCES users(id),
  scheduled_at timestamptz,
  meet_link   text,
  status      consult_status NOT NULL DEFAULT 'requested',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 20. progress_checkins ----------
CREATE TABLE IF NOT EXISTS progress_checkins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id           uuid REFERENCES plans(id),
  scan_id           uuid REFERENCES scans(id),        -- re-scan link for compare
  shedding_estimate int,                              -- daily hair-count estimate (habit framing)
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON progress_checkins(user_id);

-- ---------- 21. notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      notif_channel NOT NULL,
  template     text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  scheduled_for timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_due ON notifications(scheduled_for) WHERE sent_at IS NULL;

-- ---------- 22. feature_flags ----------
CREATE TABLE IF NOT EXISTS feature_flags (
  key         text PRIMARY KEY,
  is_enabled  boolean NOT NULL DEFAULT false,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 23. audit_log ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,                            -- case.view | plan.approve | flag.toggle | ...
  entity     text NOT NULL,
  entity_id  text,
  at         timestamptz NOT NULL DEFAULT now(),
  ip         text
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- ============================================================================
-- RLS: enabled everywhere; the server uses the service-role key (bypasses RLS).
-- Owner-scoped policies below are defense-in-depth for any anon-key access.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
           AND tablename NOT LIKE 'pg_%' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- users: a user reads/updates their own row
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL TO authenticated
  USING (id = (auth.uid())::uuid) WITH CHECK (id = (auth.uid())::uuid);

-- scans / timeline / photos / root_scores / red_flags: owner only
DROP POLICY IF EXISTS scans_owner ON scans;
CREATE POLICY scans_owner ON scans FOR ALL TO authenticated
  USING (user_id = (auth.uid())::uuid) WITH CHECK (user_id = (auth.uid())::uuid);
DROP POLICY IF EXISTS tl_owner ON timeline_events;
CREATE POLICY tl_owner ON timeline_events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM scans s WHERE s.id = scan_id AND s.user_id = (auth.uid())::uuid));
DROP POLICY IF EXISTS photos_owner ON photos;
CREATE POLICY photos_owner ON photos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM scans s WHERE s.id = scan_id AND s.user_id = (auth.uid())::uuid));
DROP POLICY IF EXISTS scores_owner ON root_scores;
CREATE POLICY scores_owner ON root_scores FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM scans s WHERE s.id = scan_id AND s.user_id = (auth.uid())::uuid));
DROP POLICY IF EXISTS rf_owner ON red_flags;
CREATE POLICY rf_owner ON red_flags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM scans s WHERE s.id = scan_id AND s.user_id = (auth.uid())::uuid));

-- consents / profiles / checkins / orders / payments / notifications: owner only
DROP POLICY IF EXISTS consents_owner ON consents;
CREATE POLICY consents_owner ON consents FOR ALL TO authenticated
  USING (user_id = (auth.uid())::uuid) WITH CHECK (user_id = (auth.uid())::uuid);
DROP POLICY IF EXISTS profiles_owner ON profiles;
CREATE POLICY profiles_owner ON profiles FOR ALL TO authenticated
  USING (user_id = (auth.uid())::uuid) WITH CHECK (user_id = (auth.uid())::uuid);
DROP POLICY IF EXISTS checkins_owner ON progress_checkins;
CREATE POLICY checkins_owner ON progress_checkins FOR ALL TO authenticated
  USING (user_id = (auth.uid())::uuid) WITH CHECK (user_id = (auth.uid())::uuid);
DROP POLICY IF EXISTS orders_owner ON orders;
CREATE POLICY orders_owner ON orders FOR ALL TO authenticated
  USING (user_id = (auth.uid())::uuid) WITH CHECK (user_id = (auth.uid())::uuid);
DROP POLICY IF EXISTS payments_owner ON payments;
CREATE POLICY payments_owner ON payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.user_id = (auth.uid())::uuid));
DROP POLICY IF EXISTS notif_owner ON notifications;
CREATE POLICY notif_owner ON notifications FOR ALL TO authenticated
  USING (user_id = (auth.uid())::uuid);

-- public read: active cosmetic products/kits (prescription hidden while flag off — app enforces too)
DROP POLICY IF EXISTS products_public ON products;
CREATE POLICY products_public ON products FOR SELECT TO anon, authenticated
  USING (is_active AND kind = 'cosmetic');
DROP POLICY IF EXISTS kits_public ON kits;
CREATE POLICY kits_public ON kits FOR SELECT TO anon, authenticated USING (is_active);

-- scan_rules / feature_flags: readable by all authenticated (engine needs them), writable by service role
DROP POLICY IF EXISTS rules_read ON scan_rules;
CREATE POLICY rules_read ON scan_rules FOR SELECT TO anon, authenticated USING (is_active);
DROP POLICY IF EXISTS flags_read ON feature_flags;
CREATE POLICY flags_read ON feature_flags FOR SELECT TO anon, authenticated USING (true);

-- ============================================================================
-- Storage: private bucket for scalp photos (signed URLs, 15-min expiry in app)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('scan-photos', 'scan-photos', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Seeds: feature flags (medical modules OFF — the locked boundary)
-- ============================================================================
INSERT INTO feature_flags (key, is_enabled) VALUES
  ('root_scan', true),
  ('cosmetic_kits', true),
  ('teleconsult_booking', false),
  ('prescription_commerce', false)
ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;

-- ============================================================================
-- Seeds: scan_rules v1 (from docs/ROOT-SCAN-FLOW.md)
-- ============================================================================
INSERT INTO scan_rules (priority, trigger_condition, action, action_params, copy_ne, copy_en) VALUES
  (100, '{"pin":"childbirth","within_months":12}', 'activate_path', '{"path":"postpartum"}',
   'बधाई छ! प्रसवपछि कपाल झर्नु सामान्य हो।', 'Postpartum shedding is normal — here is your 12-month watch plan.'),
  (90,  '{"any_red_flag":true}', 'raise_flag', '{"block_plan":true}',
   'डाक्टरले हेर्नुपर्ने संकेत देखियो।', 'We spotted something a doctor should look at first.'),
  (80,  '{"pin":"medication_change","still_taking":true}', 'raise_flag', '{"flag":"RF6","block_plan":true}',
   'औषधिसम्बन्धी जाँच आवश्यक छ।', 'A medication check is needed before we continue.'),
  (70,  '{"age_band":"16-22","gender":"male"}', 'prune', '{"prune":["hormones"],"boost":["damage","scalp"]}',
   NULL, NULL),
  (60,  '{"pin":"stress_period","sleep_hours_lt":6}', 'activate_path', '{"path":"stress"}',
   'निन्द्रा सुधारमा ध्यान दिऔं।', 'Let us focus on improving your sleep.'),
  (50,  '{"only_pin":"shedding_onset"}', 'extra_questions', '{"per_root":3}',
   NULL, NULL),
  (10,  '{}', 'standard_path', '{}', NULL, NULL)
ON CONFLICT DO NOTHING;
