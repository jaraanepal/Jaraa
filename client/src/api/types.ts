/**
 * TypeScript types derived from ~/workspace/jaraa-pwa/api/openapi.yaml (v0.1.0).
 * All API paths live under /api/v1. Money is NPR.
 *
 * Note: the contract's role enum is (customer | doctor | admin); the product
 * blueprint (SDLC §2–§5) adds pharmacy + coach roles, which the server issues
 * in the same `role` claim — hence the wider union here.
 */

export type Role = "customer" | "doctor" | "admin" | "pharmacy" | "coach";

export type Lang2 = "ne" | "en";

export interface ApiErrorBody {
  code:
    | "feature_disabled"
    | "red_flag_unresolved"
    | "scan_incomplete"
    | "rate_limited"
    | "validation_error"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "consent_required"
    | "guest_forbidden"
    | "signature_invalid"
    | "not_ready";
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

/* ---------------------------------- auth --- */
export interface OtpRequestResponse {
  sent: boolean;
  expires_in_sec: number;
  dev_code?: string; // dev/staging only, never in production
}

export interface VerifiedUser {
  id: string;
  phone: string;
  role: Role;
  is_new_user: boolean;
}

export interface OtpVerifyResponse {
  access_token: string;
  token_type: string;
  expires_in_sec: number;
  user: VerifiedUser;
}

/** Session returned by password signup / password login (every role). */
export interface PasswordAuthResponse {
  access_token: string;
  token_type: string;
  expires_in_sec: number;
  user: { id: string; phone: string; email: string | null; role: Role };
}

/* ------------------------------------ me --- */
export interface Profile {
  user_id: string;
  phone: string;
  email?: string | null;
  name?: string | null;
  age_band: "16-22" | "23-29" | "30-39" | "40-49" | "50+";
  gender: "female" | "male" | "other";
  language: Lang2;
  guardian_consent: boolean;
  /** Fresh signed URL of the profile photo (null = none). */
  photo_url?: string | null;
  addresses?: Address[];
  timezone: string;
  /** Courier delivery note (008, U19). */
  delivery_instructions?: string | null;
}

/** A saved order address (stored as a JSON array on the profile row). */
export interface Address {
  id: string;
  name: string;
  phone: string;
  city: string;
  address_line: string;
  label?: string | null;
  is_default: boolean;
}

export type ConsentType = "photo" | "teleconsult" | "marketing" | "data";

export interface Consent {
  id: string;
  user_id: string;
  type: ConsentType;
  version: string;
  granted: boolean;
  granted_at: string;
  ip?: string | null;
}

export type PlanItemKind = "habit" | "product" | "consult" | "referral";

export interface PlanItem {
  id: string;
  plan_id: string;
  kind: PlanItemKind;
  title_ne: string;
  title_en: string;
  detail?: string | null;
  product_id?: string | null;
  kit_id?: string | null;
  sort_order: number;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title_en: string;
  title_ne?: string | null;
  body_en?: string | null;
  body_ne?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  case_id: string;
  doctor_id: string;
  status: "draft" | "approved";
  version: number;
  review_notes?: string | null;
  rescan_due_on?: string | null;
  created_at: string;
  items: PlanItem[];
}

export type RootKey = "nutrition" | "stress_sleep" | "hormones" | "scalp" | "damage" | "medical_family";

export interface RootScore {
  score: number;
  label_en: string;
  label_ne: string;
  signals?: Record<string, unknown>;
}

export type RootScores = Record<RootKey, RootScore>;

export interface RootMapSvgRoot {
  root: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  length: number;
  label_en: string;
  label_ne: string;
}

export type StatusCard = "reviewed" | "pending_review" | "red_flagged";

export interface RootMap {
  scan_id: string;
  version: number;
  status_card: StatusCard;
  generated_at: string;
  weakest_roots: RootKey[];
  roots: RootScores;
  /** Signed scan-photo URLs for the before/after slider (U16). */
  photos?: string[];
  svg: { viewBox: string; roots: RootMapSvgRoot[] };
  footer_note: string;
  share_image_url?: string | null;
}

export interface Checkin {
  id: string;
  user_id: string;
  plan_id?: string | null;
  shedding_estimate?: number | null;
  note?: string | null;
  photo_ids?: string[];
  created_at: string;
}

export interface ProgressBundle {
  root_score_history: Array<{ version: number; generated_at: string; roots: Record<RootKey, number> }>;
  checkins: Checkin[];
  next_rescan_due_on?: string | null;
}

export interface DataDeletionResponse {
  request_id: string;
  scheduled_for: string;
  note: string;
}

/* ---------------------------------- scans --- */
export type ScanStage = "kahani" | "lens" | "jara" | "root_map";
export type ScanStatus = "draft" | "submitted" | "in_review" | "reviewed" | "flagged";

export interface Scan {
  id: string;
  user_id?: string | null;
  status: ScanStatus;
  current_stage: ScanStage;
  stages_completed: ScanStage[];
  version: number;
  red_flags_count: number;
  created_at: string;
  updated_at: string;
}

export type PinType =
  | "shedding_onset"
  | "illness_fever"
  | "childbirth"
  | "crash_diet"
  | "medication_change"
  | "stress_period"
  | "moved_city_water"
  | "hair_treatment"
  | "other";

export interface TimelineEvent {
  id: string;
  scan_id: string;
  event_type: PinType;
  occurred_on: string;
  note?: string | null;
  followup_answers?: Record<string, unknown>;
}

export type PhotoAngle = "hairline" | "crown" | "parting" | "temples" | "shedding";

export interface Photo {
  id: string;
  scan_id: string;
  angle: PhotoAngle;
  thumb_url: string;
  signed_url: string;
  consent_id: string;
  created_at: string;
}

export type RedFlagType = "RF1" | "RF2" | "RF3" | "RF4" | "RF5" | "RF6" | "RF7";

export interface RedFlag {
  id: string;
  scan_id: string;
  flag_type: RedFlagType;
  detail: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
}

export interface ScanDetail extends Scan {
  timeline_events: TimelineEvent[];
  photos: Photo[];
  root_scores?: RootScores | null;
  red_flags: RedFlag[];
}

export type AdaptivePath = "standard" | "postpartum" | "medical" | "young" | "stress" | "sparse";

export interface StageAdvanceResponse {
  scan: Scan;
  active_paths: AdaptivePath[] | string[];
}

/* --------------------------------- doctor --- */
export interface Case {
  id: string;
  scan_id: string;
  user_id: string;
  assigned_doctor_id?: string | null;
  priority: "red_flag" | "high" | "normal";
  sla_due_at: string;
  /** D30: set while the SLA clock is paused (010 migration); absent on older payloads. */
  sla_paused_at?: string | null;
  status: "queued" | "in_review" | "reviewed" | "needs_info";
  created_at: string;
}

export interface CaseListResponse {
  cases: Case[];
  next_cursor?: string | null;
}

export type AnnotationShape =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "path"; points: Array<{ x: number; y: number }> };

export interface Annotation {
  id: string;
  photo_id: string;
  doctor_id: string;
  shape: AnnotationShape;
  note: string;
  created_at: string;
}

/* ----------------------------------- shop --- */
export type ProductKind = "cosmetic" | "prescription";

export interface Product {
  id: string;
  name: string;
  kind: ProductKind;
  price_npr: number;
  image_url?: string | null;
  is_active: boolean;
}

export interface Kit {
  id: string;
  name: string;
  description?: string | null;
  total_npr: number;
  is_active: boolean;
  /** Public image URLs (from GET /kits and GET /kits/:id). */
  images?: string[];
  whats_included?: string | null;
  usage_instructions?: string | null;
  category?: string | null;
  stock?: number;
  products: Product[];
}

export interface KitListResponse {
  kits: Kit[];
}

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface Order {
  id: string;
  user_id: string;
  kit_id: string;
  status: OrderStatus;
  subtotal_npr: number;
  shipping_npr: number;
  total_npr: number;
  payment_method: "esewa" | "khalti" | "cod";
  idempotency_key: string;
  created_at: string;
  /** Last status/data change (P9 fulfilment cycle proxy). */
  updated_at?: string;
  /** Courier assigned by pharmacy (P4, optional — older servers omit it). */
  courier_name?: string | null;
  /** Courier tracking ID (P4, optional). */
  tracking_id?: string | null;
  shipping_address?: { name: string; phone: string; city: string; address_line: string };
  /** Courier delivery note (008, U19). */
  delivery_instructions?: string | null;
  /** Rush flag (010, P34) — rush orders sort first in the queue. */
  is_rush?: boolean;
  /** Coupon applied at checkout (008, A16). */
  coupon_code?: string | null;
  /** Discount in NPR from the coupon (008, A16). */
  discount_npr?: number;
}

export interface CreateOrderPayload {
  kit_id: string;
  payment_method: "esewa" | "khalti" | "cod";
  shipping_address: { name: string; phone: string; city: string; address_line: string };
  delivery_instructions?: string;
  coupon_code?: string;
  // U26 gift-a-kit (client-only): the order endpoint (shop track) validates
  // + stores these on the created order.
  gift_recipient_name?: string;
  gift_recipient_phone?: string | null;
  gift_message?: string | null;
}

/* ------------------------------- consults --- */
export interface Consult {
  id: string;
  user_id: string;
  doctor_id?: string | null;
  scheduled_at: string;
  meet_link?: string | null;
  status: "requested" | "scheduled" | "completed" | "cancelled";
  notes?: string | null;
}

/* ---------------------------------- admin --- */
export interface FeatureFlag {
  key: string;
  is_enabled: boolean;
  updated_by?: string | null;
  updated_at: string;
}

export interface FeatureFlagListResponse {
  flags: FeatureFlag[];
}

export interface ScanRule {
  id: string;
  trigger_condition: Record<string, unknown>;
  action: "next_stage" | "raise_flag" | "skip_root" | "activate_path";
  action_detail?: string | null;
  priority: number;
  is_active: boolean;
}

export interface ScanRuleListResponse {
  rules: ScanRule[];
}

export interface FunnelAnalytics {
  stage_funnel: Array<{ stage: string; entered: number; completed: number }>;
  review_sla_hours_median: number;
  plan_view_to_kit_rate: number;
  rescan_rate_m2: number;
  red_flag_misses: number;
}

export interface AuditEntry {
  id: string;
  actor_id: string;
  action: string;
  entity: "case" | "scan" | "plan" | "photo" | "order" | "flag" | "rule" | "user";
  entity_id: string;
  at: string;
  ip?: string | null;
}

export interface AuditListResponse {
  entries: AuditEntry[];
}

export interface AdminUser {
  id: string;
  phone: string;
  email?: string | null;
  name?: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface AdminUserListResponse {
  users: AdminUser[];
}

/* --------------------------- admin kit management ---
 * These endpoints are assumed to exist (built by a sibling worker):
 * POST/GET/PATCH/DELETE /admin/kits (list: ?q=&category=&active=&page=&limit=),
 * POST /admin/kits/:id/images (multipart), DELETE /admin/kits/:id/images/:imageId.
 * The UI treats them as optional: a 404 falls back to an honest
 * "not available yet" state, never invented data.
 */
export interface AdminKit {
  id: string;
  name_en: string;
  name_ne?: string | null;
  total_npr: number;
  category?: string | null;
  stock: number;
  /** What's included in the kit (free-text, one item per line). */
  whats_included?: string | null;
  usage_instructions?: string | null;
  is_active: boolean;
  /** Public image URLs. */
  images: string[];
  created_at?: string;
  updated_at?: string;
}

export interface AdminKitListParams {
  q?: string;
  category?: string;
  active?: boolean;
  page?: number;
  limit?: number;
}

export interface AdminKitListResponse {
  kits: AdminKit[];
  total: number;
  page: number;
  limit: number;
}

export interface KitUpsertPayload {
  name_en: string;
  name_ne?: string;
  total_npr: number;
  category?: string;
  stock?: number;
  whats_included?: string;
  usage_instructions?: string;
  is_active: boolean;
}

/* ---------------------------------- coach --- */
export interface Nudge {
  id: string;
  kind: string;
  title_en: string;
  title_ne: string;
}

/** A customer assigned to this coach. Defensive: the server may 404
 *  until the assignment feature ships — the UI then says "nothing yet". */
export interface AssignedCustomer {
  id: string;
  name?: string | null;
  phone?: string | null;
  plan_status?: string | null;
  last_checkin_at?: string | null;
  next_followup_at?: string | null;
  /** Batch-4 (C36/C44): populated when the server includes notification
   *  prefs / content language in the customer payload — otherwise the
   *  nudge composer simply shows no hint. */
  quiet_from?: string | null;
  quiet_to?: string | null;
  content_language?: string | null;
}

/* ---------------- P-12 dashboard features ---------------- */
export interface PatientCase {
  id: string;
  scan_id: string;
  status: string;
  priority: string;
  sla_due_at: string | null;
  created_at: string;
  root_scores: { root: string; score: number }[];
  red_flag_count: number;
}

export interface PatientSearchResult {
  id: string;
  phone: string;
  name: string | null;
}

export interface FollowUp {
  id: string;
  case_id: string;
  doctor_id: string;
  due_on: string;
  note: string | null;
  done_at: string | null;
  created_at: string;
}

export interface DoctorAvailability {
  doctor_id: string;
  status: "available" | "on_leave";
  note: string | null;
  updated_at: string;
  name?: string | null;
  phone?: string;
}

export interface Refund {
  id: string;
  order_id: string;
  amount_npr: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface FinanceSnapshot {
  order_count: number;
  revenue_npr: number;
  cod_pending_npr: number;
  cod_collected_npr: number;
  refunds_npr: number;
  by_status: Record<string, number>;
}

export interface StaffVerification {
  id: string;
  user_id: string;
  requested_role: string;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  created_at: string;
  phone?: string;
  name?: string | null;
}

export interface OverdueCase {
  id: string;
  scan_id: string;
  user_id: string | null;
  status: string;
  priority: string;
  sla_due_at: string | null;
  created_at: string;
  hours_overdue: number;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  status: "open" | "answered" | "closed";
  created_at: string;
  updated_at: string;
}

export interface TicketReply {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_role: string;
  body: string;
  created_at: string;
}

export interface EducationArticle {
  id: string;
  title_en: string;
  title_ne: string | null;
  body_en: string;
  body_ne: string | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderCheck {
  id: string;
  order_id: string;
  check_type: "name" | "phone" | "address";
  checked_by: string | null;
  checked_at: string;
}

export interface DamageReport {
  id: string;
  order_id: string;
  reporter_id: string | null;
  description: string;
  created_at: string;
}

export interface HandoverNote {
  id: string;
  order_id: string;
  author_id: string | null;
  note: string;
  created_at: string;
}

export interface Challenge {
  id: string;
  title_en: string;
  title_ne: string | null;
  days: 7 | 14 | 30;
  description_en: string | null;
  description_ne: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ChallengeAssignment {
  id: string;
  challenge_id: string;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  challenge: Challenge | null;
}

export interface CoachNote {
  id: string;
  coach_id: string;
  customer_id: string;
  note: string;
  created_at: string;
}

export interface Escalation {
  id: string;
  customer_id: string;
  coach_id: string;
  reason: string;
  status: "open" | "acknowledged" | "resolved";
  created_at: string;
}

export interface ScheduledNudge {
  id: string;
  coach_id: string;
  user_id: string;
  message_en: string;
  message_ne: string | null;
  send_at: string;
  sent_at: string | null;
  created_at: string;
}

export interface SatisfactionRating {
  id: string;
  customer_id: string;
  coach_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface WishlistItem {
  id: string;
  user_id: string;
  kit_id: string;
  created_at: string;
  kit: Kit | null;
}

/* ---------------- Batch 2 (008) types ---------------- */
export interface DoctorWorkload { today: { claimed: number; in_review: number }; queue_total: number; capacity: number; overloaded: boolean }
export interface DoctorSlaSummary { overdue: number; due_within_6h: number }
export interface ReplySnippet { id: string; doctor_id: string; title: string; body_en: string; body_ne: string | null; created_at: string }
export interface ChecklistItem { id: string; checklist_id: string; label_en: string; label_ne: string | null; done: boolean; done_at: string | null }
export interface ReviewChecklist { id: string; case_id: string; doctor_id: string; items: ChecklistItem[]; created_at: string }
export interface PatientRisk { level: "low" | "medium" | "high"; red_flag_cases: number; missed_rescans: number }
export interface PhotoRequest { id: string; case_id: string; doctor_id: string; angles: string; note: string | null; created_at: string }
export interface DoctorReviewStats { reviewed_total: number; median_minutes: number | null; avg_minutes: number | null }
export interface DoctorNoteSearchResult { id: string; case_id: string; notes: string; created_at: string }

export interface RolePermission { id: string; role: string; permission: string; granted: boolean; updated_by: string | null; updated_at: string }
export interface Announcement { id: string; title_en: string; title_ne: string | null; body_en: string | null; body_ne: string | null; link: string | null; starts_at: string | null; ends_at: string | null; is_active: boolean; created_by: string | null; created_at: string }
export interface RefreshSessionView { token_hash: string; user_id: string; device: string | null; ip: string | null; created_at: string; last_seen_at: string }
export interface LoginAttempt { id: string; phone: string | null; email: string | null; success: boolean; ip: string | null; user_agent: string | null; created_at: string }
export interface Coupon { id: string; code: string; kind: "percent" | "fixed_npr"; value: number; max_uses: number | null; used_count: number; min_order_npr: number; starts_at: string | null; ends_at: string | null; is_active: boolean; created_by: string | null; created_at: string }
export interface SystemHealth { db_ok: boolean; db_latency_ms: number; audit_events_1h: number; by_action: Record<string, number> }
export interface StorageBucketUsage { bucket: string; files: number }
export interface BackupRecord { id: string; label: string; status: string; size_bytes: number | null; note: string | null; recorded_by: string | null; created_at: string }
export interface NotificationTemplate { id: string; name: string; title_en: string; title_ne: string | null; body_en: string | null; body_ne: string | null; link: string | null; created_by: string | null; created_at: string }

export interface StockMovement { id: string; kit_id: string; delta: number; reason: string | null; actor_id: string | null; created_at: string }
export interface ReorderSuggestion { kit: Kit; threshold: number }
export interface PackingCheck { id: string; order_id: string; step: string; done: boolean; checked_by: string | null; created_at: string }
export interface OrderLabel { order: Order; items: { kit_id: string; name: string; qty: number }[] }
export interface ZoneStat { zone: string; orders: number; delivered: number }
export interface KitBatch { id: string; kit_id: string; batch_no: string; expires_on: string | null; qty: number; supplier_id: string | null; created_at: string; kit_name?: string }
export interface Supplier { id: string; name: string; contact: string | null; phone: string | null; address: string | null; note: string | null; created_at: string }

export interface ChallengeGroup { id: string; title_en: string; title_ne: string | null; description_en: string | null; description_ne: string | null; starts_on: string | null; ends_on: string | null; created_by: string | null; created_at: string; member_count?: number }
export interface Badge { id: string; user_id: string; badge: string; awarded_by: string | null; created_at: string }
export interface SessionSummary { id: string; coach_id: string; customer_id: string; summary: string; created_at: string }
export interface CustomerGoal { id: string; coach_id: string; customer_id: string; title_en: string; title_ne: string | null; target_date: string | null; done_at: string | null; created_at: string }
export interface HabitTemplate { id: string; title_en: string; title_ne: string | null; description_en: string | null; description_ne: string | null; created_by: string | null; created_at: string }
export interface NoteTemplate { id: string; coach_id: string | null; title: string; body_en: string; body_ne: string | null; created_at: string }
export interface CoachRiskFlag { user_id: string; name: string | null; missed_checkins: number }
export interface ArticleAssignment { id: string; article_id: string; user_id: string; assigned_by: string | null; created_at: string }

export interface SymptomEntry { id: string; user_id: string; entry_date: string; note: string; created_at: string }
export interface WaterLog { id: string; user_id: string; log_date: string; glasses: number }
export interface SleepLog { id: string; user_id: string; log_date: string; bedtime: string | null; wake_time: string | null; quality: number | null }
export interface NotificationPrefs { user_id: string; plan_updates: boolean; photo_requests: boolean; digest: boolean; marketing: boolean; quiet_from: string | null; quiet_to: string | null }
export interface EmergencyContact { id: string; user_id: string; name: string; phone: string; relation: string | null; created_at: string }
