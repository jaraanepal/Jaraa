/**
 * Batch-4 admin API (A30–A47): dashboard configs, courier/returns/refund
 * analytics, verification expiry, ticket SLA, flag history, bulk user status,
 * email logs, deletion requests, referrals, challenge analytics, coach and
 * pharmacy performance, announcement scheduling, admin notices, consent
 * versions, ops digest. All local types; uses the shared `request()` helper only.
 */
import { request } from "./client";

const json = (v: unknown) => JSON.stringify(v);

/* ---------------- A30 dashboard configs ---------------- */

export interface DashboardConfig {
  id: string;
  role: string;
  config: Record<string, unknown>;
  updated_at: string;
}

export async function getDashboardConfig(role: string): Promise<{ config: DashboardConfig | null }> {
  return request(`/admin/dashboard-config/${encodeURIComponent(role)}`);
}

export async function setDashboardConfig(role: string, config: Record<string, unknown>): Promise<{ config: DashboardConfig }> {
  return request(`/admin/dashboard-config/${encodeURIComponent(role)}`, { method: "PUT", body: json({ config }) });
}

/* ---------------- A31 courier performance ---------------- */

export interface CourierPerformanceRow {
  courier: string;
  orders: number;
  avg_delivery_days: number | null;
  damage_reports: number;
}

export async function courierPerformance(): Promise<{ couriers: CourierPerformanceRow[]; note: string }> {
  return request("/admin/couriers/performance");
}

/* ---------------- A32/A46 refunds ---------------- */

export interface RefundReasonRow {
  reason: string;
  count: number;
  total_npr: number;
  rate?: number;
}

export async function returnsAnalytics(): Promise<{ by_reason: RefundReasonRow[] }> {
  return request("/admin/returns/analytics");
}

export async function refundsAnalytics(): Promise<{ by_reason: RefundReasonRow[]; total_refunds: number }> {
  return request("/admin/refunds/analytics");
}

/* ---------------- A33 verification expiry ---------------- */

export interface StaffVerification {
  id: string;
  user_id: string;
  requested_role: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: string;
  expires_at?: string | null;
}

export async function expiringVerifications(days = 30): Promise<{ verifications: StaffVerification[] }> {
  return request(`/admin/verifications/expiring?days=${days}`);
}

export async function setVerificationExpiry(id: string, expires_at: string | null): Promise<{ verification: StaffVerification }> {
  return request(`/admin/verifications/${id}/expiry`, { method: "PATCH", body: json({ expires_at }) });
}

/* ---------------- A34 ticket SLA ---------------- */

export interface TicketSla {
  open: number;
  avgFirstResponseMin: number | null;
  avgResolveMin: number | null;
}

export async function ticketSla(): Promise<{ sla: TicketSla }> {
  return request("/admin/tickets/sla");
}

/* ---------------- A35 flag history ---------------- */

export interface FlagHistoryEntry {
  id: string | number;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  at: string;
  ip: string | null;
  detail: string | null;
}

export async function flagHistory(limit = 100): Promise<{ history: FlagHistoryEntry[] }> {
  return request(`/admin/flags/history?limit=${limit}`);
}

/* ---------------- A36 bulk user status ---------------- */

export async function bulkSetUserStatus(ids: string[], disabled: boolean): Promise<{ updated: number }> {
  return request("/admin/users/bulk-status", { method: "POST", body: json({ ids, disabled }) });
}

/* ---------------- A37 email logs ---------------- */

export interface EmailLog {
  id: string;
  to_email: string;
  template: string;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
}

export async function emailLogs(limit = 50): Promise<{ logs: EmailLog[] }> {
  return request(`/admin/email-logs?limit=${limit}`);
}

/* ---------------- A38 deletion requests ---------------- */

export interface DeletionRequest {
  id: string;
  user_id: string;
  scheduled_for: string;
  note: string;
  status: string;
  created_at: string;
}

export async function deletionRequests(): Promise<{ requests: DeletionRequest[] }> {
  return request("/admin/deletion-requests");
}

/* ---------------- A39 referrals ---------------- */

export interface ReferralStats {
  codes: number;
  joined: number;
}

export async function referralStats(): Promise<{ stats: ReferralStats }> {
  return request("/admin/referrals");
}

/* ---------------- A40 challenge analytics ---------------- */

export interface ChallengeAnalyticsRow {
  challenge_id: string;
  title_en: string;
  assigned: number;
  completed: number;
}

export async function challengeAnalytics(): Promise<{ challenges: ChallengeAnalyticsRow[] }> {
  return request("/admin/challenges/analytics");
}

/* ---------------- A41 coach performance ---------------- */

export interface CoachPerformanceRow {
  coach_id: string;
  escalations: number;
  avgSatisfaction: number | null;
}

export async function coachPerformance(): Promise<{ coaches: CoachPerformanceRow[] }> {
  return request("/admin/coaches/performance");
}

/* ---------------- A42 pharmacy performance ---------------- */

export interface PharmacyPerformance {
  handled: number;
  avgPackMin: number | null;
  avgShipMin: number | null;
}

export async function pharmacyPerformance(): Promise<{ performance: PharmacyPerformance; note: string }> {
  return request("/admin/pharmacy/performance");
}

/* ---------------- A43 announcement scheduling ---------------- */

export async function scheduleAnnouncement(id: string, publish_at: string | null): Promise<unknown> {
  return request(`/admin/announcements/${id}/schedule`, { method: "POST", body: json({ publish_at }) });
}

/* ---------------- A44 admin notices ---------------- */

export interface AdminNotice {
  id: string;
  title_en: string;
  title_ne: string | null;
  body_en: string | null;
  body_ne: string | null;
  created_at: string;
  read: boolean;
}

export async function adminNotices(): Promise<{ notices: AdminNotice[] }> {
  return request("/admin/notices");
}

export async function createAdminNotice(n: { title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null }): Promise<{ notice: AdminNotice }> {
  return request("/admin/notices", { method: "POST", body: json(n) });
}

export async function markAdminNoticeRead(id: string): Promise<{ ok: boolean }> {
  return request(`/admin/notices/${id}/read`, { method: "POST" });
}

/* ---------------- A45 consent versions ---------------- */

export interface ConsentVersion {
  id: string;
  kind: string;
  version: number;
  text_en: string;
  text_ne: string | null;
  active: boolean;
  created_at: string;
}

export async function consentVersions(kind?: string): Promise<{ versions: ConsentVersion[] }> {
  return request(`/admin/consents/versions${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
}

export async function createConsentVersion(v: { kind: string; version: number; text_en: string; text_ne?: string | null; active?: boolean }): Promise<{ version: ConsentVersion }> {
  return request("/admin/consents/versions", { method: "POST", body: json(v) });
}

export async function activateConsentVersion(id: string): Promise<{ version: ConsentVersion }> {
  return request(`/admin/consents/versions/${id}/activate`, { method: "POST" });
}

/* ---------------- A47 ops digest ---------------- */

export interface OpsDigest {
  ordersToday: number;
  slaBreaches: number;
  openTickets: number;
  pendingRefunds: number;
}

export async function opsDigest(): Promise<{ digest: OpsDigest }> {
  return request("/admin/digest");
}

export const adminB4Api = {
  getDashboardConfig,
  setDashboardConfig,
  courierPerformance,
  returnsAnalytics,
  refundsAnalytics,
  expiringVerifications,
  setVerificationExpiry,
  ticketSla,
  flagHistory,
  bulkSetUserStatus,
  emailLogs,
  deletionRequests,
  referralStats,
  challengeAnalytics,
  coachPerformance,
  pharmacyPerformance,
  scheduleAnnouncement,
  adminNotices,
  createAdminNotice,
  markAdminNoticeRead,
  consentVersions,
  createConsentVersion,
  activateConsentVersion,
  opsDigest,
};
