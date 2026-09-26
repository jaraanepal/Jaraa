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
  /** Opted into the coach streak leaderboard (009, C19). */
  leaderboard_opt_in: boolean;
}

export interface Profile {
  user_id: string; name: string | null; age_band: string | null; gender: string | null;
  is_minor: boolean; guardian_name: string | null; guardian_phone: string | null;
  guardian_consented_at: string | null;
  /** Storage path of the profile photo inside the profile-photos bucket (null = none). */
  photo_path: string | null;
  /** Order addresses, managed by the user (JSON array on the profile row). */
  addresses: Address[];
  /** Saved courier note prefilled at checkout (008, U19). */
  delivery_instructions: string | null;
  created_at: string; updated_at: string;
}

/** One saved order address (kept as a JSON array on the profile row). */
export interface Address {
  id: string; name: string; phone: string; city: string;
  address_line: string; label: string | null; is_default: boolean;
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
  /** Archived out of the active queue (009, D20). */
  archived_at: string | null;
}

export interface Annotation {
  id: string; photo_id: string; doctor_id: string; shape: Record<string, unknown>;
  note: string | null; created_at: string;
}

export interface PlanItemInput {
  kind: string; title_ne?: string; title_en?: string; detail?: string;
  product_id?: string; kit_id?: string; sort_order: number;
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
  product_ids: string[]; total_npr: number; is_active: boolean;
  /** Catalogue category slug, e.g. 'hair-oil' (005_kit_details.sql). */
  category: string | null;
  /** Public URLs of catalogue images in the public 'kit-images' bucket. */
  images: string[];
  /** What's inside the kit. */
  whats_included: string | null;
  /** How to use the kit. */
  usage_instructions: string | null;
  /** Units on hand; >= 0. */
  stock: number;
  created_at: string; updated_at: string;
  /** Low-stock alert threshold (009, P26). */
  low_stock_threshold: number;
}

export interface Order {
  id: string; order_no: string; user_id: string; kit_id: string | null;
  status: OrderStatus; subtotal_npr: number; shipping_npr: number; total_npr: number;
  payment_method: string | null; idempotency_key: string; fulfilment_note: string | null;
  /** Courier delivery note set at checkout (008, U19). */
  delivery_instructions: string | null;
  /** Coupon applied at checkout (008, A16 — cosmetic kits only). */
  coupon_code: string | null;
  /** Discount in NPR from the coupon (008, A16). */
  discount_npr: number;
  /** Courier assigned by pharmacy (007, P4). */
  courier_name: string | null;
  /** Courier tracking ID (007, P4). */
  tracking_id: string | null;
  shipping_address: Record<string, unknown>; created_at: string; updated_at: string;
  /** Gift order (009, U26). */
  is_gift: boolean;
  gift_recipient_name: string | null;
  gift_recipient_phone: string | null;
  gift_message: string | null;
  /** Pick/pack timer (009, P23). */
  pack_started_at: string | null;
  pack_completed_at: string | null;
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
  entity_id: string | null; at: string; ip: string | null; detail: string | null;
}

export interface RefreshToken { token_hash: string; user_id: string; expires_at: string; created_at: string; }

/** Single-use password-reset token. Only the HMAC hash is stored. */
export interface PasswordResetRow {
  token_hash: string; user_id: string; expires_at: string;
  used_at: string | null; created_at: string;
}

export interface DeletionRequest { id: string; user_id: string; scheduled_for: string; note: string; status: string; created_at: string; }

export interface AnalyticsSnapshot {
  stage_funnel: { stage: string; entered: number; completed: number }[];
  review_sla_hours_median: number | null;
  plan_view_to_kit_rate: number;
  rescan_rate_m2: number;
  red_flag_misses: number;
}

export interface AppNotification {
  id: string; user_id: string; type: string;
  title_en: string; title_ne: string | null;
  body_en: string | null; body_ne: string | null;
  link: string | null; read_at: string | null; created_at: string;
}

/* ---------------- P-12 dashboard features (007_dashboard_features.sql) --- */

export interface FollowUp {
  id: string; case_id: string; doctor_id: string; due_on: string;
  note: string | null; done_at: string | null; created_at: string;
}

export type DoctorAvailabilityStatus = "available" | "on_leave";
export interface DoctorAvailability {
  doctor_id: string; status: DoctorAvailabilityStatus; note: string | null; updated_at: string;
}

export interface Refund {
  id: string; order_id: string; amount_npr: number; reason: string | null;
  created_by: string | null; created_at: string;
}

export type StaffVerificationStatus = "pending" | "approved" | "rejected";
export interface StaffVerification {
  id: string; user_id: string; requested_role: string; status: StaffVerificationStatus;
  decided_by: string | null; decided_at: string | null; note: string | null; created_at: string;
}

export type TicketStatus = "open" | "answered" | "closed";
export interface SupportTicket {
  id: string; user_id: string; subject: string; status: TicketStatus;
  created_at: string; updated_at: string;
}
export interface TicketReply {
  id: string; ticket_id: string; author_id: string | null; author_role: string;
  body: string; created_at: string;
}

export interface EducationArticle {
  id: string; title_en: string; title_ne: string | null;
  body_en: string; body_ne: string | null; is_published: boolean;
  created_by: string | null; created_at: string; updated_at: string;
}

export type OrderCheckType = "name" | "phone" | "address";
export interface OrderCheck {
  id: string; order_id: string; check_type: OrderCheckType;
  checked_by: string | null; checked_at: string;
}

export interface DamageReport {
  id: string; order_id: string; reporter_id: string | null;
  description: string; created_at: string;
}

export interface HandoverNote {
  id: string; order_id: string; author_id: string | null;
  note: string; created_at: string;
}

export interface Challenge {
  id: string; title_en: string; title_ne: string | null; days: 7 | 14 | 30;
  description_en: string | null; description_ne: string | null;
  created_by: string | null; created_at: string;
}
export interface ChallengeAssignment {
  id: string; challenge_id: string; user_id: string;
  started_at: string; completed_at: string | null;
}

export interface CoachNote {
  id: string; coach_id: string; customer_id: string; note: string; created_at: string;
}

export type EscalationStatus = "open" | "acknowledged" | "resolved";
export interface Escalation {
  id: string; customer_id: string; coach_id: string; reason: string;
  status: EscalationStatus; created_at: string;
}

export interface ScheduledNudge {
  id: string; coach_id: string; user_id: string;
  message_en: string; message_ne: string | null;
  send_at: string; sent_at: string | null; created_at: string;
  /** Recurrence for motivational scheduler (009, C21): daily | weekly | null. */
  recurrence: string | null;
}

export interface SatisfactionRating {
  id: string; customer_id: string; coach_id: string;
  rating: number; comment: string | null; created_at: string;
}

export interface WishlistItem { id: string; user_id: string; kit_id: string; created_at: string; }

/* ---------------- Batch 2 (008) ---------------- */

export interface DoctorSnippet {
  id: string; doctor_id: string; title: string;
  body_en: string; body_ne: string | null; created_at: string;
}

export interface CaseBookmark { case_id: string; doctor_id: string; created_at: string; }

export interface ReviewChecklist {
  id: string; case_id: string; doctor_id: string; created_at: string;
  items?: ReviewChecklistItem[];
}
export interface ReviewChecklistItem {
  id: string; checklist_id: string; label_en: string; label_ne: string | null;
  done: boolean; sort: number; created_at: string;
}

export interface PhotoRequest {
  id: string; case_id: string; doctor_id: string; angles: string;
  note: string | null; fulfilled_at: string | null; created_at: string;
}

export interface Announcement {
  id: string; title_en: string; title_ne: string | null;
  body_en: string | null; body_ne: string | null; link: string | null;
  starts_at: string | null; ends_at: string | null; is_active: boolean;
  created_by: string | null; created_at: string;
}

export interface RolePermission {
  role: string; permission: string; granted: boolean;
  updated_by: string | null; updated_at: string;
}

export interface LoginAttempt {
  id: string; phone: string | null; email: string | null; success: boolean;
  ip: string | null; user_agent: string | null; created_at: string;
}

export type CouponKind = "percent" | "fixed_npr";
export interface Coupon {
  id: string; code: string; kind: CouponKind; value: number;
  max_uses: number | null; uses: number; min_order_npr: number;
  starts_at: string | null; ends_at: string | null; is_active: boolean;
  created_by: string | null; created_at: string;
}

export interface BackupRecord {
  id: string; label: string; status: "ok" | "failed" | "running";
  size_bytes: number | null; note: string | null;
  recorded_by: string | null; created_at: string;
}

export interface NotificationTemplate {
  id: string; name: string; title_en: string; title_ne: string | null;
  body_en: string | null; body_ne: string | null; link: string | null;
  created_by: string | null; created_at: string;
}

export interface StockMovement {
  id: string; kit_id: string; delta: number; reason: string | null;
  actor_id: string | null; created_at: string;
}

export interface PackingCheck {
  id: string; order_id: string; step: string; done: boolean;
  checked_by: string | null; created_at: string;
}

export interface KitBatch {
  id: string; kit_id: string; batch_no: string; expires_on: string | null;
  qty: number; supplier_id: string | null; created_at: string;
}

export interface Supplier {
  id: string; name: string; contact: string | null; phone: string | null;
  address: string | null; note: string | null; created_at: string;
}

export interface ChallengeGroup {
  id: string; title_en: string; title_ne: string | null;
  description_en: string | null; description_ne: string | null;
  starts_on: string | null; ends_on: string | null;
  created_by: string | null; created_at: string;
  member_count?: number;
}

export interface Badge {
  id: string; user_id: string; badge: string;
  awarded_by: string | null; created_at: string;
}

export interface SessionSummary {
  id: string; coach_id: string; customer_id: string;
  summary: string; created_at: string;
}

export interface CustomerGoal {
  id: string; coach_id: string; customer_id: string;
  title_en: string; title_ne: string | null; target_date: string | null;
  done_at: string | null; created_at: string;
}

export interface HabitTemplate {
  id: string; title_en: string; title_ne: string | null;
  description_en: string | null; description_ne: string | null;
  created_by: string | null; created_at: string;
}

export interface NoteTemplate {
  id: string; coach_id: string | null; title: string;
  body_en: string; body_ne: string | null; created_at: string;
}

export interface ArticleAssignment {
  id: string; article_id: string; user_id: string;
  assigned_by: string | null; created_at: string;
}

export interface SymptomEntry {
  id: string; user_id: string; entry_date: string; note: string; created_at: string;
}

export interface WaterLog { user_id: string; log_date: string; glasses: number; updated_at: string; }

export interface SleepLog {
  id: string; user_id: string; log_date: string;
  bedtime: string | null; wake_time: string | null; quality: number | null;
  created_at: string;
}

export interface NotificationPrefs {
  user_id: string; plan_updates: boolean; photo_requests: boolean;
  digest: boolean; marketing: boolean;
  quiet_from: string | null; quiet_to: string | null; updated_at: string;
}

export interface EmergencyContact {
  id: string; user_id: string; name: string; phone: string;
  relation: string | null; created_at: string;
}


/* ---------------- Batch 3 (009) — doctor ---------------- */
/** D22 second-opinion request (009_batch3.sql). status: pending | accepted | declined | done */
export interface SecondOpinion {
  id: string; case_id: string; requester_id: string; reviewer_id: string;
  status: "pending" | "accepted" | "declined" | "done";
  note: string | null; created_at: string; decided_at: string | null;
}

/** D24 one-tap triage preset, doctor-scoped (009_batch3.sql). */
export interface TriagePreset {
  id: string; doctor_id: string; name: string; priority: number; created_at: string;
}


/* ---------------- Batch 3 (009) — admin ---------------- */
/* ---------------- Batch 3 (009_batch3.sql) — admin dashboard A21–A29 --- */

export type DisputeStatus = "open" | "in_review" | "resolved" | "rejected";

export interface Dispute {
  id: string; order_id: string; user_id: string;
  subject: string; body: string;
  status: DisputeStatus;
  resolution: string | null;
  resolved_by: string | null;
  created_at: string; resolved_at: string | null;
}

export type CommunityTipStatus = "pending" | "approved" | "rejected";

export interface CommunityTip {
  id: string; user_id: string;
  title: string; body: string;
  status: CommunityTipStatus;
  moderated_by: string | null;
  created_at: string;
}

export interface PlanTemplate {
  id: string;
  title_en: string; title_ne: string | null;
  /** Reusable plan items (PlanItemInput shape). */
  items: unknown[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ExportSchedule {
  id: string;
  kind: string;                 // orders
  frequency: string;            // daily | weekly | monthly
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StaffChecklist {
  id: string; user_id: string;
  items: { key: string; done: boolean }[];
  updated_at: string;
}


/* ---------------- Batch 3 (009) — pharmacy ---------------- */
/* ---------------- Batch 3 (009) ---------------- */

/** One damaged-stock quarantine entry (009_batch3.sql: quarantine, P19). */
export interface QuarantineEntry {
  id: string;
  kit_id: string;
  qty: number;
  reason: string | null;
  status: "quarantined" | "released" | "written_off";
  reported_by: string | null;
  created_at: string;
}

/** One packaging-material stock row (009_batch3.sql: packaging_materials, P24). */
export interface PackagingMaterial {
  id: string;
  name: string;
  qty: number;
  unit: string | null;
  low_threshold: number;
  updated_at: string;
}

/** One internal pharmacy note on an order (009_batch3.sql: order_notes, P27).
 *  Distinct from handover_notes (007, shift handover). */
export interface OrderNote {
  id: string;
  order_id: string;
  author_id: string;
  note: string;
  created_at: string;
}


/* ---------------- Batch 3 (009) — coach ---------------- */
export interface OnboardingChecklist {
  id: string; user_id: string;
  steps: { key: string; done: boolean }[];
  updated_at: string;
}

export interface CoachAvailability {
  id: string; coach_id: string;
  status: "available" | "on_leave";
  note: string | null;
  updated_at: string;
}


/* ---------------- Batch 3 (009) — customer ---------------- */
/** U21: case Q&A thread message. 009 table `case_messages`. */
export interface CaseMessage {
  id: string;
  case_id: string;
  author_id: string;
  author_role: "customer" | "doctor";
  body: string;
  created_at: string;
}

/** U22: follow-up review request (appointment-free). 009 table `review_requests`. */
export interface ReviewRequest {
  id: string;
  user_id: string;
  case_id: string | null;
  reason: string | null;
  status: "pending" | "done";
  created_at: string;
}

/** U25: one loyalty ledger row. 009 table `loyalty_points`. */
export interface LoyaltyEntry {
  id: string;
  user_id: string;
  points: number;
  reason: string | null;
  order_id: string | null;
  created_at: string;
}

/** U29: medication-free routine item. 009 table `routine_library`. */
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

/* ================= BATCH 4 (010_batch4.sql) ================= */

/** D32: doctor-only internal comment on a case. */
export interface CaseComment {
  id: string; case_id: string; doctor_id: string; body: string; created_at: string;
}

/** D33: non-diagnostic concern tag on a case. */
export interface CaseConcernTag {
  id: string; case_id: string; tag: string; created_at: string;
}

/** D40: saved queue filter preset, doctor-scoped. */
export interface QueueFilter {
  id: string; doctor_id: string; name: string; filters: Record<string, unknown>; created_at: string;
}

/** D38: past case with similar root scores (reference only). */
export interface SimilarCase {
  id: string; created_at: string; priority: number; status: string; distance: number;
}

/** A30: role dashboard card config. */
export interface DashboardConfig {
  id: string; role: string; config: Record<string, unknown>; updated_at: string;
}

/** A37: one email delivery log row. */
export interface EmailLog {
  id: string; to_email: string; template: string; status: "sent" | "failed";
  error: string | null; created_at: string;
}

/** A44: internal admin notice. */
export interface AdminNotice {
  id: string; title_en: string; title_ne: string | null; body_en: string | null;
  body_ne: string | null; created_at: string; read: boolean;
}

/** A45: consent text version. */
export interface ConsentVersion {
  id: string; kind: string; version: number; text_en: string; text_ne: string | null;
  active: boolean; created_at: string;
}

/** P31: failed delivery attempt. */
export interface DeliveryAttempt {
  id: string; order_id: string; status: "failed" | "rescheduled" | "delivered";
  note: string | null; created_at: string;
}

/** P33: physical stock count audit row. */
export interface StockCount {
  id: string; kit_id: string; system_qty: number; counted_qty: number; variance: number;
  counted_by: string | null; created_at: string;
}

/** P38: kit substitution record. */
export interface Substitution {
  id: string; order_id: string; from_kit_id: string | null; to_kit_id: string | null;
  reason: string; created_at: string;
}

/** P39: delivery photo proof (storage_path in existing scan-photos bucket). */
export interface DeliveryProof {
  id: string; order_id: string; storage_path: string; note: string | null; created_at: string;
}

/** P43: pharmacy-initiated refund request. */
export interface RefundRequest {
  id: string; order_id: string; reason: string; status: "pending" | "approved" | "rejected";
  created_at: string; decided_at: string | null;
}

/** P44: non-dispatch day. */
export interface DispatchHoliday {
  id: string; date: string; label: string; created_at: string;
}

/** P45: courier damage claim. */
export interface CourierClaim {
  id: string; courier_name: string; order_id: string | null; amount_npr: number;
  reason: string; status: "open" | "filed" | "settled"; created_at: string;
}

/** P36-alt: kit batch expiring soon. */
export interface ExpiringBatch {
  id: string; kit_id: string; kit_name: string; batch_no: string | null;
  expiry: string | null; days_left: number | null; qty: number;
}

/** C29: customer feedback on their coach. */
export interface CoachFeedback {
  id: string; coach_id: string; customer_id: string; rating: number;
  note: string | null; created_at: string;
}

/** C30: streak freeze for one date. */
export interface StreakFreeze {
  id: string; customer_id: string; coach_id: string; frozen_date: string; created_at: string;
}

/** C32: coach-defined customer tag. */
export interface CustomerTag {
  id: string; coach_id: string; customer_id: string; tag: string; created_at: string;
}

/** C34: handover note between coaches. */
export interface CoachHandover {
  id: string; customer_id: string; from_coach_id: string | null; to_coach_id: string | null;
  note: string; created_at: string;
}

/** C43: anonymized peer tip. */
export interface CoachTip {
  id: string; coach_id: string; title: string; body: string; created_at: string;
}

/** C45: end-of-challenge survey response. */
export interface ChallengeSurvey {
  id: string; assignment_id: string; q1_rating: number; q2_text: string | null; created_at: string;
}

/** C41-alt: customer journey stage. */
export type JourneyStage = "new" | "active" | "returning" | "dormant";

/** U37: app feedback row. */
export interface AppFeedback {
  id: string; user_id: string; rating: number; message: string | null; created_at: string;
}

/** U40: per-kit usage reminder. */
export interface KitReminder {
  id: string; user_id: string; kit_id: string | null; label_en: string; label_ne: string | null;
  remind_at: string; done: boolean; created_at: string;
}

/** U42: product usage log row. */
export interface KitUsage {
  id: string; user_id: string; kit_id: string | null; used_at: string;
  note: string | null; created_at: string;
}

/* ================= P-5..P-17 (v1.4 backend) ================= */

/** P-5: customer return request. */
export interface ReturnRequest {
  id: string; order_id: string; user_id: string; reason: string;
  status: "requested" | "approved" | "rejected" | "picked_up" | "completed";
  created_at: string; decided_at: string | null; decided_by: string | null;
}

/** P-5: refund with lifecycle status (refunds table gains `status`). */
export type RefundStatus = "pending" | "approved" | "rejected" | "processed";

/** P-6: lab provider config entity — EMPTY until a real partner exists. */
export interface LabProvider {
  id: string; name_en: string; name_ne: string | null; is_active: boolean;
  note: string | null; created_at: string;
}

/** P-6: lab test catalog row. */
export interface LabTest {
  id: string; provider_id: string | null; name_en: string; name_ne: string | null;
  description_en: string | null; description_ne: string | null;
  price_npr: number; is_active: boolean; created_at: string;
}

export type LabBookingStatus = "booked" | "sample_collected" | "report_ready" | "cancelled";

/** P-6: at-home lab booking. */
export interface LabBooking {
  id: string; user_id: string; test_id: string; scheduled_on: string | null;
  slot: string | null; address: Record<string, unknown>; phone: string;
  status: LabBookingStatus; created_at: string; updated_at: string;
}

/** P-6: uploaded lab report (report file lives in existing storage). */
export interface LabReport {
  id: string; booking_id: string; storage_path: string;
  uploaded_by: string | null; created_at: string;
}

/** P-7: family member under one account. member_user_id is set on invite accept. */
export interface FamilyMember {
  id: string; owner_id: string; member_user_id: string | null;
  name: string; relation: string | null;
  status: "invited" | "active"; invite_token: string | null;
  data_shared: boolean; created_at: string;
}

/** P-8: generic idempotency record for mutations. */
export interface IdempotencyRecord {
  key: string; user_id: string; scope: string;
  response: unknown; created_at: string;
}

/** P-9: AI conversation + messages (education only, never diagnosis). */
export interface AiConversation {
  id: string; user_id: string; created_at: string;
}
export interface AiMessage {
  id: string; conversation_id: string; role: "user" | "assistant";
  body: string; red_flagged: boolean; created_at: string;
}

/** P-11: published content feed row (extends EducationArticle with category/views). */
export interface ArticleView {
  id: string; article_id: string; user_id: string; created_at: string;
}

/** P-12: community Q&A. */
export type QaQuestionStatus = "open" | "answered" | "flagged" | "hidden";
export interface QaQuestion {
  id: string; user_id: string; title: string; body: string;
  status: QaQuestionStatus; created_at: string; updated_at: string;
}
export interface QaAnswer {
  id: string; question_id: string; doctor_id: string; body: string;
  agree_count: number; helpful_count: number;
  created_at: string; updated_at: string;
}
export interface QaFlag {
  id: string; question_id: string | null; answer_id: string | null;
  user_id: string; reason: string; created_at: string;
}

/** P-13: referral code + attribution (fires only after Root Scan completion). */
export interface ReferralCode {
  id: string; user_id: string; code: string; created_at: string;
}
export interface Referral {
  id: string; referrer_id: string; referred_id: string; code: string;
  status: "pending" | "completed"; completed_at: string | null; created_at: string;
}

/** P-13/Root Coins: immutable coin ledger. */
export interface CoinLedgerEntry {
  id: string; user_id: string; amount: number; reason: string;
  ref_type: string | null; ref_id: string | null; created_at: string;
}

/** P-14: wallet + immutable transaction ledger. */
export interface Wallet {
  id: string; user_id: string; balance_npr: number; updated_at: string;
}
export type WalletTxnKind = "cashback" | "cod_change" | "adjustment";
export interface WalletTxn {
  id: string; wallet_id: string; amount_npr: number; kind: WalletTxnKind;
  ref: string | null; created_at: string;
}

/** P-15: shipment tracking event (customer-visible milestones). */
export type ShipmentEventType =
  | "packed" | "shipped" | "hub_arrival" | "out_for_delivery"
  | "delivered" | "delayed" | "failed";
export interface ShipmentEvent {
  id: string; order_id: string; event_type: ShipmentEventType;
  label_en: string | null; label_ne: string | null; location: string | null;
  created_at: string;
}

/** P-16: food DB row — source is ALWAYS 'estimate' until verified. */
export interface Food {
  id: string; name_en: string; name_ne: string | null; name_ro: string | null;
  protein_g: number; calories: number; serving: string;
  source: string; created_at: string;
}

/** P-16: diet plan template (admin) + assignment. */
export interface DietPlan {
  id: string; title_en: string; title_ne: string | null; title_ro: string | null;
  description_en: string | null; description_ne: string | null;
  protein_target_g: number | null; items: unknown[];
  is_active: boolean; created_by: string | null; created_at: string;
}
export interface DietAssignment {
  id: string; plan_id: string; user_id: string;
  assigned_by: string | null; starts_on: string | null; created_at: string;
}

/** P-16: daily habit check-in (idempotent per user+date+habit). */
export interface HabitLog {
  id: string; user_id: string; log_date: string; habit_key: string;
  done: boolean; note: string | null; created_at: string;
}

/** P-17: milestone definition + per-user achievement. */
export interface Milestone {
  id: string; title_en: string; title_ne: string | null; title_ro: string | null;
  description_en: string | null; description_ne: string | null;
  kind: string; threshold: number | null;
  is_active: boolean; created_by: string | null; created_at: string;
}
export interface UserMilestone {
  id: string; milestone_id: string; user_id: string; achieved_at: string;
}

/** P-17: coach messaging thread + messages. */
export interface CoachThread {
  id: string; customer_id: string; coach_id: string | null; created_at: string;
}
export interface CoachMessage {
  id: string; thread_id: string; sender_id: string; sender_role: string;
  body: string; client_message_id: string | null; created_at: string;
}
