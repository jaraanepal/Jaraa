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
  sort_order: number;
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
  status: "queued" | "in_review" | "reviewed" | "needs_info";
  created_at: string;
}

export interface CaseListResponse {
  cases: Case[];
  next_cursor?: string | null;
}

export type AnnotationShape =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number };

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
  shipping_address?: { name: string; phone: string; city: string; address_line: string };
}

export interface CreateOrderPayload {
  kit_id: string;
  payment_method: "esewa" | "khalti" | "cod";
  shipping_address: { name: string; phone: string; city: string; address_line: string };
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
}
