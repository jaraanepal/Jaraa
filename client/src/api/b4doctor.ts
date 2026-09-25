/**
 * Batch-4 (010) doctor dashboard API: D28 share-summary, D29 peers, D30 SLA
 * pause/resume, D31 needs-info, D32 comments, D33 concern tags, D35 priority
 * history, D37 digest, D38 similar cases, D40 queue filters, D41 case Q&A,
 * D42 articles, D43 CSV export. (D34 auto-refresh and D45 session timer are
 * client-only.) Types are local to this file (api/types.ts is not touched).
 */
import { getAccessToken, request } from "./client";
import type { Case, EducationArticle, PhotoRequest } from "./types";

const json = (v: unknown) => JSON.stringify(v);
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";

/* ------------------------- local types (batch-4 shapes) --- */
export interface B4CaseComment {
  id: string;
  case_id: string;
  doctor_id: string;
  body: string;
  created_at: string;
}

export interface B4ConcernTag {
  id: string;
  case_id: string;
  tag: string;
  created_at: string;
}

export interface B4Peer {
  id: string;
  name: string | null;
}

export interface B4Digest {
  reviewed: number;
  /** null when no timing data exists — displayed as "—", never invented. */
  avgMinutes: number | null;
  slaHits: number;
  weekStart: string;
}

export interface B4SimilarCase {
  id: string;
  created_at: string;
  priority: number;
  status: string;
  /** Sum of |score diff| over roots present in both cases. Reference only. */
  distance: number;
}

export interface B4QueueFilter {
  id: string;
  doctor_id: string;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

export interface B4CaseMessage {
  id: string;
  case_id: string;
  author_id: string;
  author_role: "customer" | "doctor";
  body: string;
  created_at: string;
}

export interface B4PriorityEntry {
  id: string | number;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  at: string;
  ip: string | null;
  detail: string | null;
}

export interface B4NeedsInfo {
  case: Case;
  photo_requests: PhotoRequest[];
}

export interface B4SlaState {
  case_id: string;
  sla_paused_at: string | null;
}

export interface B4SharedSummary {
  notification: {
    id: string;
    user_id: string;
    type: string;
    title_en: string;
    title_ne: string | null;
    body_en: string | null;
    body_ne: string | null;
    link: string | null;
    created_at: string;
  };
}

/* -------------------------------------------------- doctorB4Api --- */
export const doctorB4Api = {
  /** D28: push a plain-language case summary into the patient's notifications. */
  shareSummary: (caseId: string, summary: string, summary_ne?: string) =>
    request<B4SharedSummary>(`/doctor/cases/${encodeURIComponent(caseId)}/share-summary`, {
      method: "POST",
      body: json({ summary, summary_ne: summary_ne ?? null }),
    }),

  /** D29: doctor directory for second opinions / transfers (excludes self). */
  listPeers: () => request<{ peers: B4Peer[] }>("/doctor/peers"),

  /** D30: pause the SLA clock. */
  pauseSla: (caseId: string) =>
    request<B4SlaState>(`/doctor/cases/${encodeURIComponent(caseId)}/sla-pause`, {
      method: "POST",
    }),

  /** D30: resume the SLA clock. */
  resumeSla: (caseId: string) =>
    request<B4SlaState>(`/doctor/cases/${encodeURIComponent(caseId)}/sla-resume`, {
      method: "POST",
    }),

  /** D31: case plus its photo requests ("needs info" context). */
  needsInfo: (caseId: string) =>
    request<B4NeedsInfo>(`/doctor/cases/${encodeURIComponent(caseId)}/needs-info`),

  /** D32: doctor-only internal comment thread, oldest first. */
  listComments: (caseId: string) =>
    request<{ comments: B4CaseComment[] }>(`/doctor/cases/${encodeURIComponent(caseId)}/comments`),

  /** D32: add an internal comment. */
  addComment: (caseId: string, body: string) =>
    request<{ comment: B4CaseComment }>(`/doctor/cases/${encodeURIComponent(caseId)}/comments`, {
      method: "POST",
      body: json({ body }),
    }),

  /** D33: concern tags + the allowed tag vocabulary. */
  listConcerns: (caseId: string) =>
    request<{ concerns: B4ConcernTag[]; allowed_tags: string[] }>(
      `/doctor/cases/${encodeURIComponent(caseId)}/concerns`,
    ),

  /** D33: add a concern tag (idempotent). */
  addConcern: (caseId: string, tag: string) =>
    request<{ concern: B4ConcernTag }>(`/doctor/cases/${encodeURIComponent(caseId)}/concerns`, {
      method: "POST",
      body: json({ tag }),
    }),

  /** D33: remove a concern tag. */
  removeConcern: (caseId: string, tag: string) =>
    request<{ ok: boolean }>(`/doctor/cases/${encodeURIComponent(caseId)}/concerns`, {
      method: "DELETE",
      body: json({ tag }),
    }),

  /** D35: audit entries for this case whose action mentions priority. */
  priorityHistory: (caseId: string) =>
    request<{ history: B4PriorityEntry[] }>(
      `/doctor/cases/${encodeURIComponent(caseId)}/priority-history`,
    ),

  /** D37: weekly digest stats card data. */
  digest: () => request<B4Digest>("/doctor/digest"),

  /** D38: past own cases with similar root scores (reference only). */
  similarCases: (caseId: string) =>
    request<{ similar: B4SimilarCase[] }>(`/doctor/cases/${encodeURIComponent(caseId)}/similar`),

  /** D40: saved queue filter presets. */
  listQueueFilters: () =>
    request<{ filters: B4QueueFilter[] }>("/doctor/queue-filters"),

  /** D40: save the current queue filters as a named preset. */
  createQueueFilter: (name: string, filters: Record<string, unknown>) =>
    request<{ filter: B4QueueFilter }>("/doctor/queue-filters", {
      method: "POST",
      body: json({ name, filters }),
    }),

  /** D40: delete a saved preset (own presets only). */
  deleteQueueFilter: (id: string) =>
    request<void>(`/doctor/queue-filters/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  /** D41: doctor side of the case Q&A thread, oldest first. */
  listMessages: (caseId: string) =>
    request<{ messages: B4CaseMessage[] }>(`/doctor/cases/${encodeURIComponent(caseId)}/messages`),

  /** D41: doctor replies in the case Q&A. */
  sendMessage: (caseId: string, body: string) =>
    request<B4CaseMessage>(`/doctor/cases/${encodeURIComponent(caseId)}/messages`, {
      method: "POST",
      body: json({ body }),
    }),

  /** D42: published education articles for the doctor shelf. */
  listArticles: () =>
    request<{ articles: EducationArticle[] }>("/doctor/articles"),
};

/**
 * D43: download own reviewed cases as CSV. `request()` is JSON-only, so this
 * does an authenticated blob fetch directly (same base URL + bearer token).
 */
export async function downloadOwnCasesCsv(): Promise<void> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}/api/v1/doctor/cases/export.csv`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "my-reviewed-cases.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
