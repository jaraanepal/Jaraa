-- 018_community.sql — P-12: community Q&A (customers ask, doctors answer).
-- Run in Supabase SQL Editor AFTER 017, in order. Additive only.

CREATE TABLE IF NOT EXISTS qa_questions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'open'
             CHECK (status IN ('open','answered','flagged','hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_questions_status ON qa_questions(status);

CREATE TABLE IF NOT EXISTS qa_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES qa_questions(id) ON DELETE CASCADE,
  doctor_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_answers_question ON qa_answers(question_id);

-- Doctor "agree" votes (peer second opinions). One per doctor per answer.
CREATE TABLE IF NOT EXISTS qa_answer_agrees (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id  uuid NOT NULL REFERENCES qa_answers(id) ON DELETE CASCADE,
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (answer_id, doctor_id)
);

-- Helpfulness votes from any signed-in user. One per user per answer.
CREATE TABLE IF NOT EXISTS qa_helpfulness (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id  uuid NOT NULL REFERENCES qa_answers(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (answer_id, user_id)
);

-- Flags on questions or answers (moderation queue for admin).
CREATE TABLE IF NOT EXISTS qa_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid REFERENCES qa_questions(id) ON DELETE CASCADE,
  answer_id   uuid REFERENCES qa_answers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (question_id IS NOT NULL OR answer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_qa_flags_q ON qa_flags(question_id);
CREATE INDEX IF NOT EXISTS idx_qa_flags_a ON qa_flags(answer_id);
