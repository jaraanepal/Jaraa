// In-memory Store implementation: hermetic tests + dev fallback when Supabase
// env is absent. Not for production (data is lost on restart).
import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import type {
  Announcement, RolePermission, LoginAttempt, Coupon, CouponKind, BackupRecord,
  ArticleAssignment, SymptomEntry, WaterLog, SleepLog, NotificationPrefs, EmergencyContact,
  CaseMessage,
  CaseComment, CaseConcernTag, QueueFilter, SimilarCase,
  DashboardConfig, EmailLog, AdminNotice, ConsentVersion,
  AppFeedback, KitReminder, KitUsage,
  ChallengeGroup, Badge, SessionSummary, CustomerGoal, HabitTemplate, NoteTemplate,
  CoachAvailability,
  CoachNote, Escalation, EscalationStatus, ScheduledNudge, SatisfactionRating, WishlistItem,
  CoachFeedback, StreakFreeze, CustomerTag, CoachHandover, CoachTip, ChallengeSurvey, JourneyStage,
  CommunityTip,
  Dispute,
  DoctorSnippet, CaseBookmark, ReviewChecklist, ReviewChecklistItem, PhotoRequest,
  ExportSchedule,
  FollowUp, DoctorAvailability, DoctorAvailabilityStatus, Refund, StaffVerification,
  LoyaltyEntry,
  NotificationTemplate, StockMovement, PackingCheck, KitBatch, Supplier,
  OnboardingChecklist,
  OrderCheck, OrderCheckType, DamageReport, HandoverNote, Challenge, ChallengeAssignment,
  OrderNote,
  PackagingMaterial,
  DeliveryAttempt, StockCount, Substitution, DeliveryProof,
  RefundRequest, DispatchHoliday, CourierClaim, ExpiringBatch,
  PlanTemplate,
  Product, Kit, Order, Payment, Consult, Checkin, FeatureFlag, AuditEntry,
  QuarantineEntry,
  RefreshToken, PasswordResetRow, DeletionRequest, AnalyticsSnapshot, AppNotification,
  ReviewRequest,
  RootScoreRow, RedFlag, ScanRule, Case, Annotation, Plan, PlanItemInput, PlanItem,
  RoutineItem,
  SecondOpinion,
  StaffChecklist,
  StaffVerificationStatus, SupportTicket, TicketReply, TicketStatus, EducationArticle,
  TriagePreset,
  User, Role, Profile, Consent, OtpRow, Scan, TimelineEvent, Photo, PhotoAngle,
  // P-5..P-17 (v1.4 backend)
  ReturnRequest, RefundStatus, LabProvider, LabTest, LabBookingStatus, LabBooking,
  LabReport, FamilyMember, IdempotencyRecord, AiConversation, AiMessage,
  ArticleView, QaQuestion, QaQuestionStatus, QaAnswer, QaFlag,
  ReferralCode, Referral, CoinLedgerEntry, Wallet, WalletTxnKind, WalletTxn,
  ShipmentEventType, ShipmentEvent, Food, DietPlan, DietAssignment, HabitLog,
  Milestone, UserMilestone, CoachThread, CoachMessage,
} from "./types";

const now = () => new Date().toISOString();

/** A30/A33 (admin slice): expires_at lives on the DB row (010 migration) but
 * not on the shared StaffVerification type. Module-level alias — it cannot
 * live inside the class body. */
type StaffVerificationRow = StaffVerification & { expires_at?: string | null };

/** Server-local calendar day key "YYYY-MM-DD". */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** U31: count consecutive days in `days` ending today, or yesterday when
 * today is not in the set (user hasn't checked in today yet). */
function streakFromDays(days: Set<string>): number {
  let cursor = new Date();
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - 86_400_000);
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return n;
}

// ---- Batch 4 (010) helpers ----
// NOTE: cases.sla_paused_at exists in the DB (010_batch4.sql) but not on the
// server Case type, so it is carried via a narrow local cast — never stored
// anywhere else.
type CaseWithSla = Case & { sla_paused_at?: string | null };

/** P-5 (v1.4): the refunds table gains `status` (+ decided_by / decided_at),
 * but the shared Refund type predates it. Carried via a narrow local cast —
 * never stored anywhere else. */
type RefundRow = Refund & { status?: RefundStatus | null; decided_by?: string | null; decided_at?: string | null };

/** P-10 (v1.4): education_articles gains `category`; the shared
 * EducationArticle type predates it — same narrow-cast pattern. */
type ArticleRow = EducationArticle & { category?: string | null };

/** Monday (local) of the current week, as YYYY-MM-DD. */
function b4WeekStart(): string {
  const nowD = new Date();
  const dow = (nowD.getDay() + 6) % 7; // Monday = 0
  const mon = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - dow);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
}

export class MemoryStore implements Store {
  users = new Map<string, User>();
  profiles = new Map<string, Profile>();
  consents = new Map<string, Consent>();
  otps = new Map<string, OtpRow>();
  scans = new Map<string, Scan>();
  events = new Map<string, TimelineEvent>();
  photos = new Map<string, Photo>();
  scores = new Map<string, RootScoreRow[]>(); // by scan_id
  flags = new Map<string, RedFlag>();
  rules = new Map<string, ScanRule>();
  cases = new Map<string, Case>();
  annotations = new Map<string, Annotation>();
  plans = new Map<string, Plan & { user_id?: string }>();
  products = new Map<string, Product>();
  kits = new Map<string, Kit>();
  orders = new Map<string, Order>();
  ordersByIdem = new Map<string, Order>();
  payments = new Map<string, Payment>();
  consults = new Map<string, Consult>();
  checkins = new Map<string, Checkin>();
  featureFlags = new Map<string, FeatureFlag>();
  audit: AuditEntry[] = [];
  auditSeq = 1;
  refreshTokens = new Map<string, RefreshToken>();
  passwordResets = new Map<string, PasswordResetRow>();
  deletions = new Map<string, DeletionRequest>();
  // ---- Batch 3 (009) fields ----
  secondOpinions = new Map<string, SecondOpinion>();
  // ---- Batch 4 (010) fields ----
  caseComments = new Map<string, CaseComment>();
  caseConcernTags = new Map<string, CaseConcernTag>();
  queueFilters = new Map<string, QueueFilter>();
  dashboardConfigs = new Map<string, DashboardConfig>();
  emailLogs = new Map<string, EmailLog>();
  adminNotices = new Map<string, AdminNotice>();
  adminNoticeReads = new Map<string, string>(); // `${adminId}:${noticeId}` -> read_at
  consentVersions = new Map<string, ConsentVersion>();
  deliveryAttempts = new Map<string, DeliveryAttempt>();
  stockCounts = new Map<string, StockCount>();
  substitutions = new Map<string, Substitution>();
  deliveryProofs = new Map<string, DeliveryProof>();
  refundRequests = new Map<string, RefundRequest>();
  dispatchHolidays = new Map<string, DispatchHoliday>();
  courierClaims = new Map<string, CourierClaim>();
  coachFeedback = new Map<string, CoachFeedback>();
  streakFreezes = new Map<string, StreakFreeze>();
  customerTags = new Map<string, CustomerTag>();
  coachHandovers = new Map<string, CoachHandover>();
  coachTips = new Map<string, CoachTip>();
  challengeSurveys = new Map<string, ChallengeSurvey>();
  appFeedback = new Map<string, AppFeedback>();
  kitReminders = new Map<string, KitReminder>();
  kitUsages = new Map<string, KitUsage>();
  triagePresets = new Map<string, TriagePreset>();
  communityTips = new Map<string, CommunityTip>();
  disputes = new Map<string, Dispute>();
  exportSchedules = new Map<string, ExportSchedule>();
  planTemplates = new Map<string, PlanTemplate>();
  staffChecklists = new Map<string, StaffChecklist>();
  orderNotes = new Map<string, OrderNote>();
  packagingMaterials = new Map<string, PackagingMaterial>();
  quarantine = new Map<string, QuarantineEntry>();
  coachAvailability = new Map<string, CoachAvailability>();
  onboardingChecklists = new Map<string, OnboardingChecklist>();
  caseMessages = new Map<string, CaseMessage>();
  loyaltyEntries = new Map<string, LoyaltyEntry>();
  reviewRequests = new Map<string, ReviewRequest>();
  routines = new Map<string, RoutineItem>();
  // ---- P-5..P-17 (v1.4 backend) fields ----
  returnRequests = new Map<string, ReturnRequest>();
  labProviders = new Map<string, LabProvider>();
  labTests = new Map<string, LabTest>();
  labBookings = new Map<string, LabBooking>();
  labReports = new Map<string, LabReport>();
  familyMembers = new Map<string, FamilyMember>();
  idempotencyRecords = new Map<string, IdempotencyRecord>();
  aiConversations = new Map<string, AiConversation>();
  aiMessages = new Map<string, AiMessage>();
  articleViews = new Map<string, ArticleView>(); // key: `${article_id}:${user_id}`
  qaQuestions = new Map<string, QaQuestion>();
  qaAnswers = new Map<string, QaAnswer>();
  qaAnswerAgrees = new Map<string, { answer_id: string; doctor_id: string; created_at: string }>(); // key: `${answer_id}:${doctor_id}`
  qaHelpfulness = new Map<string, { answer_id: string; user_id: string; helpful: boolean; created_at: string }>(); // key: `${answer_id}:${user_id}`
  qaFlags = new Map<string, QaFlag>();
  referralCodes = new Map<string, ReferralCode>();
  referralCodesByUser = new Map<string, ReferralCode>(); // user_id -> code
  referrals = new Map<string, Referral>();
  coinLedger: CoinLedgerEntry[] = [];
  wallets = new Map<string, Wallet>(); // user_id -> wallet
  walletTxns = new Map<string, WalletTxn>();
  shipmentEvents = new Map<string, ShipmentEvent>();
  foods = new Map<string, Food>();
  dietPlans = new Map<string, DietPlan>();
  dietAssignments = new Map<string, DietAssignment>();
  habitLogs = new Map<string, HabitLog>(); // key: `${user_id}:${log_date}:${habit_key}`
  milestones = new Map<string, Milestone>();
  userMilestones = new Map<string, UserMilestone>(); // key: `${milestone_id}:${user_id}`
  coachThreads = new Map<string, CoachThread>();
  coachMessages = new Map<string, CoachMessage>();
  // ---- Batch 3 (009) fields ----

  constructor() {
    // seed feature flags (mirrors 001_init.sql seed; medical modules OFF)
    const seed: [string, boolean][] = [
      ["root_scan", true], ["cosmetic_kits", true],
      ["teleconsult_booking", false], ["prescription_commerce", false],
    ];
    for (const [key, is_enabled] of seed) {
      this.featureFlags.set(key, { key, is_enabled, updated_by: null, updated_at: now() });
    }
  }

  // ---- users ----
  async createUser(u: { phone: string; email?: string | null; role?: Role; passwordHash?: string | null; language?: string }): Promise<User> {
    const user: User = {
      id: randomUUID(), phone: u.phone, email: u.email ?? null, role: u.role ?? "customer",
      language: u.language ?? "ne", is_active: true, password_hash: u.passwordHash ?? null,
      leaderboard_opt_in: false,
      totp_secret: null, created_at: now(), updated_at: now(),
    };
    this.users.set(user.id, user);
    return user;
  }
  async getUserById(id: string) { return this.users.get(id) ?? null; }
  async getUserByPhone(phone: string) {
    for (const u of this.users.values()) if (u.phone === phone) return u;
    return null;
  }
  async getUserByEmail(email: string) {
    for (const u of this.users.values()) if (u.email?.toLowerCase() === email.toLowerCase()) return u;
    return null;
  }
  async listUsers() { return [...this.users.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async updateUserRole(id: string, role: Role) {
    const u = this.users.get(id); if (!u) return null;
    u.role = role; u.updated_at = now(); return u;
  }
  async setUserPassword(id: string, hash: string) {
    const u = this.users.get(id); if (u) { u.password_hash = hash; u.updated_at = now(); }
  }

  // ---- profiles ----
  async getProfile(userId: string) { return this.profiles.get(userId) ?? null; }
  async upsertProfile(userId: string, p: Partial<Profile>) {
    const cur = this.profiles.get(userId) ?? {
      user_id: userId, name: null, age_band: null, gender: null, is_minor: false,
      guardian_name: null, guardian_phone: null, guardian_consented_at: null,
      photo_path: null, addresses: [], delivery_instructions: null,
      created_at: now(), updated_at: now(),
    };
    const next = { ...cur, ...p, user_id: userId, updated_at: now() };
    this.profiles.set(userId, next);
    return next;
  }

  // ---- consents ----
  async addConsent(c: { user_id: string; type: string; version: string; granted: boolean; ip?: string | null }) {
    const row: Consent = { id: randomUUID(), ...c, ip: c.ip ?? null, granted_at: now() };
    this.consents.set(row.id, row);
    return row;
  }
  async listConsents(userId: string) {
    return [...this.consents.values()].filter((c) => c.user_id === userId)
      .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
  }
  async consentGranted(userId: string, type: string) {
    const rows = await this.listConsents(userId);
    const latest = rows.find((c) => c.type === type);
    return !!latest?.granted;
  }

  // ---- otp ----
  async otpGet(phone: string) { return this.otps.get(phone) ?? null; }
  async otpUpsert(phone: string, row: OtpRow) { this.otps.set(phone, row); }
  async otpDelete(phone: string) { this.otps.delete(phone); }

  // ---- scans ----
  async createScan(s: { user_id: string | null; guest_token?: string | null }) {
    const scan: Scan = {
      id: randomUUID(), user_id: s.user_id, guest_token: s.guest_token ?? null,
      status: "draft", current_stage: 1, version: 1, active_path: null, answers: {},
      created_at: now(), updated_at: now(),
    };
    this.scans.set(scan.id, scan);
    return scan;
  }
  async getScan(id: string) { return this.scans.get(id) ?? null; }
  async updateScan(id: string, patch: Partial<Scan>) {
    const s = this.scans.get(id); if (!s) return null;
    Object.assign(s, patch, { updated_at: now() });
    return s;
  }
  async listUserScans(userId: string) {
    return [...this.scans.values()].filter((s) => s.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ---- timeline ----
  async addTimelineEvent(e: { scan_id: string; event_type: string; occurred_on?: string | null; note?: string | null; followup_answers?: Record<string, unknown> }) {
    const row: TimelineEvent = {
      id: randomUUID(), scan_id: e.scan_id, event_type: e.event_type,
      occurred_on: e.occurred_on ?? null, position_months_ago: null, note: e.note ?? null,
      followup_answers: e.followup_answers ?? {}, created_at: now(),
    };
    this.events.set(row.id, row);
    return row;
  }
  async listTimelineEvents(scanId: string) {
    return [...this.events.values()].filter((e) => e.scan_id === scanId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ---- photos ----
  async upsertPhoto(p: { scan_id: string; angle: PhotoAngle; storage_path: string; thumb_path?: string | null; consent_id?: string | null; ai_quality?: unknown; width?: number | null; height?: number | null }) {
    const existing = [...this.photos.values()].find((x) => x.scan_id === p.scan_id && x.angle === p.angle);
    if (existing) this.photos.delete(existing.id);
    const row: Photo = {
      id: randomUUID(), scan_id: p.scan_id, angle: p.angle, storage_path: p.storage_path,
      thumb_path: p.thumb_path ?? null, consent_id: p.consent_id ?? null,
      ai_quality: p.ai_quality ?? null, width: p.width ?? null, height: p.height ?? null,
      created_at: now(),
    };
    this.photos.set(row.id, row);
    return row;
  }
  async getPhoto(id: string) { return this.photos.get(id) ?? null; }
  async listPhotos(scanId: string) {
    return [...this.photos.values()].filter((p) => p.scan_id === scanId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async deletePhoto(id: string) { this.photos.delete(id); }

  // ---- scores ----
  async setRootScores(scanId: string, scores: { root: string; score: number; signals: Record<string, unknown> }[]) {
    this.scores.set(scanId, scores.map((s) => ({ scan_id: scanId, ...s, updated_at: now() })));
  }
  async getRootScores(scanId: string) { return this.scores.get(scanId) ?? []; }

  // ---- red flags ----
  async addRedFlag(f: { scan_id: string; flag_type: string; detail: string }) {
    const row: RedFlag = { id: randomUUID(), ...f, resolved_by: null, resolved_at: null, created_at: now() };
    this.flags.set(row.id, row);
    return row;
  }
  async listRedFlags(scanId: string, opts?: { unresolvedOnly?: boolean }) {
    let rows = [...this.flags.values()].filter((f) => f.scan_id === scanId);
    if (opts?.unresolvedOnly) rows = rows.filter((f) => !f.resolved_at);
    return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async resolveRedFlag(id: string, doctorId: string) {
    const f = this.flags.get(id); if (!f) return null;
    f.resolved_by = doctorId; f.resolved_at = now();
    return f;
  }

  // ---- scan rules ----
  async listScanRules(activeOnly: boolean) {
    const rows = [...this.rules.values()].filter((r) => !activeOnly || r.is_active);
    return rows.sort((a, b) => b.priority - a.priority);
  }
  async updateScanRule(id: string, patch: Partial<ScanRule>) {
    const r = this.rules.get(id); if (!r) return null;
    Object.assign(r, patch);
    return r;
  }

  // ---- cases ----
  async createCase(c: { scan_id: string; priority: number; sla_due_at: string }) {
    const kase: Case = {
      id: randomUUID(), scan_id: c.scan_id, assigned_doctor_id: null,
      priority: c.priority, sla_due_at: c.sla_due_at, status: "queued",
      archived_at: null,
      created_at: now(), updated_at: now(),
    };
    this.cases.set(kase.id, kase);
    return kase;
  }
  async getCase(id: string) { return this.cases.get(id) ?? null; }
  async getCaseByScan(scanId: string) {
    for (const c of this.cases.values()) if (c.scan_id === scanId) return c;
    return null;
  }
  async listCases(opts: { status?: string; limit: number; cursor?: string | null }) {
    let rows = [...this.cases.values()];
    if (opts.status) rows = rows.filter((c) => c.status === opts.status);
    rows.sort((a, b) =>
      b.priority - a.priority ||
      (a.sla_due_at ?? "").localeCompare(b.sla_due_at ?? "") ||
      a.created_at.localeCompare(b.created_at));
    if (opts.cursor) {
      const i = rows.findIndex((c) => c.id === opts.cursor);
      rows = i >= 0 ? rows.slice(i + 1) : [];
    }
    const page = rows.slice(0, opts.limit);
    return { cases: page, nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null };
  }
  async claimCase(id: string, doctorId: string) {
    const c = this.cases.get(id);
    if (!c) return { kase: null, conflict: false };
    if (c.assigned_doctor_id && c.assigned_doctor_id !== doctorId) return { kase: null, conflict: true };
    c.assigned_doctor_id = doctorId; c.status = "in_review"; c.updated_at = now();
    return { kase: c, conflict: false };
  }
  async updateCase(id: string, patch: Partial<Case>) {
    const c = this.cases.get(id); if (!c) return null;
    Object.assign(c, patch, { updated_at: now() });
    return c;
  }

  // ---- annotations ----
  async addAnnotation(a: { photo_id: string; doctor_id: string; shape: Record<string, unknown>; note?: string | null }) {
    const row: Annotation = { id: randomUUID(), photo_id: a.photo_id, doctor_id: a.doctor_id, shape: a.shape, note: a.note ?? null, created_at: now() };
    this.annotations.set(row.id, row);
    return row;
  }

  // ---- plans ----
  async createPlan(p: { case_id: string; doctor_id: string; review_notes?: string | null; rescan_due_on?: string | null; items: PlanItemInput[]; resolved_flag_ids?: string[]; resolved_flag_notes?: Record<string, string> | null }) {
    const kase = this.cases.get(p.case_id);
    const items: PlanItem[] = p.items.map((it, i) => ({
      id: randomUUID(), plan_id: "", kind: it.kind,
      title_ne: it.title_ne ?? null, title_en: it.title_en ?? null,
      detail: { text: it.detail ?? null, product_id: it.product_id ?? null, kit_id: it.kit_id ?? null },
      sort: it.sort_order ?? i,
    }));
    const plan: Plan & { user_id?: string } = {
      id: randomUUID(), case_id: p.case_id, doctor_id: p.doctor_id, status: "draft", version: 1,
      review_notes: p.review_notes ?? null, rescan_due_on: p.rescan_due_on ?? null,
      approved_at: null, created_at: now(), updated_at: now(), items,
      user_id: kase ? this.scans.get(kase.scan_id)?.user_id ?? undefined : undefined,
    };
    for (const it of items) it.plan_id = plan.id;
    this.plans.set(plan.id, plan);
    if (p.resolved_flag_ids) for (const fid of p.resolved_flag_ids) await this.resolveRedFlag(fid, p.doctor_id);
    return plan;
  }
  async getPlan(id: string) { return this.plans.get(id) ?? null; }
  async getLatestApprovedPlanForUser(userId: string) {
    const rows = [...this.plans.values()].filter((p) => p.status === "approved" && p.user_id === userId);
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows[0] ?? null;
  }
  async approvePlan(id: string, approverId: string) {
    const p = this.plans.get(id);
    if (!p) return { plan: null };
    if (p.status === "approved") return { plan: null, reason: "already_approved" };
    const kase = this.cases.get(p.case_id);
    if (kase) {
      const open = (await this.listRedFlags(kase.scan_id, { unresolvedOnly: true }));
      if (open.length > 0) return { plan: null, reason: "red_flag_unresolved" };
      kase.status = "reviewed"; kase.updated_at = now();
    }
    p.status = "approved"; p.approved_at = now(); p.updated_at = now();
    return { plan: p };
  }

  // ---- catalog ----
  async createProduct(p: { name_en: string; name_ne?: string | null; kind: "cosmetic" | "prescription"; price_npr: number; image_url?: string | null; is_active?: boolean }) {
    const row: Product = {
      id: randomUUID(), name_en: p.name_en, name_ne: p.name_ne ?? null, kind: p.kind,
      price_npr: p.price_npr, image_url: p.image_url ?? null, is_active: p.is_active ?? true,
      created_at: now(),
    };
    this.products.set(row.id, row);
    return row;
  }
  async createKit(k: { name_en: string; name_ne?: string | null; product_ids: string[]; total_npr: number; is_active?: boolean; category?: string | null; images?: string[]; whats_included?: string | null; usage_instructions?: string | null; stock?: number }) {
    const row: Kit = {
      id: randomUUID(), plan_id: null, name_en: k.name_en, name_ne: k.name_ne ?? null,
      product_ids: k.product_ids, total_npr: k.total_npr, is_active: k.is_active ?? true,
      category: k.category ?? null, images: k.images ?? [],
      low_stock_threshold: 5,
      whats_included: k.whats_included ?? null, usage_instructions: k.usage_instructions ?? null,
      stock: k.stock ?? 0,
      created_at: now(), updated_at: now(),
    };
    this.kits.set(row.id, row);
    return row;
  }
  async updateKit(id: string, patch: Partial<Kit>) {
    const k = this.kits.get(id); if (!k) return null;
    const oldPrice = k.total_npr;
    Object.assign(k, patch, { updated_at: now() });
    // U33 (batch 4): price-drop alerts. The admin PATCH /admin/kits/:id route
    // can only see the Store interface, which cannot enumerate wishlists, so
    // the hook lives here on the kit-update path: when the price strictly
    // decreases, every user who wishlisted this kit gets an inbox
    // notification. Alert failures must never break the kit update itself.
    if (patch.total_npr !== undefined && Number(patch.total_npr) < oldPrice) {
      try {
        for (const w of this.wishlistItems.values()) {
          if (w.kit_id !== id) continue;
          await this.createNotification({
            user_id: w.user_id, type: "price_drop",
            title_en: `Price drop: ${k.name_en}`,
            title_ne: `मूल्य घट्यो: ${k.name_en}`,
            body_en: `A kit on your wishlist is now NPR ${patch.total_npr} (was NPR ${oldPrice}).`,
            body_ne: `तपाईंको विशलिस्टमा रहेको किट अब रू ${patch.total_npr} (पहिले रू ${oldPrice}) मा छ।`,
            link: `/kits/${id}`,
          });
        }
      } catch { /* alert failure must not fail the kit update */ }
    }
    return k;
  }
  async listProducts(opts: { activeOnly: boolean; cosmeticOnly: boolean }) {
    return [...this.products.values()].filter((p) =>
      (!opts.activeOnly || p.is_active) && (!opts.cosmeticOnly || p.kind === "cosmetic"));
  }
  async getProduct(id: string) { return this.products.get(id) ?? null; }
  async listKits(activeOnly: boolean) {
    return [...this.kits.values()].filter((k) => !activeOnly || k.is_active);
  }
  async getKit(id: string) { return this.kits.get(id) ?? null; }
  async listKitsAdmin(opts: { search?: string; category?: string; isActive?: boolean; limit: number; offset: number }) {
    const q = (opts.search ?? "").trim().toLowerCase();
    const filtered = [...this.kits.values()]
      .filter((k) => !q || k.name_en.toLowerCase().includes(q) || (k.name_ne ?? "").toLowerCase().includes(q))
      .filter((k) => opts.category === undefined || k.category === opts.category)
      .filter((k) => opts.isActive === undefined || k.is_active === opts.isActive)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { kits: filtered.slice(opts.offset, opts.offset + opts.limit), total: filtered.length };
  }

  // ---- orders ----
  async createOrder(o: { order_no: string; user_id: string; kit_id: string | null; subtotal_npr: number; shipping_npr: number; total_npr: number; payment_method: string; idempotency_key: string; shipping_address: Record<string, unknown>; delivery_instructions?: string | null; coupon_code?: string | null; discount_npr?: number }) {
    const row: Order = {
      id: randomUUID(), order_no: o.order_no, user_id: o.user_id, kit_id: o.kit_id,
      status: "pending", subtotal_npr: o.subtotal_npr, shipping_npr: o.shipping_npr,
      total_npr: o.total_npr, payment_method: o.payment_method, idempotency_key: o.idempotency_key,
      is_gift: false, gift_recipient_name: null, gift_recipient_phone: null, gift_message: null,
      pack_started_at: null, pack_completed_at: null,
      fulfilment_note: null, courier_name: null, tracking_id: null,
      delivery_instructions: o.delivery_instructions ?? null,
      coupon_code: o.coupon_code ?? null, discount_npr: o.discount_npr ?? 0,
      shipping_address: o.shipping_address, created_at: now(), updated_at: now(),
    };
    this.orders.set(row.id, row);
    this.ordersByIdem.set(row.idempotency_key, row);
    return row;
  }
  async getOrder(id: string) { return this.orders.get(id) ?? null; }
  async getOrderByNo(orderNo: string) {
    for (const o of this.orders.values()) if (o.order_no === orderNo) return o;
    return null;
  }
  async getOrderByIdempotency(key: string) { return this.ordersByIdem.get(key) ?? null; }
  async updateOrder(id: string, patch: Partial<Order>) {
    const o = this.orders.get(id); if (!o) return null;
    Object.assign(o, patch, { updated_at: now() });
    return o;
  }
  async listOrdersByUser(userId: string) {
    return [...this.orders.values()].filter((o) => o.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async listOrdersForPharmacy() {
    // Fulfillable = paid online orders + pending COD orders (cash on delivery).
    // P34: rush orders sort first, then oldest-first.
    const rushRank = (o: Order) => ((o as Order & { is_rush?: boolean }).is_rush === true ? 0 : 1);
    return [...this.orders.values()]
      .filter((o) => ["paid", "fulfilling", "shipped"].includes(o.status) ||
        (o.status === "pending" && o.payment_method === "cod"))
      .sort((a, b) => rushRank(a) - rushRank(b) || a.created_at.localeCompare(b.created_at));
  }

  // ---- payments ----
  async createPayment(p: { order_id: string; provider: string; amount_npr: number }) {
    const row: Payment = {
      id: randomUUID(), order_id: p.order_id, provider: p.provider, provider_ref: null,
      amount_npr: p.amount_npr, status: "pending", webhook_log: [], created_at: now(),
    };
    this.payments.set(row.id, row);
    return row;
  }
  async getPaymentByProviderRef(provider: string, ref: string) {
    for (const p of this.payments.values()) if (p.provider === provider && p.provider_ref === ref) return p;
    return null;
  }
  async updatePayment(id: string, patch: Partial<Payment>) {
    const p = this.payments.get(id); if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  async listPaymentsByOrder(orderId: string) {
    return [...this.payments.values()].filter((p) => p.order_id === orderId);
  }

  // ---- consults ----
  async createConsult(c: { user_id: string; doctor_id?: string | null; scheduled_at?: string | null; status: string }) {
    const row: Consult = {
      id: randomUUID(), user_id: c.user_id, doctor_id: c.doctor_id ?? null,
      scheduled_at: c.scheduled_at ?? null, meet_link: null, status: c.status as Consult["status"],
      created_at: now(),
    };
    this.consults.set(row.id, row);
    return row;
  }
  async listConsultsByUser(userId: string) {
    return [...this.consults.values()].filter((c) => c.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ---- checkins ----
  async addCheckin(c: { user_id: string; plan_id?: string | null; shedding_estimate?: number | null; note?: string | null; photo_ids?: string[] }) {
    const row: Checkin = {
      id: randomUUID(), user_id: c.user_id, plan_id: c.plan_id ?? null, scan_id: null,
      shedding_estimate: c.shedding_estimate ?? null, note: c.note ?? null,
      photo_ids: c.photo_ids ?? [], created_at: now(),
    };
    this.checkins.set(row.id, row);
    return row;
  }
  async listCheckins(userId: string) {
    return [...this.checkins.values()].filter((c) => c.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ---- flags ----
  async listFeatureFlags() { return [...this.featureFlags.values()]; }
  async setFeatureFlag(key: string, enabled: boolean, updatedBy: string | null) {
    const f = this.featureFlags.get(key); if (!f) return null;
    f.is_enabled = enabled; f.updated_by = updatedBy; f.updated_at = now();
    return f;
  }

  // ---- audit ----
  async addAudit(a: { actor_id?: string | null; action: string; entity: string; entity_id?: string | null; ip?: string | null; detail?: string | null }) {
    const row: AuditEntry = {
      id: this.auditSeq++, actor_id: a.actor_id ?? null, action: a.action,
      entity: a.entity, entity_id: a.entity_id ?? null, at: now(), ip: a.ip ?? null,
      detail: a.detail ?? null,
    };
    this.audit.push(row);
    return row;
  }
  async listAudit(f: { actor_id?: string; entity?: string; from?: string; to?: string; limit: number }) {
    let rows = [...this.audit];
    if (f.actor_id) rows = rows.filter((a) => a.actor_id === f.actor_id);
    if (f.entity) rows = rows.filter((a) => a.entity === f.entity);
    if (f.from) rows = rows.filter((a) => a.at >= f.from!);
    if (f.to) rows = rows.filter((a) => a.at <= f.to!);
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return rows.slice(0, f.limit);
  }

  // ---- refresh tokens ----
  async saveRefreshToken(t: { token_hash: string; user_id: string; expires_at: string }) {
    this.refreshTokens.set(t.token_hash, { ...t, created_at: now() });
  }
  async getRefreshToken(hash: string) { return this.refreshTokens.get(hash) ?? null; }
  async deleteRefreshToken(hash: string) { this.refreshTokens.delete(hash); }

  // ---- password resets ----
  async savePasswordReset(r: { token_hash: string; user_id: string; expires_at: string }) {
    this.passwordResets.set(r.token_hash, { ...r, used_at: null, created_at: now() });
  }
  async getPasswordReset(tokenHash: string) { return this.passwordResets.get(tokenHash) ?? null; }
  async deletePasswordReset(tokenHash: string) { this.passwordResets.delete(tokenHash); }

  // ---- deletion requests ----
  async createDeletionRequest(r: { user_id: string; scheduled_for: string; note: string }) {
    const row: DeletionRequest = { id: randomUUID(), ...r, status: "scheduled", created_at: now() };
    this.deletions.set(row.id, row);
    return row;
  }

  // ---- notifications (P-6) ----
  private notifications = new Map<string, AppNotification>();

  async createNotification(n: { user_id: string; type: string; title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null }) {
    const row: AppNotification = {
      id: randomUUID(), user_id: n.user_id, type: n.type,
      title_en: n.title_en, title_ne: n.title_ne ?? null,
      body_en: n.body_en ?? null, body_ne: n.body_ne ?? null,
      link: n.link ?? null, read_at: null, created_at: now(),
    };
    this.notifications.set(row.id, row);
    return row;
  }

  async listNotifications(userId: string, opts: { limit: number; offset: number }) {
    const rows = [...this.notifications.values()]
      .filter((n) => n.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const unreadCount = rows.filter((n) => !n.read_at).length;
    return { notifications: rows.slice(opts.offset, opts.offset + opts.limit), unreadCount };
  }

  async markNotificationRead(id: string, userId: string) {
    const n = this.notifications.get(id);
    if (!n || n.user_id !== userId) return null;
    if (!n.read_at) { n.read_at = now(); this.notifications.set(id, n); }
    return n;
  }

  // ---- analytics ----
  async analyticsSnapshot(): Promise<AnalyticsSnapshot> {
    const stages = ["kahani", "lens", "jara", "root_map", "submitted"];
    const scans = [...this.scans.values()];
    const stage_funnel = stages.map((stage, i) => {
      const n = i + 1;
      const entered = scans.filter((s) => s.current_stage >= n || s.status !== "draft").length;
      const completed = scans.filter((s) => s.current_stage > n || ["submitted", "in_review", "reviewed", "flagged"].includes(s.status)).length;
      return { stage, entered, completed };
    });
    const reviewed = [...this.cases.values()].filter((c) => c.status === "reviewed");
    const slas = reviewed.map((c) =>
      (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 3_600_000).sort((a, b) => a - b);
    const review_sla_hours_median = slas.length ? slas[Math.floor(slas.length / 2)] : null;
    const approvedPlans = [...this.plans.values()].filter((p) => p.status === "approved").length;
    const orders = this.orders.size;
    const plan_view_to_kit_rate = approvedPlans ? orders / approvedPlans : 0;
    const byUser = new Map<string, number>();
    for (const s of scans) if (s.user_id) byUser.set(s.user_id, (byUser.get(s.user_id) ?? 0) + 1);
    const multi = [...byUser.values()].filter((n) => n > 1).length;
    const rescan_rate_m2 = byUser.size ? multi / byUser.size : 0;
    // red_flag_misses: plans approved while their scan had unresolved flags — the
    // approve guard makes this 0 by construction; computed honestly here.
    let red_flag_misses = 0;
    for (const p of this.plans.values()) {
      if (p.status !== "approved") continue;
      const kase = this.cases.get(p.case_id);
      if (!kase) continue;
      const open = [...this.flags.values()].filter((f) => f.scan_id === kase.scan_id && !f.resolved_at
        && (!p.approved_at || f.created_at <= p.approved_at));
      if (open.length) red_flag_misses++;
    }
    return { stage_funnel, review_sla_hours_median, plan_view_to_kit_rate, rescan_rate_m2, red_flag_misses };
  }

  // ---------------- P-12 dashboard features (007) ----------------
  followUps = new Map<string, FollowUp>();
  availability = new Map<string, DoctorAvailability>();
  refunds = new Map<string, Refund>();
  staffVerifications = new Map<string, StaffVerification>();
  tickets = new Map<string, SupportTicket>();
  ticketReplies = new Map<string, TicketReply>();
  articles = new Map<string, EducationArticle>();
  orderChecks = new Map<string, OrderCheck>();
  damageReports = new Map<string, DamageReport>();
  handoverNotes = new Map<string, HandoverNote>();
  challenges = new Map<string, Challenge>();
  challengeAssignments = new Map<string, ChallengeAssignment>();
  coachNotes = new Map<string, CoachNote>();
  escalations = new Map<string, Escalation>();
  scheduledNudges = new Map<string, ScheduledNudge>();
  satisfactionRatings = new Map<string, SatisfactionRating>();
  wishlistItems = new Map<string, WishlistItem>();
  // ---- Batch 2 (008) ----
  snippets = new Map<string, DoctorSnippet>();
  bookmarks = new Map<string, CaseBookmark>(); // key: `${case_id}:${doctor_id}`
  checklists = new Map<string, ReviewChecklist>();
  checklistItems = new Map<string, ReviewChecklistItem>();
  photoRequests = new Map<string, PhotoRequest>();
  announcements = new Map<string, Announcement>();
  rolePermissions = new Map<string, RolePermission>(); // key: `${role}:${permission}`
  loginAttempts: LoginAttempt[] = [];
  coupons = new Map<string, Coupon>();
  backups: BackupRecord[] = [];
  notifTemplates = new Map<string, NotificationTemplate>();
  stockMovements: StockMovement[] = [];
  packingChecks = new Map<string, PackingCheck>(); // key: `${order_id}:${step}`
  kitBatches = new Map<string, KitBatch>();
  suppliers = new Map<string, Supplier>();
  challengeGroups = new Map<string, ChallengeGroup>();
  challengeGroupMembers = new Map<string, Set<string>>(); // group_id -> user_ids
  badges = new Map<string, Badge>();
  sessionSummaries = new Map<string, SessionSummary>();
  customerGoals = new Map<string, CustomerGoal>();
  habitTemplates = new Map<string, HabitTemplate>();
  noteTemplates = new Map<string, NoteTemplate>();
  articleAssignments = new Map<string, ArticleAssignment>();
  symptomEntries = new Map<string, SymptomEntry>();
  waterLogs = new Map<string, WaterLog>(); // key: `${user_id}:${log_date}`
  sleepLogs = new Map<string, SleepLog>();
  notifPrefs = new Map<string, NotificationPrefs>();
  emergencyContacts = new Map<string, EmergencyContact>();

  async listCasesByUser(userId: string): Promise<Case[]> {
    const scanIds = new Set([...this.scans.values()].filter((s) => s.user_id === userId).map((s) => s.id));
    return [...this.cases.values()]
      .filter((c) => scanIds.has(c.scan_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async searchPatients(q: string): Promise<{ user: User; profile: Profile | null }[]> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: { user: User; profile: Profile | null }[] = [];
    for (const u of this.users.values()) {
      const p = this.profiles.get(u.id) ?? null;
      const hay = `${u.phone} ${p?.name ?? ""}`.toLowerCase();
      if (hay.includes(needle)) out.push({ user: u, profile: p });
      if (out.length >= 20) break;
    }
    return out;
  }
  async bulkUpdateCasePriority(ids: string[], priority: number): Promise<number> {
    let n = 0;
    for (const id of ids) {
      const c = this.cases.get(id);
      if (c && (c.status === "queued" || c.status === "in_review")) {
        c.priority = priority; c.updated_at = now(); n++;
      }
    }
    return n;
  }
  async listOverdueCases(): Promise<Case[]> {
    const t = Date.now();
    return [...this.cases.values()]
      .filter((c) => (c.status === "queued" || c.status === "in_review")
        && c.sla_due_at && new Date(c.sla_due_at).getTime() < t)
      .sort((a, b) => (a.sla_due_at ?? "").localeCompare(b.sla_due_at ?? ""));
  }
  async createFollowUp(f: { case_id: string; doctor_id: string; due_on: string; note?: string | null }): Promise<FollowUp> {
    const row: FollowUp = { id: randomUUID(), case_id: f.case_id, doctor_id: f.doctor_id, due_on: f.due_on, note: f.note ?? null, done_at: null, created_at: now() };
    this.followUps.set(row.id, row);
    return row;
  }
  async listFollowUps(doctorId: string, opts?: { dueOnly?: boolean }): Promise<FollowUp[]> {
    const today = new Date().toISOString().slice(0, 10);
    return [...this.followUps.values()]
      .filter((f) => f.doctor_id === doctorId && !f.done_at && (!opts?.dueOnly || f.due_on <= today))
      .sort((a, b) => a.due_on.localeCompare(b.due_on));
  }
  async completeFollowUp(id: string, doctorId: string): Promise<FollowUp | null> {
    const f = this.followUps.get(id);
    if (!f || f.doctor_id !== doctorId) return null;
    f.done_at = now();
    return f;
  }
  async setDoctorAvailability(doctorId: string, status: DoctorAvailabilityStatus, note?: string | null): Promise<DoctorAvailability> {
    const row: DoctorAvailability = { doctor_id: doctorId, status, note: note ?? null, updated_at: now() };
    this.availability.set(doctorId, row);
    return row;
  }
  async getDoctorAvailability(doctorId: string): Promise<DoctorAvailability | null> {
    return this.availability.get(doctorId) ?? null;
  }
  async listDoctorAvailability(): Promise<(DoctorAvailability & { name: string | null; phone: string })[]> {
    const out: (DoctorAvailability & { name: string | null; phone: string })[] = [];
    for (const u of this.users.values()) {
      if (u.role !== "doctor") continue;
      const a = this.availability.get(u.id) ?? { doctor_id: u.id, status: "available" as DoctorAvailabilityStatus, note: null, updated_at: u.updated_at };
      out.push({ ...a, name: this.profiles.get(u.id)?.name ?? null, phone: u.phone });
    }
    return out;
  }
  async listAllOrders(): Promise<Order[]> {
    return [...this.orders.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createRefund(r: { order_id: string; amount_npr: number; reason?: string | null; created_by: string }): Promise<Refund> {
    const row: Refund = { id: randomUUID(), order_id: r.order_id, amount_npr: r.amount_npr, reason: r.reason ?? null, created_by: r.created_by, created_at: now() };
    this.refunds.set(row.id, row);
    return row;
  }
  async listRefunds(): Promise<Refund[]> {
    return [...this.refunds.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async upsertStaffVerification(userId: string, requestedRole: string): Promise<StaffVerification> {
    for (const v of this.staffVerifications.values()) {
      if (v.user_id === userId && v.status === "pending") return v;
    }
    const row: StaffVerification = { id: randomUUID(), user_id: userId, requested_role: requestedRole, status: "pending", decided_by: null, decided_at: null, note: null, created_at: now() };
    this.staffVerifications.set(row.id, row);
    return row;
  }
  async listStaffVerifications(status?: StaffVerificationStatus): Promise<StaffVerification[]> {
    return [...this.staffVerifications.values()]
      .filter((v) => !status || v.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async decideStaffVerification(id: string, approved: boolean, decidedBy: string, note?: string | null): Promise<StaffVerification | null> {
    const v = this.staffVerifications.get(id);
    if (!v || v.status !== "pending") return null;
    v.status = approved ? "approved" : "rejected";
    v.decided_by = decidedBy; v.decided_at = now(); v.note = note ?? null;
    if (approved) {
      const u = this.users.get(v.user_id);
      if (u) { u.role = v.requested_role as Role; u.updated_at = now(); }
    }
    return v;
  }
  async createTicket(t: { user_id: string; subject: string; body: string }): Promise<SupportTicket> {
    const ticket: SupportTicket = { id: randomUUID(), user_id: t.user_id, subject: t.subject, status: "open", created_at: now(), updated_at: now() };
    this.tickets.set(ticket.id, ticket);
    const reply: TicketReply = { id: randomUUID(), ticket_id: ticket.id, author_id: t.user_id, author_role: "customer", body: t.body, created_at: now() };
    this.ticketReplies.set(reply.id, reply);
    return ticket;
  }
  async listTickets(opts: { user_id?: string; status?: TicketStatus }): Promise<SupportTicket[]> {
    return [...this.tickets.values()]
      .filter((t) => (!opts.user_id || t.user_id === opts.user_id) && (!opts.status || t.status === opts.status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async getTicket(id: string): Promise<SupportTicket | null> { return this.tickets.get(id) ?? null; }
  async addTicketReply(ticketId: string, authorId: string, authorRole: string, body: string): Promise<TicketReply> {
    const reply: TicketReply = { id: randomUUID(), ticket_id: ticketId, author_id: authorId, author_role: authorRole, body, created_at: now() };
    this.ticketReplies.set(reply.id, reply);
    const t = this.tickets.get(ticketId);
    if (t) { t.updated_at = now(); t.status = authorRole === "customer" ? "open" : "answered"; }
    return reply;
  }
  async listTicketReplies(ticketId: string): Promise<TicketReply[]> {
    return [...this.ticketReplies.values()].filter((r) => r.ticket_id === ticketId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async updateTicketStatus(id: string, status: TicketStatus): Promise<SupportTicket | null> {
    const t = this.tickets.get(id); if (!t) return null;
    t.status = status; t.updated_at = now(); return t;
  }
  async createArticle(a: { title_en: string; title_ne?: string | null; body_en: string; body_ne?: string | null; is_published?: boolean; created_by: string | null }): Promise<EducationArticle> {
    const row: EducationArticle = { id: randomUUID(), title_en: a.title_en, title_ne: a.title_ne ?? null, body_en: a.body_en, body_ne: a.body_ne ?? null, is_published: a.is_published ?? false, created_by: a.created_by, created_at: now(), updated_at: now() };
    this.articles.set(row.id, row);
    return row;
  }
  async listArticles(publishedOnly: boolean): Promise<EducationArticle[]> {
    return [...this.articles.values()]
      .filter((a) => !publishedOnly || a.is_published)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getArticle(id: string): Promise<EducationArticle | null> { return this.articles.get(id) ?? null; }
  async updateArticle(id: string, patch: Partial<Pick<EducationArticle, "title_en" | "title_ne" | "body_en" | "body_ne" | "is_published">>): Promise<EducationArticle | null> {
    const a = this.articles.get(id); if (!a) return null;
    Object.assign(a, patch, { updated_at: now() });
    return a;
  }
  async deleteArticle(id: string): Promise<void> { this.articles.delete(id); }
  async adjustKitStock(kitId: string, delta: number): Promise<Kit | null> {
    const k = this.kits.get(kitId); if (!k) return null;
    k.stock = Math.max(0, k.stock + delta); k.updated_at = now();
    return k;
  }
  async setOrderCourier(orderId: string, courierName: string | null, trackingId: string | null): Promise<Order | null> {
    const o = this.orders.get(orderId); if (!o) return null;
    o.courier_name = courierName; o.tracking_id = trackingId; o.updated_at = now();
    return o;
  }
  async addOrderCheck(orderId: string, checkType: OrderCheckType, checkedBy: string): Promise<OrderCheck> {
    for (const c of this.orderChecks.values()) {
      if (c.order_id === orderId && c.check_type === checkType) return c;
    }
    const row: OrderCheck = { id: randomUUID(), order_id: orderId, check_type: checkType, checked_by: checkedBy, checked_at: now() };
    this.orderChecks.set(row.id, row);
    return row;
  }
  async listOrderChecks(orderId: string): Promise<OrderCheck[]> {
    return [...this.orderChecks.values()].filter((c) => c.order_id === orderId);
  }
  async addDamageReport(orderId: string, reporterId: string, description: string): Promise<DamageReport> {
    const row: DamageReport = { id: randomUUID(), order_id: orderId, reporter_id: reporterId, description, created_at: now() };
    this.damageReports.set(row.id, row);
    return row;
  }
  async listDamageReports(orderId?: string): Promise<DamageReport[]> {
    return [...this.damageReports.values()]
      .filter((r) => !orderId || r.order_id === orderId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addHandoverNote(orderId: string, authorId: string, note: string): Promise<HandoverNote> {
    const row: HandoverNote = { id: randomUUID(), order_id: orderId, author_id: authorId, note, created_at: now() };
    this.handoverNotes.set(row.id, row);
    return row;
  }
  async listHandoverNotes(orderId: string): Promise<HandoverNote[]> {
    return [...this.handoverNotes.values()].filter((n) => n.order_id === orderId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async createChallenge(c: { title_en: string; title_ne?: string | null; days: 7 | 14 | 30; description_en?: string | null; description_ne?: string | null; created_by: string | null }): Promise<Challenge> {
    const row: Challenge = { id: randomUUID(), title_en: c.title_en, title_ne: c.title_ne ?? null, days: c.days, description_en: c.description_en ?? null, description_ne: c.description_ne ?? null, created_by: c.created_by, created_at: now() };
    this.challenges.set(row.id, row);
    return row;
  }
  async listChallenges(): Promise<Challenge[]> {
    return [...this.challenges.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async assignChallenge(challengeId: string, userId: string): Promise<ChallengeAssignment> {
    for (const a of this.challengeAssignments.values()) {
      if (a.challenge_id === challengeId && a.user_id === userId) return a;
    }
    const row: ChallengeAssignment = { id: randomUUID(), challenge_id: challengeId, user_id: userId, started_at: now(), completed_at: null };
    this.challengeAssignments.set(row.id, row);
    return row;
  }
  async listChallengeAssignments(userId: string): Promise<(ChallengeAssignment & { challenge: Challenge | null })[]> {
    return [...this.challengeAssignments.values()]
      .filter((a) => a.user_id === userId)
      .map((a) => ({ ...a, challenge: this.challenges.get(a.challenge_id) ?? null }))
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  async completeChallengeAssignment(id: string, userId: string): Promise<ChallengeAssignment | null> {
    const a = this.challengeAssignments.get(id);
    if (!a || a.user_id !== userId) return null;
    a.completed_at = now();
    return a;
  }
  async addCoachNote(coachId: string, customerId: string, note: string): Promise<CoachNote> {
    const row: CoachNote = { id: randomUUID(), coach_id: coachId, customer_id: customerId, note, created_at: now() };
    this.coachNotes.set(row.id, row);
    return row;
  }
  async listCoachNotes(customerId: string): Promise<CoachNote[]> {
    return [...this.coachNotes.values()].filter((n) => n.customer_id === customerId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createEscalation(customerId: string, coachId: string, reason: string): Promise<Escalation> {
    const row: Escalation = { id: randomUUID(), customer_id: customerId, coach_id: coachId, reason, status: "open", created_at: now() };
    this.escalations.set(row.id, row);
    return row;
  }
  async listEscalations(status?: EscalationStatus): Promise<Escalation[]> {
    return [...this.escalations.values()]
      .filter((e) => !status || e.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async updateEscalationStatus(id: string, status: EscalationStatus): Promise<Escalation | null> {
    const e = this.escalations.get(id); if (!e) return null;
    e.status = status; return e;
  }
  async scheduleNudge(n: { coach_id: string; user_id: string; message_en: string; message_ne?: string | null; send_at: string }): Promise<ScheduledNudge> {
    const row: ScheduledNudge = { id: randomUUID(), coach_id: n.coach_id, user_id: n.user_id, message_en: n.message_en, message_ne: n.message_ne ?? null, send_at: n.send_at, sent_at: null, recurrence: null, created_at: now() };
    this.scheduledNudges.set(row.id, row);
    return row;
  }
  async listScheduledNudges(coachId: string): Promise<ScheduledNudge[]> {
    return [...this.scheduledNudges.values()].filter((n) => n.coach_id === coachId).sort((a, b) => a.send_at.localeCompare(b.send_at));
  }
  async markNudgeSent(id: string): Promise<ScheduledNudge | null> {
    const n = this.scheduledNudges.get(id); if (!n) return null;
    n.sent_at = now(); return n;
  }
  async deleteScheduledNudge(id: string, coachId: string): Promise<boolean> {
    const n = this.scheduledNudges.get(id);
    if (!n || n.coach_id !== coachId || n.sent_at) return false;
    this.scheduledNudges.delete(id);
    return true;
  }
  async addSatisfactionRating(customerId: string, coachId: string, rating: number, comment?: string | null): Promise<SatisfactionRating> {
    const row: SatisfactionRating = { id: randomUUID(), customer_id: customerId, coach_id: coachId, rating, comment: comment ?? null, created_at: now() };
    this.satisfactionRatings.set(row.id, row);
    return row;
  }
  async listSatisfactionRatings(customerId: string): Promise<SatisfactionRating[]> {
    return [...this.satisfactionRatings.values()].filter((r) => r.customer_id === customerId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addToWishlist(userId: string, kitId: string): Promise<WishlistItem> {
    for (const w of this.wishlistItems.values()) {
      if (w.user_id === userId && w.kit_id === kitId) return w;
    }
    const row: WishlistItem = { id: randomUUID(), user_id: userId, kit_id: kitId, created_at: now() };
    this.wishlistItems.set(row.id, row);
    return row;
  }
  async removeFromWishlist(userId: string, kitId: string): Promise<boolean> {
    for (const [id, w] of this.wishlistItems) {
      if (w.user_id === userId && w.kit_id === kitId) { this.wishlistItems.delete(id); return true; }
    }
    return false;
  }
  async listWishlist(userId: string): Promise<(WishlistItem & { kit: Kit | null })[]> {
    return [...this.wishlistItems.values()]
      .filter((w) => w.user_id === userId)
      .map((w) => ({ ...w, kit: this.kits.get(w.kit_id) ?? null }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /* ---------------- Batch 2 (008) ---------------- */
  // ---- doctor (D10–D18) ----
  async doctorWorkload(doctorId: string) {
    const t = Date.now();
    let claimed = 0, in_review = 0, due_soon = 0, overdue = 0;
    for (const c of this.cases.values()) {
      if (c.assigned_doctor_id !== doctorId) continue;
      if (c.status === "queued") claimed++;
      if (c.status === "in_review") in_review++;
      if ((c.status === "queued" || c.status === "in_review") && c.sla_due_at) {
        const due = new Date(c.sla_due_at).getTime();
        if (due < t) overdue++;
        else if (due - t < 6 * 3600_000) due_soon++;
      }
    }
    return { claimed, in_review, due_soon, overdue };
  }
  async doctorSlaSummary(doctorId: string) {
    const w = await this.doctorWorkload(doctorId);
    return { overdue: w.overdue, due_6h: w.due_soon };
  }
  async createSnippet(doctorId: string, s: { title: string; body_en: string; body_ne?: string | null }): Promise<DoctorSnippet> {
    const row: DoctorSnippet = { id: randomUUID(), doctor_id: doctorId, title: s.title, body_en: s.body_en, body_ne: s.body_ne ?? null, created_at: now() };
    this.snippets.set(row.id, row);
    return row;
  }
  async listSnippets(doctorId: string): Promise<DoctorSnippet[]> {
    return [...this.snippets.values()].filter((s) => s.doctor_id === doctorId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async deleteSnippet(id: string, doctorId: string): Promise<boolean> {
    const s = this.snippets.get(id);
    if (!s || s.doctor_id !== doctorId) return false;
    this.snippets.delete(id);
    return true;
  }
  async bookmarkCase(caseId: string, doctorId: string): Promise<CaseBookmark> {
    const row: CaseBookmark = { case_id: caseId, doctor_id: doctorId, created_at: now() };
    this.bookmarks.set(`${caseId}:${doctorId}`, row);
    return row;
  }
  async unbookmarkCase(caseId: string, doctorId: string): Promise<boolean> {
    return this.bookmarks.delete(`${caseId}:${doctorId}`);
  }
  async listBookmarks(doctorId: string): Promise<string[]> {
    return [...this.bookmarks.values()].filter((b) => b.doctor_id === doctorId).map((b) => b.case_id);
  }
  async getChecklist(caseId: string, doctorId: string): Promise<ReviewChecklist | null> {
    const cl = [...this.checklists.values()].find((c) => c.case_id === caseId && c.doctor_id === doctorId) ?? null;
    if (!cl) return null;
    return { ...cl, items: [...this.checklistItems.values()].filter((i) => i.checklist_id === cl.id).sort((a, b) => a.sort - b.sort) };
  }
  async createChecklist(caseId: string, doctorId: string, items: { label_en: string; label_ne?: string | null }[]): Promise<ReviewChecklist> {
    const existing = await this.getChecklist(caseId, doctorId);
    if (existing) return existing;
    const cl: ReviewChecklist = { id: randomUUID(), case_id: caseId, doctor_id: doctorId, created_at: now() };
    this.checklists.set(cl.id, cl);
    items.forEach((it, i) => {
      const row: ReviewChecklistItem = { id: randomUUID(), checklist_id: cl.id, label_en: it.label_en, label_ne: it.label_ne ?? null, done: false, sort: i, created_at: now() };
      this.checklistItems.set(row.id, row);
    });
    return (await this.getChecklist(caseId, doctorId))!;
  }
  async setChecklistItemDone(itemId: string, doctorId: string, done: boolean): Promise<ReviewChecklistItem | null> {
    const item = this.checklistItems.get(itemId);
    if (!item) return null;
    const cl = this.checklists.get(item.checklist_id);
    if (!cl || cl.doctor_id !== doctorId) return null;
    item.done = done;
    return item;
  }
  async patientRisk(userId: string): Promise<{ level: "low" | "medium" | "high"; red_flag_cases: number; missed_rescans: number }> {
    const cases = await this.listCasesByUser(userId);
    const red_flag_cases = cases.filter((c) => c.priority >= 100).length;
    const today = new Date().toISOString().slice(0, 10);
    const missed_rescans = [...this.plans.values()].filter((p) => p.user_id === userId && p.rescan_due_on && p.rescan_due_on < today).length;
    const level: "low" | "medium" | "high" = red_flag_cases > 0 || missed_rescans > 1 ? "high" : missed_rescans > 0 ? "medium" : "low";
    return { level, red_flag_cases, missed_rescans };
  }
  async createPhotoRequest(caseId: string, doctorId: string, angles: string, note?: string | null): Promise<PhotoRequest> {
    const row: PhotoRequest = { id: randomUUID(), case_id: caseId, doctor_id: doctorId, angles, note: note ?? null, fulfilled_at: null, created_at: now() };
    this.photoRequests.set(row.id, row);
    return row;
  }
  async listPhotoRequests(caseId: string): Promise<PhotoRequest[]> {
    return [...this.photoRequests.values()].filter((r) => r.case_id === caseId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async doctorReviewStats(doctorId: string): Promise<{ reviewed_7d: number; reviewed_30d: number; avg_review_hours: number | null }> {
    const entries = await this.listAudit({ actor_id: doctorId, limit: 10000 });
    const t = Date.now();
    const approves = entries.filter((e) => e.action === "plan.approve");
    const reviewed_7d = approves.filter((e) => t - new Date(e.at).getTime() < 7 * 86400_000).length;
    const reviewed_30d = approves.filter((e) => t - new Date(e.at).getTime() < 30 * 86400_000).length;
    const claims = new Map(entries.filter((e) => e.action === "case.claim").map((e) => [e.entity_id, new Date(e.at).getTime()]));
    const durs: number[] = [];
    for (const a of approves) {
      const caseId = this.plans.get(a.entity_id ?? "")?.case_id;
      const c0 = caseId ? claims.get(caseId) : undefined;
      if (c0 !== undefined) durs.push((new Date(a.at).getTime() - c0) / 3600_000);
    }
    const avg_review_hours = durs.length ? Math.round((durs.reduce((s, d) => s + d, 0) / durs.length) * 10) / 10 : null;
    return { reviewed_7d, reviewed_30d, avg_review_hours };
  }
  async searchDoctorNotes(doctorId: string, q: string): Promise<{ case_id: string; snippet: string; created_at: string }[]> {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const out: { case_id: string; snippet: string; created_at: string }[] = [];
    for (const p of this.plans.values()) {
      if (p.doctor_id !== doctorId || !p.review_notes) continue;
      const idx = p.review_notes.toLowerCase().indexOf(needle);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        out.push({ case_id: p.case_id, snippet: (start > 0 ? "…" : "") + p.review_notes.slice(start, idx + needle.length + 40) + "…", created_at: p.created_at });
      }
      if (out.length >= 20) break;
    }
    return out;
  }

  // ---- admin (A12–A20) ----
  async getRolePermissions(role: string): Promise<RolePermission[]> {
    return [...this.rolePermissions.values()].filter((p) => p.role === role)
      .sort((a, b) => a.permission.localeCompare(b.permission));
  }
  async setRolePermission(role: string, permission: string, granted: boolean, updatedBy: string | null): Promise<RolePermission> {
    const row: RolePermission = { role, permission, granted, updated_by: updatedBy, updated_at: now() };
    this.rolePermissions.set(`${role}:${permission}`, row);
    return row;
  }
  async createAnnouncement(a: { title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null; starts_at?: string | null; ends_at?: string | null; created_by?: string | null }): Promise<Announcement> {
    const row: Announcement = { id: randomUUID(), title_en: a.title_en, title_ne: a.title_ne ?? null, body_en: a.body_en ?? null, body_ne: a.body_ne ?? null, link: a.link ?? null, starts_at: a.starts_at ?? null, ends_at: a.ends_at ?? null, is_active: true, created_by: a.created_by ?? null, created_at: now() };
    this.announcements.set(row.id, row);
    return row;
  }
  async listAnnouncements(activeOnly: boolean): Promise<Announcement[]> {
    const t = now();
    return [...this.announcements.values()]
      .filter((a) => !activeOnly || (a.is_active && (!a.starts_at || a.starts_at <= t) && (!a.ends_at || a.ends_at >= t)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async updateAnnouncement(id: string, patch: Partial<Announcement>): Promise<Announcement | null> {
    const a = this.announcements.get(id);
    if (!a) return null;
    Object.assign(a, patch, { id: a.id });
    return a;
  }
  async deleteAnnouncement(id: string): Promise<boolean> {
    return this.announcements.delete(id);
  }
  async listRefreshSessions(userId: string) {
    return [...this.refreshTokens.values()].filter((t) => t.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async revokeRefreshSession(tokenHash: string): Promise<boolean> {
    return this.refreshTokens.delete(tokenHash);
  }
  async logLoginAttempt(a: { phone?: string | null; email?: string | null; success: boolean; ip?: string | null; user_agent?: string | null }): Promise<LoginAttempt> {
    const row: LoginAttempt = { id: randomUUID(), phone: a.phone ?? null, email: a.email ?? null, success: a.success, ip: a.ip ?? null, user_agent: a.user_agent ?? null, created_at: now() };
    this.loginAttempts.push(row);
    if (this.loginAttempts.length > 5000) this.loginAttempts.splice(0, this.loginAttempts.length - 5000);
    return row;
  }
  async listLoginAttempts(limit: number): Promise<LoginAttempt[]> {
    return [...this.loginAttempts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }
  async createCoupon(c: { code: string; kind: CouponKind; value: number; max_uses?: number | null; min_order_npr?: number; starts_at?: string | null; ends_at?: string | null; created_by?: string | null }): Promise<Coupon> {
    const row: Coupon = { id: randomUUID(), code: c.code.toUpperCase().trim(), kind: c.kind, value: c.value, max_uses: c.max_uses ?? null, uses: 0, min_order_npr: c.min_order_npr ?? 0, starts_at: c.starts_at ?? null, ends_at: c.ends_at ?? null, is_active: true, created_by: c.created_by ?? null, created_at: now() };
    this.coupons.set(row.id, row);
    return row;
  }
  async listCoupons(): Promise<Coupon[]> {
    return [...this.coupons.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async updateCoupon(id: string, patch: { is_active?: boolean }): Promise<Coupon | null> {
    const c = this.coupons.get(id);
    if (!c) return null;
    if (patch.is_active !== undefined) c.is_active = patch.is_active;
    return c;
  }
  async getCouponByCode(code: string): Promise<Coupon | null> {
    const needle = code.toUpperCase().trim();
    return [...this.coupons.values()].find((c) => c.code === needle) ?? null;
  }
  async incrementCouponUses(id: string): Promise<Coupon | null> {
    const c = this.coupons.get(id);
    if (!c) return null;
    c.uses++;
    return c;
  }
  async recordBackup(b: { label: string; status?: "ok" | "failed" | "running"; size_bytes?: number | null; note?: string | null; recorded_by?: string | null }): Promise<BackupRecord> {
    const row: BackupRecord = { id: randomUUID(), label: b.label, status: b.status ?? "ok", size_bytes: b.size_bytes ?? null, note: b.note ?? null, recorded_by: b.recorded_by ?? null, created_at: now() };
    this.backups.push(row);
    return row;
  }
  async listBackups(limit: number): Promise<BackupRecord[]> {
    return [...this.backups].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }
  async createNotificationTemplate(t: { name: string; title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null; created_by?: string | null }): Promise<NotificationTemplate> {
    const row: NotificationTemplate = { id: randomUUID(), name: t.name, title_en: t.title_en, title_ne: t.title_ne ?? null, body_en: t.body_en ?? null, body_ne: t.body_ne ?? null, link: t.link ?? null, created_by: t.created_by ?? null, created_at: now() };
    this.notifTemplates.set(row.id, row);
    return row;
  }
  async listNotificationTemplates(): Promise<NotificationTemplate[]> {
    return [...this.notifTemplates.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async deleteNotificationTemplate(id: string): Promise<boolean> {
    return this.notifTemplates.delete(id);
  }
  // ---- pharmacy (P10–P18) ----
  async logStockMovement(kitId: string, delta: number, reason: string | null, actorId: string | null): Promise<StockMovement> {
    const row: StockMovement = { id: randomUUID(), kit_id: kitId, delta, reason, actor_id: actorId, created_at: now() };
    this.stockMovements.push(row);
    return row;
  }
  async listStockMovements(kitId: string, limit: number): Promise<StockMovement[]> {
    return this.stockMovements.filter((m) => m.kit_id === kitId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }
  async reorderSuggestions(): Promise<{ kit: Kit; threshold: number }[]> {
    const out: { kit: Kit; threshold: number }[] = [];
    for (const kit of this.kits.values()) {
      const threshold = (kit as unknown as { low_stock_threshold?: number | null }).low_stock_threshold ?? 5;
      if (kit.is_active && kit.stock <= threshold) out.push({ kit, threshold });
    }
    return out.sort((a, b) => a.kit.stock - b.kit.stock);
  }
  async getPackingChecks(orderId: string): Promise<PackingCheck[]> {
    return [...this.packingChecks.values()].filter((c) => c.order_id === orderId)
      .sort((a, b) => a.step.localeCompare(b.step));
  }
  async setPackingCheck(orderId: string, step: string, done: boolean, checkedBy: string | null): Promise<PackingCheck> {
    const key = `${orderId}:${step}`;
    let row = this.packingChecks.get(key);
    if (!row) {
      row = { id: randomUUID(), order_id: orderId, step, done, checked_by: checkedBy, created_at: now() };
      this.packingChecks.set(key, row);
    } else {
      row.done = done;
      row.checked_by = checkedBy;
    }
    return row;
  }
  async orderLabel(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order) return null;
    const kit = order.kit_id ? this.kits.get(order.kit_id) : undefined;
    const items = kit ? [{ kit_id: kit.id, name: kit.name_en, qty: 1 }] : [];
    return { order, items };
  }
  async zoneStats(): Promise<{ zone: string; orders: number; delivered: number }[]> {
    const zones = new Map<string, { orders: number; delivered: number }>();
    for (const o of this.orders.values()) {
      const addr = o.shipping_address as Record<string, unknown>;
      const zone = String(addr?.city ?? addr?.district ?? "unknown");
      const z = zones.get(zone) ?? { orders: 0, delivered: 0 };
      z.orders++;
      if (o.status === "delivered") z.delivered++;
      zones.set(zone, z);
    }
    return [...zones.entries()].map(([zone, s]) => ({ zone, ...s })).sort((a, b) => b.orders - a.orders);
  }
  async duplicateOrders(): Promise<Order[]> {
    const sorted = [...this.orders.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const seen = new Map<string, string>(); // `${user_id}:${kit_id}` -> first created_at
    const dups: Order[] = [];
    for (const o of sorted) {
      if (!o.kit_id) continue;
      const key = `${o.user_id}:${o.kit_id}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, o.created_at);
      else if (new Date(o.created_at).getTime() - new Date(first).getTime() < 24 * 3600_000) dups.push(o);
    }
    return dups;
  }
  async createKitBatch(kitId: string, b: { batch_no: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }): Promise<KitBatch> {
    const row: KitBatch = { id: randomUUID(), kit_id: kitId, batch_no: b.batch_no, expires_on: b.expires_on ?? null, qty: b.qty ?? 0, supplier_id: b.supplier_id ?? null, created_at: now() };
    this.kitBatches.set(row.id, row);
    return row;
  }
  async listKitBatches(kitId?: string): Promise<(KitBatch & { kit_name?: string })[]> {
    return [...this.kitBatches.values()].filter((b) => !kitId || b.kit_id === kitId)
      .map((b) => ({ ...b, kit_name: this.kits.get(b.kit_id)?.name_en }))
      .sort((a, b) => (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999"));
  }
  async deleteKitBatch(id: string): Promise<boolean> {
    return this.kitBatches.delete(id);
  }
  async updateKitBatch(id: string, b: { batch_no?: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }): Promise<KitBatch | null> {
    const row = this.kitBatches.get(id);
    if (!row) return null;
    if (b.batch_no !== undefined) row.batch_no = b.batch_no;
    if (b.expires_on !== undefined) row.expires_on = b.expires_on;
    if (b.qty !== undefined) row.qty = b.qty;
    if (b.supplier_id !== undefined) row.supplier_id = b.supplier_id;
    return row;
  }
  async createSupplier(s: { name: string; contact?: string | null; phone?: string | null; address?: string | null; note?: string | null }): Promise<Supplier> {
    const row: Supplier = { id: randomUUID(), name: s.name, contact: s.contact ?? null, phone: s.phone ?? null, address: s.address ?? null, note: s.note ?? null, created_at: now() };
    this.suppliers.set(row.id, row);
    return row;
  }
  async listSuppliers(): Promise<Supplier[]> {
    return [...this.suppliers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async updateSupplier(id: string, patch: Partial<Supplier>): Promise<Supplier | null> {
    const s = this.suppliers.get(id);
    if (!s) return null;
    Object.assign(s, patch, { id: s.id });
    return s;
  }
  async deleteSupplier(id: string): Promise<boolean> {
    return this.suppliers.delete(id);
  }

  // ---- coach (C10–C18) ----
  async createChallengeGroup(g: { title_en: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null; starts_on?: string | null; ends_on?: string | null; created_by?: string | null }): Promise<ChallengeGroup> {
    const row: ChallengeGroup = { id: randomUUID(), title_en: g.title_en, title_ne: g.title_ne ?? null, description_en: g.description_en ?? null, description_ne: g.description_ne ?? null, starts_on: g.starts_on ?? null, ends_on: g.ends_on ?? null, created_by: g.created_by ?? null, created_at: now() };
    this.challengeGroups.set(row.id, row);
    this.challengeGroupMembers.set(row.id, new Set());
    return row;
  }
  async listChallengeGroups(): Promise<ChallengeGroup[]> {
    return [...this.challengeGroups.values()].map((g) => ({ ...g, member_count: this.challengeGroupMembers.get(g.id)?.size ?? 0 }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addChallengeGroupMember(groupId: string, userId: string): Promise<boolean> {
    const g = this.challengeGroups.get(groupId);
    if (!g || !this.users.get(userId)) return false;
    let set = this.challengeGroupMembers.get(groupId);
    if (!set) { set = new Set(); this.challengeGroupMembers.set(groupId, set); }
    set.add(userId);
    return true;
  }
  async listChallengeGroupMembers(groupId: string): Promise<string[]> {
    return [...(this.challengeGroupMembers.get(groupId) ?? new Set())];
  }
  async awardBadge(userId: string, badge: string, awardedBy: string | null): Promise<Badge> {
    const row: Badge = { id: randomUUID(), user_id: userId, badge, awarded_by: awardedBy, created_at: now() };
    this.badges.set(row.id, row);
    return row;
  }
  async listBadges(userId: string): Promise<Badge[]> {
    return [...this.badges.values()].filter((b) => b.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addSessionSummary(coachId: string, customerId: string, summary: string): Promise<SessionSummary> {
    const row: SessionSummary = { id: randomUUID(), coach_id: coachId, customer_id: customerId, summary, created_at: now() };
    this.sessionSummaries.set(row.id, row);
    return row;
  }
  async listSessionSummaries(customerId: string): Promise<SessionSummary[]> {
    return [...this.sessionSummaries.values()].filter((s) => s.customer_id === customerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createCustomerGoal(coachId: string, customerId: string, g: { title_en: string; title_ne?: string | null; target_date?: string | null }): Promise<CustomerGoal> {
    const row: CustomerGoal = { id: randomUUID(), coach_id: coachId, customer_id: customerId, title_en: g.title_en, title_ne: g.title_ne ?? null, target_date: g.target_date ?? null, done_at: null, created_at: now() };
    this.customerGoals.set(row.id, row);
    return row;
  }
  async listCustomerGoals(customerId: string): Promise<CustomerGoal[]> {
    return [...this.customerGoals.values()].filter((g) => g.customer_id === customerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async completeCustomerGoal(id: string, coachId: string): Promise<CustomerGoal | null> {
    const g = this.customerGoals.get(id);
    if (!g || g.coach_id !== coachId) return null;
    g.done_at = now();
    return g;
  }
  async deleteCustomerGoal(id: string, coachId: string): Promise<boolean> {
    const g = this.customerGoals.get(id);
    if (!g || g.coach_id !== coachId) return false;
    return this.customerGoals.delete(id);
  }
  async createHabitTemplate(t: { title_en: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null; created_by?: string | null }): Promise<HabitTemplate> {
    const row: HabitTemplate = { id: randomUUID(), title_en: t.title_en, title_ne: t.title_ne ?? null, description_en: t.description_en ?? null, description_ne: t.description_ne ?? null, created_by: t.created_by ?? null, created_at: now() };
    this.habitTemplates.set(row.id, row);
    return row;
  }
  async listHabitTemplates(): Promise<HabitTemplate[]> {
    return [...this.habitTemplates.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async deleteHabitTemplate(id: string): Promise<boolean> {
    return this.habitTemplates.delete(id);
  }
  async updateHabitTemplate(id: string, t: { title_en?: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null }): Promise<HabitTemplate | null> {
    const row = this.habitTemplates.get(id);
    if (!row) return null;
    if (t.title_en !== undefined) row.title_en = t.title_en;
    if (t.title_ne !== undefined) row.title_ne = t.title_ne;
    if (t.description_en !== undefined) row.description_en = t.description_en;
    if (t.description_ne !== undefined) row.description_ne = t.description_ne;
    return row;
  }
  async createNoteTemplate(coachId: string | null, t: { title: string; body_en: string; body_ne?: string | null }): Promise<NoteTemplate> {
    const row: NoteTemplate = { id: randomUUID(), coach_id: coachId, title: t.title, body_en: t.body_en, body_ne: t.body_ne ?? null, created_at: now() };
    this.noteTemplates.set(row.id, row);
    return row;
  }
  async listNoteTemplates(coachId: string): Promise<NoteTemplate[]> {
    return [...this.noteTemplates.values()].filter((t) => t.coach_id === null || t.coach_id === coachId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async deleteNoteTemplate(id: string, coachId: string): Promise<boolean> {
    const t = this.noteTemplates.get(id);
    if (!t || t.coach_id !== coachId) return false;
    return this.noteTemplates.delete(id);
  }
  async updateNoteTemplate(id: string, coachId: string, t: { title?: string; body_en?: string; body_ne?: string | null }): Promise<NoteTemplate | null> {
    const row = this.noteTemplates.get(id);
    if (!row || row.coach_id !== coachId) return null;
    if (t.title !== undefined) row.title = t.title;
    if (t.body_en !== undefined) row.body_en = t.body_en;
    if (t.body_ne !== undefined) row.body_ne = t.body_ne;
    return row;
  }
  async assignArticle(articleId: string, userId: string, assignedBy: string | null): Promise<ArticleAssignment> {
    const existing = [...this.articleAssignments.values()].find((a) => a.article_id === articleId && a.user_id === userId);
    if (existing) return existing;
    const row: ArticleAssignment = { id: randomUUID(), article_id: articleId, user_id: userId, assigned_by: assignedBy, created_at: now() };
    this.articleAssignments.set(row.id, row);
    return row;
  }
  async listArticleAssignments(userId: string): Promise<ArticleAssignment[]> {
    return [...this.articleAssignments.values()].filter((a) => a.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async coachRiskFlags(): Promise<{ user_id: string; name: string | null; missed_checkins: number }[]> {
    // Customers whose latest check-in is older than 7 days (or never checked in after 7 days of account age)
    const out: { user_id: string; name: string | null; missed_checkins: number }[] = [];
    const cutoff = Date.now() - 7 * 86400_000;
    for (const u of this.users.values()) {
      if (u.role !== "customer") continue;
      const cis = [...this.checkins.values()].filter((c) => c.user_id === u.id);
      const latest = cis.length ? Math.max(...cis.map((c) => new Date(c.created_at).getTime())) : 0;
      if (latest < cutoff && new Date(u.created_at).getTime() < cutoff) {
        out.push({ user_id: u.id, name: this.profiles.get(u.id)?.name ?? null, missed_checkins: cis.length });
      }
    }
    return out;
  }
  // ---- customer (U12–U20) ----
  async planHistory(userId: string): Promise<Plan[]> {
    const scanIds = new Set([...this.scans.values()].filter((s) => s.user_id === userId).map((s) => s.id));
    const caseIds = new Set([...this.cases.values()].filter((c) => scanIds.has(c.scan_id)).map((c) => c.id));
    return [...this.plans.values()].filter((p) => caseIds.has(p.case_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async upsertSymptomEntry(userId: string, entryDate: string, note: string): Promise<SymptomEntry> {
    const existing = [...this.symptomEntries.values()].find((e) => e.user_id === userId && e.entry_date === entryDate);
    if (existing) { existing.note = note; return existing; }
    const row: SymptomEntry = { id: randomUUID(), user_id: userId, entry_date: entryDate, note, created_at: now() };
    this.symptomEntries.set(row.id, row);
    return row;
  }
  async listSymptomEntries(userId: string, limit: number): Promise<SymptomEntry[]> {
    return [...this.symptomEntries.values()].filter((e) => e.user_id === userId)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, limit);
  }
  async deleteSymptomEntry(id: string, userId: string): Promise<boolean> {
    const e = this.symptomEntries.get(id);
    if (!e || e.user_id !== userId) return false;
    return this.symptomEntries.delete(id);
  }
  async setWaterLog(userId: string, logDate: string, glasses: number): Promise<WaterLog> {
    const row: WaterLog = { user_id: userId, log_date: logDate, glasses: Math.max(0, glasses), updated_at: now() };
    this.waterLogs.set(`${userId}:${logDate}`, row);
    return row;
  }
  async getWaterLog(userId: string, logDate: string): Promise<WaterLog | null> {
    return this.waterLogs.get(`${userId}:${logDate}`) ?? null;
  }
  async upsertSleepLog(userId: string, logDate: string, s: { bedtime?: string | null; wake_time?: string | null; quality?: number | null }): Promise<SleepLog> {
    const existing = [...this.sleepLogs.values()].find((l) => l.user_id === userId && l.log_date === logDate);
    if (existing) {
      if (s.bedtime !== undefined) existing.bedtime = s.bedtime;
      if (s.wake_time !== undefined) existing.wake_time = s.wake_time;
      if (s.quality !== undefined) existing.quality = s.quality;
      return existing;
    }
    const row: SleepLog = { id: randomUUID(), user_id: userId, log_date: logDate, bedtime: s.bedtime ?? null, wake_time: s.wake_time ?? null, quality: s.quality ?? null, created_at: now() };
    this.sleepLogs.set(row.id, row);
    return row;
  }
  async listSleepLogs(userId: string, limit: number): Promise<SleepLog[]> {
    return [...this.sleepLogs.values()].filter((l) => l.user_id === userId)
      .sort((a, b) => b.log_date.localeCompare(a.log_date)).slice(0, limit);
  }
  async deleteSleepLog(id: string, userId: string): Promise<boolean> {
    const l = this.sleepLogs.get(id);
    if (!l || l.user_id !== userId) return false;
    return this.sleepLogs.delete(id);
  }
  async getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
    let p = this.notifPrefs.get(userId);
    if (!p) {
      p = { user_id: userId, plan_updates: true, photo_requests: true, digest: true, marketing: false, quiet_from: null, quiet_to: null, updated_at: now() };
      this.notifPrefs.set(userId, p);
    }
    return p;
  }
  async setNotificationPrefs(userId: string, p: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const cur = await this.getNotificationPrefs(userId);
    Object.assign(cur, p, { user_id: userId, updated_at: now() });
    return cur;
  }
  async createEmergencyContact(userId: string, c: { name: string; phone: string; relation?: string | null }): Promise<EmergencyContact> {
    const row: EmergencyContact = { id: randomUUID(), user_id: userId, name: c.name, phone: c.phone, relation: c.relation ?? null, created_at: now() };
    this.emergencyContacts.set(row.id, row);
    return row;
  }
  async listEmergencyContacts(userId: string): Promise<EmergencyContact[]> {
    return [...this.emergencyContacts.values()].filter((c) => c.user_id === userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async storageUsage(): Promise<{ bucket: string; files: number }[]> {
    let kitImages = 0;
    for (const k of this.kits.values()) kitImages += (k.images ?? []).length;
    let profilePhotos = 0;
    for (const p of this.profiles.values()) if (p.photo_path) profilePhotos++;
    return [
      { bucket: "scan-photos", files: this.photos.size },
      { bucket: "kit-images", files: kitImages },
      { bucket: "profile-photos", files: profilePhotos },
    ];
  }
  async deleteEmergencyContact(id: string, userId: string): Promise<boolean> {
    const c = this.emergencyContacts.get(id);
    if (!c || c.user_id !== userId) return false;
    return this.emergencyContacts.delete(id);
  }

  /* ---------------- Batch 3 (009) — doctor ---------------- */
  // ---- D19 doctor audit trail ----
  async listDoctorAudit(doctorId: string, limit: number): Promise<AuditEntry[]> {
    return [...this.audit]
      .filter((a) => a.actor_id === doctorId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  // ---- D20 case archive ----
  async archiveCase(id: string): Promise<Case | null> {
    const c = this.cases.get(id); if (!c) return null;
    // Case needs archived_at added to the interface (see endpoints.md checklist);
    // cast keeps this file compiling until then.
    (c as Case & { archived_at: string | null }).archived_at = now();
    c.updated_at = now();
    return c;
  }
  async listArchivedCases(doctorId: string): Promise<Case[]> {
    const isArchived = (c: Case) => (c as Case & { archived_at?: string | null }).archived_at != null;
    return [...this.cases.values()]
      .filter((c) => c.assigned_doctor_id === doctorId && isArchived(c))
      .sort((a, b) => ((b as Case & { archived_at: string }).archived_at ?? "")
        .localeCompare((a as Case & { archived_at: string }).archived_at ?? ""));
  }

  // ---- D22 second opinions ----
  async createSecondOpinion(o: { case_id: string; requester_id: string; reviewer_id: string; note?: string | null }): Promise<SecondOpinion> {
    const row: SecondOpinion = {
      id: randomUUID(), case_id: o.case_id, requester_id: o.requester_id,
      reviewer_id: o.reviewer_id, status: "pending", note: o.note ?? null,
      created_at: now(), decided_at: null,
    };
    this.secondOpinions.set(row.id, row);
    return row;
  }
  async listSecondOpinions(doctorId: string): Promise<SecondOpinion[]> {
    return [...this.secondOpinions.values()]
      .filter((s) => s.requester_id === doctorId || s.reviewer_id === doctorId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async decideSecondOpinion(id: string, reviewerId: string, accept: boolean): Promise<SecondOpinion | null> {
    const s = this.secondOpinions.get(id);
    if (!s || s.reviewer_id !== reviewerId || s.status !== "pending") return null;
    s.status = accept ? "accepted" : "declined";
    s.decided_at = now();
    return s;
  }

  // ---- D23 follow-up calendar (date range) ----
  async listFollowUpsRange(doctorId: string, from: string, to: string): Promise<FollowUp[]> {
    return [...this.followUps.values()]
      .filter((f) => f.doctor_id === doctorId && f.due_on >= from && f.due_on <= to)
      .sort((a, b) => a.due_on.localeCompare(b.due_on));
  }

  // ---- D24 triage presets ----
  async createTriagePreset(doctorId: string, name: string, priority: number): Promise<TriagePreset> {
    const row: TriagePreset = { id: randomUUID(), doctor_id: doctorId, name, priority, created_at: now() };
    this.triagePresets.set(row.id, row);
    return row;
  }
  async listTriagePresets(doctorId: string): Promise<TriagePreset[]> {
    return [...this.triagePresets.values()]
      .filter((p) => p.doctor_id === doctorId)
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  }
  async deleteTriagePreset(id: string, doctorId: string): Promise<boolean> {
    const p = this.triagePresets.get(id);
    if (!p || p.doctor_id !== doctorId) return false;
    this.triagePresets.delete(id);
    return true;
  }

  // ---- D25 patient adherence (read-only; see OPEN QUESTIONS for the "total" definition) ----
  async getPatientAdherence(userId: string): Promise<{ rate: number; done: number; total: number }> {
    const rows = [...this.checkins.values()]
      .filter((c) => c.user_id === userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const done = rows.length;
    if (!done) return { rate: 0, done: 0, total: 0 };
    const first = new Date(rows[0].created_at);
    const today = new Date();
    const days = Math.max(1, Math.floor((today.getTime() - first.getTime()) / 86400000) + 1);
    return { rate: Math.min(1, done / days), done, total: days };
  }

  // ---- D26 case transfer (route should addAudit 'case.transfer' after this) ----
  async transferCase(id: string, toDoctorId: string): Promise<Case | null> {
    const c = this.cases.get(id); if (!c) return null;
    c.assigned_doctor_id = toDoctorId;
    c.updated_at = now();
    return c;
  }

  /* ---------------- Batch 3 (009) — admin ---------------- */

// ---- admin: dispute resolution center (A21) ----
async createDispute(d: { order_id: string; user_id: string; subject: string; body: string }): Promise<Dispute> {
  const row: Dispute = {
    id: randomUUID(), order_id: d.order_id, user_id: d.user_id,
    subject: d.subject, body: d.body, status: "open",
    resolution: null, resolved_by: null,
    created_at: now(), resolved_at: null,
  };
  this.disputes.set(row.id, row);
  return row;
}
async listDisputes(status?: string): Promise<Dispute[]> {
  const rows = [...this.disputes.values()];
  const filtered = status ? rows.filter((d) => d.status === status) : rows;
  return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async getDispute(id: string): Promise<Dispute | null> {
  return this.disputes.get(id) ?? null;
}
async resolveDispute(id: string, resolvedBy: string, resolution: string, approved: boolean): Promise<Dispute | null> {
  const d = this.disputes.get(id);
  if (!d) return null;
  d.status = approved ? "resolved" : "rejected";
  d.resolution = resolution;
  d.resolved_by = resolvedBy;
  d.resolved_at = now();
  return d;
}

// ---- admin: doctor payout report (A22) ----
// Convention (mirrors batch-2 doctorReviewStats): a "reviewed" case is a
// plan.approve audit entry; the doctor comes from the approved plan.
async doctorPayouts(month: string): Promise<{ doctor_id: string; name: string | null; reviewed: number }[]> {
  const counts = new Map<string, number>();
  for (const a of this.audit) {
    if (a.action !== "plan.approve" || !a.at.startsWith(month)) continue;
    const plan = this.plans.get(a.entity_id ?? "");
    if (!plan) continue;
    counts.set(plan.doctor_id, (counts.get(plan.doctor_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([doctor_id, reviewed]) => ({
      doctor_id,
      name: this.profiles.get(doctor_id)?.name ?? null,
      reviewed,
    }))
    .sort((a, b) => b.reviewed - a.reviewed);
}

// ---- admin: content moderation queue (A23) ----
async listModerationQueue(): Promise<CommunityTip[]> {
  return [...this.communityTips.values()]
    .filter((t) => t.status === "pending")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async decideCommunityTip(id: string, approved: boolean, moderatorId: string): Promise<CommunityTip | null> {
  const t = this.communityTips.get(id);
  if (!t) return null;
  t.status = approved ? "approved" : "rejected";
  t.moderated_by = moderatorId;
  return t;
}

// ---- admin: plan template manager (A24) ----
async createPlanTemplate(t: { title_en: string; title_ne?: string | null; items: unknown[]; created_by?: string | null }): Promise<PlanTemplate> {
  const row: PlanTemplate = {
    id: randomUUID(), title_en: t.title_en, title_ne: t.title_ne ?? null,
    items: t.items, is_active: true, created_by: t.created_by ?? null,
    created_at: now(),
  };
  this.planTemplates.set(row.id, row);
  return row;
}
async listPlanTemplates(activeOnly: boolean): Promise<PlanTemplate[]> {
  return [...this.planTemplates.values()]
    .filter((t) => !activeOnly || t.is_active)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async updatePlanTemplate(id: string, patch: Partial<PlanTemplate>): Promise<PlanTemplate | null> {
  const t = this.planTemplates.get(id);
  if (!t) return null;
  const next: PlanTemplate = { ...t, ...patch, id };
  this.planTemplates.set(id, next);
  return next;
}
async deletePlanTemplate(id: string): Promise<boolean> {
  return this.planTemplates.delete(id);
}

// ---- admin: scan quality stats (A25) ----
// Pass rule: ai_quality.lighting_ok === true AND ai_quality.blur_ok === true.
// Photos with no quality result (e.g. Gemini key unset -> {skipped:true}) count
// as not passed.
async scanQualityStats(): Promise<{ angle: string; total: number; passed: number }[]> {
  const byAngle = new Map<string, { angle: string; total: number; passed: number }>();
  for (const p of this.photos.values()) {
    let row = byAngle.get(p.angle);
    if (!row) { row = { angle: p.angle, total: 0, passed: 0 }; byAngle.set(p.angle, row); }
    row.total += 1;
    const q = p.ai_quality as { lighting_ok?: boolean; blur_ok?: boolean } | null;
    if (q && q.lighting_ok === true && q.blur_ok === true) row.passed += 1;
  }
  return [...byAngle.values()].sort((a, b) => a.angle.localeCompare(b.angle));
}

// ---- admin: kit leaderboard (A26) ----
async kitLeaderboard(): Promise<{ kit_id: string; name: string; orders: number; revenue_npr: number }[]> {
  const byKit = new Map<string, { kit_id: string; name: string; orders: number; revenue_npr: number }>();
  for (const o of this.orders.values()) {
    if (!o.kit_id || o.status === "cancelled") continue;
    let row = byKit.get(o.kit_id);
    if (!row) {
      row = {
        kit_id: o.kit_id,
        name: this.kits.get(o.kit_id)?.name_en ?? "Unknown kit",
        orders: 0, revenue_npr: 0,
      };
      byKit.set(o.kit_id, row);
    }
    row.orders += 1;
    row.revenue_npr += o.total_npr;
  }
  return [...byKit.values()].sort((a, b) => b.revenue_npr - a.revenue_npr);
}

// ---- admin: order export scheduler (A27) ----
async createExportSchedule(s: { kind?: string; frequency: string; created_by?: string | null }): Promise<ExportSchedule> {
  const row: ExportSchedule = {
    id: randomUUID(), kind: s.kind ?? "orders", frequency: s.frequency,
    is_active: true, last_run_at: null, next_run_at: null,
    created_by: s.created_by ?? null, created_at: now(),
  };
  this.exportSchedules.set(row.id, row);
  return row;
}
async listExportSchedules(): Promise<ExportSchedule[]> {
  return [...this.exportSchedules.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async updateExportSchedule(id: string, patch: Partial<ExportSchedule>): Promise<ExportSchedule | null> {
  const s = this.exportSchedules.get(id);
  if (!s) return null;
  const next: ExportSchedule = { ...s, ...patch, id };
  this.exportSchedules.set(id, next);
  return next;
}
async deleteExportSchedule(id: string): Promise<boolean> {
  return this.exportSchedules.delete(id);
}

// ---- admin: staff onboarding checklist (A28) ----
async getStaffChecklist(userId: string): Promise<StaffChecklist | null> {
  for (const c of this.staffChecklists.values()) if (c.user_id === userId) return c;
  return null;
}
async saveStaffChecklist(userId: string, items: { key: string; done: boolean }[]): Promise<StaffChecklist> {
  const cur = await this.getStaffChecklist(userId);
  if (cur) {
    cur.items = items;
    cur.updated_at = now();
    return cur;
  }
  const row: StaffChecklist = { id: randomUUID(), user_id: userId, items, updated_at: now() };
  this.staffChecklists.set(row.id, row);
  return row;
}

  /* ---------------- Batch 3 (009) — pharmacy ---------------- */

// ---------------- Batch 2 (008) ----------------  <-- append AFTER the batch-2 block
// ---------------- Batch 3 (009) ----------------
// pharmacy (P19–P27)
async createQuarantine(q: { kit_id: string; qty: number; reason?: string | null; reported_by?: string | null }): Promise<QuarantineEntry> {
  const row: QuarantineEntry = {
    id: randomUUID(), kit_id: q.kit_id, qty: q.qty, reason: q.reason ?? null,
    status: "quarantined", reported_by: q.reported_by ?? null, created_at: now(),
  };
  this.quarantine.set(row.id, row);
  return row;
}
async listQuarantine(status?: string): Promise<QuarantineEntry[]> {
  const rows = [...this.quarantine.values()].filter((e) => !status || e.status === status);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async setQuarantineStatus(id: string, status: "quarantined" | "released" | "written_off"): Promise<QuarantineEntry | null> {
  const e = this.quarantine.get(id); if (!e) return null;
  e.status = status;
  return e;
}
async shiftSummary(date: string): Promise<{ handled: number; pending: number; cod_orders: number }> {
  // date = UTC calendar day "YYYY-MM-DD" (created_at/updated_at are UTC ISO).
  const handledIds = new Set<string>();
  let pending = 0, cod_orders = 0;
  for (const o of this.orders.values()) {
    const createdDay = o.created_at.slice(0, 10);
    const packDoneAt = (o as unknown as { pack_completed_at?: string | null }).pack_completed_at ?? null;
    if (createdDay === date && o.payment_method === "cod") cod_orders++;
    const packedDay = packDoneAt ? packDoneAt.slice(0, 10) : null;
    if (packedDay === date || (["shipped", "delivered"].includes(o.status) && o.updated_at.slice(0, 10) === date)) {
      handledIds.add(o.id);
    }
    if (["pending", "paid", "fulfilling"].includes(o.status) && !packDoneAt && createdDay <= date) pending++;
  }
  return { handled: handledIds.size, pending, cod_orders };
}
async courierPerformance(): Promise<{ courier: string; orders: number; delivered: number }[]> {
  const agg = new Map<string, { orders: number; delivered: number }>();
  for (const o of this.orders.values()) {
    const courier = o.courier_name ?? "unassigned";
    const a = agg.get(courier) ?? { orders: 0, delivered: 0 };
    a.orders++;
    if (o.status === "delivered") a.delivered++;
    agg.set(courier, a);
  }
  return [...agg.entries()].map(([courier, s]) => ({ courier, ...s }))
    .sort((a, b) => b.orders - a.orders);
}
async returnAnalytics(): Promise<{ kit_id: string; kit_name: string; returns: number; reasons: Record<string, number> }[]> {
  // Proxy: refunds (007) are the only by-reason return ledger; no returns table exists.
  const agg = new Map<string, { returns: number; reasons: Record<string, number> }>();
  for (const r of this.refunds.values()) {
    const o = this.orders.get(r.order_id); if (!o || !o.kit_id) continue;
    const a = agg.get(o.kit_id) ?? { returns: 0, reasons: {} };
    a.returns++;
    const reason = r.reason ?? "unspecified";
    a.reasons[reason] = (a.reasons[reason] ?? 0) + 1;
    agg.set(o.kit_id, a);
  }
  const out = [...agg.entries()].map(([kit_id, s]) => {
    const kit = this.kits.get(kit_id);
    return { kit_id, kit_name: kit?.name_en ?? kit?.name_ne ?? "unknown kit", returns: s.returns, reasons: s.reasons };
  });
  return out.sort((a, b) => b.returns - a.returns);
}
async packStart(orderId: string): Promise<Order | null> {
  const o = this.orders.get(orderId); if (!o) return null;
  (o as unknown as { pack_started_at: string | null }).pack_started_at = now();
  o.updated_at = now();
  return o;
}
async packComplete(orderId: string): Promise<Order | null> {
  const o = this.orders.get(orderId); if (!o) return null;
  (o as unknown as { pack_completed_at: string | null }).pack_completed_at = now();
  o.updated_at = now();
  return o;
}
async createPackagingMaterial(m: { name: string; qty?: number; unit?: string | null; low_threshold?: number }): Promise<PackagingMaterial> {
  const row: PackagingMaterial = {
    id: randomUUID(), name: m.name, qty: m.qty ?? 0, unit: m.unit ?? null,
    low_threshold: m.low_threshold ?? 0, updated_at: now(),
  };
  this.packagingMaterials.set(row.id, row);
  return row;
}
async listPackagingMaterials(): Promise<PackagingMaterial[]> {
  return [...this.packagingMaterials.values()].sort((a, b) => a.name.localeCompare(b.name));
}
async updatePackagingMaterial(id: string, patch: Partial<PackagingMaterial>): Promise<PackagingMaterial | null> {
  const m = this.packagingMaterials.get(id); if (!m) return null;
  const { id: _drop, ...rest } = patch; // id is immutable
  Object.assign(m, rest, { updated_at: now() });
  return m;
}
async deletePackagingMaterial(id: string): Promise<boolean> {
  return this.packagingMaterials.delete(id);
}
async codReconciliation(date: string): Promise<{ expected_npr: number; orders: { id: string; order_no: string; total_npr: number; status: string }[] }> {
  // date = UTC calendar day "YYYY-MM-DD".
  const rows = [...this.orders.values()]
    .filter((o) => o.payment_method === "cod" && o.created_at.slice(0, 10) === date)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    expected_npr: rows.reduce((s, o) => s + o.total_npr, 0),
    orders: rows.map((o) => ({ id: o.id, order_no: o.order_no, total_npr: o.total_npr, status: o.status })),
  };
}
async setKitLowStockThreshold(kitId: string, threshold: number): Promise<Kit | null> {
  const k = this.kits.get(kitId); if (!k) return null;
  (k as unknown as { low_stock_threshold: number }).low_stock_threshold = threshold;
  k.updated_at = now();
  return k;
}
async addOrderNote(orderId: string, authorId: string, note: string): Promise<OrderNote> {
  const row: OrderNote = { id: randomUUID(), order_id: orderId, author_id: authorId, note, created_at: now() };
  this.orderNotes.set(row.id, row);
  return row;
}
async listOrderNotes(orderId: string): Promise<OrderNote[]> {
  return [...this.orderNotes.values()].filter((n) => n.order_id === orderId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

  /* ---------------- Batch 3 (009) — coach ---------------- */
async streakLeaderboard(limit?: number): Promise<{ user_id: string; display: string; streak: number }[]> {
  const dayMs = 86400_000;
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const rows: { user_id: string; display: string; streak: number }[] = [];
  for (const u of this.users.values()) {
    if (u.role !== "customer") continue;
    if ((u as User & { leaderboard_opt_in?: boolean }).leaderboard_opt_in !== true) continue;
    const days = new Set(
      [...this.checkins.values()]
        .filter((c) => c.user_id === u.id)
        .map((c) => dayKey(new Date(c.created_at).getTime()))
    );
    let streak = 0;
    let cursor = Date.now();
    // Walk back from today; a gap ends the streak.
    for (let i = 0; i < 3650; i++) {
      if (days.has(dayKey(cursor))) { streak++; cursor -= dayMs; }
      else break;
    }
    rows.push({ user_id: u.id, display: `Customer #${u.id.replace(/-/g, "").slice(-4).toUpperCase()}`, streak });
  }
  rows.sort((a, b) => b.streak - a.streak || a.user_id.localeCompare(b.user_id));
  return rows.slice(0, limit ?? 10);
}

async escalationSla(): Promise<{ id: string; customer_id: string; status: string; hours_to_ack: number | null; hours_to_resolve: number | null }[]> {
  // escalations has no acknowledged_at / resolved_at columns, so times cannot be
  // computed. Returning nulls honestly; see store.ts JSDoc + endpoints.md.
  return [...this.escalations.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((e) => ({ id: e.id, customer_id: e.customer_id, status: e.status, hours_to_ack: null, hours_to_resolve: null }));
}

async createRecurringNudge(n: { coach_id: string; user_id: string; message_en: string; message_ne?: string | null; send_at: string; recurrence: "daily" | "weekly" }): Promise<ScheduledNudge> {
  const row = {
    id: randomUUID(), coach_id: n.coach_id, user_id: n.user_id,
    message_en: n.message_en, message_ne: n.message_ne ?? null,
    send_at: n.send_at, sent_at: null, created_at: now(),
    recurrence: n.recurrence,
  } as ScheduledNudge;
  this.scheduledNudges.set(row.id, row);
  return row;
}

async satisfactionTrend(): Promise<{ bucket: string; avg: number; count: number }[]> {
  // bucket = ISO week start (Monday, UTC) as YYYY-MM-DD
  const groups = new Map<string, { sum: number; count: number }>();
  for (const r of this.satisfactionRatings.values()) {
    const d = new Date(r.created_at);
    const mondayOffset = (d.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset));
    const bucket = monday.toISOString().slice(0, 10);
    const g = groups.get(bucket) ?? { sum: 0, count: 0 };
    g.sum += r.rating; g.count++;
    groups.set(bucket, g);
  }
  return [...groups.entries()]
    .map(([bucket, g]) => ({ bucket, avg: Math.round((g.sum / g.count) * 100) / 100, count: g.count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

async progressCompare(userId: string): Promise<{ baseline: Record<string, number> | null; current: Record<string, number> | null }> {
  // Degraded: no numeric progress table exists, so compare shedding_estimate
  // from the earliest vs latest progress_checkins rows.
  const cis = [...this.checkins.values()]
    .filter((c) => c.user_id === userId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const toRecord = (c?: Checkin | null): Record<string, number> | null =>
    c && typeof c.shedding_estimate === "number" ? { shedding_estimate: c.shedding_estimate } : null;
  if (!cis.length) return { baseline: null, current: null };
  return { baseline: toRecord(cis[0]), current: toRecord(cis[cis.length - 1]) };
}

async getOnboardingChecklist(userId: string): Promise<OnboardingChecklist | null> {
  return this.onboardingChecklists.get(userId) ?? null;
}

async saveOnboardingChecklist(userId: string, steps: { key: string; done: boolean }[]): Promise<OnboardingChecklist> {
  const existing = this.onboardingChecklists.get(userId);
  const row: OnboardingChecklist = {
    id: existing?.id ?? randomUUID(),
    user_id: userId,
    steps: steps.map((s) => ({ key: s.key, done: !!s.done })),
    updated_at: now(),
  };
  this.onboardingChecklists.set(userId, row);
  return row;
}

async missedCheckins(days?: number): Promise<{ user_id: string; name: string | null; days_missed: number }[]> {
  const n = days ?? 7;
  const cutoff = Date.now() - n * 86400_000;
  const out: { user_id: string; name: string | null; days_missed: number }[] = [];
  for (const u of this.users.values()) {
    if (u.role !== "customer") continue;
    if (new Date(u.created_at).getTime() >= cutoff) continue;
    const cis = [...this.checkins.values()].filter((c) => c.user_id === u.id);
    const latest = cis.length ? Math.max(...cis.map((c) => new Date(c.created_at).getTime())) : 0;
    if (latest < cutoff) {
      const since = latest || new Date(u.created_at).getTime();
      out.push({ user_id: u.id, name: this.profiles.get(u.id)?.name ?? null, days_missed: Math.floor((Date.now() - since) / 86400_000) });
    }
  }
  return out.sort((a, b) => b.days_missed - a.days_missed);
}

async getCoachAvailability(coachId: string): Promise<CoachAvailability | null> {
  return this.coachAvailability.get(coachId) ?? null;
}

async setCoachAvailability(coachId: string, status: "available" | "on_leave", note?: string | null): Promise<CoachAvailability> {
  const existing = this.coachAvailability.get(coachId);
  const row: CoachAvailability = {
    id: existing?.id ?? randomUUID(),
    coach_id: coachId,
    status,
    note: note ?? null,
    updated_at: now(),
  };
  this.coachAvailability.set(coachId, row);
  return row;
}

async adherenceDetail(userId: string): Promise<{ habit: string; done: number; total: number }[]> {
  // Degraded: progress_checkins has no habit column. Report 30-day done/total
  // across the checkin dimensions that do exist.
  const windowStart = Date.now() - 30 * 86400_000;
  const cis = [...this.checkins.values()].filter(
    (c) => c.user_id === userId && new Date(c.created_at).getTime() >= windowStart
  );
  const daysWithCheckin = new Set(cis.map((c) => c.created_at.slice(0, 10))).size;
  return [
    { habit: "daily_checkin", done: daysWithCheckin, total: 30 },
    { habit: "photo_logged", done: cis.filter((c) => (c.photo_ids ?? []).length > 0).length, total: cis.length },
    { habit: "shedding_logged", done: cis.filter((c) => typeof c.shedding_estimate === "number").length, total: cis.length },
    { habit: "note_logged", done: cis.filter((c) => !!c.note).length, total: cis.length },
  ];
}

  /* ---------------- Batch 3 (009) — customer ---------------- */
  // ---- Batch 3 (009) map declarations ----

  /* ---------------- Batch 3 (009) — customer (U21–U29) ---------------- */
  // ---- U21 case Q&A ----
  async listCaseMessages(caseId: string): Promise<CaseMessage[]> {
    return [...this.caseMessages.values()]
      .filter((m) => m.case_id === caseId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async addCaseMessage(caseId: string, authorId: string, authorRole: "customer" | "doctor", body: string): Promise<CaseMessage> {
    const row: CaseMessage = { id: randomUUID(), case_id: caseId, author_id: authorId, author_role: authorRole, body, created_at: now() };
    this.caseMessages.set(row.id, row);
    return row;
  }
  // ---- U22 follow-up review requests (appointment-free) ----
  async createReviewRequest(r: { user_id: string; case_id?: string | null; reason?: string | null }): Promise<ReviewRequest> {
    const row: ReviewRequest = {
      id: randomUUID(), user_id: r.user_id, case_id: r.case_id ?? null,
      reason: r.reason ?? null, status: "pending", created_at: now(),
    };
    this.reviewRequests.set(row.id, row);
    return row;
  }
  async listReviewRequests(userId: string): Promise<ReviewRequest[]> {
    return [...this.reviewRequests.values()]
      .filter((r) => r.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  // ---- U23 community tips (moderated) ----
  async listCommunityTips(approvedOnly: boolean): Promise<CommunityTip[]> {
    return [...this.communityTips.values()]
      .filter((t) => !approvedOnly || t.status === "approved")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createCommunityTip(userId: string, title: string, body: string): Promise<CommunityTip> {
    const row: CommunityTip = {
      id: randomUUID(), user_id: userId, title, body,
      status: "pending", moderated_by: null, created_at: now(),
    };
    this.communityTips.set(row.id, row);
    return row;
  }
  // ---- U25 loyalty (earn derived at READ time) ----
  async getLoyalty(userId: string): Promise<{ balance: number; history: LoyaltyEntry[] }> {
    // 001 order_status enum: 'delivered' is the only fulfilled terminal state.
    const earnedNpr = [...this.orders.values()]
      .filter((o) => o.user_id === userId && o.status === "delivered")
      .reduce((sum, o) => sum + (o.total_npr ?? 0), 0);
    const history = [...this.loyaltyEntries.values()]
      .filter((e) => e.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const adjustments = history.reduce((sum, e) => sum + e.points, 0);
    return { balance: Math.floor(earnedNpr / 100) + adjustments, history };
  }
  async addLoyaltyEntry(userId: string, points: number, reason?: string | null, orderId?: string | null): Promise<LoyaltyEntry> {
    const row: LoyaltyEntry = {
      id: randomUUID(), user_id: userId, points, reason: reason ?? null,
      order_id: orderId ?? null, created_at: now(),
    };
    this.loyaltyEntries.set(row.id, row);
    return row;
  }
  // ---- U26 gift-a-kit (store method only; POST /orders wiring is a separate track) ----
  async setOrderGift(orderId: string, g: { recipient_name: string; recipient_phone?: string | null; message?: string | null }): Promise<Order | null> {
    const o = this.orders.get(orderId);
    if (!o) return null;
    Object.assign(o, {
      is_gift: true,
      gift_recipient_name: g.recipient_name,
      gift_recipient_phone: g.recipient_phone ?? null,
      gift_message: g.message ?? null,
      updated_at: now(),
    });
    return o;
  }
  // ---- U24 adherence history (reuses 001 progress_checkins) ----
  async adherenceHistory(userId: string): Promise<{ week: string; rate: number }[]> {
    // Rate definition (documented in endpoints.md, not in the migration):
    // per calendar week (Monday-start), distinct days with ≥1 check-in / 7.
    const dayMs = 86_400_000;
    const nowT = new Date();
    const monday = new Date(Date.UTC(nowT.getUTCFullYear(), nowT.getUTCMonth(), nowT.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7)); // rewind to Monday
    const daysByWeek = new Map<string, Set<string>>();
    for (let w = 0; w < 12; w++) {
      const key = new Date(monday.getTime() - w * 7 * dayMs).toISOString().slice(0, 10);
      daysByWeek.set(key, new Set());
    }
    for (const c of this.checkins.values()) {
      if (c.user_id !== userId) continue;
      const d = new Date(c.created_at);
      const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
      const key = weekStart.toISOString().slice(0, 10);
      const set = daysByWeek.get(key);
      if (set) set.add(d.toISOString().slice(0, 10));
    }
    return [...daysByWeek.entries()]
      .map(([week, days]) => ({ week, rate: Math.round((days.size / 7) * 100) / 100 }))
      .sort((a, b) => a.week.localeCompare(b.week));
  }
  // ---- U29 routine library (published only) ----
  async listRoutines(): Promise<RoutineItem[]> {
    return [...this.routines.values()]
      .filter((r) => r.is_published)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  // ---- leaderboard opt-in (009 users.leaderboard_opt_in; needed by coach C19) ----
  async getLeaderboardOptIn(userId: string): Promise<boolean> {
    const u = this.users.get(userId) as (User & { leaderboard_opt_in?: boolean | null }) | undefined;
    return u?.leaderboard_opt_in === true;
  }
  async setLeaderboardOptIn(userId: string, optIn: boolean): Promise<void> {
    const u = this.users.get(userId) as (User & { leaderboard_opt_in?: boolean | null }) | undefined;
    if (u) { u.leaderboard_opt_in = optIn; u.updated_at = now(); }
  }

// __B4_DOCTOR_METHODS__
// ---- Batch 4 (010) — doctor (D28–D45) ----

  // ---- D29 doctor directory (excludes self) ----
  async listDoctorPeers(excludeId: string): Promise<User[]> {
    return [...this.users.values()]
      .filter((u) => u.role === "doctor" && u.id !== excludeId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ---- D30 SLA pause / resume ----
  async setCaseSlaPaused(caseId: string, pausedAt: string | null): Promise<Case | null> {
    const c = this.cases.get(caseId);
    if (!c) return null;
    (c as CaseWithSla).sla_paused_at = pausedAt;
    c.updated_at = now();
    return c;
  }

  // ---- D32 doctor-only internal comment thread (oldest first) ----
  async createCaseComment(c: { case_id: string; doctor_id: string; body: string }): Promise<CaseComment> {
    const row: CaseComment = { id: randomUUID(), case_id: c.case_id, doctor_id: c.doctor_id, body: c.body, created_at: now() };
    this.caseComments.set(row.id, row);
    return row;
  }
  async listCaseComments(caseId: string): Promise<CaseComment[]> {
    return [...this.caseComments.values()]
      .filter((c) => c.case_id === caseId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ---- D33 non-diagnostic concern tags (idempotent add) ----
  async addCaseConcernTag(caseId: string, tag: string): Promise<CaseConcernTag> {
    const existing = [...this.caseConcernTags.values()]
      .find((t) => t.case_id === caseId && t.tag === tag);
    if (existing) return existing;
    const row: CaseConcernTag = { id: randomUUID(), case_id: caseId, tag, created_at: now() };
    this.caseConcernTags.set(row.id, row);
    return row;
  }
  async removeCaseConcernTag(caseId: string, tag: string): Promise<void> {
    for (const [id, t] of this.caseConcernTags) {
      if (t.case_id === caseId && t.tag === tag) this.caseConcernTags.delete(id);
    }
  }
  async listCaseConcernTags(caseId: string): Promise<CaseConcernTag[]> {
    return [...this.caseConcernTags.values()]
      .filter((t) => t.case_id === caseId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ---- D37 weekly digest ----
  async getDoctorDigest(doctorId: string): Promise<{ reviewed: number; avgMinutes: number | null; slaHits: number; weekStart: string }> {
    // "decided" is not a CaseStatus (queued | in_review | reviewed), so the
    // reviewed bucket is status === "reviewed" within the last 7 days.
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const mine = [...this.cases.values()].filter(
      (c) => c.assigned_doctor_id === doctorId && c.status === "reviewed" && c.updated_at >= cutoff,
    );
    // No timing data is recorded (no decided_at column), so avgMinutes is
    // honestly null. "Decided" is approximated by updated_at (the moment the
    // case moved to reviewed); null sla_due_at rows are excluded (null-safe).
    const slaHits = mine.filter((c) => c.sla_due_at != null && c.updated_at <= c.sla_due_at).length;
    return { reviewed: mine.length, avgMinutes: null, slaHits, weekStart: b4WeekStart() };
  }

  // ---- D38 similar past cases by root-score distance ----
  async listSimilarCases(caseId: string, doctorId: string): Promise<SimilarCase[]> {
    const kase = this.cases.get(caseId);
    if (!kase) return [];
    const baseRows = await this.getRootScores(kase.scan_id);
    const base = new Map(baseRows.map((s) => [s.root, s.score]));
    if (base.size === 0) return [];
    const out: SimilarCase[] = [];
    for (const c of this.cases.values()) {
      if (c.id === caseId) continue;                    // exclude itself
      if (c.assigned_doctor_id !== doctorId) continue;   // own past cases only
      if (c.status !== "reviewed") continue;             // past (decided) cases
      const rows = await this.getRootScores(c.scan_id);
      if (!rows.length) continue;
      // Distance = sum of |diff| over roots present in BOTH cases; roots
      // missing on either side are skipped (documented, not invented).
      let distance = 0;
      let common = 0;
      for (const s of rows) {
        const b = base.get(s.root);
        if (b == null) continue;
        distance += Math.abs(b - s.score);
        common++;
      }
      if (common === 0) continue;
      out.push({
        id: c.id, created_at: c.created_at, priority: c.priority,
        status: c.status, distance: Math.round(distance * 100) / 100,
      });
    }
    return out.sort((a, b) => a.distance - b.distance).slice(0, 5);
  }

  // ---- D40 saved queue filter presets (doctor-scoped) ----
  async createQueueFilter(f: { doctor_id: string; name: string; filters: Record<string, unknown> }): Promise<QueueFilter> {
    const row: QueueFilter = { id: randomUUID(), doctor_id: f.doctor_id, name: f.name, filters: f.filters, created_at: now() };
    this.queueFilters.set(row.id, row);
    return row;
  }
  async listQueueFilters(doctorId: string): Promise<QueueFilter[]> {
    return [...this.queueFilters.values()]
      .filter((q) => q.doctor_id === doctorId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async deleteQueueFilter(id: string, doctorId: string): Promise<boolean> {
    const q = this.queueFilters.get(id);
    if (!q || q.doctor_id !== doctorId) return false;
    this.queueFilters.delete(id);
    return true;
  }

  // ---- D43 own reviewed cases for CSV export ----
  async exportOwnCases(doctorId: string): Promise<{ id: string; created_at: string; status: string; priority: number }[]> {
    return [...this.cases.values()]
      .filter((c) => c.assigned_doctor_id === doctorId && c.status === "reviewed")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => ({ id: c.id, created_at: c.created_at, status: c.status, priority: c.priority }));
  }

// __B4_ADMIN_METHODS__
// ---- Batch 4 admin (A30–A47) ----

// ---- A30 dashboard configs ----
async getDashboardConfig(role: string): Promise<DashboardConfig | null> {
  return this.dashboardConfigs.get(role) ?? null;
}
async setDashboardConfig(role: string, config: Record<string, unknown>): Promise<DashboardConfig> {
  const existing = this.dashboardConfigs.get(role);
  const row: DashboardConfig = { id: existing?.id ?? randomUUID(), role, config, updated_at: now() };
  this.dashboardConfigs.set(role, row);
  return row;
}

// ---- A37 email delivery log ----
async logEmail(e: { to_email: string; template: string; status: "sent" | "failed"; error?: string | null }): Promise<EmailLog> {
  const row: EmailLog = {
    id: randomUUID(), to_email: e.to_email, template: e.template,
    status: e.status, error: e.error ?? null, created_at: now(),
  };
  this.emailLogs.set(row.id, row);
  return row;
}
async listEmailLogs(limit: number): Promise<EmailLog[]> {
  return [...this.emailLogs.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, Math.max(limit, 0));
}

// ---- A44 admin notices ----
async listAdminNotices(adminId: string): Promise<AdminNotice[]> {
  return [...this.adminNotices.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((n) => ({ ...n, read: this.adminNoticeReads.has(`${adminId}:${n.id}`) }));
}
async createAdminNotice(n: { title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null }): Promise<AdminNotice> {
  const row: AdminNotice = {
    id: randomUUID(), title_en: n.title_en, title_ne: n.title_ne ?? null,
    body_en: n.body_en ?? null, body_ne: n.body_ne ?? null,
    created_at: now(), read: false,
  };
  this.adminNotices.set(row.id, row);
  return row;
}
async markAdminNoticeRead(adminId: string, noticeId: string): Promise<void> {
  if (this.adminNotices.has(noticeId)) {
    this.adminNoticeReads.set(`${adminId}:${noticeId}`, now());
  }
}

// ---- A45 consent versions ----
async listConsentVersions(kind?: string): Promise<ConsentVersion[]> {
  let rows = [...this.consentVersions.values()];
  if (kind) rows = rows.filter((v) => v.kind === kind);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async createConsentVersion(v: { kind: string; version: number; text_en: string; text_ne?: string | null; active?: boolean }): Promise<ConsentVersion> {
  const row: ConsentVersion = {
    id: randomUUID(), kind: v.kind, version: v.version, text_en: v.text_en,
    text_ne: v.text_ne ?? null, active: v.active ?? false, created_at: now(),
  };
  this.consentVersions.set(row.id, row);
  return row;
}
async activateConsentVersion(id: string): Promise<ConsentVersion | null> {
  const row = this.consentVersions.get(id);
  if (!row) return null;
  for (const v of this.consentVersions.values()) {
    if (v.kind === row.kind) v.active = v.id === id;
  }
  return row;
}

// ---- A33 verification document expiry ----
async listExpiringVerifications(withinDays: number): Promise<StaffVerification[]> {
  const cutoff = Date.now() + withinDays * 86400_000;
  return [...this.staffVerifications.values()]
    .filter((v) => {
      const exp = (v as StaffVerificationRow).expires_at;
      return !!exp && v.status !== "rejected" && new Date(exp).getTime() <= cutoff;
    })
    .sort((a, b) => String((a as StaffVerificationRow).expires_at ?? "").localeCompare(String((b as StaffVerificationRow).expires_at ?? "")));
}
async setVerificationExpiry(id: string, expiresAt: string | null): Promise<StaffVerification | null> {
  const v = this.staffVerifications.get(id);
  if (!v) return null;
  (v as StaffVerificationRow).expires_at = expiresAt;
  return v;
}

// ---- A34 support ticket SLA ----
async getTicketSla(): Promise<{ open: number; avgFirstResponseMin: number | null; avgResolveMin: number | null }> {
  const tickets = [...this.tickets.values()];
  const repliesByTicket = new Map<string, TicketReply[]>();
  for (const r of this.ticketReplies.values()) {
    const arr = repliesByTicket.get(r.ticket_id) ?? [];
    arr.push(r);
    repliesByTicket.set(r.ticket_id, arr);
  }
  const firstResponseMs: number[] = [];
  const resolveMs: number[] = [];
  for (const t of tickets) {
    const staff = (repliesByTicket.get(t.id) ?? [])
      .filter((r) => r.author_role !== "customer")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (staff.length > 0) {
      firstResponseMs.push(new Date(staff[0].created_at).getTime() - new Date(t.created_at).getTime());
    }
    // No closed_at column exists — updated_at is the closest honest proxy for resolution time.
    if (t.status === "closed") {
      resolveMs.push(new Date(t.updated_at).getTime() - new Date(t.created_at).getTime());
    }
  }
  const avgMin = (xs: number[]) => (xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60000) : null);
  return { open: tickets.filter((t) => t.status === "open").length, avgFirstResponseMin: avgMin(firstResponseMs), avgResolveMin: avgMin(resolveMs) };
}

// ---- A36 bulk user status ----
async bulkSetUserStatus(ids: string[], disabled: boolean): Promise<number> {
  let updated = 0;
  for (const id of ids) {
    const u = this.users.get(id);
    if (u && u.is_active === disabled) {
      u.is_active = !disabled;
      u.updated_at = now();
      updated++;
    }
  }
  return updated;
}

// ---- A38 deletion requests ----
async listDeletionRequests(): Promise<DeletionRequest[]> {
  return [...this.deletions.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// ---- A39 referral stats ----
// No referral-code system exists in the schema (no referral tables through 010)
// — returning honest zeros rather than fabricated numbers.
async getReferralStats(): Promise<{ codes: number; joined: number }> {
  return { codes: 0, joined: 0 };
}

// ---- A40 challenge analytics ----
async getChallengeAnalytics(): Promise<{ challenge_id: string; title_en: string; assigned: number; completed: number }[]> {
  return [...this.challenges.values()]
    .map((c) => {
      const assigns = [...this.challengeAssignments.values()].filter((a) => a.challenge_id === c.id);
      return {
        challenge_id: c.id, title_en: c.title_en,
        assigned: assigns.length, completed: assigns.filter((a) => a.completed_at).length,
      };
    })
    .sort((a, b) => b.assigned - a.assigned);
}

// ---- A41 coach performance ----
async getCoachPerformance(): Promise<{ coach_id: string; escalations: number; avgSatisfaction: number | null }[]> {
  return [...this.users.values()]
    .filter((u) => u.role === "coach")
    .map((c) => {
      const escalations = [...this.escalations.values()].filter((e) => e.coach_id === c.id).length;
      const ratings = [...this.satisfactionRatings.values()].filter((r) => r.coach_id === c.id);
      return {
        coach_id: c.id, escalations,
        avgSatisfaction: ratings.length > 0
          ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10
          : null,
      };
    });
}

// ---- A42 pharmacy fulfilment performance ----
async getPharmacyPerformance(): Promise<{ handled: number; avgPackMin: number | null; avgShipMin: number | null }> {
  const packMs: number[] = [];
  const shipMs: number[] = [];
  let handled = 0;
  for (const o of this.orders.values()) {
    if (!o.pack_completed_at) continue;
    handled++;
    if (o.pack_started_at) {
      packMs.push(new Date(o.pack_completed_at).getTime() - new Date(o.pack_started_at).getTime());
    }
    // No shipped_at/delivered_at column — updated_at is the closest honest proxy.
    shipMs.push(new Date(o.updated_at).getTime() - new Date(o.pack_completed_at).getTime());
  }
  const avgMin = (xs: number[]) => (xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60000) : null);
  return { handled, avgPackMin: avgMin(packMs), avgShipMin: avgMin(shipMs) };
}

// ---- A32/A46 refund analytics (grouped by reason, from the refunds table) ----
async getRefundAnalytics(): Promise<{ reason: string; count: number; total_npr: number }[]> {
  const byReason = new Map<string, { count: number; total: number }>();
  for (const r of this.refunds.values()) {
    const reason = r.reason?.trim() || "other";
    const g = byReason.get(reason) ?? { count: 0, total: 0 };
    g.count++;
    g.total += r.amount_npr;
    byReason.set(reason, g);
  }
  return [...byReason.entries()]
    .map(([reason, g]) => ({ reason, count: g.count, total_npr: g.total }))
    .sort((a, b) => b.total_npr - a.total_npr);
}

// ---- A47 morning ops digest ----
async getOpsDigest(): Promise<{ ordersToday: number; slaBreaches: number; openTickets: number; pendingRefunds: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const t = Date.now();
  const ordersToday = [...this.orders.values()].filter((o) => o.created_at.slice(0, 10) === today).length;
  const slaBreaches = [...this.cases.values()].filter(
    (c) => (c.status === "queued" || c.status === "in_review") && c.sla_due_at && new Date(c.sla_due_at).getTime() < t,
  ).length;
  const openTickets = [...this.tickets.values()].filter((tk) => tk.status === "open").length;
  const pendingRefunds = [...this.refundRequests.values()].filter((r) => r.status === "pending").length;
  return { ordersToday, slaBreaches, openTickets, pendingRefunds };
}

// __B4_PHARMACY_METHODS__

/* ---------------- Batch 4 (010): P28–P45 (pharmacy role) ---------------- */

// ---- P31: delivery attempts ----
async createDeliveryAttempt(a: { order_id: string; status: "failed" | "rescheduled" | "delivered"; note?: string | null }): Promise<DeliveryAttempt> {
  const row: DeliveryAttempt = {
    id: randomUUID(), order_id: a.order_id, status: a.status,
    note: a.note ?? null, created_at: now(),
  };
  this.deliveryAttempts.set(row.id, row);
  return row;
}
async listDeliveryAttempts(orderId: string): Promise<DeliveryAttempt[]> {
  return [...this.deliveryAttempts.values()]
    .filter((a) => a.order_id === orderId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
// ---- P33: physical stock counts ----
async createStockCount(c: { kit_id: string; counted_qty: number; counted_by: string | null; system_qty: number }): Promise<StockCount> {
  const row: StockCount = {
    id: randomUUID(), kit_id: c.kit_id, system_qty: c.system_qty,
    counted_qty: c.counted_qty, variance: c.counted_qty - c.system_qty,
    counted_by: c.counted_by, created_at: now(),
  };
  this.stockCounts.set(row.id, row);
  return row;
}
async listStockCounts(kitId: string): Promise<StockCount[]> {
  return [...this.stockCounts.values()]
    .filter((s) => s.kit_id === kitId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
// ---- P38: kit substitutions ----
async createSubstitution(s: { order_id: string; from_kit_id?: string | null; to_kit_id?: string | null; reason: string }): Promise<Substitution> {
  const row: Substitution = {
    id: randomUUID(), order_id: s.order_id,
    from_kit_id: s.from_kit_id ?? null, to_kit_id: s.to_kit_id ?? null,
    reason: s.reason, created_at: now(),
  };
  this.substitutions.set(row.id, row);
  return row;
}
async listSubstitutions(orderId: string): Promise<Substitution[]> {
  return [...this.substitutions.values()]
    .filter((s) => s.order_id === orderId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
// ---- P39: delivery photo proofs ----
async createDeliveryProof(p: { order_id: string; storage_path: string; note?: string | null }): Promise<DeliveryProof> {
  const row: DeliveryProof = {
    id: randomUUID(), order_id: p.order_id, storage_path: p.storage_path,
    note: p.note ?? null, created_at: now(),
  };
  this.deliveryProofs.set(row.id, row);
  return row;
}
async listDeliveryProofs(orderId: string): Promise<DeliveryProof[]> {
  return [...this.deliveryProofs.values()]
    .filter((p) => p.order_id === orderId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
// ---- P43: pharmacy-initiated refund requests (admin decides) ----
async createRefundRequest(r: { order_id: string; reason: string }): Promise<RefundRequest> {
  const row: RefundRequest = {
    id: randomUUID(), order_id: r.order_id, reason: r.reason,
    status: "pending", created_at: now(), decided_at: null,
  };
  this.refundRequests.set(row.id, row);
  return row;
}
async listRefundRequests(status?: string): Promise<RefundRequest[]> {
  return [...this.refundRequests.values()]
    .filter((r) => !status || r.status === status)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async decideRefundRequest(id: string, approved: boolean): Promise<RefundRequest | null> {
  const r = this.refundRequests.get(id); if (!r) return null;
  r.status = approved ? "approved" : "rejected";
  r.decided_at = now();
  return r;
}
// ---- P44: non-dispatch days ----
async createDispatchHoliday(h: { date: string; label: string }): Promise<DispatchHoliday> {
  for (const x of this.dispatchHolidays.values()) if (x.date === h.date) return x; // idempotent
  const row: DispatchHoliday = { id: randomUUID(), date: h.date, label: h.label, created_at: now() };
  this.dispatchHolidays.set(row.id, row);
  return row;
}
async listDispatchHolidays(): Promise<DispatchHoliday[]> {
  return [...this.dispatchHolidays.values()].sort((a, b) => a.date.localeCompare(b.date));
}
async deleteDispatchHoliday(id: string): Promise<boolean> {
  return this.dispatchHolidays.delete(id);
}
// ---- P45: courier damage claims ----
async createCourierClaim(c: { courier_name: string; order_id?: string | null; amount_npr?: number; reason: string }): Promise<CourierClaim> {
  const row: CourierClaim = {
    id: randomUUID(), courier_name: c.courier_name, order_id: c.order_id ?? null,
    amount_npr: c.amount_npr ?? 0, reason: c.reason, status: "open", created_at: now(),
  };
  this.courierClaims.set(row.id, row);
  return row;
}
async listCourierClaims(status?: string): Promise<CourierClaim[]> {
  return [...this.courierClaims.values()]
    .filter((c) => !status || c.status === status)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async setCourierClaimStatus(id: string, status: "open" | "filed" | "settled"): Promise<CourierClaim | null> {
  const c = this.courierClaims.get(id); if (!c) return null;
  c.status = status;
  return c;
}
// ---- P34: rush flag on an order ----
async setOrderRush(orderId: string, rush: boolean): Promise<Order | null> {
  const o = this.orders.get(orderId); if (!o) return null;
  (o as Order & { is_rush?: boolean }).is_rush = rush;
  o.updated_at = now();
  return o;
}
// ---- P36-alt: kit batches expiring within N days (null expiries excluded) ----
async listExpiringBatches(withinDays: number): Promise<ExpiringBatch[]> {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  const out: ExpiringBatch[] = [];
  for (const b of this.kitBatches.values()) {
    if (!b.expires_on || b.expires_on > cutoff) continue;
    out.push({
      id: b.id, kit_id: b.kit_id,
      kit_name: this.kits.get(b.kit_id)?.name_en ?? b.kit_id,
      batch_no: b.batch_no, expiry: b.expires_on,
      days_left: Math.round((Date.parse(b.expires_on) - Date.parse(today)) / 86400000),
      qty: b.qty,
    });
  }
  return out.sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
}
// ---- P42: order search (order id / order_no fragment, customer phone / name) ----
async searchOrders(q: string): Promise<Order[]> {
  const needle = q.trim().toLowerCase();
  const match = (o: Order): boolean => {
    if (!needle) return true; // empty query = full listing (monthly report backdoor)
    if (o.id.toLowerCase().includes(needle)) return true;
    if (o.order_no.toLowerCase().includes(needle)) return true;
    const u = this.users.get(o.user_id);
    if (u && u.phone.toLowerCase().includes(needle)) return true;
    const p = this.profiles.get(o.user_id);
    if (p?.name && p.name.toLowerCase().includes(needle)) return true;
    const addr = o.shipping_address as Record<string, unknown> | null;
    if (addr && typeof addr.name === "string" && addr.name.toLowerCase().includes(needle)) return true;
    return false;
  };
  const all = [...this.orders.values()]
    .filter(match)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return needle ? all.slice(0, 20) : all;
}
// ---- P28: clear + recreate verification checks as pending ----
async reverifyOrderChecks(orderId: string): Promise<OrderCheck[]> {
  for (const [id, c] of this.orderChecks) {
    if (c.order_id === orderId) this.orderChecks.delete(id);
  }
  const rows: OrderCheck[] = [];
  for (const t of ["name", "phone", "address"] as OrderCheckType[]) {
    const row: OrderCheck = {
      id: randomUUID(), order_id: orderId, check_type: t,
      checked_by: null, checked_at: now(),
    };
    this.orderChecks.set(row.id, row);
    rows.push(row);
  }
  return rows;
}

/* ---------------- Batch 4 (010) — COACH (C28–C45) ---------------- */

// C29: customer rates their coach. Individual rows stay server-side — the
// coach-facing route only ever exposes the aggregate (avg + count).
async createCoachFeedback(f: { coach_id: string; customer_id: string; rating: number; note?: string | null }): Promise<CoachFeedback> {
  const row: CoachFeedback = {
    id: randomUUID(), coach_id: f.coach_id, customer_id: f.customer_id,
    rating: f.rating, note: f.note ?? null, created_at: now(),
  };
  this.coachFeedback.set(row.id, row);
  return row;
}
async getCoachFeedbackAggregate(coachId: string): Promise<{ avg: number | null; count: number }> {
  const rows = [...this.coachFeedback.values()].filter((r) => r.coach_id === coachId);
  if (!rows.length) return { avg: null, count: 0 };
  const sum = rows.reduce((a, r) => a + r.rating, 0);
  return { avg: Math.round((sum / rows.length) * 10) / 10, count: rows.length };
}

// C30: streak freeze for one date. The one-per-customer-per-month cap is
// enforced in the route (via listStreakFreezes); the DB additionally has
// UNIQUE(customer_id, frozen_date).
async createStreakFreeze(f: { customer_id: string; coach_id: string; frozen_date: string }): Promise<StreakFreeze> {
  const row: StreakFreeze = {
    id: randomUUID(), customer_id: f.customer_id, coach_id: f.coach_id,
    frozen_date: f.frozen_date, created_at: now(),
  };
  this.streakFreezes.set(row.id, row);
  return row;
}
async listStreakFreezes(customerId: string, month: string): Promise<StreakFreeze[]> {
  return [...this.streakFreezes.values()]
    .filter((r) => r.customer_id === customerId && r.frozen_date.slice(0, 7) === month)
    .sort((a, b) => a.frozen_date.localeCompare(b.frozen_date));
}

// C32: coach-defined customer tags (idempotent add; tags are coach-scoped).
async addCustomerTag(coachId: string, customerId: string, tag: string): Promise<CustomerTag> {
  const t = tag.trim().toLowerCase().slice(0, 60);
  for (const row of this.customerTags.values()) {
    if (row.coach_id === coachId && row.customer_id === customerId && row.tag === t) return row;
  }
  const row: CustomerTag = { id: randomUUID(), coach_id: coachId, customer_id: customerId, tag: t, created_at: now() };
  this.customerTags.set(row.id, row);
  return row;
}
async removeCustomerTag(coachId: string, customerId: string, tag: string): Promise<void> {
  const t = tag.trim().toLowerCase();
  for (const [id, row] of this.customerTags) {
    if (row.coach_id === coachId && row.customer_id === customerId && row.tag === t) this.customerTags.delete(id);
  }
}
async listCustomerTags(coachId: string, customerId: string): Promise<CustomerTag[]> {
  return [...this.customerTags.values()]
    .filter((r) => r.coach_id === coachId && r.customer_id === customerId)
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

// C34: handover notes when a customer moves between coaches.
async createCoachHandover(h: { customer_id: string; from_coach_id?: string | null; to_coach_id?: string | null; note: string }): Promise<CoachHandover> {
  const row: CoachHandover = {
    id: randomUUID(), customer_id: h.customer_id,
    from_coach_id: h.from_coach_id ?? null, to_coach_id: h.to_coach_id ?? null,
    note: h.note, created_at: now(),
  };
  this.coachHandovers.set(row.id, row);
  return row;
}
async listCoachHandovers(customerId: string): Promise<CoachHandover[]> {
  return [...this.coachHandovers.values()]
    .filter((r) => r.customer_id === customerId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// C37: this week's own activity (week starts Monday 00:00 UTC).
async getCoachWeeklyReport(coachId: string): Promise<{ notes: number; nudges: number; escalations: number; weekStart: string }> {
  const d = new Date();
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset);
  const since = new Date(startMs).toISOString();
  const weekStart = since.slice(0, 10);
  const notes = [...this.coachNotes.values()].filter((n) => n.coach_id === coachId && n.created_at >= since).length;
  const nudges = [...this.scheduledNudges.values()].filter((n) => n.coach_id === coachId && n.created_at >= since).length;
  const escalations = [...this.escalations.values()].filter((e) => e.coach_id === coachId && e.created_at >= since).length;
  return { notes, nudges, escalations, weekStart };
}

// C38: milestone timeline — badges, completed customer goals, completed challenges.
async listCustomerMilestones(customerId: string): Promise<{ kind: string; title: string; at: string }[]> {
  const out: { kind: string; title: string; at: string }[] = [];
  for (const b of this.badges.values()) {
    if (b.user_id === customerId) out.push({ kind: "badge", title: b.badge, at: b.created_at });
  }
  for (const g of this.customerGoals.values()) {
    if (g.customer_id === customerId && g.done_at) out.push({ kind: "goal", title: g.title_en, at: g.done_at });
  }
  for (const a of this.challengeAssignments.values()) {
    if (a.user_id === customerId && a.completed_at) {
      out.push({ kind: "challenge", title: this.challenges.get(a.challenge_id)?.title_en ?? "Challenge", at: a.completed_at });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// C41: computed journey stage. Documented rule (simplified, habit-only):
// - "active":    check-in within the last 7 days, with no 21d+ gap before it.
// - "returning": check-in within the last 7 days after a 21d+ dormant gap
//                (or a first-ever check-in 21d+ after signup).
// - "new":       no check-ins yet and signed up < 7 days ago.
// - "dormant":   no check-in for 21d+. Also covers: signed up 7d+ ago with
//                zero check-ins, and the 8–20d "lapsed" window — folded into
//                dormant because the four-stage model has no lapsed stage.
//                The client shows exact days-since so the nuance is visible.
async getJourneyStage(customerId: string): Promise<JourneyStage> {
  const user = this.users.get(customerId);
  const checkins = [...this.checkins.values()]
    .filter((c) => c.user_id === customerId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  const last = checkins[0];
  if (last && daysAgo(last.created_at) <= 7) {
    const prev = checkins[1];
    if (prev && daysAgo(prev.created_at) >= 21) return "returning";
    if (!prev && user && daysAgo(user.created_at) >= 21) return "returning";
    return "active";
  }
  if (!last && user && daysAgo(user.created_at) < 7) return "new";
  return "dormant";
}

// C42: record the outcome of an escalation (the escalations table has no
// outcome column in code types yet — carried on the row, persisted in DB).
async setEscalationOutcome(id: string, outcome: string): Promise<Escalation | null> {
  const e = this.escalations.get(id);
  if (!e) return null;
  (e as Escalation & { outcome: string | null }).outcome = outcome;
  return e;
}

// C43: anonymized peer tips between coaches (PII rejection lives in the route).
async createCoachTip(t: { coach_id: string; title: string; body: string }): Promise<CoachTip> {
  const row: CoachTip = { id: randomUUID(), coach_id: t.coach_id, title: t.title, body: t.body, created_at: now() };
  this.coachTips.set(row.id, row);
  return row;
}
async listCoachTips(): Promise<CoachTip[]> {
  return [...this.coachTips.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async deleteCoachTip(id: string, coachId: string): Promise<boolean> {
  const tip = this.coachTips.get(id);
  if (!tip || tip.coach_id !== coachId) return false;
  this.coachTips.delete(id);
  return true;
}

// C45: two-question end-of-challenge survey (one per assignment).
async createChallengeSurvey(s: { assignment_id: string; q1_rating: number; q2_text?: string | null }): Promise<ChallengeSurvey> {
  const row: ChallengeSurvey = {
    id: randomUUID(), assignment_id: s.assignment_id, q1_rating: s.q1_rating,
    q2_text: s.q2_text ?? null, created_at: now(),
  };
  this.challengeSurveys.set(row.id, row);
  return row;
}
async listChallengeSurveys(challengeId: string): Promise<ChallengeSurvey[]> {
  const out: ChallengeSurvey[] = [];
  for (const s of this.challengeSurveys.values()) {
    const a = this.challengeAssignments.get(s.assignment_id);
    if (a && a.challenge_id === challengeId) out.push(s);
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// C39 helper: read receipt on an assigned article. Extra method on the
// concrete store (not part of the Store interface — the me route calls it
// through a structural cast) so store.ts stays untouched.
async markArticleAssignmentRead(id: string): Promise<ArticleAssignment | null> {
  const a = this.articleAssignments.get(id);
  if (!a) return null;
  (a as ArticleAssignment & { read_at: string | null }).read_at = now();
  return a;
}

  /* ================= Batch 4 (010) — CUSTOMER (U30–U47) ================= */

  /** U37: app feedback. */
  async createAppFeedback(f: { user_id: string; rating: number; message?: string | null }): Promise<AppFeedback> {
    const row: AppFeedback = {
      id: randomUUID(), user_id: f.user_id, rating: f.rating,
      message: f.message ?? null, created_at: now(),
    };
    this.appFeedback.set(row.id, row);
    return row;
  }

  /** U40: create a kit reminder. */
  async createKitReminder(r: { user_id: string; kit_id?: string | null; label_en: string; label_ne?: string | null; remind_at: string }): Promise<KitReminder> {
    const row: KitReminder = {
      id: randomUUID(), user_id: r.user_id, kit_id: r.kit_id ?? null,
      label_en: r.label_en, label_ne: r.label_ne ?? null,
      remind_at: r.remind_at, done: false, created_at: now(),
    };
    this.kitReminders.set(row.id, row);
    return row;
  }
  /** U40: my reminders, earliest reminder first. */
  async listKitReminders(userId: string): Promise<KitReminder[]> {
    return [...this.kitReminders.values()]
      .filter((r) => r.user_id === userId)
      .sort((a, b) => a.remind_at.localeCompare(b.remind_at));
  }
  /** U40: mark done/undone; null when missing or someone else's. */
  async setKitReminderDone(id: string, userId: string, done: boolean): Promise<KitReminder | null> {
    const row = this.kitReminders.get(id);
    if (!row || row.user_id !== userId) return null;
    row.done = done;
    return row;
  }
  /** U40: delete; false when missing or someone else's. */
  async deleteKitReminder(id: string, userId: string): Promise<boolean> {
    const row = this.kitReminders.get(id);
    if (!row || row.user_id !== userId) return false;
    this.kitReminders.delete(id);
    return true;
  }

  /** U42: log one product usage. */
  async logKitUsage(u: { user_id: string; kit_id?: string | null; note?: string | null }): Promise<KitUsage> {
    const t = now();
    const row: KitUsage = {
      id: randomUUID(), user_id: u.user_id, kit_id: u.kit_id ?? null,
      used_at: t, note: u.note ?? null, created_at: t,
    };
    this.kitUsages.set(row.id, row);
    return row;
  }
  /** U42: recent usage rows, newest first. */
  async listKitUsages(userId: string, limit: number): Promise<KitUsage[]> {
    return [...this.kitUsages.values()]
      .filter((u) => u.user_id === userId)
      .sort((a, b) => b.used_at.localeCompare(a.used_at))
      .slice(0, Math.max(1, limit));
  }

  /** U31: consecutive check-in days ending today, or yesterday when the
   * user hasn't checked in today yet. Server-local calendar days. */
  async getStreak(userId: string): Promise<{ days: number }> {
    const days = new Set<string>();
    for (const c of this.checkins.values()) {
      if (c.user_id !== userId) continue;
      days.add(dayKey(new Date(Date.parse(c.created_at))));
    }
    return { days: streakFromDays(days) };
  }

  /** U32: referral history. There is NO referrals table: U4 derives the code
   * deterministically from the user id (see client Referral.tsx) and never
   * tracked joins, so `joined` is honestly empty. */
  async getReferralHistory(userId: string): Promise<{ code: string | null; joined: { user_id: string; at: string }[] }> {
    const user = this.users.get(userId);
    return {
      code: user ? `JARAA-${userId.slice(0, 6).toUpperCase()}` : null,
      joined: [],
    };
  }

  /** U41: kits whose latest order is 60+ days old (kit_id on orders). */
  async getReorderSuggestions(userId: string): Promise<{ kit_id: string; kit_name: string; ordered_at: string }[]> {
    const cutoff = Date.now() - 60 * 86_400_000;
    const latest = new Map<string, Order>();
    for (const o of this.orders.values()) {
      if (o.user_id !== userId || !o.kit_id) continue;
      const prev = latest.get(o.kit_id);
      if (!prev || o.created_at > prev.created_at) latest.set(o.kit_id, o);
    }
    const out: { kit_id: string; kit_name: string; ordered_at: string }[] = [];
    for (const [kitId, o] of latest) {
      if (Date.parse(o.created_at) < cutoff) {
        out.push({ kit_id: kitId, kit_name: this.kits.get(kitId)?.name_en ?? "Kit", ordered_at: o.created_at });
      }
    }
    return out.sort((a, b) => a.ordered_at.localeCompare(b.ordered_at));
  }

  /** U45: own sessions from refresh tokens. The full token hash is
   * credential material — expose only an 8-char fingerprint as `id`, and
   * the schema has no last_used_at column (always null, honestly). */
  async listOwnSessions(userId: string): Promise<{ id: string; created_at: string; last_used_at: string | null }[]> {
    return [...this.refreshTokens.values()]
      .filter((t) => t.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((t) => ({ id: t.token_hash.slice(0, 8), created_at: t.created_at, last_used_at: null }));
  }

// __B4_CUSTOMER_METHODS__

  /* ================= P-5..P-17 (v1.4 backend) ================= */
  // ---- P-5: returns + customer-visible refunds ----
  async createReturnRequest(r: { order_id: string; user_id: string; reason: string }): Promise<ReturnRequest> {
    const row: ReturnRequest = { id: randomUUID(), order_id: r.order_id, user_id: r.user_id, reason: r.reason, status: "requested", created_at: now(), decided_at: null, decided_by: null };
    this.returnRequests.set(row.id, row);
    return row;
  }
  async listReturnRequestsByUser(userId: string): Promise<ReturnRequest[]> {
    return [...this.returnRequests.values()]
      .filter((r) => r.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async listReturnRequests(status?: string): Promise<ReturnRequest[]> {
    return [...this.returnRequests.values()]
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async updateReturnRequest(id: string, patch: { status: ReturnRequest["status"]; decided_by?: string | null }): Promise<ReturnRequest | null> {
    const r = this.returnRequests.get(id); if (!r) return null;
    r.status = patch.status; r.decided_by = patch.decided_by ?? null; r.decided_at = now();
    return r;
  }
  async listRefundsByUser(userId: string): Promise<Refund[]> {
    return [...this.refunds.values()]
      .filter((r) => this.orders.get(r.order_id)?.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async updateRefundStatus(id: string, status: RefundStatus, decidedBy: string): Promise<Refund | null> {
    const r = this.refunds.get(id) as RefundRow | undefined;
    if (!r) return null;
    r.status = status; r.decided_by = decidedBy; r.decided_at = now();
    return r;
  }

  // ---- P-6: labs ----
  async createLabProvider(p: { name_en: string; name_ne?: string | null; note?: string | null }): Promise<LabProvider> {
    const row: LabProvider = { id: randomUUID(), name_en: p.name_en, name_ne: p.name_ne ?? null, is_active: true, note: p.note ?? null, created_at: now() };
    this.labProviders.set(row.id, row);
    return row;
  }
  async listLabProviders(): Promise<LabProvider[]> {
    return [...this.labProviders.values()].sort((a, b) => a.name_en.localeCompare(b.name_en));
  }
  async createLabTest(t: { provider_id?: string | null; name_en: string; name_ne?: string | null; description_en?: string | null; description_ne?: string | null; price_npr: number }): Promise<LabTest> {
    const row: LabTest = {
      id: randomUUID(), provider_id: t.provider_id ?? null, name_en: t.name_en,
      name_ne: t.name_ne ?? null, description_en: t.description_en ?? null,
      description_ne: t.description_ne ?? null, price_npr: t.price_npr,
      is_active: true, created_at: now(),
    };
    this.labTests.set(row.id, row);
    return row;
  }
  async listLabTests(activeOnly: boolean): Promise<LabTest[]> {
    return [...this.labTests.values()]
      .filter((t) => !activeOnly || t.is_active)
      .sort((a, b) => a.name_en.localeCompare(b.name_en));
  }
  async getLabTest(id: string): Promise<LabTest | null> { return this.labTests.get(id) ?? null; }
  async updateLabTest(id: string, patch: Partial<Pick<LabTest, "name_en" | "name_ne" | "description_en" | "description_ne" | "price_npr" | "is_active">>): Promise<LabTest | null> {
    const t = this.labTests.get(id); if (!t) return null;
    Object.assign(t, patch);
    return t;
  }
  async createLabBooking(b: { user_id: string; test_id: string; scheduled_on?: string | null; slot?: string | null; address: Record<string, unknown>; phone: string }): Promise<LabBooking> {
    const row: LabBooking = {
      id: randomUUID(), user_id: b.user_id, test_id: b.test_id,
      scheduled_on: b.scheduled_on ?? null, slot: b.slot ?? null,
      address: b.address, phone: b.phone, status: "booked",
      created_at: now(), updated_at: now(),
    };
    this.labBookings.set(row.id, row);
    return row;
  }
  async listLabBookingsByUser(userId: string): Promise<LabBooking[]> {
    return [...this.labBookings.values()]
      .filter((b) => b.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async listLabBookings(status?: string): Promise<LabBooking[]> {
    return [...this.labBookings.values()]
      .filter((b) => !status || b.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getLabBooking(id: string): Promise<LabBooking | null> { return this.labBookings.get(id) ?? null; }
  async updateLabBookingStatus(id: string, status: LabBookingStatus): Promise<LabBooking | null> {
    const b = this.labBookings.get(id); if (!b) return null;
    b.status = status; b.updated_at = now();
    return b;
  }
  async attachLabReport(bookingId: string, storagePath: string, uploadedBy: string | null): Promise<LabReport> {
    const row: LabReport = { id: randomUUID(), booking_id: bookingId, storage_path: storagePath, uploaded_by: uploadedBy, created_at: now() };
    this.labReports.set(row.id, row);
    const b = this.labBookings.get(bookingId);
    if (b) { b.status = "report_ready"; b.updated_at = now(); }
    return row;
  }
  async getLabReport(bookingId: string): Promise<LabReport | null> {
    for (const r of this.labReports.values()) if (r.booking_id === bookingId) return r;
    return null;
  }

  // ---- P-7: family profiles ----
  async createFamilyMember(m: { owner_id: string; name: string; relation?: string | null }): Promise<FamilyMember> {
    const row: FamilyMember = {
      id: randomUUID(), owner_id: m.owner_id, member_user_id: null,
      name: m.name, relation: m.relation ?? null,
      status: "invited", invite_token: randomUUID().replace(/-/g, ""),
      data_shared: false, created_at: now(),
    };
    this.familyMembers.set(row.id, row);
    return row;
  }
  async listFamilyMembers(ownerId: string): Promise<FamilyMember[]> {
    return [...this.familyMembers.values()]
      .filter((m) => m.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getFamilyMember(id: string): Promise<FamilyMember | null> { return this.familyMembers.get(id) ?? null; }
  async getFamilyMemberByToken(token: string): Promise<FamilyMember | null> {
    for (const m of this.familyMembers.values()) if (m.invite_token === token) return m;
    return null;
  }
  async acceptFamilyInvite(token: string, memberUserId: string): Promise<FamilyMember | null> {
    for (const m of this.familyMembers.values()) {
      if (m.invite_token === token) {
        if (m.status !== "invited") return null;
        m.member_user_id = memberUserId; m.status = "active"; m.invite_token = null;
        return m;
      }
    }
    return null;
  }
  async setFamilyMemberShare(id: string, shared: boolean): Promise<FamilyMember | null> {
    const m = this.familyMembers.get(id); if (!m) return null;
    m.data_shared = shared;
    return m;
  }
  async removeFamilyMember(id: string): Promise<boolean> { return this.familyMembers.delete(id); }

  // ---- P-8: idempotency + sync ----
  async getIdempotencyRecord(key: string, userId: string, scope: string): Promise<IdempotencyRecord | null> {
    const r = this.idempotencyRecords.get(key);
    if (!r || r.user_id !== userId || r.scope !== scope) return null;
    return r;
  }
  async saveIdempotencyRecord(r: { key: string; user_id: string; scope: string; response: unknown }): Promise<void> {
    this.idempotencyRecords.set(r.key, { key: r.key, user_id: r.user_id, scope: r.scope, response: r.response, created_at: now() });
  }

  // ---- P-9: AI assistant (education-only) ----
  async createAiConversation(userId: string): Promise<AiConversation> {
    const row: AiConversation = { id: randomUUID(), user_id: userId, created_at: now() };
    this.aiConversations.set(row.id, row);
    return row;
  }
  async listAiConversations(userId: string): Promise<AiConversation[]> {
    return [...this.aiConversations.values()]
      .filter((c) => c.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addAiMessage(conversationId: string, role: "user" | "assistant", body: string, redFlagged?: boolean): Promise<AiMessage> {
    const row: AiMessage = { id: randomUUID(), conversation_id: conversationId, role, body, red_flagged: redFlagged ?? false, created_at: now() };
    this.aiMessages.set(row.id, row);
    return row;
  }
  async listAiMessages(conversationId: string): Promise<AiMessage[]> {
    return [...this.aiMessages.values()]
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ---- P-10/P-11: content ----
  async listPublishedArticles(category?: string): Promise<EducationArticle[]> {
    return [...this.articles.values()]
      .filter((a) => a.is_published && (!category || (a as ArticleRow).category === category))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async recordArticleView(articleId: string, userId: string): Promise<void> {
    const key = `${articleId}:${userId}`;
    if (this.articleViews.has(key)) return; // unique (article_id, user_id) — silently ignore duplicates
    this.articleViews.set(key, { id: randomUUID(), article_id: articleId, user_id: userId, created_at: now() });
  }
  async getArticleViewCount(articleId: string): Promise<number> {
    let n = 0;
    for (const v of this.articleViews.values()) if (v.article_id === articleId) n++;
    return n;
  }

  // ---- P-12: community Q&A ----
  async createQaQuestion(userId: string, title: string, body: string): Promise<QaQuestion> {
    const row: QaQuestion = { id: randomUUID(), user_id: userId, title, body, status: "open", created_at: now(), updated_at: now() };
    this.qaQuestions.set(row.id, row);
    return row;
  }
  async listQaQuestions(opts: { status?: string; limit: number; offset: number }): Promise<{ questions: QaQuestion[]; total: number }> {
    const all = [...this.qaQuestions.values()]
      .filter((q) => !opts.status || q.status === opts.status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { questions: all.slice(opts.offset, opts.offset + opts.limit), total: all.length };
  }
  async getQaQuestion(id: string): Promise<QaQuestion | null> { return this.qaQuestions.get(id) ?? null; }
  async updateQaQuestionStatus(id: string, status: QaQuestionStatus): Promise<QaQuestion | null> {
    const q = this.qaQuestions.get(id); if (!q) return null;
    q.status = status; q.updated_at = now();
    return q;
  }
  async createQaAnswer(questionId: string, doctorId: string, body: string): Promise<QaAnswer> {
    const row: QaAnswer = { id: randomUUID(), question_id: questionId, doctor_id: doctorId, body, agree_count: 0, helpful_count: 0, created_at: now(), updated_at: now() };
    this.qaAnswers.set(row.id, row);
    return row;
  }
  /** Computed counts: agree_count = qa_answer_agrees rows for the answer;
   * helpful_count = qa_helpfulness rows with helpful=true. Returned as fresh
   * objects — the stored rows keep their creation-time zeros. */
  async listQaAnswers(questionId: string): Promise<QaAnswer[]> {
    const agrees = new Map<string, number>();
    for (const a of this.qaAnswerAgrees.values()) {
      agrees.set(a.answer_id, (agrees.get(a.answer_id) ?? 0) + 1);
    }
    const helpful = new Map<string, number>();
    for (const h of this.qaHelpfulness.values()) {
      if (h.helpful) helpful.set(h.answer_id, (helpful.get(h.answer_id) ?? 0) + 1);
    }
    return [...this.qaAnswers.values()]
      .filter((a) => a.question_id === questionId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({ ...a, agree_count: agrees.get(a.id) ?? 0, helpful_count: helpful.get(a.id) ?? 0 }));
  }
  async agreeQaAnswer(answerId: string, doctorId: string): Promise<boolean> {
    const key = `${answerId}:${doctorId}`;
    if (this.qaAnswerAgrees.has(key)) return false;
    this.qaAnswerAgrees.set(key, { answer_id: answerId, doctor_id: doctorId, created_at: now() });
    return true;
  }
  async setQaHelpful(answerId: string, userId: string, helpful: boolean): Promise<void> {
    const key = `${answerId}:${userId}`;
    const prev = this.qaHelpfulness.get(key);
    this.qaHelpfulness.set(key, { answer_id: answerId, user_id: userId, helpful, created_at: prev?.created_at ?? now() });
  }
  async flagQaContent(f: { question_id?: string | null; answer_id?: string | null; user_id: string; reason: string }): Promise<QaFlag> {
    const row: QaFlag = { id: randomUUID(), question_id: f.question_id ?? null, answer_id: f.answer_id ?? null, user_id: f.user_id, reason: f.reason, created_at: now() };
    this.qaFlags.set(row.id, row);
    return row;
  }
  async listQaFlags(): Promise<QaFlag[]> {
    return [...this.qaFlags.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ---- P-13: referrals + coins ----
  async getOrCreateReferralCode(userId: string): Promise<ReferralCode> {
    const existing = this.referralCodesByUser.get(userId);
    if (existing) return existing;
    const code = "JARAA-" + randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    const row: ReferralCode = { id: randomUUID(), user_id: userId, code, created_at: now() };
    this.referralCodes.set(row.id, row);
    this.referralCodesByUser.set(userId, row);
    return row;
  }
  async getReferralCode(code: string): Promise<ReferralCode | null> {
    for (const c of this.referralCodes.values()) if (c.code === code) return c;
    return null;
  }
  async applyReferralCode(referredId: string, code: string): Promise<Referral> {
    for (const r of this.referrals.values()) {
      if (r.referred_id === referredId) return r; // one referral per referred user
    }
    const rc = await this.getReferralCode(code);
    if (!rc) throw new Error(`referral code not found: ${code}`);
    if (rc.user_id === referredId) throw new Error("cannot apply your own referral code");
    const row: Referral = { id: randomUUID(), referrer_id: rc.user_id, referred_id: referredId, code, status: "pending", completed_at: null, created_at: now() };
    this.referrals.set(row.id, row);
    return row;
  }
  async completeReferralForUser(referredId: string): Promise<Referral | null> {
    for (const r of this.referrals.values()) {
      if (r.referred_id === referredId && r.status === "pending") {
        r.status = "completed"; r.completed_at = now();
        return r;
      }
    }
    return null;
  }
  async grantCoins(userId: string, amount: number, reason: string, refType?: string | null, refId?: string | null): Promise<CoinLedgerEntry> {
    const row: CoinLedgerEntry = { id: randomUUID(), user_id: userId, amount, reason, ref_type: refType ?? null, ref_id: refId ?? null, created_at: now() };
    this.coinLedger.push(row);
    return row;
  }
  async getCoinBalance(userId: string): Promise<number> {
    return this.coinLedger.filter((e) => e.user_id === userId).reduce((s, e) => s + e.amount, 0);
  }
  async listCoinLedger(userId: string, limit: number): Promise<CoinLedgerEntry[]> {
    return this.coinLedger
      .filter((e) => e.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  // ---- P-14: wallet ----
  async getOrCreateWallet(userId: string): Promise<Wallet> {
    const w = this.wallets.get(userId);
    if (w) return w;
    const row: Wallet = { id: randomUUID(), user_id: userId, balance_npr: 0, updated_at: now() };
    this.wallets.set(userId, row);
    return row;
  }
  async addWalletTxn(userId: string, amountNpr: number, kind: WalletTxnKind, ref?: string | null): Promise<WalletTxn> {
    const w = await this.getOrCreateWallet(userId);
    w.balance_npr += amountNpr; w.updated_at = now();
    const txn: WalletTxn = { id: randomUUID(), wallet_id: w.id, amount_npr: amountNpr, kind, ref: ref ?? null, created_at: now() };
    this.walletTxns.set(txn.id, txn);
    return txn;
  }
  async listWalletTxns(userId: string, limit: number): Promise<WalletTxn[]> {
    const w = this.wallets.get(userId);
    if (!w) return [];
    return [...this.walletTxns.values()]
      .filter((t) => t.wallet_id === w.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  // ---- P-15: shipment tracking ----
  async addShipmentEvent(orderId: string, e: { event_type: ShipmentEventType; label_en?: string | null; label_ne?: string | null; location?: string | null }): Promise<ShipmentEvent> {
    const row: ShipmentEvent = { id: randomUUID(), order_id: orderId, event_type: e.event_type, label_en: e.label_en ?? null, label_ne: e.label_ne ?? null, location: e.location ?? null, created_at: now() };
    this.shipmentEvents.set(row.id, row);
    return row;
  }
  async listShipmentEvents(orderId: string): Promise<ShipmentEvent[]> {
    return [...this.shipmentEvents.values()]
      .filter((e) => e.order_id === orderId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // ---- P-16: nutrition ----
  async searchFoods(q: string, limit: number): Promise<Food[]> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return [...this.foods.values()]
      .filter((f) => `${f.name_en} ${f.name_ne ?? ""} ${f.name_ro ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name_en.localeCompare(b.name_en))
      .slice(0, limit);
  }
  async createDietPlan(p: { title_en: string; title_ne?: string | null; title_ro?: string | null; description_en?: string | null; description_ne?: string | null; protein_target_g?: number | null; items?: unknown[]; created_by?: string | null }): Promise<DietPlan> {
    const row: DietPlan = {
      id: randomUUID(), title_en: p.title_en, title_ne: p.title_ne ?? null,
      title_ro: p.title_ro ?? null, description_en: p.description_en ?? null,
      description_ne: p.description_ne ?? null, protein_target_g: p.protein_target_g ?? null,
      items: p.items ?? [], is_active: true, created_by: p.created_by ?? null,
      created_at: now(),
    };
    this.dietPlans.set(row.id, row);
    return row;
  }
  async listDietPlans(activeOnly: boolean): Promise<DietPlan[]> {
    return [...this.dietPlans.values()]
      .filter((p) => !activeOnly || p.is_active)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getDietPlan(id: string): Promise<DietPlan | null> { return this.dietPlans.get(id) ?? null; }
  async updateDietPlan(id: string, patch: Partial<Pick<DietPlan, "title_en" | "title_ne" | "title_ro" | "description_en" | "description_ne" | "protein_target_g" | "items" | "is_active">>): Promise<DietPlan | null> {
    const p = this.dietPlans.get(id); if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  async assignDietPlan(planId: string, userId: string, assignedBy: string | null, startsOn?: string | null): Promise<DietAssignment> {
    const row: DietAssignment = { id: randomUUID(), plan_id: planId, user_id: userId, assigned_by: assignedBy, starts_on: startsOn ?? null, created_at: now() };
    this.dietAssignments.set(row.id, row);
    return row;
  }
  async getDietAssignment(userId: string): Promise<(DietAssignment & { plan: DietPlan | null }) | null> {
    const rows = [...this.dietAssignments.values()]
      .filter((a) => a.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const a = rows[0];
    if (!a) return null;
    return { ...a, plan: this.dietPlans.get(a.plan_id) ?? null };
  }
  async logHabit(userId: string, logDate: string, habitKey: string, done: boolean, note?: string | null): Promise<HabitLog> {
    const key = `${userId}:${logDate}:${habitKey}`;
    const prev = this.habitLogs.get(key);
    if (prev) { prev.done = done; prev.note = note ?? null; return prev; }
    const row: HabitLog = { id: randomUUID(), user_id: userId, log_date: logDate, habit_key: habitKey, done, note: note ?? null, created_at: now() };
    this.habitLogs.set(key, row);
    return row;
  }
  async listHabitLogs(userId: string, from: string, to: string): Promise<HabitLog[]> {
    return [...this.habitLogs.values()]
      .filter((h) => h.user_id === userId && h.log_date >= from && h.log_date <= to)
      .sort((a, b) => a.log_date.localeCompare(b.log_date) || a.habit_key.localeCompare(b.habit_key));
  }

  // ---- P-17: milestones + coach messaging ----
  async createMilestone(m: { title_en: string; title_ne?: string | null; title_ro?: string | null; description_en?: string | null; description_ne?: string | null; kind?: string; threshold?: number | null; created_by?: string | null }): Promise<Milestone> {
    const row: Milestone = {
      id: randomUUID(), title_en: m.title_en, title_ne: m.title_ne ?? null,
      title_ro: m.title_ro ?? null, description_en: m.description_en ?? null,
      description_ne: m.description_ne ?? null, kind: m.kind ?? "general",
      threshold: m.threshold ?? null, is_active: true,
      created_by: m.created_by ?? null, created_at: now(),
    };
    this.milestones.set(row.id, row);
    return row;
  }
  async listMilestones(activeOnly: boolean): Promise<Milestone[]> {
    return [...this.milestones.values()]
      .filter((m) => !activeOnly || m.is_active)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async awardMilestone(milestoneId: string, userId: string): Promise<UserMilestone | null> {
    const key = `${milestoneId}:${userId}`;
    if (this.userMilestones.has(key)) return null;
    const row: UserMilestone = { id: randomUUID(), milestone_id: milestoneId, user_id: userId, achieved_at: now() };
    this.userMilestones.set(key, row);
    return row;
  }
  async listUserMilestones(userId: string): Promise<(UserMilestone & { milestone: Milestone | null })[]> {
    return [...this.userMilestones.values()]
      .filter((u) => u.user_id === userId)
      .sort((a, b) => b.achieved_at.localeCompare(a.achieved_at))
      .map((u) => ({ ...u, milestone: this.milestones.get(u.milestone_id) ?? null }));
  }
  async getOrCreateCoachThread(customerId: string): Promise<CoachThread> {
    for (const t of this.coachThreads.values()) if (t.customer_id === customerId) return t;
    const row: CoachThread = { id: randomUUID(), customer_id: customerId, coach_id: null, created_at: now() };
    this.coachThreads.set(row.id, row);
    return row;
  }
  async listCoachThreads(coachId: string): Promise<(CoachThread & { customer_name: string | null })[]> {
    return [...this.coachThreads.values()]
      .filter((t) => t.coach_id === coachId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((t) => ({ ...t, customer_name: this.profiles.get(t.customer_id)?.name ?? null }));
  }
  async sendCoachMessage(threadId: string, senderId: string, senderRole: string, body: string, clientMessageId?: string | null): Promise<CoachMessage> {
    if (clientMessageId) {
      for (const m of this.coachMessages.values()) {
        if (m.thread_id === threadId && m.client_message_id === clientMessageId) return m; // idempotent
      }
    }
    const row: CoachMessage = { id: randomUUID(), thread_id: threadId, sender_id: senderId, sender_role: senderRole, body, client_message_id: clientMessageId ?? null, created_at: now() };
    this.coachMessages.set(row.id, row);
    return row;
  }
  async listCoachMessages(threadId: string): Promise<CoachMessage[]> {
    return [...this.coachMessages.values()]
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}
