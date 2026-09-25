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
  AuditListResponse,
  Case,
  CaseListResponse,
  Checkin,
  Consent,
  ConsentType,
  Consult,
  CreateOrderPayload,
  DataDeletionResponse,
  FeatureFlag,
  FeatureFlagListResponse,
  FunnelAnalytics,
  KitListResponse,
  Kit,
  KitUpsertPayload,
  Nudge,
  Order,
  OrderStatus,
  OtpRequestResponse,
  OtpVerifyResponse,
  PasswordAuthResponse,
  Photo,
  PhotoAngle,
  Plan,
  PlanItemKind,
  Profile,
  ProgressBundle,
  RedFlag,
  RedFlagType,
  Role,
  RootMap,
  Scan,
  ScanDetail,
  ScanRule,
  ScanRuleListResponse,
  ScanStage,
  StageAdvanceResponse,
  TimelineEvent,
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

async function refreshAccessToken(): Promise<boolean> {
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
  getProgress: () => request<ProgressBundle>("/me/progress"),
  requestDataDeletion: () => request<DataDeletionResponse>("/me/data", { method: "DELETE" }),
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
        sort_order: number;
      }>;
      review_notes?: string;
      rescan_due_on?: string;
      resolved_flag_ids?: string[];
    },
  ) => request<Plan>(`/doctor/cases/${caseId}/plan`, { method: "POST", body: json(payload) }),
  approvePlan: (planId: string) => request<Plan>(`/doctor/plans/${planId}/approve`, {
    method: "POST",
    body: json({}),
  }),
  /** Full case context for review: the scan detail carries timeline, photos, scores, flags. */
  getCaseScan: (scanId: string) => scansApi.getScan(scanId),
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
};

export type { RedFlagType, Address };
