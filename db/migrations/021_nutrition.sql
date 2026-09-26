-- 021_nutrition.sql — P-16: diet plans + habit check-ins + food database.
-- Run in Supabase SQL Editor AFTER 020, in order. Additive only.
--
-- HONESTY NOTICE: there is NO verified Nepal food-nutrition database.
-- Every seeded food row has source='estimate'. Values are rough guides,
-- never presented as lab-verified. Build the real table over time; do NOT
-- flip source to 'verified' without a real source.

-- Starter Nepali food table (estimates only).
CREATE TABLE IF NOT EXISTS foods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en    text NOT NULL,
  name_ne    text,
  name_ro    text,
  protein_g  numeric NOT NULL CHECK (protein_g >= 0),
  calories   int NOT NULL CHECK (calories >= 0),
  serving    text NOT NULL,
  source     text NOT NULL DEFAULT 'estimate',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed: common Nepali foods, ALL marked source='estimate'.
INSERT INTO foods (name_en, name_ne, name_ro, protein_g, calories, serving, source) VALUES
  ('Dal-bhat set (1 plate)', 'दाल-भात', 'dal-bhat', 18, 650, '1 plate', 'estimate'),
  ('Dal (1 katori)', 'दाल', 'dal', 7, 170, '1 katori (150ml)', 'estimate'),
  ('Bhat / white rice (1 cup cooked)', 'भात', 'bhat', 4, 205, '1 cup cooked', 'estimate'),
  ('Tarkari (mixed veg, 1 katori)', 'तरकारी', 'tarkari', 3, 120, '1 katori', 'estimate'),
  ('Chicken curry (1 katori)', 'कुखुराको मासु', 'kukhura ko masu', 22, 280, '1 katori', 'estimate'),
  ('Boiled egg (1)', 'उमालेको अण्डा', 'umaleko anda', 6, 78, '1 egg', 'estimate'),
  ('Buff curry (1 katori)', 'राँगाको मासु', 'rango ko masu', 24, 320, '1 katori', 'estimate'),
  ('Milk (1 glass)', 'दूध', 'dudh', 8, 150, '1 glass (250ml)', 'estimate'),
  ('Curd / dahi (1 katori)', 'दही', 'dahi', 6, 120, '1 katori', 'estimate'),
  ('Soya chunks (dry, 50g)', 'सोया चंक्स', 'soya chunks', 26, 175, '50g dry', 'estimate'),
  ('Peanuts (1 handful)', 'बदाम', 'badam', 7, 170, '30g handful', 'estimate'),
  ('Chana / chickpeas boiled (1 katori)', 'चना', 'chana', 9, 210, '1 katori', 'estimate'),
  ('Paneer (100g)', 'पनिर', 'paneer', 18, 265, '100g', 'estimate'),
  ('Momo chicken (4 pcs)', 'चिकेन मोमो', 'chicken momo', 12, 260, '4 pieces', 'estimate'),
  ('Roti (1)', 'रोटी', 'roti', 3, 100, '1 roti', 'estimate')
ON CONFLICT DO NOTHING;

-- Admin diet plan templates.
CREATE TABLE IF NOT EXISTS diet_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_en         text NOT NULL,
  title_ne         text,
  title_ro         text,
  description_en   text,
  description_ne   text,
  protein_target_g int,
  items            jsonb NOT NULL DEFAULT '[]',
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Per-user plan assignment (one active row per user by convention).
CREATE TABLE IF NOT EXISTS diet_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES diet_plans(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  starts_on   date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diet_assignments_user ON diet_assignments(user_id);

-- Daily habit check-ins: idempotent per (user, date, habit_key).
CREATE TABLE IF NOT EXISTS habit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date   date NOT NULL,
  habit_key  text NOT NULL,
  done       boolean NOT NULL DEFAULT true,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_date, habit_key)
);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs(user_id, log_date);
