-- 023_coach_workflow.sql — Problem 4 (coach role): assigned customers + coach follow-ups.
-- Run in Supabase SQL Editor AFTER 022, in order. Additive only.
--
-- coach_assignments: which customers a coach is accountable for. One coach per
-- customer (UNIQUE customer_id); reassigning a customer updates the row.
-- coach_followups: coach-scheduled check-in appointments (date + note) with a
-- pending/completed lifecycle. "Nudge" delivery stays in scheduled_nudges;
-- follow-ups are appointments, not messages.

CREATE TABLE IF NOT EXISTS coach_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_assignments_coach ON coach_assignments(coach_id);

CREATE TABLE IF NOT EXISTS coach_followups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  note         text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_followups_coach ON coach_followups(coach_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_coach_followups_customer ON coach_followups(customer_id, scheduled_for);
