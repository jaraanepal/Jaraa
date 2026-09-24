// Entity types mirroring db/migrations/001_init.sql + 002_app.sql.
export type Role = "customer" | "doctor" | "admin" | "pharmacy" | "coach";
export type ScanStatus = "draft" | "submitted" | "in_review" | "reviewed" | "flagged";
export type CaseStatus = "queued" | "in_review" | "reviewed";
export type PlanStatus = "draft" | "approved";
export type OrderStatus = "pending" | "paid" | "fulfilling" | "shipped" | "delivered" | "cancelled" | "refunded";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
export type ConsultStatus = "requested" | "scheduled" | "completed" | "cancelled";
export type PhotoAngle = "hairline" | "crown" | "parting" | "temples" | "shedding";

export interface User {
  id: string; phone: string; email: string | null; role: Role; language: string;
  is_active: boolean; password_hash: string | null; totp_secret: string | null;
  created_at: string; updated_at: string;
}

export interface Profile {
  user_id: string; name: string | null; age_band: string | null; gender: string | null;
  is_minor: boolean; guardian_name: string | null; guardian_phone: string | null;
  guardian_consented_at: string | null; created_at: string; updated_at: string;
}

export interface Consent {
  id: string; user_id: string; type: string; version: string; granted: boolean;
  granted_at: string; ip: string | null;
}

export interface OtpRow {
  code_hash: string; expires_at: number; attempts_left: number;
  request_count: number; window_start: number;
}

export interface Scan {
  id: string; user_id: string | null; guest_token: string | null;
  status: ScanStatus; current_stage: number; version: number;
  active_path: string | null; answers: Record<string, unknown>;
  created_at: string; updated_at: string;
}

export interface TimelineEvent {
  id: string; scan_id: string; event_type: string; occurred_on: string | null;
  position_months_ago: number | null; note: string | null;
  followup_answers: Record<string, unknown>; created_at: string;
}

export interface Photo {
  id: string; scan_id: string; angle: PhotoAngle; storage_path: string;
  thumb_path: string | null; consent_id: string | null; ai_quality: unknown;
  width: number | null; height: number | null; created_at: string;
}

export interface RootScoreRow { scan_id: string; root: string; score: number; signals: Record<string, unknown>; updated_at: string; }

export interface RedFlag {
  id: string; scan_id: string; flag_type: string; detail: string;
  resolved_by: string | null; resolved_at: string | null; created_at: string;
}

export interface ScanRule {
  id: string; priority: number; trigger_condition: Record<string, unknown>;
  action: string; action_params: Record<string, unknown>;
  copy_ne: string | null; copy_en: string | null; is_active: boolean; created_at: string;
}

export interface Case {
  id: string; scan_id: string; assigned_doctor_id: string | null;
  priority: number; sla_due_at: string | null; status: CaseStatus;
  created_at: string; updated_at: string;
}

export interface Annotation {
  id: string; photo_id: string; doctor_id: string; shape: Record<string, unknown>;
  note: string | null; created_at: string;
}

export interface PlanItemInput {
  kind: string; title_ne?: string; title_en?: string; detail?: string;
  product_id?: string; sort_order: number;
}
export interface PlanItem {
  id: string; plan_id: string; kind: string; title_ne: string | null; title_en: string | null;
  detail: Record<string, unknown>; sort: number;
}
export interface Plan {
  id: string; case_id: string; doctor_id: string; status: PlanStatus; version: number;
  review_notes: string | null; rescan_due_on: string | null; approved_at: string | null;
  created_at: string; updated_at: string; items: PlanItem[];
}

export interface Product {
  id: string; name_ne: string | null; name_en: string; kind: "cosmetic" | "prescription";
  price_npr: number; image_url: string | null; is_active: boolean; created_at: string;
}
export interface Kit {
  id: string; plan_id: string | null; name_ne: string | null; name_en: string;
  product_ids: string[]; total_npr: number; is_active: boolean; created_at: string;
}

export interface Order {
  id: string; order_no: string; user_id: string; kit_id: string | null;
  status: OrderStatus; subtotal_npr: number; shipping_npr: number; total_npr: number;
  payment_method: string | null; idempotency_key: string; fulfilment_note: string | null;
  shipping_address: Record<string, unknown>; created_at: string; updated_at: string;
}

export interface Payment {
  id: string; order_id: string; provider: string; provider_ref: string | null;
  amount_npr: number; status: PaymentStatus; webhook_log: unknown[];
  created_at: string;
}

export interface Consult {
  id: string; user_id: string; doctor_id: string | null; scheduled_at: string | null;
  meet_link: string | null; status: ConsultStatus; created_at: string;
}

export interface Checkin {
  id: string; user_id: string; plan_id: string | null; scan_id: string | null;
  shedding_estimate: number | null; note: string | null; photo_ids: string[];
  created_at: string;
}

export interface FeatureFlag { key: string; is_enabled: boolean; updated_by: string | null; updated_at: string; }

export interface AuditEntry {
  id: string | number; actor_id: string | null; action: string; entity: string;
  entity_id: string | null; at: string; ip: string | null;
}

export interface RefreshToken { token_hash: string; user_id: string; expires_at: string; created_at: string; }

export interface DeletionRequest { id: string; user_id: string; scheduled_for: string; note: string; status: string; created_at: string; }

export interface AnalyticsSnapshot {
  stage_funnel: { stage: string; entered: number; completed: number }[];
  review_sla_hours_median: number | null;
  plan_view_to_kit_rate: number;
  rescan_rate_m2: number;
  red_flag_misses: number;
}
