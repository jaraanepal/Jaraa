-- 007_dashboard_features.sql — 40+ dashboard features (P-12).
--
-- Deploy step (founder/ops): run in the Supabase SQL Editor, in order,
-- after 001_init.sql .. 006_notifications.sql (same as DEPLOY.md §1 step 3).
--
-- All statements are additive / IF (NOT) EXISTS, so re-running is safe.
-- No existing tables or columns are modified except ADD COLUMN IF NOT EXISTS
-- on orders (courier_name, tracking_id).

-- --------------------------------------------------------------------------
-- Doctor: follow-up scheduler (D6)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_ups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_on     date NOT NULL,
  note       text,
  done_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followups_doctor ON follow_ups(doctor_id, due_on);

-- --------------------------------------------------------------------------
-- Doctor: availability toggle (D9)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_availability (
  doctor_id  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'available',   -- 'available' | 'on_leave'
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Admin: refunds (A3)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_npr  int NOT NULL CHECK (amount_npr > 0),
  reason      text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

-- --------------------------------------------------------------------------
-- Admin: doctor/staff verification queue (A5)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_verifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_role text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  decided_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_verif_status ON staff_verifications(status);

-- --------------------------------------------------------------------------
-- Admin: support tickets (A7)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject    text NOT NULL,
  status     text NOT NULL DEFAULT 'open',   -- 'open' | 'answered' | 'closed'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  author_role text NOT NULL DEFAULT 'customer',
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_replies ON ticket_replies(ticket_id, created_at);

-- --------------------------------------------------------------------------
-- Admin: education articles / coach knowledge base (A8, C9)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS education_articles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en     text NOT NULL,
  title_ne     text,
  body_en      text NOT NULL,
  body_ne      text,
  is_published boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON education_articles(is_published, created_at DESC);

-- --------------------------------------------------------------------------
-- Pharmacy: courier + tracking on orders (P4); address checks (P5);
-- damage reports (P7); handover notes (P8)
-- --------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_id text;

CREATE TABLE IF NOT EXISTS order_checks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  check_type text NOT NULL,   -- 'name' | 'phone' | 'address'
  checked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, check_type)
);

CREATE TABLE IF NOT EXISTS damage_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_damage_order ON damage_reports(order_id);

CREATE TABLE IF NOT EXISTS handover_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_handover_order ON handover_notes(order_id, created_at);

-- --------------------------------------------------------------------------
-- Coach: challenges (C4)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en       text NOT NULL,
  title_ne       text,
  days           int NOT NULL DEFAULT 7 CHECK (days IN (7, 14, 30)),
  description_en text,
  description_ne text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenge_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_challenge_assign_user ON challenge_assignments(user_id);

-- --------------------------------------------------------------------------
-- Coach: timestamped customer notes (C5)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coach_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_notes_customer ON coach_notes(customer_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Coach: escalations to doctor (C6)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'open',   -- 'open' | 'acknowledged' | 'resolved'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status, created_at DESC);

-- --------------------------------------------------------------------------
-- Coach: scheduled reminders / future nudges (C7)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_nudges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_en  text NOT NULL,
  message_ne  text,
  send_at     timestamptz NOT NULL,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_nudges_coach ON scheduled_nudges(coach_id, send_at);

-- --------------------------------------------------------------------------
-- Coach: satisfaction ratings (C8)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS satisfaction_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_satisfaction_customer ON satisfaction_ratings(customer_id, created_at DESC);

-- --------------------------------------------------------------------------
-- Customer: kit wishlist (U6)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kit_id     uuid NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, kit_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);
