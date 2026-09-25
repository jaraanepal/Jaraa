/**
 * Batch-4 coach API (C28–C45) + the C29/C39/C45 customer-side endpoints.
 * Thin wrappers around the exported `request()` only; all types live here.
 * Habit-only coaching — nothing medical/diagnostic.
 */
import { request } from "./client";

/** C28 — certificate data for a completed challenge assignment. */
export interface ChallengeCertificate {
  assignment_id: string;
  customer_name: string | null;
  challenge_title_en: string;
  challenge_title_ne: string | null;
  completed_at: string;
}

/** C29 — aggregate ONLY (avg + count). Individual rows never reach the coach. */
export interface CoachFeedbackAggregate {
  avg: number | null;
  count: number;
}

/** C30 — streak freeze row. */
export interface StreakFreeze {
  id: string;
  customer_id: string;
  coach_id: string;
  frozen_date: string;
  created_at: string;
}

/** C31 — nudge stats. Honest: open_rate is always null — scheduled_nudges
 *  records sent_at only, so open/read tracking does not exist. */
export interface NudgeStats {
  total: number;
  sent: number;
  pending: number;
  open_rate: null;
  note: string;
}

/** C32 — customer tag (coach-scoped). */
export interface CustomerTag {
  id: string;
  coach_id: string;
  customer_id: string;
  tag: string;
  created_at: string;
}

/** C33 — scheduled nudge row (bulk results reuse the C7 shape). */
export interface BulkNudge {
  id: string;
  coach_id: string;
  user_id: string;
  message_en: string;
  message_ne: string | null;
  send_at: string;
  sent_at: string | null;
  created_at: string;
}

/** C34 — handover note between coaches. */
export interface CoachHandover {
  id: string;
  customer_id: string;
  from_coach_id: string | null;
  to_coach_id: string | null;
  note: string;
  created_at: string;
}

/** C35 — inactive customer row (reuses the missed-checkins shape). */
export interface InactiveCustomer {
  user_id: string;
  name: string | null;
  days_missed: number;
}

/** C37 — own activity since Monday 00:00 UTC. */
export interface WeeklyReport {
  notes: number;
  nudges: number;
  escalations: number;
  weekStart: string;
}

/** C38 — one milestone timeline entry. */
export interface Milestone {
  kind: "badge" | "goal" | "challenge";
  title: string;
  at: string;
}

/**
 * C41 — computed journey stage. Rule (documented, simplified, habit-only):
 * - "new":       no check-ins yet and signed up < 7 days ago.
 * - "active":    check-in within the last 7 days, no 21d+ gap before it.
 * - "returning": check-in within the last 7 days after a 21d+ dormant gap
 *                (or a first-ever check-in 21d+ after signup).
 * - "dormant":   no check-in for 21d+ (also folds in: signed up 7d+ ago with
 *                zero check-ins, and the 8–20d "lapsed" window — the
 *                four-stage model has no lapsed stage; the UI shows the exact
 *                days-since so coaches see the nuance).
 */
export type JourneyStage = "new" | "active" | "returning" | "dormant";

/** C42 — escalation with an optional recorded outcome. */
export interface EscalationOutcome {
  id: string;
  customer_id: string;
  coach_id: string;
  reason: string;
  status: string;
  outcome?: string | null;
  created_at: string;
}

/** C43 — anonymized peer tip (never contains patient data). */
export interface CoachTip {
  id: string;
  coach_id: string;
  title: string;
  body: string;
  created_at: string;
}

/** C45 — end-of-challenge survey response. */
export interface ChallengeSurvey {
  id: string;
  assignment_id: string;
  q1_rating: number;
  q2_text: string | null;
  created_at: string;
}

const j = (v: unknown) => JSON.stringify(v);
const enc = (v: string) => encodeURIComponent(v);

export const coachB4Api = {
  /** C28 — certificate data; coach must own the challenge (403 otherwise), 409 if not completed. */
  certificate: (assignmentId: string) =>
    request<{ certificate: ChallengeCertificate }>(
      `/coach/challenges/assignments/${enc(assignmentId)}/certificate`,
    ),
  /** C29 — feedback aggregate ONLY (avg, count) for the logged-in coach. */
  feedbackAggregate: () =>
    request<{ feedback: CoachFeedbackAggregate }>("/coach/feedback"),
  /** C30 — freeze a streak date; at most ONE per customer per calendar month (409). */
  createStreakFreeze: (customerId: string, frozen_date: string) =>
    request<{ freeze: StreakFreeze }>(
      `/coach/customers/${enc(customerId)}/streak-freeze`,
      { method: "POST", body: j({ frozen_date }) },
    ),
  /** C31 — sent vs pending stats; open_rate is always null (not tracked). */
  nudgeStats: () => request<{ stats: NudgeStats }>("/coach/nudges/stats"),
  /** C32 — list the coach's tags for a customer. */
  listTags: (customerId: string) =>
    request<{ tags: CustomerTag[] }>(`/coach/customers/${enc(customerId)}/tags`),
  /** C32 — add a tag (idempotent). */
  addTag: (customerId: string, tag: string) =>
    request<{ tag: CustomerTag }>(
      `/coach/customers/${enc(customerId)}/tags`,
      { method: "POST", body: j({ tag }) },
    ),
  /** C32 — remove a tag (tag goes in the body). */
  removeTag: (customerId: string, tag: string) =>
    request<{ ok: boolean }>(
      `/coach/customers/${enc(customerId)}/tags`,
      { method: "DELETE", body: j({ tag }) },
    ),
  /** C33 — schedule one nudge for many customers (non-empty list, ≤200). */
  bulkNudge: (payload: {
    customer_ids: string[]; title_en?: string; title_ne?: string;
    body_en: string; body_ne?: string; send_at: string;
  }) =>
    request<{ sent: number; nudges: BulkNudge[] }>(
      "/coach/nudges/bulk",
      { method: "POST", body: j(payload) },
    ),
  /** C34 — record a handover note for a customer. */
  createHandover: (customerId: string, payload: { to_coach_id?: string; note: string }) =>
    request<{ handover: CoachHandover }>(
      `/coach/customers/${enc(customerId)}/handover`,
      { method: "POST", body: j(payload) },
    ),
  /** C34 — handover history for a customer, newest first. */
  listHandovers: (customerId: string) =>
    request<{ handovers: CoachHandover[] }>(
      `/coach/customers/${enc(customerId)}/handovers`,
    ),
  /** C35 — customers with no check-in for 14+ days. */
  inactive: () => request<{ inactive: InactiveCustomer[] }>("/coach/inactive"),
  /** C37 — this week's own activity (notes / nudges / escalations). */
  weeklyReport: () => request<{ report: WeeklyReport }>("/coach/weekly-report"),
  /** C38 — milestone timeline for a customer (badges, goals, challenges). */
  milestones: (customerId: string) =>
    request<{ milestones: Milestone[] }>(
      `/coach/customers/${enc(customerId)}/milestones`,
    ),
  /** C41 — computed journey stage (new | active | returning | dormant). */
  journey: (customerId: string) =>
    request<{ stage: JourneyStage }>(
      `/coach/customers/${enc(customerId)}/journey`,
    ),
  /** C42 — record the outcome of a resolved escalation (409 unless resolved). */
  setEscalationOutcome: (id: string, outcome: string) =>
    request<{ escalation: EscalationOutcome }>(
      `/coach/escalations/${enc(id)}/outcome`,
      { method: "PATCH", body: j({ outcome }) },
    ),
  /** C43 — anonymized peer tips (all coaches). */
  listTips: () => request<{ tips: CoachTip[] }>("/coach/tips"),
  /** C43 — create a tip; bodies with phone/email-like patterns are rejected (400). */
  createTip: (payload: { title: string; body: string }) =>
    request<{ tip: CoachTip }>("/coach/tips", { method: "POST", body: j(payload) }),
  /** C43 — delete own tip only (404 for others'). */
  deleteTip: (id: string) =>
    request<{ ok: boolean }>(`/coach/tips/${enc(id)}`, { method: "DELETE" }),
  /** C45 — survey results for a challenge's assignments (owner only). */
  challengeSurveys: (challengeId: string) =>
    request<{ surveys: ChallengeSurvey[] }>(
      `/coach/challenges/${enc(challengeId)}/surveys`,
    ),
};

/** Customer-side batch-4 endpoints (C29/C39/C45): exposed here so the
 *  customer UI can import them without touching coach modules. */
export const customerB4Api = {
  /** C29 — rate your own coach (1–5). */
  submitCoachFeedback: (payload: { coach_id: string; rating: number; note?: string }) =>
    request<{ feedback: { id: string; coach_id: string; rating: number; created_at: string } }>(
      "/me/coach-feedback",
      { method: "POST", body: j(payload) },
    ),
  /** C39 — mark an assigned article as read (must belong to you). */
  markArticleRead: (assignmentId: string) =>
    request<{ assignment: { id: string; read_at: string | null } }>(
      `/me/article-assignments/${enc(assignmentId)}/read`,
      { method: "PATCH" },
    ),
  /** C45 — submit the two-question survey for one of your challenge
   *  assignments (409 on duplicate). */
  submitChallengeSurvey: (assignmentId: string, payload: { q1_rating: number; q2_text?: string }) =>
    request<{ survey: ChallengeSurvey }>(
      `/me/challenges/${enc(assignmentId)}/survey`,
      { method: "POST", body: j(payload) },
    ),
};
