/**
 * Problem 4 (v14) coach workflow API. Thin wrappers around the exported
 * `request()` plus the existing coachApi for nudge delivery. Types for new
 * payloads live here (api/types.ts is owned by another batch).
 */
import { request, coachApi } from "../../api/client";
import type {
  AssignedCustomer, ChallengeAssignment, Checkin, ScheduledNudge,
} from "../../api/types";

/** Follow-up appointment row (server: coach_followups). */
export interface CoachFollowup {
  id: string;
  customer_id: string;
  coach_id: string;
  scheduled_for: string;
  note: string;
  status: "pending" | "completed" | "cancelled";
  completed_at: string | null;
  created_at: string;
}

/** Follow-up row with the customer's display name (server joins profiles). */
export interface CoachFollowupRow extends CoachFollowup {
  customer_name: string | null;
}

export interface CoachAssignment {
  id: string;
  coach_id: string;
  customer_id: string;
  assigned_at: string;
}

export const coachP14Api = {
  /** Assigned customers (server: GET /coach/customers). */
  listCustomers: (q?: string) =>
    request<{ customers: AssignedCustomer[] }>(
      `/coach/customers${q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
    ),

  /** Assign a customer to the calling coach (admins may pass coach_id). */
  assignCustomer: (customerId: string, coachId?: string) =>
    request<{ assignment: CoachAssignment }>(
      `/coach/customers/${encodeURIComponent(customerId)}/assign`,
      {
        method: "POST",
        body: JSON.stringify(coachId ? { coach_id: coachId } : {}),
        headers: { "Content-Type": "application/json" },
      },
    ),

  /** Remove a customer's coach assignment. */
  unassignCustomer: (customerId: string) =>
    request<void>(`/coach/customers/${encodeURIComponent(customerId)}/assign`, {
      method: "DELETE",
    }),

  /** Challenge assignments for the per-customer progress view. */
  listCustomerChallenges: (customerId: string) =>
    request<{ assignments: ChallengeAssignment[] }>(
      `/coach/customers/${encodeURIComponent(customerId)}/challenges`,
    ),

  /** Check-ins for the per-customer progress view (reuses existing endpoint). */
  listCustomerCheckins: (customerId: string): Promise<Checkin[]> =>
    coachApi.listCustomerCheckins(customerId).then((r) => r.checkins),

  /** Follow-up history for one customer (all statuses, newest first). */
  listCustomerFollowups: (customerId: string) =>
    request<{ followups: CoachFollowup[] }>(
      `/coach/customers/${encodeURIComponent(customerId)}/followups`,
    ),

  /** Schedule a follow-up appointment (future date + note). */
  scheduleFollowup: (customerId: string, payload: { scheduled_for: string; note: string }) =>
    request<{ followup: CoachFollowup }>(
      `/coach/customers/${encodeURIComponent(customerId)}/followups`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
    ),

  /** All follow-ups across the coach's assigned customers (?status filter). */
  listFollowups: (status?: "pending" | "completed" | "cancelled") =>
    request<{ followups: CoachFollowupRow[] }>(
      `/coach/followups${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),

  /** Mark a follow-up complete. */
  completeFollowup: (id: string) =>
    request<{ followup: CoachFollowup }>(
      `/coach/followups/${encodeURIComponent(id)}/complete`,
      { method: "PATCH" },
    ),

  /**
   * Send a nudge to one customer NOW: schedules a nudge ~1 minute out (the
   * server requires send_at in the future) and immediately sends it, which
   * delivers an in-app notification to the customer. Habits/motivation only.
   */
  sendNudgeNow: async (
    userId: string,
    messageEn: string,
    messageNe?: string,
  ): Promise<ScheduledNudge> => {
    const sendAt = new Date(Date.now() + 60_000).toISOString();
    const created = await coachApi.scheduleNudge({
      user_id: userId,
      message_en: messageEn,
      ...(messageNe?.trim() ? { message_ne: messageNe.trim() } : {}),
      send_at: sendAt,
    });
    return (await coachApi.sendScheduledNudge(created.nudge.id)).nudge;
  },
};
