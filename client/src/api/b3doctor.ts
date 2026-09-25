/**
 * Batch-3 (009) doctor dashboard API: D19 audit, D20 archive, D22 second
 * opinions, D23 follow-up range, D24 triage presets, D25 adherence, D26
 * transfer. Types are local to this file (api/types.ts is not touched).
 */
import { request } from "./client";

const json = (v: unknown) => JSON.stringify(v);

/* ------------------------- local types (batch-3 shapes) --- */
export interface B3AuditEntry {
  id: string | number;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  at: string;
  ip: string | null;
}

/** Minimal case shape for archive/transfer responses (includes archived_at). */
export interface B3Case {
  id: string;
  scan_id: string;
  user_id: string | null;
  assigned_doctor_id: string | null;
  priority: "red_flag" | "high" | "normal";
  sla_due_at: string;
  status: string;
  created_at: string;
  archived_at: string | null;
}

export interface B3SecondOpinion {
  id: string;
  case_id: string;
  requester_id: string;
  reviewer_id: string;
  status: "pending" | "accepted" | "declined" | "done";
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface B3TriagePreset {
  id: string;
  doctor_id: string;
  name: string;
  priority: number;
  created_at: string;
}

export interface B3Adherence {
  user_id: string;
  rate: number;
  done: number;
  total: number;
}

export interface B3FollowUp {
  id: string;
  case_id: string;
  doctor_id: string;
  due_on: string;
  note: string | null;
  done_at: string | null;
  created_at: string;
}

/* -------------------------------------------------- doctorB3Api --- */
export const doctorB3Api = {
  /** D19: own audit trail, newest first. */
  listAudit: (limit = 50) =>
    request<{ audit: B3AuditEntry[] }>(`/doctor/audit?limit=${limit}`),

  /** D20: archive a case (assigned to me, or unassigned + reviewed). */
  archiveCase: (id: string) =>
    request<{ case: B3Case }>(`/doctor/cases/${encodeURIComponent(id)}/archive`, {
      method: "PATCH",
    }),

  /** D20: my archived cases, newest archived first. */
  listArchivedCases: () =>
    request<{ cases: B3Case[] }>("/doctor/cases/archived"),

  /** D22: request a second opinion from another doctor. */
  requestSecondOpinion: (caseId: string, reviewer_id: string, note?: string) =>
    request<{ secondOpinion: B3SecondOpinion }>(
      `/doctor/cases/${encodeURIComponent(caseId)}/second-opinion`,
      { method: "POST", body: json({ reviewer_id, note: note ?? null }) },
    ),

  /** D22: second-opinion inbox (sent + received, newest first). */
  listSecondOpinions: () =>
    request<{ secondOpinions: B3SecondOpinion[] }>("/doctor/second-opinions"),

  /** D22: reviewer accepts / declines a pending request. */
  decideSecondOpinion: (id: string, accept: boolean) =>
    request<{ secondOpinion: B3SecondOpinion }>(
      `/doctor/second-opinions/${encodeURIComponent(id)}/decide`,
      { method: "POST", body: json({ accept }) },
    ),

  /** D23: follow-ups in a date range (done + pending). Defaults to the
   * current week when only one bound (or none) is given. */
  listFollowUpsRange: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const qs = q.toString();
    return request<{ follow_ups: B3FollowUp[]; from: string; to: string }>(
      `/doctor/follow-ups${qs ? `?${qs}` : ""}`,
    );
  },

  /** D24: triage presets, highest priority first. */
  listTriagePresets: () =>
    request<{ presets: B3TriagePreset[] }>("/doctor/triage-presets"),

  /** D24: create a triage preset (priority: 0 | 50 | 100). */
  createTriagePreset: (name: string, priority: 0 | 50 | 100 = 0) =>
    request<{ preset: B3TriagePreset }>("/doctor/triage-presets", {
      method: "POST",
      body: json({ name, priority }),
    }),

  /** D24: delete a triage preset (own presets only). */
  deleteTriagePreset: (id: string) =>
    request<void>(`/doctor/triage-presets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  /** D25: patient check-in adherence (assigned doctor or reviewer only). */
  getPatientAdherence: (userId: string) =>
    request<B3Adherence>(`/doctor/patients/${encodeURIComponent(userId)}/adherence`),

  /** D26: transfer a case to another doctor. */
  transferCase: (id: string, to_doctor_id: string, reason?: string) =>
    request<{ case: B3Case }>(`/doctor/cases/${encodeURIComponent(id)}/transfer`, {
      method: "POST",
      body: json({ to_doctor_id, reason: reason ?? null }),
    }),
};
