/**
 * Typed API client for the Jaraa PWA backend (see api/openapi.yaml).
 * Base URL: same origin — the API server serves this client's dist/.
 * Auth: access JWT lives ONLY in memory (module scope); the refresh token
 * is an httpOnly cookie (`jaraa_rt`) the browser sends automatically, so the
 * client never reads or stores it.
 */
import { ApiError } from "./types";
import type {
  Annotation,
  AnnotationShape,
  ApiErrorBody,
  Address,
  AdminKit,
  AdminKitListParams,
  AdminKitListResponse,
  AdminUser,
  AdminUserListResponse,
  AssignedCustomer,
  AppNotification,
  AuditListResponse,
  Case,
  CaseListResponse,
  Checkin,
  Challenge,
  ChallengeAssignment,
  CoachNote,
  Consent,
  ConsentType,
  Consult,
  CreateOrderPayload,
  DamageReport,
  DataDeletionResponse,
  DoctorAvailability,
  EducationArticle,
  Escalation,
  FeatureFlag,
  FeatureFlagListResponse,
  FinanceSnapshot,
  FollowUp,
  FunnelAnalytics,
  HandoverNote,
  KitListResponse,
  Kit,
  KitUpsertPayload,
  Nudge,
  Order,
  OrderCheck,
  OrderStatus,
  OtpRequestResponse,
  OtpVerifyResponse,
  OverdueCase,
  PasswordAuthResponse,
  PatientCase,
  PatientSearchResult,
  Photo,
  PhotoAngle,
  Plan,
  PlanItemKind,
  Profile,
  ProgressBundle,
  RedFlag,
  RedFlagType,
  Refund,
  Role,
  RootMap,
  SatisfactionRating,
  Scan,
  ScanDetail,
  ScanRule,
  ScanRuleListResponse,
  ScanStage,
  ScheduledNudge,
  StaffVerification,
  StageAdvanceResponse,
  DoctorWorkload, DoctorSlaSummary, ReplySnippet, ReviewChecklist, ChecklistItem,
  PatientRisk, PhotoRequest, DoctorReviewStats, DoctorNoteSearchResult,
  RolePermission, Announcement, RefreshSessionView, LoginAttempt, Coupon,
  SystemHealth, StorageBucketUsage, BackupRecord, NotificationTemplate,
  StockMovement, ReorderSuggestion, PackingCheck, OrderLabel, ZoneStat,
  KitBatch, Supplier, ChallengeGroup, Badge, SessionSummary, CustomerGoal,
  HabitTemplate, NoteTemplate, CoachRiskFlag, ArticleAssignment,
  SymptomEntry, WaterLog, SleepLog, NotificationPrefs, EmergencyContact,
  SupportTicket,
  TicketReply,
  TimelineEvent,
  WishlistItem,
  PinType,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
const API = `${BASE}/api/v1`;

/* ------------------------- access-token store (in memory only) --- */
let accessToken: string | null = null;
export function setAccessToken(t: string | null): void {
  accessToken = t;
}
export function getAccessToken(): string | null {
  return accessToken;
}

type AuthExpiredHandler = () => void;
const authExpiredHandlers = new Set<AuthExpiredHandler>();
export function onAuthExpired(h: AuthExpiredHandler): () => void {
  authExpiredHandlers.add(h);
  return () => authExpiredHandlers.delete(h);
}
function emitAuthExpired(): void {
  setAccessToken(null);
  authExpiredHandlers.forEach((h) => h());
}

/* ----------------------------------------------- core request --- */
let refreshing: Promise<boolean> | null = null;

/** Silent refresh via the httpOnly cookie. Exported for non-JSON downloads (CSV). */
export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API}/auth/refresh`, {
          method: "POST",
          credentials: "include", // sends the httpOnly jaraa_rt cookie
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { access_token?: string };
        if (!body.access_token) return false;
        setAccessToken(body.access_token);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

interface ReqOpts extends RequestInit {
  /** skip the automatic 401 -> refresh -> retry (used for auth endpoints) */
  noRetry?: boolean;
}

export async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const { noRetry, ...init } = opts;
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const doFetch = () =>
    fetch(`${API}${path}`, { ...init, headers, credentials: "include" });

  let res = await doFetch();

  // 401 -> try one silent refresh via the httpOnly cookie, then retry once.
  if (res.status === 401 && !noRetry && !path.startsWith("/auth/")) {
    const ok = await refreshAccessToken();
    if (ok) {
      const h2 = new Headers(init.headers);
      const t = getAccessToken();
      if (t) h2.set("Authorization", `Bearer ${t}`);
      if (init.body && !(init.body instanceof FormData) && !h2.has("Content-Type")) {
        h2.set("Content-Type", "application/json");
      }
      res = await fetch(`${API}${path}`, { ...init, headers: h2, credentials: "include" });
    }
  }

  if (res.status === 401 && !path.startsWith("/auth/")) {
    emitAuthExpired();
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const errBody = (body ?? { code: "unknown", message: res.statusText }) as ApiErrorBody;
    throw new ApiError(res.status, {
      code: errBody.code ?? "unknown",
      message: errBody.message ?? res.statusText,
      details: errBody.details,
    });
  }
  return body as T;
}

const json = (v: unknown) => JSON.stringify(v);

export interface RestoredSession {
  access_token: string;
  user: { id: string; phone: string; email?: string | null; role?: Role };
}

/**
 * Silent session restore for page refreshes (P10).
 *
 * The access JWT lives in memory only, so after a refresh there is none —
 * the httpOnly `jaraa_rt` refresh cookie (if still valid) is rotated here
 * to mint a fresh access token. No token is ever copied into localStorage.
 * Returns the fresh session, or null when there is no valid refresh cookie.
 * Never throws and never fires the global auth-expired handler: a failed
 * restore simply means "stay logged out".
 */
export async function restoreSession(): Promise<RestoredSession | null> {
  if (accessToken) return null; // already have one — nothing to restore
  try {
    const body = await request<{ access_token?: string; user?: RestoredSession["user"] }>(
      "/auth/refresh",
      { method: "POST", noRetry: true },
    );
    if (!body?.access_token) return null;
    setAccessToken(body.access_token);
    return { access_token: body.access_token, user: body.user ?? { id: "", phone: "" } };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------- auth --- */
export const authApi = {
  requestOtp: (phone: string) =>
    request<OtpRequestResponse>("/auth/otp/request", {
      method: "POST",
      body: json({ phone }),
      noRetry: true,
    }),
  verifyOtp: (phone: string, code: string, claim_guest_scan_id?: string) =>
    request<OtpVerifyResponse>("/auth/otp/verify", {
      method: "POST",
      body: json({ phone, code, claim_guest_scan_id }),
      noRetry: true,
    }),
  /** Email-or-phone + password sign-up. Same flow for every role. */
  signup: (payload: { email?: string; phone?: string; password: string; password_confirm: string }) =>
    request<PasswordAuthResponse>("/auth/signup", {
      method: "POST",
      body: json(payload),
      noRetry: true,
    }),
  /** Email-or-phone + password login. Same flow for every role. */
  loginPassword: (payload: { email?: string; phone?: string; password: string }) =>
    request<PasswordAuthResponse>("/auth/login", {
      method: "POST",
      body: json(payload),
      noRetry: true,
    }),
  /** Always resolves ok:true — the server never reveals whether the email exists. */
  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/forgot-password", {
      method: "POST",
      body: json({ email }),
      noRetry: true,
    }),
  resetPassword: (payload: { token: string; password: string; password_confirm: string }) =>
    request<{ ok: true }>("/auth/reset-password", {
      method: "POST",
      body: json(payload),
      noRetry: true,
    }),
  logout: () =>
    request<void>("/auth/logout", { method: "POST", noRetry: true }).catch(() => undefined),
};

/* ---------------------------------------------------------- me --- */
export const meApi = {
  getProfile: () => request<Profile>("/me/profile"),
  updateProfile: (patch: Partial<Pick<Profile, "name" | "age_band" | "gender" | "language">>) =>
    request<Profile>("/me/profile", { method: "PATCH", body: json(patch) }),
  uploadProfilePhoto: (photo: Blob) => {
    const fd = new FormData();
    fd.append("photo", photo, "profile.jpg");
    return request<{ photo_url: string; photo_path: string; addresses: Address[] }>(
      "/me/profile/photo",
      { method: "POST", body: fd },
    );
  },
  deleteProfilePhoto: () => request<void>("/me/profile/photo", { method: "DELETE" }),
  listAddresses: () => request<{ addresses: Address[] }>("/me/addresses"),
  addAddress: (a: Omit<Address, "id">) =>
    request<{ address: Address }>("/me/addresses", { method: "POST", body: json(a) }),
  updateAddress: (id: string, patch: Partial<Omit<Address, "id">>) =>
    request<{ address: Address }>(`/me/addresses/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json(patch),
    }),
  deleteAddress: (id: string) =>
    request<void>(`/me/addresses/${encodeURIComponent(id)}`, { method: "DELETE" }),
  recordConsent: (type: ConsentType, version: string, granted: boolean) =>
    request<Consent>("/me/consents", { method: "POST", body: json({ type, version, granted }) }),
  getPlan: () => request<Plan>("/me/plan"),
  getRootMapHistory: () => request<{ versions: RootMap[] }>("/me/root-map/history"),
  createCheckin: (payload: { plan_id?: string; shedding_estimate?: number; note?: string; photo_ids?: string[] }) =>
    request<Checkin>("/me/checkins", { method: "POST", body: json(payload) }),
  /** Own habit check-ins, newest first (Batch-1 customer/coach features). */
  listCheckins: () => request<{ checkins: Checkin[] }>("/me/checkins"),
  getProgress: () => request<ProgressBundle>("/me/progress"),
  requestDataDeletion: () => request<DataDeletionResponse>("/me/data", { method: "DELETE" }),

  /* ---------------- P-12 customer features ---------------- */
  /** Support tickets (A7). */
  listTickets: () => request<{ tickets: SupportTicket[] }>("/me/tickets"),
  /** Open a support ticket (A7). */
  createTicket: (subject: string, body: string) =>
    request<{ ticket: SupportTicket }>("/me/tickets", { method: "POST", body: json({ subject, body }) }),
  /** Ticket + replies (A7). */
  getTicket: (id: string) =>
    request<{ ticket: SupportTicket; replies: TicketReply[] }>(`/me/tickets/${encodeURIComponent(id)}`),
  /** Reply on own ticket (A7). */
  replyTicket: (id: string, body: string) =>
    request<{ reply: TicketReply }>(`/me/tickets/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      body: json({ body }),
    }),
  /** Assigned challenges (C4). */
  listMyChallenges: () => request<{ assignments: ChallengeAssignment[] }>("/me/challenges"),
  /** Complete a challenge (C4). */
  completeChallenge: (assignmentId: string) =>
    request<{ assignment: ChallengeAssignment }>(
      `/me/challenges/${encodeURIComponent(assignmentId)}/complete`,
      { method: "POST" },
    ),
  /** Kit wishlist (U6). */
  listWishlist: () => request<{ items: WishlistItem[] }>("/me/wishlist"),
  /** Add a kit to the wishlist (U6). */
  addToWishlist: (kit_id: string) =>
    request<{ item: WishlistItem }>("/me/wishlist", { method: "POST", body: json({ kit_id }) }),
  /** Remove a kit from the wishlist (U6). */
  removeFromWishlist: (kitId: string) =>
    request<void>(`/me/wishlist/${encodeURIComponent(kitId)}`, { method: "DELETE" }),

  /* ---------------- Batch 2 (008): U12–U20 ---------------- */
  /** Plan history (U12). */
  planHistory: () => request<{ plans: Plan[] }>("/me/plans/history"),
  /** Symptom diary (U13). */
  listSymptoms: () => request<{ entries: SymptomEntry[] }>("/me/symptoms"),
  saveSymptom: (entry_date: string, note: string) =>
    request<SymptomEntry>("/me/symptoms", { method: "POST", body: json({ entry_date, note }) }),
  deleteSymptom: (id: string) =>
    request<void>(`/me/symptoms/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Water tracker (U14). */
  getWater: (date?: string) =>
    request<{ log: WaterLog | null }>(`/me/water${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  setWater: (log_date: string, glasses: number) =>
    request<WaterLog>("/me/water", { method: "POST", body: json({ log_date, glasses }) }),
  /** Sleep log (U15). */
  listSleep: () => request<{ logs: SleepLog[] }>("/me/sleep"),
  saveSleep: (payload: { log_date: string; bedtime?: string; wake_time?: string; quality?: number }) =>
    request<SleepLog>("/me/sleep", { method: "POST", body: json(payload) }),
  deleteSleep: (id: string) =>
    request<void>(`/me/sleep/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Notification prefs (U17). */
  getNotificationPrefs: () => request<NotificationPrefs>("/me/notification-prefs"),
  setNotificationPrefs: (patch: Partial<NotificationPrefs>) =>
    request<NotificationPrefs>("/me/notification-prefs", { method: "PUT", body: json(patch) }),
  /** Emergency contacts (U20). */
  listEmergencyContacts: () => request<{ contacts: EmergencyContact[] }>("/me/emergency-contacts"),
  createEmergencyContact: (payload: { name: string; phone: string; relation?: string }) =>
    request<EmergencyContact>("/me/emergency-contacts", { method: "POST", body: json(payload) }),
  deleteEmergencyContact: (id: string) =>
    request<void>(`/me/emergency-contacts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Badges my coach awarded me (C11). */
  getMyBadges: () => request<{ badges: Badge[] }>("/me/badges"),
  /** Articles my coach shared with me (C18). */
  getAssignedArticles: () =>
    request<{ articles: Array<EducationArticle & { assigned_at: string }> }>("/me/articles/assigned"),
};

/* -------------------------------------------------------- scans --- */
export const scansApi = {
  /** Guest mode allowed: no auth needed. */
  createScan: () => request<Scan>("/scans", { method: "POST", body: json({}) }),
  getScan: (id: string) => request<ScanDetail>(`/scans/${id}`),
  advanceStage: (id: string, stage: ScanStage) =>
    request<StageAdvanceResponse>(`/scans/${id}/stage`, { method: "PATCH", body: json({ stage }) }),
  addTimelineEvent: (
    id: string,
    payload: { event_type: PinType; occurred_on: string; note?: string; followup_answers?: Record<string, unknown> },
  ) => request<{ event: TimelineEvent; red_flags_raised: RedFlag[] }>(`/scans/${id}/timeline-events`, {
    method: "POST",
    body: json(payload),
  }),
  uploadPhoto: (id: string, angle: PhotoAngle, photo: Blob, consent_id?: string) => {
    const fd = new FormData();
    fd.append("angle", angle);
    fd.append("photo", photo, `${angle}.jpg`);
    // Optional in the contract: the server validates the granted consent row
    // independently and 403s (consent_required) when none exists.
    if (consent_id) fd.append("consent_id", consent_id);
    return request<Photo>(`/scans/${id}/photos`, { method: "POST", body: fd });
  },
  deletePhoto: (id: string, photoId: string) =>
    request<void>(`/scans/${id}/photos/${photoId}`, { method: "DELETE" }),
  getRootMap: (id: string) => request<RootMap>(`/scans/${id}/root-map`),
  submit: (id: string) => request<Case>(`/scans/${id}/submit`, { method: "POST", body: json({}) }),
};

/* ------------------------------------------------------- doctor --- */
export const doctorApi = {
  listCases: (status: "queued" | "in_review" | "reviewed" | "needs_info" = "queued", limit = 20, cursor?: string) => {
    const q = new URLSearchParams({ status, limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return request<CaseListResponse>(`/doctor/cases?${q}`);
  },
  claimCase: (id: string) => request<Case>(`/doctor/cases/${id}/claim`, { method: "POST", body: json({}) }),
  /** Single case by id — works for every status (queued, in_review, reviewed, needs_info). */
  getCase: (id: string) => request<Case>(`/doctor/cases/${encodeURIComponent(id)}`),
  annotatePhoto: (caseId: string, photo_id: string, shape: AnnotationShape, note: string) =>
    request<Annotation>(`/doctor/cases/${caseId}/annotations`, {
      method: "POST",
      body: json({ photo_id, shape, note }),
    }),
  composePlan: (
    caseId: string,
    payload: {
      items: Array<{
        kind: PlanItemKind;
        title_ne: string;
        title_en: string;
        detail?: string;
        product_id?: string;
        kit_id?: string;
        sort_order: number;
      }>;
      review_notes?: string;
      rescan_due_on?: string;
      resolved_flag_ids?: string[];
      /** D36: one non-empty note per resolved flag id (server enforces). */
      resolved_flag_notes?: Record<string, string>;
    },
  ) => request<Plan>(`/doctor/cases/${caseId}/plan`, { method: "POST", body: json(payload) }),
  approvePlan: (planId: string) => request<Plan>(`/doctor/plans/${planId}/approve`, {
    method: "POST",
    body: json({}),
  }),
  /** Full case context for review: the scan detail carries timeline, photos, scores, flags. */
  getCaseScan: (scanId: string) => scansApi.getScan(scanId),

  /* ---------------- P-12 doctor dashboard features ---------------- */
  /** Patient timeline + score trend data (D3, D5). */
  patientCases: (userId: string) =>
    request<{ cases: PatientCase[] }>(`/doctor/patients/${encodeURIComponent(userId)}/cases`),
  /** Patient search by name/phone (D7). */
  searchPatients: (q: string) =>
    request<{ patients: PatientSearchResult[] }>(`/doctor/patients/search?q=${encodeURIComponent(q)}`),
  /** Schedule a follow-up (D6). */
  createFollowUp: (payload: { case_id: string; due_on: string; note?: string }) =>
    request<FollowUp>("/doctor/follow-ups", { method: "POST", body: json(payload) }),
  /** Own follow-ups, optionally due-only (D6). */
  listFollowUps: (dueOnly = false) =>
    request<{ follow_ups: FollowUp[] }>(`/doctor/follow-ups${dueOnly ? "?due_only=1" : ""}`),
  /** Mark a follow-up done (D6). */
  completeFollowUp: (id: string) =>
    request<FollowUp>(`/doctor/follow-ups/${encodeURIComponent(id)}/done`, { method: "PATCH" }),
  /** Bulk priority change on queue cases (D8). */
  bulkPriority: (ids: string[], priority: 0 | 50 | 100) =>
    request<{ updated: number }>("/doctor/cases/bulk-priority", {
      method: "PATCH",
      body: json({ ids, priority }),
    }),
  /** Own availability (D9). */
  getAvailability: () => request<{ availability: DoctorAvailability | null }>("/doctor/availability"),
  /** Set own availability (D9). */
  setAvailability: (status: "available" | "on_leave", note?: string) =>
    request<DoctorAvailability>("/doctor/availability", {
      method: "PUT",
      body: json({ status, note }),
    }),

  /* ---------------- Batch 2 (008): D10–D18 ---------------- */
  /** Workload banner data (D10). */
  getWorkload: () => request<DoctorWorkload>("/doctor/workload"),
  /** SLA banner counts (D11). */
  getSlaSummary: () => request<DoctorSlaSummary>("/doctor/sla-summary"),
  /** Reply snippets (D12). */
  listSnippets: () => request<{ snippets: ReplySnippet[] }>("/doctor/snippets"),
  createSnippet: (payload: { title: string; body_en: string; body_ne?: string }) =>
    request<ReplySnippet>("/doctor/snippets", { method: "POST", body: json(payload) }),
  deleteSnippet: (id: string) =>
    request<void>(`/doctor/snippets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Bookmark a case (D13). */
  bookmarkCase: (id: string) =>
    request<{ id: string }>(`/doctor/cases/${encodeURIComponent(id)}/bookmark`, { method: "POST", body: json({}) }),
  unbookmarkCase: (id: string) =>
    request<void>(`/doctor/cases/${encodeURIComponent(id)}/bookmark`, { method: "DELETE" }),
  listBookmarks: () => request<{ case_ids: string[] }>("/doctor/bookmarks"),
  /** Review checklist (D14). */
  getChecklist: (caseId: string) =>
    request<{ checklist: ReviewChecklist | null }>(`/doctor/cases/${encodeURIComponent(caseId)}/checklist`),
  createChecklist: (caseId: string, items?: { label_en: string; label_ne?: string }[]) =>
    request<{ checklist: ReviewChecklist }>(`/doctor/cases/${encodeURIComponent(caseId)}/checklist`, {
      method: "POST", body: json(items ? { items } : {}),
    }),
  setChecklistItemDone: (itemId: string, done: boolean) =>
    request<ChecklistItem>(`/doctor/checklist-items/${encodeURIComponent(itemId)}`, {
      method: "PATCH", body: json({ done }),
    }),
  /** Patient risk badge (D15). */
  patientRisk: (userId: string) =>
    request<PatientRisk>(`/doctor/patients/${encodeURIComponent(userId)}/risk`),
  /** Photo requests (D16). */
  createPhotoRequest: (caseId: string, angles: string, note?: string) =>
    request<PhotoRequest>(`/doctor/cases/${encodeURIComponent(caseId)}/photo-request`, {
      method: "POST", body: json({ angles, note }),
    }),
  listPhotoRequests: (caseId: string) =>
    request<{ requests: PhotoRequest[] }>(`/doctor/cases/${encodeURIComponent(caseId)}/photo-requests`),
  /** Personal review stats (D17). */
  getStats: () => request<DoctorReviewStats>("/doctor/stats"),
  /** Search own review notes (D18). */
  searchNotes: (q: string) =>
    request<{ results: DoctorNoteSearchResult[] }>(`/doctor/notes/search?q=${encodeURIComponent(q)}`),
};

/* --------------------------------------------------------- shop --- */
export const shopApi = {
  listKits: (active_only = true) => request<KitListResponse>(`/kits?active_only=${active_only}`),
  /** Full kit detail incl. images, whats_included, usage_instructions, stock. */
  getKit: (id: string) => request<Kit>(`/kits/${encodeURIComponent(id)}`),
  createOrder: (payload: CreateOrderPayload, idempotencyKey: string) =>
    request<Order>("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: json(payload),
    }),
  /** My orders. */
  listMyOrders: () => request<{ orders: Order[] }>("/my/orders"),
  /** Pharmacy fulfilment queue (role: pharmacy | admin). */
  pharmacyOrders: () => request<{ orders: Order[] }>("/pharmacy/orders"),
  /** Advance an order's fulfilment status. Accepts contract status names. */
  updatePharmacyOrder: (id: string, status: OrderStatus, fulfilment_note?: string) =>
    request<Order>(`/pharmacy/orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json({ status, ...(fulfilment_note ? { fulfilment_note } : {}) }),
    }),

  /* ---------------- P-12 pharmacy features ---------------- */
  /** Kit list with stock for fulfilment (P1/P2). */
  listPharmacyKits: () => request<{ kits: Kit[] }>("/pharmacy/kits"),
  /** Adjust kit stock by delta (P2). */
  adjustKitStock: (kitId: string, delta: number) =>
    request<{ kit: Kit }>(`/pharmacy/kits/${encodeURIComponent(kitId)}/stock`, {
      method: "PATCH",
      body: json({ delta }),
    }),
  /** Assign courier + tracking ID (P4). */
  setOrderCourier: (id: string, courier_name?: string | null, tracking_id?: string | null) =>
    request<{ order: Order }>(`/pharmacy/orders/${encodeURIComponent(id)}/courier`, {
      method: "PATCH",
      body: json({ courier_name: courier_name ?? null, tracking_id: tracking_id ?? null }),
    }),
  /** Address verification checklist (P5). */
  addOrderCheck: (id: string, check_type: "name" | "phone" | "address") =>
    request<{ check: OrderCheck }>(`/pharmacy/orders/${encodeURIComponent(id)}/checks`, {
      method: "POST",
      body: json({ check_type }),
    }),
  /** List address checks for an order (P5). */
  listOrderChecks: (id: string) =>
    request<{ checks: OrderCheck[] }>(`/pharmacy/orders/${encodeURIComponent(id)}/checks`),
  /** Mark order returned + restock kit (P6). */
  returnOrder: (id: string, reason: string) =>
    request<{ order: Order }>(`/pharmacy/orders/${encodeURIComponent(id)}/return`, {
      method: "POST",
      body: json({ reason }),
    }),
  /** Damage report log (P7). */
  addDamageReport: (id: string, description: string) =>
    request<{ report: DamageReport }>(`/pharmacy/orders/${encodeURIComponent(id)}/damage`, {
      method: "POST",
      body: json({ description }),
    }),
  /** List damage reports for an order (P7). */
  listDamageReports: (id: string) =>
    request<{ reports: DamageReport[] }>(`/pharmacy/orders/${encodeURIComponent(id)}/damage`),
  /** Handover note (P8). */
  addHandoverNote: (id: string, note: string) =>
    request<{ note: HandoverNote }>(`/pharmacy/orders/${encodeURIComponent(id)}/handover`, {
      method: "POST",
      body: json({ note }),
    }),
  /** Handover notes for an order (P8). */
  listHandoverNotes: (id: string) =>
    request<{ notes: HandoverNote[] }>(`/pharmacy/orders/${encodeURIComponent(id)}/handover`),

  /* ---------------- Batch 2 (008): P10–P18 ---------------- */
  /** Stock movement history for a kit (P10). */
  kitMovements: (kitId: string) =>
    request<{ movements: StockMovement[] }>(`/pharmacy/kits/${encodeURIComponent(kitId)}/movements`),
  /** Reorder suggestions (P11). */
  reorderSuggestions: () =>
    request<{ suggestions: ReorderSuggestion[] }>("/pharmacy/reorder-suggestions"),
  /** Packing checklist (P12). */
  getPacking: (orderId: string) =>
    request<{ checks: PackingCheck[] }>(`/pharmacy/orders/${encodeURIComponent(orderId)}/packing`),
  setPackingStep: (orderId: string, step: string, done: boolean) =>
    request<PackingCheck>(`/pharmacy/orders/${encodeURIComponent(orderId)}/packing`, {
      method: "POST", body: json({ step, done }),
    }),
  /** Printable label payload (P13). */
  orderLabel: (orderId: string) =>
    request<{ label: OrderLabel }>(`/pharmacy/orders/${encodeURIComponent(orderId)}/label`),
  /** Delivery-zone stats (P14). */
  zoneStats: () => request<{ zones: ZoneStat[] }>("/pharmacy/zones"),
  /** Duplicate-order detector (P16). */
  duplicateOrders: () => request<{ duplicates: Order[] }>("/pharmacy/duplicates"),
  /** Kit batches with expiry (P17). */
  listBatches: (kitId?: string) =>
    request<{ batches: KitBatch[] }>(`/pharmacy/batches${kitId ? `?kit_id=${encodeURIComponent(kitId)}` : ""}`),
  createBatch: (payload: { kit_id: string; batch_no: string; expires_on?: string; qty?: number; supplier_id?: string }) =>
    request<KitBatch>("/pharmacy/batches", { method: "POST", body: json(payload) }),
  deleteBatch: (id: string) =>
    request<void>(`/pharmacy/batches/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateBatch: (id: string, patch: { batch_no?: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }) =>
    request<KitBatch>(`/pharmacy/batches/${encodeURIComponent(id)}`, { method: "PATCH", body: json(patch) }),
  /** Suppliers (P18). */
  listSuppliers: () => request<{ suppliers: Supplier[] }>("/pharmacy/suppliers"),
  createSupplier: (payload: { name: string; contact?: string; phone?: string; address?: string; note?: string }) =>
    request<Supplier>("/pharmacy/suppliers", { method: "POST", body: json(payload) }),
  updateSupplier: (id: string, patch: Partial<Supplier>) =>
    request<Supplier>(`/pharmacy/suppliers/${encodeURIComponent(id)}`, { method: "PATCH", body: json(patch) }),
  deleteSupplier: (id: string) =>
    request<void>(`/pharmacy/suppliers/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/* ----------------------------------------------------- consults --- */
export const consultsApi = {
  /** 403 feature_disabled while teleconsult_booking is OFF. */
  book: (doctor_id: string, scheduled_at: string, note?: string) =>
    request<Consult>("/consults/book", { method: "POST", body: json({ doctor_id, scheduled_at, note }) }),
};

/* -------------------------------------------------------- flags --- */
export interface PublicFlags {
  root_scan: boolean;
  cosmetic_kits: boolean;
  teleconsult_booking: boolean;
  prescription_commerce: boolean;
}

export const DEFAULT_FLAGS: PublicFlags = {
  root_scan: true,
  cosmetic_kits: true,
  teleconsult_booking: false,
  prescription_commerce: false,
};

export const flagsApi = {
  /**
   * Public flag snapshot for the customer app. The v1 contract only defines
   * /admin/flags (admin role); deployments may expose /flags publicly.
   * Falls back to the pre-legal defaults when unavailable.
   */
  getPublic: async (): Promise<PublicFlags> => {
    try {
      const body = await request<{ flags: FeatureFlag[] } | PublicFlags>("/flags", { noRetry: true });
      if (Array.isArray((body as { flags: FeatureFlag[] }).flags)) {
        const out = { ...DEFAULT_FLAGS };
        for (const f of (body as { flags: FeatureFlag[] }).flags) {
          if (f.key in out) (out as Record<string, boolean>)[f.key] = f.is_enabled;
        }
        return out;
      }
      return { ...DEFAULT_FLAGS, ...(body as PublicFlags) };
    } catch {
      return { ...DEFAULT_FLAGS };
    }
  },
};

/* -------------------------------------------------------- admin --- */
export const adminApi = {
  listFlags: () => request<FeatureFlagListResponse>("/admin/flags"),
  setFlag: (key: string, is_enabled: boolean) =>
    request<FeatureFlag>(`/admin/flags/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: json({ is_enabled }),
    }),
  listScanRules: (active_only = true) =>
    request<ScanRuleListResponse>(`/admin/scan-rules?active_only=${active_only}`),
  updateScanRule: (
    id: string,
    patch: Partial<Pick<ScanRule, "trigger_condition" | "action" | "action_detail" | "priority" | "is_active">>,
  ) => request<ScanRule>(`/admin/scan-rules/${encodeURIComponent(id)}`, { method: "PUT", body: json(patch) }),
  getFunnel: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const qs = q.toString();
    return request<FunnelAnalytics>(`/admin/analytics/funnel${qs ? `?${qs}` : ""}`);
  },
  listAudit: (params: { actor_id?: string; entity?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.actor_id) q.set("actor_id", params.actor_id);
    if (params.entity) q.set("entity", params.entity);
    q.set("limit", String(params.limit ?? 50));
    return request<AuditListResponse>(`/admin/audit?${q}`);
  },
  listUsers: () => request<AdminUserListResponse>("/admin/users"),
  updateUserRole: (id: string, role: Role) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(id)}/role`, {
      method: "PATCH",
      body: json({ role }),
    }),

  /* ---------------- P-12 admin dashboard features ---------------- */
  /** Broadcast in-app notification to all users or one role (A1). */
  broadcast: (payload: {
    title_en: string; title_ne?: string; body_en?: string; body_ne?: string;
    role?: "customer" | "doctor" | "pharmacy" | "coach"; link?: string;
  }) => request<{ sent: number; failed: number }>("/admin/broadcast", { method: "POST", body: json(payload) }),
  /** Record a refund on an order (A3). */
  createRefund: (orderId: string, amount_npr: number, reason?: string) =>
    request<{ refund: Refund; order: Order }>(
      `/admin/orders/${encodeURIComponent(orderId)}/refund`,
      { method: "POST", body: json({ amount_npr, reason }) },
    ),
  /** All refunds (A3). */
  listRefunds: () => request<{ refunds: Refund[] }>("/admin/refunds"),
  /** SLA monitor: overdue cases across doctors (A4). */
  listOverdueCases: () => request<{ cases: OverdueCase[] }>("/admin/sla"),
  /** Staff verification queue (A5). */
  listVerifications: (status?: string) =>
    request<{ verifications: StaffVerification[] }>(
      `/admin/verifications${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  /** Approve/reject a verification (A5). */
  decideVerification: (id: string, approved: boolean, note?: string) =>
    request<{ verification: StaffVerification }>(
      `/admin/verifications/${encodeURIComponent(id)}/decide`,
      { method: "POST", body: json({ approved, note }) },
    ),
  /** Finance snapshot (A6). */
  getFinance: () => request<{ finance: FinanceSnapshot }>("/admin/finance"),
  /** Support ticket inbox (A7). */
  listTickets: (status?: string) =>
    request<{ tickets: SupportTicket[] }>(
      `/admin/tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  /** Ticket + replies (A7). */
  getTicket: (id: string) =>
    request<{ ticket: SupportTicket; replies: TicketReply[] }>(`/admin/tickets/${encodeURIComponent(id)}`),
  /** Reply to a ticket — notifies the customer (A7). */
  replyTicket: (id: string, body: string) =>
    request<{ reply: TicketReply }>(`/admin/tickets/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      body: json({ body }),
    }),
  /** Change ticket status (A7). */
  setTicketStatus: (id: string, status: "open" | "answered" | "closed") =>
    request<{ ticket: SupportTicket }>(`/admin/tickets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json({ status }),
    }),
  /** Education articles (A8). */
  listArticles: () => request<{ articles: EducationArticle[] }>("/admin/articles"),
  createArticle: (payload: {
    title_en: string; title_ne?: string; body_en: string; body_ne?: string; is_published?: boolean;
  }) => request<{ article: EducationArticle }>("/admin/articles", { method: "POST", body: json(payload) }),
  updateArticle: (id: string, patch: Partial<EducationArticle>) =>
    request<{ article: EducationArticle }>(`/admin/articles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json(patch),
    }),
  deleteArticle: (id: string) =>
    request<void>(`/admin/articles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Doctor availability roster (D9 admin view). */
  listDoctorAvailability: () =>
    request<{ doctors: DoctorAvailability[] }>("/admin/doctors/availability"),

  /* ---------------- Batch 2 (008): A12–A20 ---------------- */
  /** Role permissions (A12). */
  getRolePermissions: (role: string) =>
    request<{ role: string; permissions: RolePermission[] }>(`/admin/roles/${encodeURIComponent(role)}/permissions`),
  setRolePermissions: (role: string, permissions: { permission: string; granted: boolean }[]) =>
    request<{ role: string; permissions: RolePermission[] }>(`/admin/roles/${encodeURIComponent(role)}/permissions`, {
      method: "PUT", body: json({ permissions }),
    }),
  /** Announcements (A13). */
  listAnnouncements: () => request<{ announcements: Announcement[] }>("/admin/announcements"),
  createAnnouncement: (payload: Partial<Announcement>) =>
    request<Announcement>("/admin/announcements", { method: "POST", body: json(payload) }),
  updateAnnouncement: (id: string, patch: Partial<Announcement>) =>
    request<Announcement>(`/admin/announcements/${encodeURIComponent(id)}`, { method: "PATCH", body: json(patch) }),
  deleteAnnouncement: (id: string) =>
    request<void>(`/admin/announcements/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Active sessions (A14). */
  listSessions: (userId: string) =>
    request<{ sessions: RefreshSessionView[] }>(`/admin/sessions?user_id=${encodeURIComponent(userId)}`),
  revokeSession: (tokenHash: string, userId: string) =>
    request<void>(`/admin/sessions/${encodeURIComponent(tokenHash)}?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" }),
  /** Login attempts (A15). */
  listLoginAttempts: (limit = 50) =>
    request<{ attempts: LoginAttempt[] }>(`/admin/login-attempts?limit=${limit}`),
  /** Coupons (A16). */
  listCoupons: () => request<{ coupons: Coupon[] }>("/admin/coupons"),
  createCoupon: (payload: Partial<Coupon>) =>
    request<Coupon>("/admin/coupons", { method: "POST", body: json(payload) }),
  updateCoupon: (id: string, is_active: boolean) =>
    request<Coupon>(`/admin/coupons/${encodeURIComponent(id)}`, { method: "PATCH", body: json({ is_active }) }),
  /** System health (A17). */
  getHealth: () => request<SystemHealth>("/admin/health"),
  /** Storage usage (A18). */
  getStorage: () => request<{ buckets: StorageBucketUsage[] }>("/admin/storage"),
  /** Backups (A19). */
  listBackups: () => request<{ backups: BackupRecord[] }>("/admin/backups"),
  recordBackup: (payload: Partial<BackupRecord>) =>
    request<BackupRecord>("/admin/backups", { method: "POST", body: json(payload) }),
  /** Notification templates (A20). */
  listNotificationTemplates: () =>
    request<{ templates: NotificationTemplate[] }>("/admin/notification-templates"),
  createNotificationTemplate: (payload: Partial<NotificationTemplate>) =>
    request<NotificationTemplate>("/admin/notification-templates", { method: "POST", body: json(payload) }),
  deleteNotificationTemplate: (id: string) =>
    request<void>(`/admin/notification-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/* ----------------------------------- admin kits ---
 * Assumed endpoints (sibling worker). Every call may 404 on older
 * servers — callers must catch ApiError and degrade gracefully. */
export const adminKitsApi = {
  list: (p: AdminKitListParams = {}) => {
    const q = new URLSearchParams();
    if (p.q) q.set("q", p.q);
    if (p.category) q.set("category", p.category);
    if (p.active !== undefined) q.set("active", String(p.active));
    q.set("page", String(p.page ?? 1));
    q.set("limit", String(p.limit ?? 20));
    return request<AdminKitListResponse>(`/admin/kits?${q}`);
  },
  get: (id: string) => request<AdminKit>(`/admin/kits/${encodeURIComponent(id)}`),
  create: (payload: KitUpsertPayload) =>
    request<AdminKit>("/admin/kits", { method: "POST", body: json(payload) }),
  update: (id: string, patch: Partial<KitUpsertPayload>) =>
    request<AdminKit>(`/admin/kits/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: json(patch),
    }),
  /** Soft-delete: the server hides the kit; the UI confirms first. */
  remove: (id: string) => request<void>(`/admin/kits/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Upload images one file per request: the server accepts a single
   *  multipart field named "image" per call. Returns the kit's full
   *  image URL list after the last upload. */
  uploadImages: async (id: string, files: File[]): Promise<{ images: string[] }> => {
    let images: string[] = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("image", f, f.name);
      const r = await request<{ images: string[] }>(
        `/admin/kits/${encodeURIComponent(id)}/images`,
        { method: "POST", body: fd },
      );
      images = r.images;
    }
    return { images };
  },
  /** Delete one kit image, identified by its public URL. */
  deleteImage: (kitId: string, imageUrl: string) =>
    request<{ images: string[] }>(
      `/admin/kits/${encodeURIComponent(kitId)}/images`,
      { method: "DELETE", body: JSON.stringify({ image_url: imageUrl }) },
    ),
};

/* ---------------------------------------- coach --- */
export const coachApi = {
  /** Customers assigned to this coach. May 404 until the server ships it. */
  listCustomers: () => request<{ customers: AssignedCustomer[] }>("/coach/customers"),
  /** Rule-based nudges for one customer (contract: ?user_id required for coach). */
  getNudges: (userId: string) =>
    request<{ nudges: Nudge[] }>(`/coach/nudges?user_id=${encodeURIComponent(userId)}`),

  /* ---------------- P-12 coach features ---------------- */
  /** Customer habit check-ins for review (C1). */
  listCustomerCheckins: (userId: string) =>
    request<{ checkins: Checkin[] }>(`/coach/customers/${encodeURIComponent(userId)}/checkins`),
  /** Challenges (C4). */
  listChallenges: () => request<{ challenges: Challenge[] }>("/coach/challenges"),
  /** Create a challenge (C4). */
  createChallenge: (payload: {
    title_en: string; title_ne?: string; days: 7 | 14 | 30;
    description_en?: string; description_ne?: string;
  }) => request<{ challenge: Challenge }>("/coach/challenges", { method: "POST", body: json(payload) }),
  /** Assign a challenge to a customer (C4). */
  assignChallenge: (challengeId: string, user_id: string) =>
    request<{ assignment: ChallengeAssignment }>(
      `/coach/challenges/${encodeURIComponent(challengeId)}/assign`,
      { method: "POST", body: json({ user_id }) },
    ),
  /** Timestamped customer notes history (C5). */
  listCustomerNotes: (userId: string) =>
    request<{ notes: CoachNote[] }>(`/coach/customers/${encodeURIComponent(userId)}/notes`),
  /** Add a customer note (C5). */
  addCustomerNote: (userId: string, note: string) =>
    request<{ note: CoachNote }>(`/coach/customers/${encodeURIComponent(userId)}/notes`, {
      method: "POST",
      body: json({ note }),
    }),
  /** Escalate a customer to doctors (C6). */
  escalateCustomer: (userId: string, reason: string) =>
    request<{ escalation: Escalation }>(`/coach/customers/${encodeURIComponent(userId)}/escalate`, {
      method: "POST",
      body: json({ reason }),
    }),
  /** Escalations (C6). */
  listEscalations: (status?: string) =>
    request<{ escalations: Escalation[] }>(
      `/coach/escalations${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  /** Scheduled reminders (C7). */
  listScheduledNudges: () => request<{ nudges: ScheduledNudge[] }>("/coach/nudges/scheduled"),
  /** Schedule a future nudge (C7). */
  scheduleNudge: (payload: { user_id: string; message_en: string; message_ne?: string; send_at: string }) =>
    request<{ nudge: ScheduledNudge }>("/coach/nudges/scheduled", { method: "POST", body: json(payload) }),
  /** Send a scheduled nudge now (C7). */
  sendScheduledNudge: (id: string) =>
    request<{ nudge: ScheduledNudge }>(`/coach/nudges/scheduled/${encodeURIComponent(id)}/send`, {
      method: "POST",
    }),
  /** Delete an unsent scheduled nudge (C7). */
  deleteScheduledNudge: (id: string) =>
    request<void>(`/coach/nudges/scheduled/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Satisfaction rating log (C8). */
  listSatisfaction: (userId: string) =>
    request<{ ratings: SatisfactionRating[] }>(
      `/coach/customers/${encodeURIComponent(userId)}/satisfaction`,
    ),
  /** Log a satisfaction rating (C8). */
  addSatisfaction: (userId: string, rating: number, comment?: string) =>
    request<{ rating: SatisfactionRating }>(
      `/coach/customers/${encodeURIComponent(userId)}/satisfaction`,
      { method: "POST", body: json({ rating, comment }) },
    ),
  /** Coach knowledge base: published education articles (C9). */
  listArticles: () => request<{ articles: EducationArticle[] }>("/coach/articles"),

  /* ---------------- Batch 2 (008): C10–C18 ---------------- */
  /** Group challenges (C10). */
  createChallengeGroup: (payload: { title_en: string; title_ne?: string; description_en?: string; description_ne?: string; starts_on?: string; ends_on?: string }) =>
    request<ChallengeGroup>("/coach/challenge-groups", { method: "POST", body: json(payload) }),
  listChallengeGroups: () => request<{ groups: ChallengeGroup[] }>("/coach/challenge-groups"),
  assignChallengeGroup: (groupId: string, userId: string) =>
    request<void>(`/coach/challenge-groups/${encodeURIComponent(groupId)}/assign`, {
      method: "POST", body: json({ user_id: userId }),
    }),
  /** Milestone badges (C11). */
  awardBadge: (userId: string, badge: string) =>
    request<Badge>(`/coach/customers/${encodeURIComponent(userId)}/badges`, {
      method: "POST", body: json({ badge }),
    }),
  listBadges: (userId: string) =>
    request<{ badges: Badge[] }>(`/coach/customers/${encodeURIComponent(userId)}/badges`),
  /** Session summaries (C12). */
  addSessionSummary: (userId: string, summary: string) =>
    request<SessionSummary>(`/coach/customers/${encodeURIComponent(userId)}/sessions`, {
      method: "POST", body: json({ summary }),
    }),
  listSessionSummaries: (userId: string) =>
    request<{ sessions: SessionSummary[] }>(`/coach/customers/${encodeURIComponent(userId)}/sessions`),
  /** Customer goals (C13). */
  createCustomerGoal: (userId: string, payload: { title_en: string; title_ne?: string; target_date?: string }) =>
    request<CustomerGoal>(`/coach/customers/${encodeURIComponent(userId)}/goals`, {
      method: "POST", body: json(payload),
    }),
  listCustomerGoals: (userId: string) =>
    request<{ goals: CustomerGoal[] }>(`/coach/customers/${encodeURIComponent(userId)}/goals`),
  completeCustomerGoal: (goalId: string) =>
    request<CustomerGoal>(`/coach/goals/${encodeURIComponent(goalId)}/complete`, { method: "PATCH" }),
  deleteCustomerGoal: (goalId: string) =>
    request<void>(`/coach/goals/${encodeURIComponent(goalId)}`, { method: "DELETE" }),
  /** Habit templates (C14). */
  createHabitTemplate: (payload: { title_en: string; title_ne?: string; description_en?: string; description_ne?: string }) =>
    request<HabitTemplate>("/coach/habit-templates", { method: "POST", body: json(payload) }),
  listHabitTemplates: () => request<{ templates: HabitTemplate[] }>("/coach/habit-templates"),
  deleteHabitTemplate: (id: string) =>
    request<void>(`/coach/habit-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateHabitTemplate: (id: string, patch: { title_en?: string; description_en?: string | null }) =>
    request<HabitTemplate>(`/coach/habit-templates/${encodeURIComponent(id)}`, { method: "PATCH", body: json(patch) }),
  /** Weekly digest (C15). */
  digestPreview: () =>
    request<{ at_risk_count: number; at_risk: CoachRiskFlag[] }>("/coach/digest/preview", { method: "POST", body: json({}) }),
  sendDigest: (payload: { headline_en: string; headline_ne?: string; body_en?: string; body_ne?: string }) =>
    request<{ sent: number }>("/coach/digest/send", { method: "POST", body: json(payload) }),
  /** Note templates (C16). */
  createNoteTemplate: (payload: { title: string; body_en: string; body_ne?: string }) =>
    request<NoteTemplate>("/coach/note-templates", { method: "POST", body: json(payload) }),
  listNoteTemplates: () => request<{ templates: NoteTemplate[] }>("/coach/note-templates"),
  deleteNoteTemplate: (id: string) =>
    request<void>(`/coach/note-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateNoteTemplate: (id: string, patch: { title?: string; body_en?: string }) =>
    request<NoteTemplate>(`/coach/note-templates/${encodeURIComponent(id)}`, { method: "PATCH", body: json(patch) }),
  /** Risk flags (C17). */
  riskFlags: () => request<{ flags: CoachRiskFlag[] }>("/coach/risk-flags"),
  /** Article assignment (C18). */
  assignArticle: (articleId: string, userId: string) =>
    request<ArticleAssignment>(`/coach/articles/${encodeURIComponent(articleId)}/assign`, {
      method: "POST", body: json({ user_id: userId }),
    }),
};

/* ---------------------------------- notifications --- */
export const notificationsApi = {
  /** Own inbox, newest first. */
  list: (limit = 20, offset = 0) =>
    request<{ notifications: AppNotification[]; unread_count: number }>(
      `/notifications?limit=${limit}&offset=${offset}`
    ),
  /** Mark one notification as read. */
  markRead: (id: string) =>
    request<{ notification: AppNotification }>(`/notifications/${encodeURIComponent(id)}/read`, {
      method: "PATCH",
    }),
};

export type { RedFlagType, Address };
