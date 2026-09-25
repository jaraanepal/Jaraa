/**
 * Batch-3 admin API (A21–A29): disputes, doctor payouts, content moderation,
 * plan templates, scan quality, kit leaderboard, export schedules,
 * staff checklists. All local types; uses the shared `request()` helper only.
 */
import { request } from "./client";

const json = (v: unknown) => JSON.stringify(v);

/* ---------------- A21 disputes ---------------- */
export type DisputeStatus = "open" | "in_review" | "resolved" | "rejected";

export interface Dispute {
  id: string;
  order_id: string;
  user_id: string;
  subject: string;
  body: string;
  status: DisputeStatus;
  resolution: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

/* ---------------- A22 payouts ---------------- */
export interface PayoutRow {
  doctor_id: string;
  name: string | null;
  reviewed: number;
}

/* ---------------- A23 moderation ---------------- */
export type CommunityTipStatus = "pending" | "approved" | "rejected";

export interface CommunityTip {
  id: string;
  user_id: string;
  title: string;
  body: string;
  status: CommunityTipStatus;
  moderated_by: string | null;
  created_at: string;
}

/* ---------------- A24 plan templates ---------------- */
export interface PlanTemplate {
  id: string;
  title_en: string;
  title_ne: string | null;
  items: unknown[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

/* ---------------- A25 scan quality ---------------- */
export interface ScanQualityRow {
  angle: string;
  total: number;
  passed: number;
}

/* ---------------- A26 kit leaderboard ---------------- */
export interface KitLeaderboardRow {
  kit_id: string;
  name: string;
  orders: number;
  revenue_npr: number;
}

/* ---------------- A27 export schedules ---------------- */
export type ExportFrequency = "daily" | "weekly" | "monthly";

export interface ExportSchedule {
  id: string;
  kind: string;
  frequency: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
}

/* ---------------- A28 staff checklist ---------------- */
export interface ChecklistItem {
  key: string;
  done: boolean;
}

export interface StaffChecklist {
  id: string;
  user_id: string;
  items: ChecklistItem[];
  updated_at: string;
}

export const adminB3Api = {
  /* A21 */
  listDisputes: (status?: string) =>
    request<{ disputes: Dispute[] }>(
      `/admin/disputes${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  createDispute: (payload: { order_id: string; user_id: string; subject: string; body: string }) =>
    request<{ dispute: Dispute }>("/admin/disputes", { method: "POST", body: json(payload) }),
  getDispute: (id: string) =>
    request<{ dispute: Dispute }>(`/admin/disputes/${encodeURIComponent(id)}`),
  resolveDispute: (id: string, payload: { resolution: string; approved: boolean }) =>
    request<{ dispute: Dispute }>(`/admin/disputes/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: json(payload),
    }),

  /* A22 */
  payouts: (month: string) =>
    request<{ payouts: PayoutRow[] }>(`/admin/payouts?month=${encodeURIComponent(month)}`),

  /* A23 */
  moderationQueue: () => request<{ tips: CommunityTip[] }>("/admin/moderation"),
  decideTip: (id: string, approved: boolean) =>
    request<{ tip: CommunityTip }>(`/admin/moderation/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      body: json({ approved }),
    }),

  /* A24 */
  listPlanTemplates: (activeOnly = false) =>
    request<{ templates: PlanTemplate[] }>(
      `/admin/plan-templates${activeOnly ? "?activeOnly=true" : ""}`,
    ),
  createPlanTemplate: (payload: { title_en: string; title_ne?: string | null; items: unknown[] }) =>
    request<{ template: PlanTemplate }>("/admin/plan-templates", { method: "POST", body: json(payload) }),
  updatePlanTemplate: (id: string, patch: Partial<Pick<PlanTemplate, "title_en" | "title_ne" | "items" | "is_active">>) =>
    request<{ template: PlanTemplate }>(`/admin/plan-templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json(patch),
    }),
  deletePlanTemplate: (id: string) =>
    request<{ deleted: boolean }>(`/admin/plan-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /* A25 */
  scanQuality: () => request<{ stats: ScanQualityRow[] }>("/admin/scan-quality"),

  /* A26 */
  kitLeaderboard: () => request<{ leaderboard: KitLeaderboardRow[] }>("/admin/kits/leaderboard"),

  /* A27 */
  listExportSchedules: () => request<{ schedules: ExportSchedule[] }>("/admin/export-schedules"),
  createExportSchedule: (payload: { kind?: string; frequency: ExportFrequency }) =>
    request<{ schedule: ExportSchedule }>("/admin/export-schedules", { method: "POST", body: json(payload) }),
  updateExportSchedule: (
    id: string,
    patch: Partial<Pick<ExportSchedule, "frequency" | "is_active" | "next_run_at">>,
  ) =>
    request<{ schedule: ExportSchedule }>(`/admin/export-schedules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json(patch),
    }),
  deleteExportSchedule: (id: string) =>
    request<{ deleted: boolean }>(`/admin/export-schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /* A28 */
  getStaffChecklist: (userId: string) =>
    request<{ checklist: StaffChecklist | null }>(`/admin/staff/${encodeURIComponent(userId)}/checklist`),
  saveStaffChecklist: (userId: string, items: ChecklistItem[]) =>
    request<{ checklist: StaffChecklist }>(`/admin/staff/${encodeURIComponent(userId)}/checklist`, {
      method: "PATCH",
      body: json({ items }),
    }),
};
