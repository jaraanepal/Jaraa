/**
 * Batch 4 (010) customer API: U30–U47 + C28/C45 customer-side support.
 * Thin wrapper over the exported `request()` from api/client — no new auth
 * or fetch plumbing. Types are local to this file (not re-exported from
 * api/types, which is owned by other tracks).
 */
import { request } from "./client";

const json = (v: unknown) => JSON.stringify(v);

/* ------------------------- types (U30–U47) ------------------------- */

export interface KitReminder {
  id: string;
  user_id: string;
  kit_id: string | null;
  label_en: string;
  label_ne: string | null;
  remind_at: string;
  done: boolean;
  created_at: string;
}

export interface KitUsage {
  id: string;
  user_id: string;
  kit_id: string | null;
  note: string | null;
  used_at: string;
}

export interface Consent {
  id: string;
  user_id: string;
  type: string;
  version: string;
  granted: boolean;
  created_at: string;
}

export interface ReferralHistory {
  code: string | null;
  joined: { user_id: string; at: string }[];
}

export interface ReorderSuggestion {
  kit_id: string;
  kit_name: string;
  ordered_at: string;
}

export interface OwnSession {
  id: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ChallengeCertificate {
  assignment_id: string;
  customer_name: string | null;
  challenge_title_en: string;
  challenge_title_ne: string | null;
  completed_at: string;
}

export interface ChallengeSurvey {
  id: string;
  assignment_id: string;
  q1_rating: number;
  q2_text: string | null;
  created_at: string;
}

export interface AppFeedback {
  id: string;
  user_id: string;
  rating: number;
  message: string | null;
  created_at: string;
}

/* ------------------------------- API ------------------------------- */

export const customerB4Api = {
  /* ---------------- U30: profile preferences ---------------- */
  /** Save content-language / default-payment preferences (both nullable). */
  savePreferences: (prefs: { content_language?: "ne" | "en" | null; default_payment?: "esewa" | "khalti" | "cod" | null }) =>
    request<{ content_language: string | null; default_payment: string | null }>("/me/profile", {
      method: "PATCH",
      body: json(prefs),
    }),

  /* ---------------- U31: streak ---------------- */
  /** Consecutive check-in days ending today (or yesterday). */
  getStreak: () => request<{ days: number }>("/me/streak"),

  /* ---------------- U32: referrals ---------------- */
  /** Own referral code + users who joined via it (honestly empty: no
   * join tracking exists server-side). */
  getReferrals: () => request<ReferralHistory>("/me/referrals"),

  /* ---------------- U36: consent history ---------------- */
  /** Consent records, newest first. */
  listConsents: () => request<{ consents: Consent[] }>("/me/consents"),

  /* ---------------- U37: app feedback ---------------- */
  /** Submit app feedback (rating 1–5 + optional message). */
  postFeedback: (rating: number, message?: string) =>
    request<AppFeedback>("/me/feedback", {
      method: "POST",
      body: json({ rating, message: message?.trim() || null }),
    }),

  /* ---------------- U40: kit reminders ---------------- */
  /** My reminders, earliest first. */
  listKitReminders: () => request<{ reminders: KitReminder[] }>("/me/kit-reminders"),
  /** Create a reminder (label + ISO remind_at; kit_id optional). */
  createKitReminder: (r: { kit_id?: string | null; label_en: string; label_ne?: string | null; remind_at: string }) =>
    request<KitReminder>("/me/kit-reminders", {
      method: "POST",
      body: json({ kit_id: r.kit_id ?? null, label_en: r.label_en, label_ne: r.label_ne ?? null, remind_at: r.remind_at }),
    }),
  /** Mark a reminder done / not done (own rows only). */
  setKitReminderDone: (id: string, done: boolean) =>
    request<KitReminder>(`/me/kit-reminders/${encodeURIComponent(id)}/done`, {
      method: "PATCH",
      body: json({ done }),
    }),
  /** Delete a reminder (own rows only). */
  deleteKitReminder: (id: string) =>
    request<void>(`/me/kit-reminders/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /* ---------------- U41: reorder suggestions ---------------- */
  /** Kits whose latest order is 60+ days old. */
  getReorderSuggestions: () => request<{ suggestions: ReorderSuggestion[] }>("/me/reorder-suggestions"),

  /* ---------------- U42: kit usage log ---------------- */
  /** Log one product usage. */
  logKitUsage: (u: { kit_id?: string | null; note?: string }) =>
    request<KitUsage>("/me/kit-usages", {
      method: "POST",
      body: json({ kit_id: u.kit_id ?? null, note: u.note?.trim() || null }),
    }),
  /** Recent usage rows, newest first. */
  listKitUsages: (limit = 20) =>
    request<{ usages: KitUsage[] }>(`/me/kit-usages?limit=${Math.max(1, Math.min(100, limit))}`),

  /* ---------------- U45: sessions ---------------- */
  /** Own recent sessions (id fingerprints only — no token material). */
  listSessions: () => request<{ sessions: OwnSession[] }>("/me/sessions"),

  /* ---------------- C28: challenge certificate (customer side) ---------------- */
  /** Certificate data for a COMPLETED assignment of mine (409 while open). */
  getCertificate: (assignmentId: string) =>
    request<{ certificate: ChallengeCertificate }>(
      `/me/challenges/assignments/${encodeURIComponent(assignmentId)}/certificate`,
    ),

  /* ---------------- C45: end-of-challenge survey (customer side) ---------------- */
  /** Submit the end-of-challenge survey (one per assignment; 409 on dup). */
  submitChallengeSurvey: (assignmentId: string, q1_rating: number, q2_text?: string) =>
    request<{ survey: ChallengeSurvey }>(`/me/challenges/${encodeURIComponent(assignmentId)}/survey`, {
      method: "POST",
      body: json({ q1_rating, q2_text: q2_text?.trim() || null }),
    }),
};
