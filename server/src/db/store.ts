// The single data-access seam. Routes depend on this interface; memory.ts and
// supabase.ts implement it. Tests run against the in-memory implementation.
import type {
  User, Role, Profile, Consent, OtpRow, Scan, TimelineEvent, Photo, PhotoAngle,
  RootScoreRow, RedFlag, ScanRule, Case, Annotation, Plan, PlanItemInput,
  Product, Kit, Order, Payment, Consult, Checkin, FeatureFlag, AuditEntry,
  RefreshToken, DeletionRequest, AnalyticsSnapshot, PasswordResetRow,
} from "./types";

export interface Store {
  // users
  createUser(u: { phone: string; email?: string | null; role?: Role; passwordHash?: string | null; language?: string }): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByPhone(phone: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUserRole(id: string, role: Role): Promise<User | null>;
  setUserPassword(id: string, hash: string): Promise<void>;
  // profiles
  getProfile(userId: string): Promise<Profile | null>;
  upsertProfile(userId: string, p: Partial<Profile>): Promise<Profile>;
  // consents
  addConsent(c: { user_id: string; type: string; version: string; granted: boolean; ip?: string | null }): Promise<Consent>;
  listConsents(userId: string): Promise<Consent[]>;
  consentGranted(userId: string, type: string): Promise<boolean>;
  // otp
  otpGet(phone: string): Promise<OtpRow | null>;
  otpUpsert(phone: string, row: OtpRow): Promise<void>;
  otpDelete(phone: string): Promise<void>;
  // scans
  createScan(s: { user_id: string | null; guest_token?: string | null }): Promise<Scan>;
  getScan(id: string): Promise<Scan | null>;
  updateScan(id: string, patch: Partial<Scan>): Promise<Scan | null>;
  listUserScans(userId: string): Promise<Scan[]>;
  // timeline
  addTimelineEvent(e: { scan_id: string; event_type: string; occurred_on?: string | null; note?: string | null; followup_answers?: Record<string, unknown> }): Promise<TimelineEvent>;
  listTimelineEvents(scanId: string): Promise<TimelineEvent[]>;
  // photos
  upsertPhoto(p: { scan_id: string; angle: PhotoAngle; storage_path: string; thumb_path?: string | null; consent_id?: string | null; ai_quality?: unknown; width?: number | null; height?: number | null }): Promise<Photo>;
  getPhoto(id: string): Promise<Photo | null>;
  listPhotos(scanId: string): Promise<Photo[]>;
  deletePhoto(id: string): Promise<void>;
  // scores
  setRootScores(scanId: string, scores: { root: string; score: number; signals: Record<string, unknown> }[]): Promise<void>;
  getRootScores(scanId: string): Promise<RootScoreRow[]>;
  // red flags
  addRedFlag(f: { scan_id: string; flag_type: string; detail: string }): Promise<RedFlag>;
  listRedFlags(scanId: string, opts?: { unresolvedOnly?: boolean }): Promise<RedFlag[]>;
  resolveRedFlag(id: string, doctorId: string): Promise<RedFlag | null>;
  // scan rules
  listScanRules(activeOnly: boolean): Promise<ScanRule[]>;
  updateScanRule(id: string, patch: Partial<ScanRule>): Promise<ScanRule | null>;
  // cases
  createCase(c: { scan_id: string; priority: number; sla_due_at: string }): Promise<Case>;
  getCase(id: string): Promise<Case | null>;
  getCaseByScan(scanId: string): Promise<Case | null>;
  listCases(opts: { status?: string; limit: number; cursor?: string | null }): Promise<{ cases: Case[]; nextCursor: string | null }>;
  claimCase(id: string, doctorId: string): Promise<{ kase: Case | null; conflict: boolean }>;
  updateCase(id: string, patch: Partial<Case>): Promise<Case | null>;
  // annotations
  addAnnotation(a: { photo_id: string; doctor_id: string; shape: Record<string, unknown>; note?: string | null }): Promise<Annotation>;
  // plans
  createPlan(p: { case_id: string; doctor_id: string; review_notes?: string | null; rescan_due_on?: string | null; items: PlanItemInput[]; resolved_flag_ids?: string[] }): Promise<Plan>;
  getPlan(id: string): Promise<Plan | null>;
  getLatestApprovedPlanForUser(userId: string): Promise<Plan | null>;
  approvePlan(id: string, approverId: string): Promise<{ plan: Plan | null; reason?: string }>;
  // catalog
  createProduct(p: { name_en: string; name_ne?: string | null; kind: "cosmetic" | "prescription"; price_npr: number; image_url?: string | null; is_active?: boolean }): Promise<Product>;
  createKit(k: { name_en: string; name_ne?: string | null; product_ids: string[]; total_npr: number; is_active?: boolean }): Promise<Kit>;
  listProducts(opts: { activeOnly: boolean; cosmeticOnly: boolean }): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  listKits(activeOnly: boolean): Promise<Kit[]>;
  getKit(id: string): Promise<Kit | null>;
  updateKit(id: string, patch: Partial<Kit>): Promise<Kit | null>;
  // orders
  createOrder(o: { order_no: string; user_id: string; kit_id: string | null; subtotal_npr: number; shipping_npr: number; total_npr: number; payment_method: string; idempotency_key: string; shipping_address: Record<string, unknown> }): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  getOrderByNo(orderNo: string): Promise<Order | null>;
  getOrderByIdempotency(key: string): Promise<Order | null>;
  updateOrder(id: string, patch: Partial<Order>): Promise<Order | null>;
  listOrdersByUser(userId: string): Promise<Order[]>;
  listOrdersForPharmacy(): Promise<Order[]>;
  // payments
  createPayment(p: { order_id: string; provider: string; amount_npr: number }): Promise<Payment>;
  getPaymentByProviderRef(provider: string, ref: string): Promise<Payment | null>;
  updatePayment(id: string, patch: Partial<Payment>): Promise<Payment | null>;
  listPaymentsByOrder(orderId: string): Promise<Payment[]>;
  // consults
  createConsult(c: { user_id: string; doctor_id?: string | null; scheduled_at?: string | null; status: string }): Promise<Consult>;
  listConsultsByUser(userId: string): Promise<Consult[]>;
  // checkins
  addCheckin(c: { user_id: string; plan_id?: string | null; shedding_estimate?: number | null; note?: string | null; photo_ids?: string[] }): Promise<Checkin>;
  listCheckins(userId: string): Promise<Checkin[]>;
  // feature flags
  listFeatureFlags(): Promise<FeatureFlag[]>;
  setFeatureFlag(key: string, enabled: boolean, updatedBy: string | null): Promise<FeatureFlag | null>;
  // audit
  addAudit(a: { actor_id?: string | null; action: string; entity: string; entity_id?: string | null; ip?: string | null }): Promise<AuditEntry>;
  listAudit(f: { actor_id?: string; entity?: string; from?: string; to?: string; limit: number }): Promise<AuditEntry[]>;
  // refresh tokens
  saveRefreshToken(t: { token_hash: string; user_id: string; expires_at: string }): Promise<void>;
  getRefreshToken(hash: string): Promise<RefreshToken | null>;
  deleteRefreshToken(hash: string): Promise<void>;
  // password resets (single-use, HMAC-hashed tokens)
  savePasswordReset(r: { token_hash: string; user_id: string; expires_at: string }): Promise<void>;
  getPasswordReset(tokenHash: string): Promise<PasswordResetRow | null>;
  deletePasswordReset(tokenHash: string): Promise<void>;
  // deletion requests
  createDeletionRequest(r: { user_id: string; scheduled_for: string; note: string }): Promise<DeletionRequest>;
  // analytics
  analyticsSnapshot(): Promise<AnalyticsSnapshot>;
}
