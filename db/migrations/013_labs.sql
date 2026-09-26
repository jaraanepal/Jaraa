-- 013_labs.sql — P-6: at-home lab test booking.
-- Run in Supabase SQL Editor AFTER 012, in order. Additive only.
--
-- NOTE: lab_providers is intentionally left EMPTY. There is no lab partner
-- yet — do NOT insert fake provider rows. The app must show "coming soon"
-- until a real partnership exists.

CREATE TABLE IF NOT EXISTS lab_providers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en    text NOT NULL,
  name_ne    text,
  is_active  boolean NOT NULL DEFAULT true,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_tests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid REFERENCES lab_providers(id) ON DELETE SET NULL,
  name_en        text NOT NULL,
  name_ne        text,
  description_en text,
  description_ne text,
  price_npr      int NOT NULL CHECK (price_npr >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_tests_active ON lab_tests(is_active);

CREATE TABLE IF NOT EXISTS lab_bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id      uuid NOT NULL REFERENCES lab_tests(id) ON DELETE RESTRICT,
  scheduled_on date,
  slot         text,
  address      jsonb NOT NULL DEFAULT '{}',
  phone        text NOT NULL,
  status       text NOT NULL DEFAULT 'booked'
               CHECK (status IN ('booked','sample_collected','report_ready','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_user   ON lab_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_lab_bookings_status ON lab_bookings(status);

CREATE TABLE IF NOT EXISTS lab_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL UNIQUE REFERENCES lab_bookings(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
