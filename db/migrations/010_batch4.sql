-- 010_batch4.sql — Batch 4 dashboard features (D28–D45, A30–A47, P28–P45, C28–C45, U30–U47).
--
-- Run in the Supabase SQL Editor AFTER 001..009, in order.
-- All statements are additive / IF (NOT) EXISTS — re-running is safe.

-- ============================================================================
-- DOCTOR (D28–D45)
-- ============================================================================

-- D32: doctor-only internal comment thread per case
CREATE TABLE IF NOT EXISTS case_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_comments_case ON case_comments(case_id, created_at);

-- D33: non-diagnostic concern tags per case
CREATE TABLE IF NOT EXISTS case_concern_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tag        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_case_concern_tags_case ON case_concern_tags(case_id);

-- D40: saved queue filter presets, doctor-scoped
CREATE TABLE IF NOT EXISTS queue_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  filters    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_filters_doctor ON queue_filters(doctor_id);

-- D30: SLA pause timestamp on cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS sla_paused_at timestamptz;

-- ============================================================================
-- ADMIN (A30–A47)
-- ============================================================================

-- A30: role-based dashboard card configuration
CREATE TABLE IF NOT EXISTS dashboard_configs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role       text NOT NULL UNIQUE,                       -- doctor | admin | pharmacy | coach | customer
  config     jsonb NOT NULL DEFAULT '{}',                -- { hiddenCards: [...] }
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A37: email delivery log (Brevo sends)
CREATE TABLE IF NOT EXISTS email_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email   text NOT NULL,
  template   text NOT NULL,
  status     text NOT NULL DEFAULT 'sent',               -- sent | failed
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_logs(created_at DESC);

-- A44: internal admin-only notices
CREATE TABLE IF NOT EXISTS admin_notices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en   text NOT NULL,
  title_ne   text,
  body_en    text,
  body_ne    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_notice_reads (
  admin_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notice_id  uuid NOT NULL REFERENCES admin_notices(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, notice_id)
);

-- A45: consent text versions
CREATE TABLE IF NOT EXISTS consent_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,                              -- signup | scan | photo
  version    int NOT NULL DEFAULT 1,
  text_en    text NOT NULL,
  text_ne    text,
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

-- A33: expiry on doctor verification documents
ALTER TABLE staff_verifications ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- A43: scheduled publishing for announcements
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS publish_at timestamptz;

-- ============================================================================
-- PHARMACY (P28–P45)
-- ============================================================================

-- P31: failed delivery attempts
CREATE TABLE IF NOT EXISTS delivery_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     text NOT NULL,                              -- failed | rescheduled | delivered
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_order ON delivery_attempts(order_id, created_at DESC);

-- P33: physical stock count audits
CREATE TABLE IF NOT EXISTS stock_counts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id      uuid NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  system_qty  int NOT NULL,
  counted_qty int NOT NULL,
  variance    int NOT NULL,
  counted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_kit ON stock_counts(kit_id, created_at DESC);

-- P38: kit substitution log
CREATE TABLE IF NOT EXISTS substitutions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_kit_id uuid REFERENCES kits(id) ON DELETE SET NULL,
  to_kit_id   uuid REFERENCES kits(id) ON DELETE SET NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_substitutions_order ON substitutions(order_id);

-- P39: delivery photo proof (storage_path in the existing scan-photos bucket)
CREATE TABLE IF NOT EXISTS delivery_proofs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_order ON delivery_proofs(order_id);

-- P43: pharmacy-initiated refund requests (admin approves via A3)
CREATE TABLE IF NOT EXISTS refund_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  status     text NOT NULL DEFAULT 'pending',            -- pending | approved | rejected
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status, created_at DESC);

-- P44: non-dispatch days
CREATE TABLE IF NOT EXISTS dispatch_holidays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date       date NOT NULL UNIQUE,
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- P45: courier damage claims
CREATE TABLE IF NOT EXISTS courier_claims (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_name text NOT NULL,
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  amount_npr   int NOT NULL DEFAULT 0,
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'open',             -- open | filed | settled
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courier_claims_status ON courier_claims(status, created_at DESC);

-- P34: rush-order flag
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_rush boolean NOT NULL DEFAULT false;

-- ============================================================================
-- COACH (C28–C45)
-- ============================================================================

-- C29: customer feedback on their coach (coach sees aggregates only)
CREATE TABLE IF NOT EXISTS coach_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_feedback_coach ON coach_feedback(coach_id, created_at DESC);

-- C30: streak freezes (one per customer per month, enforced in app code)
CREATE TABLE IF NOT EXISTS streak_freezes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frozen_date date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, frozen_date)
);

-- C32: coach-defined customer tags
CREATE TABLE IF NOT EXISTS customer_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, customer_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_customer_tags_coach ON customer_tags(coach_id, tag);

-- C34: handover notes when a customer moves between coaches
CREATE TABLE IF NOT EXISTS coach_handovers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_coach_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  to_coach_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  note          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_handovers_customer ON coach_handovers(customer_id, created_at DESC);

-- C43: anonymized peer tips shared between coaches (no patient data)
CREATE TABLE IF NOT EXISTS coach_tips (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_tips_created ON coach_tips(created_at DESC);

-- C45: two-question end-of-challenge survey
CREATE TABLE IF NOT EXISTS challenge_surveys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  q1_rating     int NOT NULL CHECK (q1_rating >= 1 AND q1_rating <= 5),
  q2_text       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id)
);

-- C39: read receipt on assigned articles
ALTER TABLE article_assignments ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- C40: mark challenges as reusable templates
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

-- C42: outcome recorded after an escalation resolves
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS outcome text;

-- ============================================================================
-- CUSTOMER (U30–U47)
-- ============================================================================

-- U37: app feedback / feature suggestions
CREATE TABLE IF NOT EXISTS app_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  message    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON app_feedback(created_at DESC);

-- U40: per-kit usage reminders
CREATE TABLE IF NOT EXISTS kit_reminders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kit_id     uuid REFERENCES kits(id) ON DELETE SET NULL,
  label_en   text NOT NULL,
  label_ne   text,
  remind_at  timestamptz NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_reminders_user ON kit_reminders(user_id, remind_at);

-- U42: product usage log (each kit application)
CREATE TABLE IF NOT EXISTS kit_usages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kit_id     uuid REFERENCES kits(id) ON DELETE SET NULL,
  used_at    timestamptz NOT NULL DEFAULT now(),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_usages_user ON kit_usages(user_id, used_at DESC);

-- U30: content language preference (separate from UI language)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS content_language text;

-- U46: default payment method preference
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_payment text;
