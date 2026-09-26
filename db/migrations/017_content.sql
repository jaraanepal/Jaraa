-- 017_content.sql — P-10/P-11: content locale fields + library feed support.
-- Run in Supabase SQL Editor AFTER 016, in order. Additive only.
--
-- Roman-Nepali columns are NULLABLE and left NULL until a real human
-- translation exists. Clients fall back to English. NEVER machine-fill.

-- P-10: Roman-Nepali on articles + notifications (clients request en/ne/ro).
ALTER TABLE education_articles
  ADD COLUMN IF NOT EXISTS title_ro text,
  ADD COLUMN IF NOT EXISTS body_ro  text;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS title_ro text,
  ADD COLUMN IF NOT EXISTS body_ro  text;

-- P-11: content library categories + view tracking.
ALTER TABLE education_articles
  ADD COLUMN IF NOT EXISTS category text;

CREATE TABLE IF NOT EXISTS article_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES education_articles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_article_views_article ON article_views(article_id);
