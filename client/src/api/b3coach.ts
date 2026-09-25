/**
 * Batch-3 coach API (C19–C27). Thin wrappers around the exported `request()`
 * only; all types live in this file.
 */
import { request } from "./client";

/** C19 — anonymized leaderboard row. */
export interface LeaderboardRow {
  user_id: string;
  /** Anonymized display, e.g. "Customer #A1B2" — never a real name. */
  display: string;
  /** Consecutive UTC days with ≥1 check-in, counting back from today. */
  streak: number;
}

/** C20 — escalation SLA. hours_to_ack / hours_to_resolve are always null:
 *  the escalations table has no ack/resolve timestamps (degraded by design). */
export interface EscalationSlaRow {
  id: string;
  customer_id: string;
  status: string;
  hours_to_ack: number | null;
  hours_to_resolve: number | null;
}

/** C21 — recurring nudge payload + row. */
export type Recurrence = "daily" | "weekly";
export interface RecurringNudge {
  id: string;
  coach_id: string;
  user_id: string;
  message_en: string;
  message_ne: string | null;
  send_at: string;
  sent_at: string | null;
  recurrence: Recurrence;
  created_at: string;
}

/** C22 — weekly satisfaction bucket (ISO week start Monday, UTC). */
export interface SatisfactionBucket {
  bucket: string;
  avg: number;
  count: number;
}

/**
 * C23 — progress comparison. Degraded: compares customer-reported
 * shedding_estimate from the earliest vs latest check-in (the only numeric
 * progress field). Null side when no check-in / null estimate. Never a
 * medical measurement.
 */
export interface ProgressCompare {
  baseline: { shedding_estimate: number } | null;
  current: { shedding_estimate: number } | null;
}

/** C24 — onboarding checklist row. */
export interface OnboardingChecklist {
  id: string;
  user_id: string;
  steps: Array<{ key: string; done: boolean }>;
  updated_at: string;
}

/** C25 — missed check-ins row. */
export interface MissedCheckin {
  user_id: string;
  name: string | null;
  days_missed: number;
}

/** C26 — coach availability row. */
export interface CoachAvailability {
  id: string;
  coach_id: string;
  status: "available" | "on_leave";
  note: string | null;
  updated_at: string;
}

/**
 * C27 — adherence detail. Degraded by design: progress_checkins has no habit
 * column, so rows are checkin-dimension proxies over the last 30 days, not
 * habit-level adherence. Label clearly in the UI.
 */
export interface AdherenceRow {
  habit: "daily_checkin" | "photo_logged" | "shedding_logged" | "note_logged";
  done: number;
  total: number;
}

const j = (v: unknown) => JSON.stringify(v);

export const coachB3Api = {
  /** C19 — opt-in only, anonymized leaderboard, streak desc. */
  leaderboard: (limit?: number) =>
    request<{ leaderboard: LeaderboardRow[] }>(
      `/coach/leaderboard${limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : ""}`,
    ),
  /** C20 — escalation SLA (nulls where timestamps absent). */
  escalationSla: () => request<{ sla: EscalationSlaRow[] }>("/coach/escalations/sla"),
  /** C21 — create a recurring nudge (recurrence: daily|weekly, enforced server-side). */
  createRecurringNudge: (payload: {
    user_id: string; message_en: string; message_ne?: string; send_at: string; recurrence: Recurrence;
  }) => request<{ nudge: RecurringNudge }>("/coach/nudges/recurring", { method: "POST", body: j(payload) }),
  /** C22 — weekly satisfaction trend, chronological. */
  satisfactionTrend: () => request<{ trend: SatisfactionBucket[] }>("/coach/satisfaction/trend"),
  /** C23 — baseline vs current progress for one customer. */
  progressCompare: (userId: string) =>
    request<ProgressCompare>(`/coach/customers/${encodeURIComponent(userId)}/progress-compare`),
  /** C24 — onboarding checklist (GET null before save). */
  getOnboarding: (userId: string) =>
    request<{ checklist: OnboardingChecklist | null }>(
      `/coach/customers/${encodeURIComponent(userId)}/onboarding`,
    ),
  /** C24 — save the full steps array (upsert). */
  saveOnboarding: (userId: string, steps: Array<{ key: string; done: boolean }>) =>
    request<{ checklist: OnboardingChecklist }>(
      `/coach/customers/${encodeURIComponent(userId)}/onboarding`,
      { method: "PATCH", body: j({ steps }) },
    ),
  /** C25 — customers with no check-in in `days` (default 7), most-missed first. */
  missedCheckins: (days?: number) =>
    request<{ missed: MissedCheckin[] }>(
      `/coach/missed-checkins${days !== undefined ? `?days=${encodeURIComponent(String(days))}` : ""}`,
    ),
  /** C26 — own availability (null treated as "available"). */
  getAvailability: () => request<{ availability: CoachAvailability | null }>("/coach/availability"),
  /** C26 — upsert own availability. */
  setAvailability: (status: "available" | "on_leave", note?: string) =>
    request<{ availability: CoachAvailability }>(
      "/coach/availability",
      { method: "PUT", body: j({ status, note }) },
    ),
  /** C27 — 30-day checkin-dimension adherence proxies (labelled, not habit-level). */
  adherenceDetail: (userId: string) =>
    request<{ detail: AdherenceRow[] }>(
      `/coach/customers/${encodeURIComponent(userId)}/adherence-detail`,
    ),
};
