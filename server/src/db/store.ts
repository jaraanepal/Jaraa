// The single data-access seam. Routes depend on this interface; memory.ts and
// supabase.ts implement it. Tests run against the in-memory implementation.
import type {
  Announcement, RolePermission, LoginAttempt, Coupon, CouponKind, BackupRecord,
  ArticleAssignment, SymptomEntry, WaterLog, SleepLog, NotificationPrefs, EmergencyContact,
  CaseMessage,
  ChallengeGroup, Badge, SessionSummary, CustomerGoal, HabitTemplate, NoteTemplate,
  CoachAvailability,
  CoachNote, Escalation, EscalationStatus, ScheduledNudge, SatisfactionRating, WishlistItem,
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
  PlanTemplate,
  Product, Kit, Order, Payment, Consult, Checkin, FeatureFlag, AuditEntry,
  QuarantineEntry,
  RefreshToken, DeletionRequest, AnalyticsSnapshot, PasswordResetRow, AppNotification,
  ReviewRequest,
  RootScoreRow, RedFlag, ScanRule, Case, Annotation, Plan, PlanItemInput,
  RoutineItem,
  SecondOpinion,
  StaffChecklist,
  StaffVerificationStatus, SupportTicket, TicketReply, TicketStatus, EducationArticle,
  TriagePreset,
  CaseComment, CaseConcernTag, QueueFilter, SimilarCase,
  DashboardConfig, EmailLog, AdminNotice, ConsentVersion,
  DeliveryAttempt, StockCount, Substitution, DeliveryProof, RefundRequest, DispatchHoliday, CourierClaim, ExpiringBatch,
  CoachFeedback, StreakFreeze, CustomerTag, CoachHandover, CoachTip, ChallengeSurvey, JourneyStage,
  AppFeedback, KitReminder, KitUsage,
  User, Role, Profile, Consent, OtpRow, Scan, TimelineEvent, Photo, PhotoAngle,
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
  createPlan(p: { case_id: string; doctor_id: string; review_notes?: string | null; rescan_due_on?: string | null; items: PlanItemInput[]; resolved_flag_ids?: string[]; resolved_flag_notes?: Record<string, string> | null }): Promise<Plan>;
  getPlan(id: string): Promise<Plan | null>;
  getLatestApprovedPlanForUser(userId: string): Promise<Plan | null>;
  approvePlan(id: string, approverId: string): Promise<{ plan: Plan | null; reason?: string }>;
  // catalog
  createProduct(p: { name_en: string; name_ne?: string | null; kind: "cosmetic" | "prescription"; price_npr: number; image_url?: string | null; is_active?: boolean }): Promise<Product>;
  createKit(k: {
    name_en: string; name_ne?: string | null; product_ids: string[]; total_npr: number;
    is_active?: boolean; category?: string | null; images?: string[];
    whats_included?: string | null; usage_instructions?: string | null; stock?: number;
  }): Promise<Kit>;
  listProducts(opts: { activeOnly: boolean; cosmeticOnly: boolean }): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  listKits(activeOnly: boolean): Promise<Kit[]>;
  getKit(id: string): Promise<Kit | null>;
  updateKit(id: string, patch: Partial<Kit>): Promise<Kit | null>;
  /** Admin kit list: search + filters + pagination. Ordered newest-first. */
  listKitsAdmin(opts: {
    search?: string; category?: string; isActive?: boolean; limit: number; offset: number;
  }): Promise<{ kits: Kit[]; total: number }>;
  // orders
  createOrder(o: { order_no: string; user_id: string; kit_id: string | null; subtotal_npr: number; shipping_npr: number; total_npr: number; payment_method: string; idempotency_key: string; shipping_address: Record<string, unknown>; delivery_instructions?: string | null; coupon_code?: string | null; discount_npr?: number }): Promise<Order>;
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
  addAudit(a: { actor_id?: string | null; action: string; entity: string; entity_id?: string | null; ip?: string | null; detail?: string | null }): Promise<AuditEntry>;
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
  // notifications (P-6)
  createNotification(n: { user_id: string; type: string; title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null }): Promise<AppNotification>;
  listNotifications(userId: string, opts: { limit: number; offset: number }): Promise<{ notifications: AppNotification[]; unreadCount: number }>;
  markNotificationRead(id: string, userId: string): Promise<AppNotification | null>;
  // analytics
  analyticsSnapshot(): Promise<AnalyticsSnapshot>;

  // ---------------- P-12 dashboard features (007) ----------------
  // doctor
  /** All cases for one patient (scan.user_id), newest first — D3 timeline + D5 trend. */
  listCasesByUser(userId: string): Promise<Case[]>;
  /** Patient search by phone or profile name (case-insensitive substring) — D7. */
  searchPatients(q: string): Promise<{ user: User; profile: Profile | null }[]>;
  /** Bulk priority change on queue cases — D8. Returns updated count. */
  bulkUpdateCasePriority(ids: string[], priority: number): Promise<number>;
  /** All cases past SLA (queued/in_review) across doctors — A4. */
  listOverdueCases(): Promise<Case[]>;
  // doctor follow-ups (D6)
  createFollowUp(f: { case_id: string; doctor_id: string; due_on: string; note?: string | null }): Promise<FollowUp>;
  listFollowUps(doctorId: string, opts?: { dueOnly?: boolean }): Promise<FollowUp[]>;
  completeFollowUp(id: string, doctorId: string): Promise<FollowUp | null>;
  // doctor availability (D9)
  setDoctorAvailability(doctorId: string, status: DoctorAvailabilityStatus, note?: string | null): Promise<DoctorAvailability>;
  getDoctorAvailability(doctorId: string): Promise<DoctorAvailability | null>;
  listDoctorAvailability(): Promise<(DoctorAvailability & { name: string | null; phone: string })[]>;
  // admin: orders + finance (A3, A6, A9)
  listAllOrders(): Promise<Order[]>;
  createRefund(r: { order_id: string; amount_npr: number; reason?: string | null; created_by: string }): Promise<Refund>;
  listRefunds(): Promise<Refund[]>;
  // admin: staff verification (A5)
  upsertStaffVerification(userId: string, requestedRole: string): Promise<StaffVerification>;
  listStaffVerifications(status?: StaffVerificationStatus): Promise<StaffVerification[]>;
  decideStaffVerification(id: string, approved: boolean, decidedBy: string, note?: string | null): Promise<StaffVerification | null>;
  // admin/customer: support tickets (A7)
  createTicket(t: { user_id: string; subject: string; body: string }): Promise<SupportTicket>;
  listTickets(opts: { user_id?: string; status?: TicketStatus }): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  addTicketReply(ticketId: string, authorId: string, authorRole: string, body: string): Promise<TicketReply>;
  listTicketReplies(ticketId: string): Promise<TicketReply[]>;
  updateTicketStatus(id: string, status: TicketStatus): Promise<SupportTicket | null>;
  // admin/coach: education articles (A8, C9)
  createArticle(a: { title_en: string; title_ne?: string | null; body_en: string; body_ne?: string | null; is_published?: boolean; created_by: string | null }): Promise<EducationArticle>;
  listArticles(publishedOnly: boolean): Promise<EducationArticle[]>;
  getArticle(id: string): Promise<EducationArticle | null>;
  updateArticle(id: string, patch: Partial<Pick<EducationArticle, "title_en" | "title_ne" | "body_en" | "body_ne" | "is_published">>): Promise<EducationArticle | null>;
  deleteArticle(id: string): Promise<void>;
  // pharmacy (P2, P4–P8)
  adjustKitStock(kitId: string, delta: number): Promise<Kit | null>;
  setOrderCourier(orderId: string, courierName: string | null, trackingId: string | null): Promise<Order | null>;
  addOrderCheck(orderId: string, checkType: OrderCheckType, checkedBy: string): Promise<OrderCheck>;
  listOrderChecks(orderId: string): Promise<OrderCheck[]>;
  addDamageReport(orderId: string, reporterId: string, description: string): Promise<DamageReport>;
  listDamageReports(orderId?: string): Promise<DamageReport[]>;
  addHandoverNote(orderId: string, authorId: string, note: string): Promise<HandoverNote>;
  listHandoverNotes(orderId: string): Promise<HandoverNote[]>;
  // coach (C4–C8)
  createChallenge(c: { title_en: string; title_ne?: string | null; days: 7 | 14 | 30; description_en?: string | null; description_ne?: string | null; created_by: string | null }): Promise<Challenge>;
  listChallenges(): Promise<Challenge[]>;
  assignChallenge(challengeId: string, userId: string): Promise<ChallengeAssignment>;
  listChallengeAssignments(userId: string): Promise<(ChallengeAssignment & { challenge: Challenge | null })[]>;
  completeChallengeAssignment(id: string, userId: string): Promise<ChallengeAssignment | null>;
  addCoachNote(coachId: string, customerId: string, note: string): Promise<CoachNote>;
  listCoachNotes(customerId: string): Promise<CoachNote[]>;
  createEscalation(customerId: string, coachId: string, reason: string): Promise<Escalation>;
  listEscalations(status?: EscalationStatus): Promise<Escalation[]>;
  updateEscalationStatus(id: string, status: EscalationStatus): Promise<Escalation | null>;
  scheduleNudge(n: { coach_id: string; user_id: string; message_en: string; message_ne?: string | null; send_at: string }): Promise<ScheduledNudge>;
  listScheduledNudges(coachId: string): Promise<ScheduledNudge[]>;
  markNudgeSent(id: string): Promise<ScheduledNudge | null>;
  deleteScheduledNudge(id: string, coachId: string): Promise<boolean>;
  addSatisfactionRating(customerId: string, coachId: string, rating: number, comment?: string | null): Promise<SatisfactionRating>;
  listSatisfactionRatings(customerId: string): Promise<SatisfactionRating[]>;
  // customer wishlist (U6)
  addToWishlist(userId: string, kitId: string): Promise<WishlistItem>;
  removeFromWishlist(userId: string, kitId: string): Promise<boolean>;
  listWishlist(userId: string): Promise<(WishlistItem & { kit: Kit | null })[]>;

  /* ---------------- Batch 2 (008) ---------------- */
  // doctor (D10–D18)
  doctorWorkload(doctorId: string): Promise<{ claimed: number; in_review: number; due_soon: number; overdue: number }>;
  doctorSlaSummary(doctorId: string): Promise<{ overdue: number; due_6h: number }>;
  createSnippet(doctorId: string, s: { title: string; body_en: string; body_ne?: string | null }): Promise<DoctorSnippet>;
  listSnippets(doctorId: string): Promise<DoctorSnippet[]>;
  deleteSnippet(id: string, doctorId: string): Promise<boolean>;
  bookmarkCase(caseId: string, doctorId: string): Promise<CaseBookmark>;
  unbookmarkCase(caseId: string, doctorId: string): Promise<boolean>;
  listBookmarks(doctorId: string): Promise<string[]>;
  getChecklist(caseId: string, doctorId: string): Promise<ReviewChecklist | null>;
  createChecklist(caseId: string, doctorId: string, items: { label_en: string; label_ne?: string | null }[]): Promise<ReviewChecklist>;
  setChecklistItemDone(itemId: string, doctorId: string, done: boolean): Promise<ReviewChecklistItem | null>;
  patientRisk(userId: string): Promise<{ level: "low" | "medium" | "high"; red_flag_cases: number; missed_rescans: number }>;
  createPhotoRequest(caseId: string, doctorId: string, angles: string, note?: string | null): Promise<PhotoRequest>;
  listPhotoRequests(caseId: string): Promise<PhotoRequest[]>;
  doctorReviewStats(doctorId: string): Promise<{ reviewed_7d: number; reviewed_30d: number; avg_review_hours: number | null }>;
  searchDoctorNotes(doctorId: string, q: string): Promise<{ case_id: string; snippet: string; created_at: string }[]>;
  // admin (A12–A20)
  getRolePermissions(role: string): Promise<RolePermission[]>;
  setRolePermission(role: string, permission: string, granted: boolean, updatedBy: string | null): Promise<RolePermission>;
  createAnnouncement(a: { title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null; starts_at?: string | null; ends_at?: string | null; created_by?: string | null }): Promise<Announcement>;
  listAnnouncements(activeOnly: boolean): Promise<Announcement[]>;
  updateAnnouncement(id: string, patch: Partial<Announcement>): Promise<Announcement | null>;
  deleteAnnouncement(id: string): Promise<boolean>;
  listRefreshSessions(userId: string): Promise<{ token_hash: string; user_id: string; expires_at: string; created_at: string }[]>;
  revokeRefreshSession(tokenHash: string): Promise<boolean>;
  logLoginAttempt(a: { phone?: string | null; email?: string | null; success: boolean; ip?: string | null; user_agent?: string | null }): Promise<LoginAttempt>;
  listLoginAttempts(limit: number): Promise<LoginAttempt[]>;
  createCoupon(c: { code: string; kind: CouponKind; value: number; max_uses?: number | null; min_order_npr?: number; starts_at?: string | null; ends_at?: string | null; created_by?: string | null }): Promise<Coupon>;
  listCoupons(): Promise<Coupon[]>;
  updateCoupon(id: string, patch: { is_active?: boolean }): Promise<Coupon | null>;
  getCouponByCode(code: string): Promise<Coupon | null>;
  incrementCouponUses(id: string): Promise<Coupon | null>;
  recordBackup(b: { label: string; status?: "ok" | "failed" | "running"; size_bytes?: number | null; note?: string | null; recorded_by?: string | null }): Promise<BackupRecord>;
  listBackups(limit: number): Promise<BackupRecord[]>;
  createNotificationTemplate(t: { name: string; title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null; created_by?: string | null }): Promise<NotificationTemplate>;
  listNotificationTemplates(): Promise<NotificationTemplate[]>;
  deleteNotificationTemplate(id: string): Promise<boolean>;
  // pharmacy (P10–P18)
  logStockMovement(kitId: string, delta: number, reason: string | null, actorId: string | null): Promise<StockMovement>;
  listStockMovements(kitId: string, limit: number): Promise<StockMovement[]>;
  // pharmacy P11–P18
  reorderSuggestions(): Promise<{ kit: Kit; threshold: number }[]>;
  getPackingChecks(orderId: string): Promise<PackingCheck[]>;
  setPackingCheck(orderId: string, step: string, done: boolean, checkedBy: string | null): Promise<PackingCheck>;
  orderLabel(orderId: string): Promise<{ order: Order; items: { kit_id: string; name: string; qty: number }[] } | null>;
  zoneStats(): Promise<{ zone: string; orders: number; delivered: number }[]>;
  duplicateOrders(): Promise<Order[]>;
  listKitBatches(kitId?: string): Promise<(KitBatch & { kit_name?: string })[]>;
  createKitBatch(kitId: string, b: { batch_no: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }): Promise<KitBatch>;
  deleteKitBatch(id: string): Promise<boolean>;
  updateKitBatch(id: string, b: { batch_no?: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }): Promise<KitBatch | null>;
  listSuppliers(): Promise<Supplier[]>;
  createSupplier(s: { name: string; contact?: string | null; phone?: string | null; address?: string | null; note?: string | null }): Promise<Supplier>;
  updateSupplier(id: string, patch: Partial<Supplier>): Promise<Supplier | null>;
  deleteSupplier(id: string): Promise<boolean>;
  reorderSuggestions(): Promise<{ kit: Kit; threshold: number }[]>;
  getPackingChecks(orderId: string): Promise<PackingCheck[]>;
  setPackingCheck(orderId: string, step: string, done: boolean, checkedBy: string | null): Promise<PackingCheck>;
  orderLabel(orderId: string): Promise<{ order: Order; items: { kit_id: string | null; name: string; qty: number }[] } | null>;
  zoneStats(): Promise<{ zone: string; orders: number; delivered: number }[]>;
  duplicateOrders(): Promise<Order[]>;
  createKitBatch(kitId: string, b: { batch_no: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }): Promise<KitBatch>;
  listKitBatches(kitId?: string): Promise<(KitBatch & { kit_name?: string })[]>;
  deleteKitBatch(id: string): Promise<boolean>;
  createSupplier(s: { name: string; contact?: string | null; phone?: string | null; address?: string | null; note?: string | null }): Promise<Supplier>;
  listSuppliers(): Promise<Supplier[]>;
  updateSupplier(id: string, patch: Partial<Supplier>): Promise<Supplier | null>;
  deleteSupplier(id: string): Promise<boolean>;
  // coach (C10–C18)
  createChallengeGroup(g: { title_en: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null; starts_on?: string | null; ends_on?: string | null; created_by?: string | null }): Promise<ChallengeGroup>;
  listChallengeGroups(): Promise<ChallengeGroup[]>;
  addChallengeGroupMember(groupId: string, userId: string): Promise<boolean>;
  listChallengeGroupMembers(groupId: string): Promise<string[]>;
  awardBadge(userId: string, badge: string, awardedBy: string | null): Promise<Badge>;
  listBadges(userId: string): Promise<Badge[]>;
  addSessionSummary(coachId: string, customerId: string, summary: string): Promise<SessionSummary>;
  listSessionSummaries(customerId: string): Promise<SessionSummary[]>;
  createCustomerGoal(coachId: string, customerId: string, g: { title_en: string; title_ne?: string | null; target_date?: string | null }): Promise<CustomerGoal>;
  listCustomerGoals(customerId: string): Promise<CustomerGoal[]>;
  completeCustomerGoal(id: string, coachId: string): Promise<CustomerGoal | null>;
  deleteCustomerGoal(id: string, coachId: string): Promise<boolean>;
  createHabitTemplate(t: { title_en: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null; created_by?: string | null }): Promise<HabitTemplate>;
  listHabitTemplates(): Promise<HabitTemplate[]>;
  deleteHabitTemplate(id: string): Promise<boolean>;
  updateHabitTemplate(id: string, t: { title_en?: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null }): Promise<HabitTemplate | null>;
  createNoteTemplate(coachId: string | null, t: { title: string; body_en: string; body_ne?: string | null }): Promise<NoteTemplate>;
  listNoteTemplates(coachId: string): Promise<NoteTemplate[]>;
  deleteNoteTemplate(id: string, coachId: string): Promise<boolean>;
  updateNoteTemplate(id: string, coachId: string, t: { title?: string; body_en?: string; body_ne?: string | null }): Promise<NoteTemplate | null>;
  assignArticle(articleId: string, userId: string, assignedBy: string | null): Promise<ArticleAssignment>;
  listArticleAssignments(userId: string): Promise<ArticleAssignment[]>;
  coachRiskFlags(): Promise<{ user_id: string; name: string | null; missed_checkins: number }[]>;
  // customer (U12–U20)
  planHistory(userId: string): Promise<Plan[]>;
  upsertSymptomEntry(userId: string, entryDate: string, note: string): Promise<SymptomEntry>;
  listSymptomEntries(userId: string, limit: number): Promise<SymptomEntry[]>;
  deleteSymptomEntry(id: string, userId: string): Promise<boolean>;
  setWaterLog(userId: string, logDate: string, glasses: number): Promise<WaterLog>;
  getWaterLog(userId: string, logDate: string): Promise<WaterLog | null>;
  upsertSleepLog(userId: string, logDate: string, s: { bedtime?: string | null; wake_time?: string | null; quality?: number | null }): Promise<SleepLog>;
  listSleepLogs(userId: string, limit: number): Promise<SleepLog[]>;
  deleteSleepLog(id: string, userId: string): Promise<boolean>;
  getNotificationPrefs(userId: string): Promise<NotificationPrefs>;
  setNotificationPrefs(userId: string, p: Partial<NotificationPrefs>): Promise<NotificationPrefs>;
  createEmergencyContact(userId: string, c: { name: string; phone: string; relation?: string | null }): Promise<EmergencyContact>;
  listEmergencyContacts(userId: string): Promise<EmergencyContact[]>;
  deleteEmergencyContact(id: string, userId: string): Promise<boolean>;
  // admin storage usage (A18): tracked file counts per bucket
  storageUsage(): Promise<{ bucket: string; files: number }[]>;

  /* ---------------- Batch 3 (009) — doctor ---------------- */
  /** D19: own audit trail — the doctor's own case actions from the audit log. */
  listDoctorAudit(doctorId: string, limit: number): Promise<AuditEntry[]>;

  /** D20: archive a case (sets cases.archived_at). */
  archiveCase(id: string): Promise<Case | null>;
  /** D20: this doctor's archived cases, newest archived first. */
  listArchivedCases(doctorId: string): Promise<Case[]>;

  /** D22: ask another doctor to review a case. Status starts at 'pending'. */
  createSecondOpinion(o: { case_id: string; requester_id: string; reviewer_id: string; note?: string | null }): Promise<SecondOpinion>;
  /** D22: second-opinion rows where this doctor is requester OR reviewer. */
  listSecondOpinions(doctorId: string): Promise<SecondOpinion[]>;
  /** D22: reviewer accepts or declines a pending request (null = not found / not reviewer). */
  decideSecondOpinion(id: string, reviewerId: string, accept: boolean): Promise<SecondOpinion | null>;

  /** D23: follow-ups for this doctor whose due_on falls in [from, to] (YYYY-MM-DD). */
  listFollowUpsRange(doctorId: string, from: string, to: string): Promise<FollowUp[]>;

  /** D24: one-tap triage preset for this doctor. */
  createTriagePreset(doctorId: string, name: string, priority: number): Promise<TriagePreset>;
  /** D24: this doctor's presets, highest priority first. */
  listTriagePresets(doctorId: string): Promise<TriagePreset[]>;
  /** D24: delete a preset only if it belongs to this doctor. */
  deleteTriagePreset(id: string, doctorId: string): Promise<boolean>;

  /**
 * D25: patient adherence, read-only, derived from progress_checkins.
 * done = number of check-ins; total = days since first check-in
 * (assumes a daily check-in habit — see OPEN QUESTIONS in endpoints.md).
 */
  getPatientAdherence(userId: string): Promise<{ rate: number; done: number; total: number }>;

  /** D26: reassign a case to another doctor. (Route should call addAudit after this.) */
  transferCase(id: string, toDoctorId: string): Promise<Case | null>;

  /* ---------------- Batch 3 (009) — admin ---------------- */
  /* ---------------- Batch 3 (009) — admin dashboard A21–A29 ---------------- */
  // admin: dispute resolution center (A21)
  /** Create an order dispute (customer-raised; admin resolves). Status starts 'open'. */
  createDispute(d: { order_id: string; user_id: string; subject: string; body: string }): Promise<Dispute>;
  /** Dispute queue, newest first; optional status filter. */
  listDisputes(status?: string): Promise<Dispute[]>;
  getDispute(id: string): Promise<Dispute | null>;
  /** Resolve a dispute. approved=true -> 'resolved', false -> 'rejected'. */
  resolveDispute(id: string, resolvedBy: string, resolution: string, approved: boolean): Promise<Dispute | null>;
  // admin: doctor payout report (A22)
  /** Per-doctor reviewed-case counts for month 'YYYY-MM' (via plan.approve audit entries). */
  doctorPayouts(month: string): Promise<{ doctor_id: string; name: string | null; reviewed: number }[]>;
  // admin: content moderation queue (A23)
  /** Pending community tips awaiting moderation, newest first. */
  listModerationQueue(): Promise<CommunityTip[]>;
  /** Approve or reject a tip; records the moderator. */
  decideCommunityTip(id: string, approved: boolean, moderatorId: string): Promise<CommunityTip | null>;
  // admin: plan template manager (A24)
  createPlanTemplate(t: { title_en: string; title_ne?: string | null; items: unknown[]; created_by?: string | null }): Promise<PlanTemplate>;
  /** Plan templates, newest first; activeOnly=true hides archived ones. */
  listPlanTemplates(activeOnly: boolean): Promise<PlanTemplate[]>;
  updatePlanTemplate(id: string, patch: Partial<PlanTemplate>): Promise<PlanTemplate | null>;
  deletePlanTemplate(id: string): Promise<boolean>;
  // admin: scan quality stats (A25)
  /** Photo pass/fail aggregates by angle, from photos.ai_quality. */
  scanQualityStats(): Promise<{ angle: string; total: number; passed: number }[]>;
  // admin: kit leaderboard (A26)
  /** Per-kit order counts + revenue, ordered by revenue desc. */
  kitLeaderboard(): Promise<{ kit_id: string; name: string; orders: number; revenue_npr: number }[]>;
  // admin: order export scheduler (A27)
  createExportSchedule(s: { kind?: string; frequency: string; created_by?: string | null }): Promise<ExportSchedule>;
  /** All export schedules, newest first. */
  listExportSchedules(): Promise<ExportSchedule[]>;
  updateExportSchedule(id: string, patch: Partial<ExportSchedule>): Promise<ExportSchedule | null>;
  deleteExportSchedule(id: string): Promise<boolean>;
  // admin: staff onboarding checklist (A28)
  /** The one checklist row for a staff user, or null if never started. */
  getStaffChecklist(userId: string): Promise<StaffChecklist | null>;
  /** Create-or-replace the checklist items for a staff user. */
  saveStaffChecklist(userId: string, items: { key: string; done: boolean }[]): Promise<StaffChecklist>;

  /* ---------------- Batch 3 (009) — pharmacy ---------------- */
  /* ---------------- Batch 3 (009) ---------------- */
  // pharmacy (P19–P27)
  /** P19: Quarantine a damaged-stock batch. New entries start as "quarantined". */
  createQuarantine(q: { kit_id: string; qty: number; reason?: string | null; reported_by?: string | null }): Promise<QuarantineEntry>;
  /** P19: List quarantine entries, newest first; optional status filter. */
  listQuarantine(status?: string): Promise<QuarantineEntry[]>;
  /** P19: Move an entry quarantined -> released | written_off (or back to quarantined). */
  setQuarantineStatus(id: string, status: "quarantined" | "released" | "written_off"): Promise<QuarantineEntry | null>;
  /**
 * P20: Shift summary for a UTC calendar date ("YYYY-MM-DD").
 * handled = orders packed that day (pack_completed_at) or shipped/delivered that day;
 * pending = created on/before date, still in pending|paid|fulfilling, not pack-completed;
 * cod_orders = COD orders (payment_method='cod') created that day.
 * Handover notes are per-order (007); the route joins them via listHandoverNotes.
 */
  shiftSummary(date: string): Promise<{ handled: number; pending: number; cod_orders: number }>;
  /**
 * P21: Per-courier order counts. Unassigned orders appear under "unassigned".
 * No damaged count: damage_reports (007) are per-order with no courier column.
 */
  courierPerformance(): Promise<{ courier: string; orders: number; delivered: number }[]>;
  /**
 * P22: Return-rate analytics by kit + reason. Derived from the refunds table
 * (007: reason, order_id -> orders.kit_id); no dedicated returns table exists
 * in any migration 001–009. reasons maps reason -> count (null -> "unspecified").
 */
  returnAnalytics(): Promise<{ kit_id: string; kit_name: string; returns: number; reasons: Record<string, number> }[]>;
  /** P23: Start the pick/pack timer (sets orders.pack_started_at, 009). Restart-safe: re-starts. */
  packStart(orderId: string): Promise<Order | null>;
  /** P23: Stop the pick/pack timer (sets orders.pack_completed_at, 009). */
  packComplete(orderId: string): Promise<Order | null>;
  /** P24: Create a packaging-material row. qty defaults 0, low_threshold defaults 0. */
  createPackagingMaterial(m: { name: string; qty?: number; unit?: string | null; low_threshold?: number }): Promise<PackagingMaterial>;
  /** P24: List packaging materials, sorted by name. */
  listPackagingMaterials(): Promise<PackagingMaterial[]>;
  /** P24: Patch a material (id is immutable); bumps updated_at. */
  updatePackagingMaterial(id: string, patch: Partial<PackagingMaterial>): Promise<PackagingMaterial | null>;
  /** P24: Delete a material; true if it existed. */
  deletePackagingMaterial(id: string): Promise<boolean>;
  /**
 * P25: COD reconciliation for a UTC calendar date ("YYYY-MM-DD").
 * expected_npr = sum of total_npr over COD orders created that day.
 * "Collected" has no column: a succeeded 'cod' payment row (listPaymentsByOrder)
 * for an order means its cash was collected — the route derives it.
 */
  codReconciliation(date: string): Promise<{ expected_npr: number; orders: { id: string; order_no: string; total_npr: number; status: string }[] }>;
  /** P26: Set kits.low_stock_threshold (009) for reorder alerts. */
  setKitLowStockThreshold(kitId: string, threshold: number): Promise<Kit | null>;
  /** P27: Add an internal pharmacy note to an order. */
  addOrderNote(orderId: string, authorId: string, note: string): Promise<OrderNote>;
  /** P27: List an order's internal notes, oldest first. */
  listOrderNotes(orderId: string): Promise<OrderNote[]>;

  /* ---------------- Batch 3 (009) — coach ---------------- */
  /** C19 — Streak leaderboard (opt-in only). Returns anonymized display names
   *  ("Customer #XXXX") for users with users.leaderboard_opt_in = true, ranked by
   *  consecutive-day streak of progress_checkins. limit defaults to 10. */
  streakLeaderboard(limit?: number): Promise<{ user_id: string; display: string; streak: number }[]>;

  /** C20 — Escalation SLA. NOTE: escalations has no acknowledged_at / resolved_at
   *  columns, so hours_to_ack / hours_to_resolve are always null until an additive
   *  migration adds them. Implementers: keep the nulls honest; do NOT fabricate. */
  escalationSla(): Promise<{ id: string; customer_id: string; status: string; hours_to_ack: number | null; hours_to_resolve: number | null }[]>;

  /** C21 — Create a recurring nudge. recurrence is written to the 009 column
   *  scheduled_nudges.recurrence ("daily" | "weekly"). Recurrence expansion
   *  (materialising future send_at rows) is NOT done here — the delivery worker
   *  handles it. Returns ScheduledNudge; the row also carries recurrence. */
  createRecurringNudge(n: { coach_id: string; user_id: string; message_en: string; message_ne?: string | null; send_at: string; recurrence: "daily" | "weekly" }): Promise<ScheduledNudge>;

  /** C22 — Satisfaction trend: average rating per ISO week bucket (bucket = week
   *  start date "YYYY-MM-DD"), with rating counts. Computed from satisfaction_ratings
   *  (rating 1–5 CHECKed at DB level). */
  satisfactionTrend(): Promise<{ bucket: string; avg: number; count: number }[]>;

  /** C23 — Progress comparison current vs baseline. DEGRADED: there is no numeric
   *  progress-metrics table, so this compares shedding_estimate from the earliest
   *  and latest progress_checkins rows. Both are null when the customer has no
   *  checkins; either side is null when its shedding_estimate is null. */
  progressCompare(userId: string): Promise<{ baseline: Record<string, number> | null; current: Record<string, number> | null }>;

  /** C24 — Get the customer's onboarding checklist (onboarding_checklists; one row
   *  per user_id). Returns null when the customer has no checklist yet. */
  getOnboardingChecklist(userId: string): Promise<OnboardingChecklist | null>;

  /** C24 — Upsert the customer's onboarding checklist steps [{key, done}].
   *  New customers get a fresh row; existing rows keep their id and created_at. */
  saveOnboardingChecklist(userId: string, steps: { key: string; done: boolean }[]): Promise<OnboardingChecklist>;

  /** C25 — Customers whose latest progress_checkin is older than `days` days
   *  (days defaults to 7), or who never checked in and whose account is older
   *  than `days`. Name comes from profiles.name (may be null — users has no
   *  name column). days_missed = whole days since last checkin (or account
   *  creation), sorted most-missed first. */
  missedCheckins(days?: number): Promise<{ user_id: string; name: string | null; days_missed: number }[]>;

  /** C26 — Get the coach's availability row (coach_availability). Null when the
   *  coach has never set one (treat as "available" in UI). */
  getCoachAvailability(coachId: string): Promise<CoachAvailability | null>;

  /** C26 — Upsert the coach's availability (unique on coach_id). */
  setCoachAvailability(coachId: string, status: "available" | "on_leave", note?: string | null): Promise<CoachAvailability>;

  /** C27 — Per-habit adherence detail. DEGRADED: progress_checkins has NO habit
   *  column, so there is no per-habit data. This reports done/total over the
   *  last 30 days across checkin dimensions that exist: "daily_checkin"
   *  (days with ≥1 checkin / 30), "photo_logged", "shedding_logged",
   *  "note_logged". When a real habit column lands, replace these buckets. */
  adherenceDetail(userId: string): Promise<{ habit: string; done: number; total: number }[]>;

  /* ---------------- Batch 3 (009) — customer ---------------- */
  /* ---------------- Batch 3 (009) — customer (U21–U29) ---------------- */
  // U21 case Q&A: customer asks on own case; doctor replies land via batch 5
  // (same case_messages table, author_role = "doctor"). Ownership
  // (case → user via cases.scan_id → scans.user_id) is enforced in routes.
  /** Q&A thread for one case, oldest first. */
  listCaseMessages(caseId: string): Promise<CaseMessage[]>;
  /**
   * Append a message to a case Q&A thread. authorRole is explicit so the
   * customer-side POST can never forge a doctor reply (batch 5 uses "doctor").
   */
  addCaseMessage(caseId: string, authorId: string, authorRole: "customer" | "doctor", body: string): Promise<CaseMessage>;
  // U22 follow-up review request — appointment-free (teleconsult stays OFF).
  /** Request a doctor review of the case / a general follow-up review. */
  createReviewRequest(r: { user_id: string; case_id?: string | null; reason?: string | null }): Promise<ReviewRequest>;
  /** The customer's own review requests, newest first. */
  listReviewRequests(userId: string): Promise<ReviewRequest[]>;
  // U23 community tips — moderated (admin A23 owns moderation).
  /**
   * Community tips. approvedOnly=true returns status='approved' (customer UI);
   * false returns all statuses (admin moderation queue, A23).
   */
  listCommunityTips(approvedOnly: boolean): Promise<CommunityTip[]>;
  /** Submit a tip; always enters as status='pending' for admin moderation. */
  createCommunityTip(userId: string, title: string, body: string): Promise<CommunityTip>;
  // U25 loyalty — earn is derived at READ time (1 pt per NPR 100 of delivered
  // order total_npr); loyalty_points is the adjustments ledger only.
  /**
   * Loyalty wallet: { balance, history }.
   * balance = floor(sum(delivered orders total_npr) / 100) + sum(ledger points).
   */
  getLoyalty(userId: string): Promise<{ balance: number; history: LoyaltyEntry[] }>;
  /** Manual ledger adjustment (earn bonus / redeem / correction). */
  addLoyaltyEntry(userId: string, points: number, reason?: string | null, orderId?: string | null): Promise<LoyaltyEntry>;
  // U26 gift-a-kit — route wiring lives at integration (POST /orders is owned
  // by the shop track); the store method only patches gift columns on an
  // existing order.
  /**
   * Set gift fields on an order. Sets is_gift=true + recipient columns.
   * Returns null when the order does not exist. Ownership (order.user_id) is
   * enforced in routes.
   */
  setOrderGift(orderId: string, g: { recipient_name: string; recipient_phone?: string | null; message?: string | null }): Promise<Order | null>;
  // U24 adherence history — derived from progress_checkins (001), no new table.
  /**
   * Weekly adherence series, last 12 weeks, Monday-start week keys
   * ("YYYY-MM-DD"). rate = distinct check-in days in week / 7, 0–1, 2dp.
   */
  adherenceHistory(userId: string): Promise<{ week: string; rate: number }[]>;
  // U29 routine library — published items only; zero medicinal claims.
  /** Published routine-library items, newest first. */
  listRoutines(): Promise<RoutineItem[]>;
  // Leaderboard opt-in toggle (needed by coach C19 streak board).
  /** users.leaderboard_opt_in (009); false when user missing/unset. */
  getLeaderboardOptIn(userId: string): Promise<boolean>;
  /** Set users.leaderboard_opt_in. No-op-safe when the user is missing. */
  setLeaderboardOptIn(userId: string, optIn: boolean): Promise<void>;

  /* ================= BATCH 4 (010) — DOCTOR (D28–D45) ================= */
  /** D29: doctors directory for second opinions / transfers (excludes self). */
  listDoctorPeers(excludeId: string): Promise<User[]>;
  /** D30: pause/resume the SLA clock (sets/clears cases.sla_paused_at). */
  setCaseSlaPaused(caseId: string, pausedAt: string | null): Promise<Case | null>;
  /** D32: doctor-only internal comment thread. */
  createCaseComment(c: { case_id: string; doctor_id: string; body: string }): Promise<CaseComment>;
  /** D32: comments for a case, oldest first. */
  listCaseComments(caseId: string): Promise<CaseComment[]>;
  /** D33: add a non-diagnostic concern tag (idempotent). */
  addCaseConcernTag(caseId: string, tag: string): Promise<CaseConcernTag>;
  /** D33: remove a concern tag. */
  removeCaseConcernTag(caseId: string, tag: string): Promise<void>;
  /** D33: tags for a case. */
  listCaseConcernTags(caseId: string): Promise<CaseConcernTag[]>;
  /** D37: this week's review stats for the digest card. */
  getDoctorDigest(doctorId: string): Promise<{ reviewed: number; avgMinutes: number | null; slaHits: number; weekStart: string }>;
  /** D38: own past cases with similar root scores (reference only, no diagnosis). */
  listSimilarCases(caseId: string, doctorId: string): Promise<SimilarCase[]>;
  /** D40: saved queue filter presets. */
  createQueueFilter(f: { doctor_id: string; name: string; filters: Record<string, unknown> }): Promise<QueueFilter>;
  listQueueFilters(doctorId: string): Promise<QueueFilter[]>;
  deleteQueueFilter(id: string, doctorId: string): Promise<boolean>;
  /** D43: own reviewed cases for CSV export. */
  exportOwnCases(doctorId: string): Promise<{ id: string; created_at: string; status: string; priority: number }[]>;

  /* ================= BATCH 4 (010) — ADMIN (A30–A47) ================= */
  /** A30: dashboard card config for a role (null = never configured). */
  getDashboardConfig(role: string): Promise<DashboardConfig | null>;
  /** A30: upsert dashboard card config for a role. */
  setDashboardConfig(role: string, config: Record<string, unknown>): Promise<DashboardConfig>;
  /** A37: record an email send attempt. */
  logEmail(e: { to_email: string; template: string; status: "sent" | "failed"; error?: string | null }): Promise<EmailLog>;
  /** A37: recent email logs, newest first. */
  listEmailLogs(limit: number): Promise<EmailLog[]>;
  /** A44: internal admin notices (read flag is per-admin). */
  listAdminNotices(adminId: string): Promise<AdminNotice[]>;
  createAdminNotice(n: { title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null }): Promise<AdminNotice>;
  markAdminNoticeRead(adminId: string, noticeId: string): Promise<void>;
  /** A45: consent text versions. */
  listConsentVersions(kind?: string): Promise<ConsentVersion[]>;
  createConsentVersion(v: { kind: string; version: number; text_en: string; text_ne?: string | null; active?: boolean }): Promise<ConsentVersion>;
  /** A45: activate one version per kind (deactivates others). */
  activateConsentVersion(id: string): Promise<ConsentVersion | null>;
  /** A33: verifications expiring within N days. */
  listExpiringVerifications(withinDays: number): Promise<StaffVerification[]>;
  /** A33: set expiry on a verification document. */
  setVerificationExpiry(id: string, expiresAt: string | null): Promise<StaffVerification | null>;
  /** A34: ticket first-response / resolution SLA aggregates (nulls where untracked). */
  getTicketSla(): Promise<{ open: number; avgFirstResponseMin: number | null; avgResolveMin: number | null }>;
  /** A36: bulk activate/suspend users. Returns updated count. */
  bulkSetUserStatus(ids: string[], disabled: boolean): Promise<number>;
  /** A38: deletion-request queue for the privacy tab. */
  listDeletionRequests(): Promise<DeletionRequest[]>;
  /** A39: referral stats. */
  getReferralStats(): Promise<{ codes: number; joined: number }>;
  /** A40: participation / completion per challenge. */
  getChallengeAnalytics(): Promise<{ challenge_id: string; title_en: string; assigned: number; completed: number }[]>;
  /** A41: per-coach aggregates (escalations, avg satisfaction). */
  getCoachPerformance(): Promise<{ coach_id: string; escalations: number; avgSatisfaction: number | null }[]>;
  /** A42: fulfilment cycle aggregates (pack→ship→delivered). */
  getPharmacyPerformance(): Promise<{ handled: number; avgPackMin: number | null; avgShipMin: number | null }>;
  /** A46: refund rate by reason. */
  getRefundAnalytics(): Promise<{ reason: string; count: number; total_npr: number }[]>;
  /** A47: morning ops digest aggregates. */
  getOpsDigest(): Promise<{ ordersToday: number; slaBreaches: number; openTickets: number; pendingRefunds: number }>;

  /* ================= BATCH 4 (010) — PHARMACY (P28–P45) ================= */
  /** P31: record a delivery attempt. */
  createDeliveryAttempt(a: { order_id: string; status: "failed" | "rescheduled" | "delivered"; note?: string | null }): Promise<DeliveryAttempt>;
  /** P31: attempts for an order, newest first. */
  listDeliveryAttempts(orderId: string): Promise<DeliveryAttempt[]>;
  /** P33: record a physical stock count (variance computed). */
  createStockCount(c: { kit_id: string; counted_qty: number; counted_by: string | null; system_qty: number }): Promise<StockCount>;
  /** P33: count history for a kit. */
  listStockCounts(kitId: string): Promise<StockCount[]>;
  /** P38: record a kit substitution on an order. */
  createSubstitution(s: { order_id: string; from_kit_id?: string | null; to_kit_id?: string | null; reason: string }): Promise<Substitution>;
  /** P38: substitutions for an order. */
  listSubstitutions(orderId: string): Promise<Substitution[]>;
  /** P39: attach delivery photo proof (storage_path in existing bucket). */
  createDeliveryProof(p: { order_id: string; storage_path: string; note?: string | null }): Promise<DeliveryProof>;
  /** P39: proofs for an order. */
  listDeliveryProofs(orderId: string): Promise<DeliveryProof[]>;
  /** P43: pharmacy flags an order for admin refund approval. */
  createRefundRequest(r: { order_id: string; reason: string }): Promise<RefundRequest>;
  /** P43: refund requests by status. */
  listRefundRequests(status?: string): Promise<RefundRequest[]>;
  /** P43: admin approves/rejects (decided_at set). */
  decideRefundRequest(id: string, approved: boolean): Promise<RefundRequest | null>;
  /** P44: non-dispatch days CRUD. */
  createDispatchHoliday(h: { date: string; label: string }): Promise<DispatchHoliday>;
  listDispatchHolidays(): Promise<DispatchHoliday[]>;
  deleteDispatchHoliday(id: string): Promise<boolean>;
  /** P45: courier damage claims CRUD. */
  createCourierClaim(c: { courier_name: string; order_id?: string | null; amount_npr?: number; reason: string }): Promise<CourierClaim>;
  listCourierClaims(status?: string): Promise<CourierClaim[]>;
  setCourierClaimStatus(id: string, status: "open" | "filed" | "settled"): Promise<CourierClaim | null>;
  /** P34: rush flag on an order. */
  setOrderRush(orderId: string, rush: boolean): Promise<Order | null>;
  /** P36-alt: kit batches expiring within N days. */
  listExpiringBatches(withinDays: number): Promise<ExpiringBatch[]>;
  /** P42: search orders by id / customer name / phone. */
  searchOrders(q: string): Promise<Order[]>;
  /** P28: re-run verification checks (clears + recreates as pending). */
  reverifyOrderChecks(orderId: string): Promise<OrderCheck[]>;

  /* ================= BATCH 4 (010) — COACH (C28–C45) ================= */
  /** C29: customer rates their coach. */
  createCoachFeedback(f: { coach_id: string; customer_id: string; rating: number; note?: string | null }): Promise<CoachFeedback>;
  /** C29: aggregate only (avg rating, count) — never individual rows for the coach. */
  getCoachFeedbackAggregate(coachId: string): Promise<{ avg: number | null; count: number }>;
  /** C30: freeze a streak date (one per customer per month enforced in route). */
  createStreakFreeze(f: { customer_id: string; coach_id: string; frozen_date: string }): Promise<StreakFreeze>;
  /** C30: freezes for a customer in a YYYY-MM month. */
  listStreakFreezes(customerId: string, month: string): Promise<StreakFreeze[]>;
  /** C32: tag a customer (idempotent). */
  addCustomerTag(coachId: string, customerId: string, tag: string): Promise<CustomerTag>;
  /** C32: remove a tag. */
  removeCustomerTag(coachId: string, customerId: string, tag: string): Promise<void>;
  /** C32: tags for a customer. */
  listCustomerTags(coachId: string, customerId: string): Promise<CustomerTag[]>;
  /** C34: handover note when a customer moves between coaches. */
  createCoachHandover(h: { customer_id: string; from_coach_id?: string | null; to_coach_id?: string | null; note: string }): Promise<CoachHandover>;
  /** C34: handovers for a customer, newest first. */
  listCoachHandovers(customerId: string): Promise<CoachHandover[]>;
  /** C37: this week's own activity summary. */
  getCoachWeeklyReport(coachId: string): Promise<{ notes: number; nudges: number; escalations: number; weekStart: string }>;
  /** C38: milestone timeline (badges, goals, challenge completions). */
  listCustomerMilestones(customerId: string): Promise<{ kind: string; title: string; at: string }[]>;
  /** C41-alt: computed journey stage for a customer. */
  getJourneyStage(customerId: string): Promise<JourneyStage>;
  /** C42: record the outcome of a resolved escalation. */
  setEscalationOutcome(id: string, outcome: string): Promise<Escalation | null>;
  /** C43: anonymized peer tips. */
  createCoachTip(t: { coach_id: string; title: string; body: string }): Promise<CoachTip>;
  listCoachTips(): Promise<CoachTip[]>;
  deleteCoachTip(id: string, coachId: string): Promise<boolean>;
  /** C45: end-of-challenge survey (one per assignment). */
  createChallengeSurvey(s: { assignment_id: string; q1_rating: number; q2_text?: string | null }): Promise<ChallengeSurvey>;
  /** C45: surveys for a challenge's assignments. */
  listChallengeSurveys(challengeId: string): Promise<ChallengeSurvey[]>;

  /* ================= BATCH 4 (010) — CUSTOMER (U30–U47) ================= */
  /** U37: submit app feedback. */
  createAppFeedback(f: { user_id: string; rating: number; message?: string | null }): Promise<AppFeedback>;
  /** U40: kit reminder CRUD. */
  createKitReminder(r: { user_id: string; kit_id?: string | null; label_en: string; label_ne?: string | null; remind_at: string }): Promise<KitReminder>;
  listKitReminders(userId: string): Promise<KitReminder[]>;
  setKitReminderDone(id: string, userId: string, done: boolean): Promise<KitReminder | null>;
  deleteKitReminder(id: string, userId: string): Promise<boolean>;
  /** U42: product usage log. */
  logKitUsage(u: { user_id: string; kit_id?: string | null; note?: string | null }): Promise<KitUsage>;
  /** U42: recent usage rows, newest first. */
  listKitUsages(userId: string, limit: number): Promise<KitUsage[]>;
  /** U31: current check-in streak (days). */
  getStreak(userId: string): Promise<{ days: number }>;
  /** U32: referral history (codes issued + joiners). */
  getReferralHistory(userId: string): Promise<{ code: string | null; joined: { user_id: string; at: string }[] }>;
  /** U41: kits likely finished (ordered >60 days ago, no reorder since). */
  getReorderSuggestions(userId: string): Promise<{ kit_id: string; kit_name: string; ordered_at: string }[]>;
  /** U45: own recent sessions (from refresh tokens, no token values). */
  listOwnSessions(userId: string): Promise<{ id: string; created_at: string; last_used_at: string | null }[]>;
}
