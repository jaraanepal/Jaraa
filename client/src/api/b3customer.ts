/**
 * Batch 3 (009) customer API: U21–U29 + leaderboard opt-in.
 * Thin wrapper over the exported `request()` from api/client — no new auth
 * or fetch plumbing. Types are local to this file (not re-exported from
 * api/types, which is owned by other tracks).
 */
import { request } from "./client";

const json = (v: unknown) => JSON.stringify(v);

/* ------------------------- types (U21–U29) ------------------------- */

export interface CaseMessage {
  id: string;
  case_id: string;
  author_id: string;
  author_role: "customer" | "doctor";
  body: string;
  created_at: string;
}

export interface UserCase {
  id: string;
  scan_id: string;
  status: "queued" | "in_review" | "reviewed" | "needs_info";
  created_at: string;
}

export interface ReviewRequest {
  id: string;
  user_id: string;
  case_id: string | null;
  reason: string | null;
  status: "pending" | "done";
  created_at: string;
}

export interface CommunityTip {
  id: string;
  user_id: string;
  title: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  moderated_by: string | null;
  created_at: string;
}

export interface LoyaltyEntry {
  id: string;
  user_id: string;
  points: number;
  reason: string | null;
  order_id: string | null;
  created_at: string;
}

export interface LoyaltyWallet {
  balance: number;
  history: LoyaltyEntry[];
}

export interface AdherenceWeek {
  week: string;
  rate: number;
}

export interface RoutineItem {
  id: string;
  title_en: string;
  title_ne: string | null;
  body_en: string;
  body_ne: string | null;
  category: string | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
}

export interface OrderDispute {
  id: string;
  order_id: string;
  user_id: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}

/** Gift fields for checkout — the server wiring lives with the shop track
 * (POST /orders already accepts them); this is the client-only contract. */
export interface GiftFields {
  recipient_name: string;
  recipient_phone: string;
  message: string;
}

/* ------------------------------- API ------------------------------- */

export const customerB3Api = {
  /* ---------------- U21: case Q&A ---------------- */
  /** My cases (for the Q&A thread view). */
  listMyCases: () => request<{ cases: UserCase[] }>("/me/cases"),
  /** Q&A thread for one case, oldest first. */
  listCaseMessages: (caseId: string) =>
    request<{ messages: CaseMessage[] }>(`/me/cases/${encodeURIComponent(caseId)}/messages`),
  /** Ask a question on my own case. */
  postCaseMessage: (caseId: string, body: string) =>
    request<CaseMessage>(`/me/cases/${encodeURIComponent(caseId)}/messages`, {
      method: "POST",
      body: json({ body }),
    }),

  /* ---------------- U22: follow-up review request (appointment-free) ---------------- */
  /** Request a follow-up review; omit case_id for a general follow-up. */
  createReviewRequest: (case_id?: string | null, reason?: string) =>
    request<ReviewRequest>("/me/review-requests", {
      method: "POST",
      body: json({ case_id: case_id ?? null, reason: reason ?? null }),
    }),
  /** My review requests, newest first. */
  listReviewRequests: () => request<{ requests: ReviewRequest[] }>("/me/review-requests"),

  /* ---------------- U23: community tips (moderated) ---------------- */
  /** Approved tips only. */
  listCommunityTips: () => request<{ tips: CommunityTip[] }>("/me/community-tips"),
  /** Submit a tip — always enters as pending moderation. */
  createCommunityTip: (title: string, body: string) =>
    request<CommunityTip>("/me/community-tips", {
      method: "POST",
      body: json({ title, body }),
    }),

  /* ---------------- U24: adherence history ---------------- */
  /** Last 12 Monday-start calendar weeks, oldest → newest. */
  adherenceHistory: () => request<{ history: AdherenceWeek[] }>("/me/adherence/history"),

  /* ---------------- U25: loyalty wallet ---------------- */
  /** Balance + adjustment history (earn derived at read time server-side). */
  getLoyalty: () => request<LoyaltyWallet>("/me/loyalty"),

  /* ---------------- U26: gift-a-kit (client-only; server wiring is shop track's) ---------------- */
  /** Gift fields the client attaches to the order payload at checkout.
   *  The server validates + stores them in the order endpoint itself
   *  (shop track); here they only shape the UI form state. */
  toGiftPayload: (gift: GiftFields) => ({
    gift_recipient_name: gift.recipient_name,
    gift_recipient_phone: gift.recipient_phone || null,
    gift_message: gift.message || null,
  }),

  /* ---------------- U27: order issue reporter ---------------- */
  /** Report an issue on my own order — creates a support dispute. */
  reportOrderIssue: (orderId: string, subject: string, body: string) =>
    request<OrderDispute>(`/me/orders/${encodeURIComponent(orderId)}/issue`, {
      method: "POST",
      body: json({ subject, body }),
    }),

  /* ---------------- U29: routine library ---------------- */
  /** Published routine items, newest first. */
  listRoutines: () => request<{ routines: RoutineItem[] }>("/me/routines"),

  /* ---------------- leaderboard opt-in (C19) ---------------- */
  getLeaderboardOptIn: () => request<{ opt_in: boolean }>("/me/leaderboard-opt-in"),
  setLeaderboardOptIn: (opt_in: boolean) =>
    request<{ opt_in: boolean }>("/me/leaderboard-opt-in", {
      method: "PUT",
      body: json({ opt_in }),
    }),
};
