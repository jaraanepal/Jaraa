// Supabase Store implementation (production): Postgres via supabase-js service
// role (bypasses RLS; RLS policies remain as defense-in-depth for anon keys)
// + private Storage bucket 'scan-photos' for uploads.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import type { Role } from "./types";

const iso = (d: Date | string | number) => new Date(d).toISOString();

export class SupabaseStore implements Store {
  private sb: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  // ---- users ----
  async createUser(u: { phone: string; email?: string | null; role?: Role; passwordHash?: string | null; language?: string }) {
    const { data, error } = await this.sb.from("users").insert({
      phone: u.phone, email: u.email ?? null, role: u.role ?? "customer",
      language: u.language ?? "ne", password_hash: u.passwordHash ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async getUserById(id: string) {
    const { data } = await this.sb.from("users").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async getUserByPhone(phone: string) {
    const { data } = await this.sb.from("users").select("*").eq("phone", phone).maybeSingle();
    return data;
  }
  async getUserByEmail(email: string) {
    const { data } = await this.sb.from("users").select("*").ilike("email", email).maybeSingle();
    return data;
  }
  async listUsers() {
    const { data, error } = await this.sb.from("users").select("*").order("created_at");
    if (error) throw error;
    return data;
  }
  async updateUserRole(id: string, role: Role) {
    const { data, error } = await this.sb.from("users").update({ role }).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async setUserPassword(id: string, hash: string) {
    const { error } = await this.sb.from("users").update({ password_hash: hash }).eq("id", id);
    if (error) throw error;
  }

  // ---- profiles ----
  async getProfile(userId: string) {
    const { data } = await this.sb.from("profiles").select("*").eq("user_id", userId).maybeSingle();
    return data;
  }
  async upsertProfile(userId: string, p: Partial<import("./types").Profile>) {
    const { data, error } = await this.sb.from("profiles")
      .upsert({ user_id: userId, ...p }, { onConflict: "user_id" }).select().single();
    if (error) throw error;
    return data;
  }

  // ---- consents ----
  async addConsent(c: { user_id: string; type: string; version: string; granted: boolean; ip?: string | null }) {
    const { data, error } = await this.sb.from("consents").insert({ ...c, ip: c.ip ?? null }).select().single();
    if (error) throw error;
    return data;
  }
  async listConsents(userId: string) {
    const { data, error } = await this.sb.from("consents").select("*").eq("user_id", userId).order("granted_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async consentGranted(userId: string, type: string) {
    const { data } = await this.sb.from("consents").select("granted").eq("user_id", userId).eq("type", type)
      .order("granted_at", { ascending: false }).limit(1).maybeSingle();
    return !!data?.granted;
  }

  // ---- otp (otp_codes table; store keeps epoch-ms for the service's clock math) ----
  private rowToOtp(r: { code_hash: string; expires_at: string; attempts_left: number; request_count: number; window_start: string } | null) {
    if (!r) return null;
    return {
      code_hash: r.code_hash, expires_at: new Date(r.expires_at).getTime(),
      attempts_left: r.attempts_left, request_count: r.request_count,
      window_start: new Date(r.window_start).getTime(),
    };
  }
  async otpGet(phone: string) {
    const { data } = await this.sb.from("otp_codes").select("*").eq("phone", phone).maybeSingle();
    return this.rowToOtp(data);
  }
  async otpUpsert(phone: string, row: import("./types").OtpRow) {
    const { error } = await this.sb.from("otp_codes").upsert({
      phone, code_hash: row.code_hash, expires_at: iso(row.expires_at),
      attempts_left: row.attempts_left, request_count: row.request_count,
      window_start: iso(row.window_start),
    }, { onConflict: "phone" });
    if (error) throw error;
  }
  async otpDelete(phone: string) {
    await this.sb.from("otp_codes").delete().eq("phone", phone);
  }

  // ---- scans ----
  async createScan(s: { user_id: string | null; guest_token?: string | null }) {
    const { data, error } = await this.sb.from("scans").insert({
      user_id: s.user_id, guest_token: s.guest_token ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async getScan(id: string) {
    const { data } = await this.sb.from("scans").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async updateScan(id: string, patch: Partial<import("./types").Scan>) {
    const { data, error } = await this.sb.from("scans").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async listUserScans(userId: string) {
    const { data, error } = await this.sb.from("scans").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // ---- timeline ----
  async addTimelineEvent(e: { scan_id: string; event_type: string; occurred_on?: string | null; note?: string | null; followup_answers?: Record<string, unknown> }) {
    const { data, error } = await this.sb.from("timeline_events").insert({
      scan_id: e.scan_id, event_type: e.event_type, occurred_on: e.occurred_on ?? null,
      note: e.note ?? null, followup_answers: e.followup_answers ?? {},
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listTimelineEvents(scanId: string) {
    const { data, error } = await this.sb.from("timeline_events").select("*").eq("scan_id", scanId).order("created_at");
    if (error) throw error;
    return data;
  }

  // ---- photos ----
  async upsertPhoto(p: { scan_id: string; angle: import("./types").PhotoAngle; storage_path: string; thumb_path?: string | null; consent_id?: string | null; ai_quality?: unknown; width?: number | null; height?: number | null }) {
    const { data, error } = await this.sb.from("photos").upsert({
      scan_id: p.scan_id, angle: p.angle, storage_path: p.storage_path,
      thumb_path: p.thumb_path ?? null, consent_id: p.consent_id ?? null,
      ai_quality: p.ai_quality ?? null, width: p.width ?? null, height: p.height ?? null,
    }, { onConflict: "scan_id,angle" }).select().single();
    if (error) throw error;
    return data;
  }
  async getPhoto(id: string) {
    const { data } = await this.sb.from("photos").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async listPhotos(scanId: string) {
    const { data, error } = await this.sb.from("photos").select("*").eq("scan_id", scanId).order("created_at");
    if (error) throw error;
    return data;
  }
  async deletePhoto(id: string) {
    await this.sb.from("photos").delete().eq("id", id);
  }

  // ---- scores ----
  async setRootScores(scanId: string, scores: { root: string; score: number; signals: Record<string, unknown> }[]) {
    const { error } = await this.sb.from("root_scores").upsert(
      scores.map((s) => ({ scan_id: scanId, root: s.root, score: s.score, signals: s.signals })),
      { onConflict: "scan_id,root" });
    if (error) throw error;
  }
  async getRootScores(scanId: string) {
    const { data, error } = await this.sb.from("root_scores").select("*").eq("scan_id", scanId);
    if (error) throw error;
    return data;
  }

  // ---- red flags ----
  async addRedFlag(f: { scan_id: string; flag_type: string; detail: string }) {
    const { data, error } = await this.sb.from("red_flags").insert(f).select().single();
    if (error) throw error;
    return data;
  }
  async listRedFlags(scanId: string, opts?: { unresolvedOnly?: boolean }) {
    let q = this.sb.from("red_flags").select("*").eq("scan_id", scanId).order("created_at");
    if (opts?.unresolvedOnly) q = q.is("resolved_at", null);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async resolveRedFlag(id: string, doctorId: string) {
    const { data, error } = await this.sb.from("red_flags")
      .update({ resolved_by: doctorId, resolved_at: new Date().toISOString() })
      .eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- scan rules ----
  async listScanRules(activeOnly: boolean) {
    let q = this.sb.from("scan_rules").select("*").order("priority", { ascending: false });
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async updateScanRule(id: string, patch: Partial<import("./types").ScanRule>) {
    const { data, error } = await this.sb.from("scan_rules").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- cases ----
  async createCase(c: { scan_id: string; priority: number; sla_due_at: string }) {
    const { data, error } = await this.sb.from("cases").insert(c).select().single();
    if (error) throw error;
    return data;
  }
  async getCase(id: string) {
    const { data } = await this.sb.from("cases").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async getCaseByScan(scanId: string) {
    const { data } = await this.sb.from("cases").select("*").eq("scan_id", scanId).maybeSingle();
    return data;
  }
  async listCases(opts: { status?: string; limit: number; cursor?: string | null }) {
    let q = this.sb.from("cases").select("*")
      .order("priority", { ascending: false })
      .order("sla_due_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.cursor) {
      const cur = await this.getCase(opts.cursor);
      if (cur) {
        // keyset-ish: fetch all and slice (queue is small in v1)
        const { data, error } = await q;
        if (error) throw error;
        const i = data.findIndex((c: { id: string }) => c.id === opts.cursor);
        const rows = i >= 0 ? data.slice(i + 1) : [];
        const page = rows.slice(0, opts.limit);
        return { cases: page, nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null };
      }
    }
    const { data, error } = await q.limit(opts.limit + 1);
    if (error) throw error;
    const page = data.slice(0, opts.limit);
    return { cases: page, nextCursor: data.length > opts.limit ? page[page.length - 1].id : null };
  }
  async claimCase(id: string, doctorId: string) {
    const cur = await this.getCase(id);
    if (!cur) return { kase: null, conflict: false };
    if (cur.assigned_doctor_id && cur.assigned_doctor_id !== doctorId) return { kase: null, conflict: true };
    const { data, error } = await this.sb.from("cases")
      .update({ assigned_doctor_id: doctorId, status: "in_review" }).eq("id", id).select().single();
    if (error) throw error;
    return { kase: data, conflict: false };
  }
  async updateCase(id: string, patch: Partial<import("./types").Case>) {
    const { data, error } = await this.sb.from("cases").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- annotations ----
  async addAnnotation(a: { photo_id: string; doctor_id: string; shape: Record<string, unknown>; note?: string | null }) {
    const { data, error } = await this.sb.from("photo_annotations")
      .insert({ photo_id: a.photo_id, doctor_id: a.doctor_id, shape: a.shape, note: a.note ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }

  // ---- plans ----
  async createPlan(p: { case_id: string; doctor_id: string; review_notes?: string | null; rescan_due_on?: string | null; items: import("./types").PlanItemInput[]; resolved_flag_ids?: string[] }) {
    const { data: plan, error } = await this.sb.from("plans").insert({
      case_id: p.case_id, doctor_id: p.doctor_id,
      review_notes: p.review_notes ?? null, rescan_due_on: p.rescan_due_on ?? null,
    }).select().single();
    if (error) throw error;
    const items = p.items.map((it, i) => ({
      plan_id: plan.id, kind: it.kind, title_ne: it.title_ne ?? null, title_en: it.title_en ?? null,
      detail: { text: it.detail ?? null, product_id: it.product_id ?? null }, sort: it.sort_order ?? i,
    }));
    const { data: savedItems, error: e2 } = await this.sb.from("plan_items").insert(items).select();
    if (e2) throw e2;
    if (p.resolved_flag_ids) for (const fid of p.resolved_flag_ids) await this.resolveRedFlag(fid, p.doctor_id);
    return { ...plan, items: savedItems };
  }
  async getPlan(id: string) {
    const { data: plan } = await this.sb.from("plans").select("*").eq("id", id).maybeSingle();
    if (!plan) return null;
    const { data: items } = await this.sb.from("plan_items").select("*").eq("plan_id", id).order("sort");
    return { ...plan, items: items ?? [] };
  }
  async getLatestApprovedPlanForUser(userId: string) {
    // join via cases -> scans
    const { data } = await this.sb.from("plans").select("*, cases!inner(scan_id, scans!inner(user_id))")
      .eq("status", "approved").eq("cases.scans.user_id", userId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    const { data: items } = await this.sb.from("plan_items").select("*").eq("plan_id", data.id).order("sort");
    return { ...data, items: items ?? [] };
  }
  async approvePlan(id: string, approverId: string) {
    const plan = await this.getPlan(id);
    if (!plan) return { plan: null };
    if (plan.status === "approved") return { plan: null, reason: "already_approved" };
    const kase = await this.getCase(plan.case_id);
    if (kase) {
      const open = await this.listRedFlags(kase.scan_id, { unresolvedOnly: true });
      if (open.length) return { plan: null, reason: "red_flag_unresolved" };
    }
    const { error } = await this.sb.from("plans").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    if (kase) await this.updateCase(kase.id, { status: "reviewed" });
    return { plan: await this.getPlan(id) };
  }

  // ---- catalog ----
  async createProduct(p: { name_en: string; name_ne?: string | null; kind: "cosmetic" | "prescription"; price_npr: number; image_url?: string | null; is_active?: boolean }) {
    const { data, error } = await this.sb.from("products").insert({
      name_en: p.name_en, name_ne: p.name_ne ?? null, kind: p.kind,
      price_npr: p.price_npr, image_url: p.image_url ?? null, is_active: p.is_active ?? true,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async createKit(k: { name_en: string; name_ne?: string | null; product_ids: string[]; total_npr: number; is_active?: boolean }) {
    const { data, error } = await this.sb.from("kits").insert({
      name_en: k.name_en, name_ne: k.name_ne ?? null, product_ids: k.product_ids,
      total_npr: k.total_npr, is_active: k.is_active ?? true,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listProducts(opts: { activeOnly: boolean; cosmeticOnly: boolean }) {
    let q = this.sb.from("products").select("*");
    if (opts.activeOnly) q = q.eq("is_active", true);
    if (opts.cosmeticOnly) q = q.eq("kind", "cosmetic");
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async getProduct(id: string) {
    const { data } = await this.sb.from("products").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async listKits(activeOnly: boolean) {
    let q = this.sb.from("kits").select("*");
    if (activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async getKit(id: string) {
    const { data } = await this.sb.from("kits").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async updateKit(id: string, patch: Partial<import("./types").Kit>) {
    const { data, error } = await this.sb.from("kits").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- orders ----
  async createOrder(o: { order_no: string; user_id: string; kit_id: string | null; subtotal_npr: number; shipping_npr: number; total_npr: number; payment_method: string; idempotency_key: string; shipping_address: Record<string, unknown> }) {
    const { data, error } = await this.sb.from("orders").insert({
      order_no: o.order_no, user_id: o.user_id, kit_id: o.kit_id,
      subtotal_npr: o.subtotal_npr, shipping_npr: o.shipping_npr, total_npr: o.total_npr,
      payment_method: o.payment_method, idempotency_key: o.idempotency_key,
      shipping_address: o.shipping_address,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async getOrder(id: string) {
    const { data } = await this.sb.from("orders").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async getOrderByNo(orderNo: string) {
    const { data } = await this.sb.from("orders").select("*").eq("order_no", orderNo).maybeSingle();
    return data;
  }
  async getOrderByIdempotency(key: string) {
    const { data } = await this.sb.from("orders").select("*").eq("idempotency_key", key).maybeSingle();
    return data;
  }
  async updateOrder(id: string, patch: Partial<import("./types").Order>) {
    const { data, error } = await this.sb.from("orders").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async listOrdersByUser(userId: string) {
    const { data, error } = await this.sb.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async listOrdersForPharmacy() {
    // Fulfillable = paid online orders + pending COD orders (cash on delivery).
    const { data, error } = await this.sb.from("orders").select("*")
      .or("status.in.(paid,fulfilling,shipped),and(status.eq.pending,payment_method.eq.cod)")
      .order("created_at");
    if (error) throw error;
    return data;
  }

  // ---- payments ----
  async createPayment(p: { order_id: string; provider: string; amount_npr: number }) {
    const { data, error } = await this.sb.from("payments")
      .insert({ order_id: p.order_id, provider: p.provider, amount_npr: p.amount_npr }).select().single();
    if (error) throw error;
    return data;
  }
  async getPaymentByProviderRef(provider: string, ref: string) {
    const { data } = await this.sb.from("payments").select("*")
      .eq("provider", provider).eq("provider_ref", ref).maybeSingle();
    return data;
  }
  async updatePayment(id: string, patch: Partial<import("./types").Payment>) {
    const { data, error } = await this.sb.from("payments").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async listPaymentsByOrder(orderId: string) {
    const { data, error } = await this.sb.from("payments").select("*").eq("order_id", orderId);
    if (error) throw error;
    return data;
  }

  // ---- consults ----
  async createConsult(c: { user_id: string; doctor_id?: string | null; scheduled_at?: string | null; status: string }) {
    const { data, error } = await this.sb.from("consults").insert({
      user_id: c.user_id, doctor_id: c.doctor_id ?? null,
      scheduled_at: c.scheduled_at ?? null, status: c.status,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listConsultsByUser(userId: string) {
    const { data, error } = await this.sb.from("consults").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // ---- checkins ----
  async addCheckin(c: { user_id: string; plan_id?: string | null; shedding_estimate?: number | null; note?: string | null; photo_ids?: string[] }) {
    const { data, error } = await this.sb.from("progress_checkins").insert({
      user_id: c.user_id, plan_id: c.plan_id ?? null,
      shedding_estimate: c.shedding_estimate ?? null, note: c.note ?? null,
    }).select().single();
    if (error) throw error;
    return { ...data, photo_ids: c.photo_ids ?? [] };
  }
  async listCheckins(userId: string) {
    const { data, error } = await this.sb.from("progress_checkins").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((c) => ({ ...c, photo_ids: [] as string[] }));
  }

  // ---- flags ----
  async listFeatureFlags() {
    const { data, error } = await this.sb.from("feature_flags").select("*");
    if (error) throw error;
    return data;
  }
  async setFeatureFlag(key: string, enabled: boolean, updatedBy: string | null) {
    const { data, error } = await this.sb.from("feature_flags")
      .update({ is_enabled: enabled, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .eq("key", key).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- audit ----
  async addAudit(a: { actor_id?: string | null; action: string; entity: string; entity_id?: string | null; ip?: string | null }) {
    const { data, error } = await this.sb.from("audit_log").insert({
      actor_id: a.actor_id ?? null, action: a.action, entity: a.entity,
      entity_id: a.entity_id ?? null, ip: a.ip ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listAudit(f: { actor_id?: string; entity?: string; from?: string; to?: string; limit: number }) {
    let q = this.sb.from("audit_log").select("*").order("at", { ascending: false }).limit(f.limit);
    if (f.actor_id) q = q.eq("actor_id", f.actor_id);
    if (f.entity) q = q.eq("entity", f.entity);
    if (f.from) q = q.gte("at", f.from);
    if (f.to) q = q.lte("at", f.to);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  // ---- refresh tokens ----
  async saveRefreshToken(t: { token_hash: string; user_id: string; expires_at: string }) {
    const { error } = await this.sb.from("refresh_tokens").upsert(t, { onConflict: "token_hash" });
    if (error) throw error;
  }
  async getRefreshToken(hash: string) {
    const { data } = await this.sb.from("refresh_tokens").select("*").eq("token_hash", hash).maybeSingle();
    return data;
  }
  async deleteRefreshToken(hash: string) {
    await this.sb.from("refresh_tokens").delete().eq("token_hash", hash);
  }

  // ---- deletion requests ----
  async createDeletionRequest(r: { user_id: string; scheduled_for: string; note: string }) {
    const { data, error } = await this.sb.from("deletion_requests").insert(r).select().single();
    if (error) throw error;
    return data;
  }

  // ---- storage passthrough for the photo pipeline ----
  storage() { return this.sb.storage; }

  // ---- analytics ----
  async analyticsSnapshot(): Promise<import("./types").AnalyticsSnapshot> {
    const { data: scans } = await this.sb.from("scans").select("current_stage,status,user_id");
    const stages = ["kahani", "lens", "jara", "root_map", "submitted"];
    const rows = scans ?? [];
    const stage_funnel = stages.map((stage, i) => {
      const n = i + 1;
      const entered = rows.filter((s) => s.current_stage >= n || s.status !== "draft").length;
      const completed = rows.filter((s) => s.current_stage > n || ["submitted", "in_review", "reviewed", "flagged"].includes(s.status)).length;
      return { stage, entered, completed };
    });
    const { data: cases } = await this.sb.from("cases").select("created_at,updated_at,status");
    const reviewed = (cases ?? []).filter((c) => c.status === "reviewed");
    const slas = reviewed.map((c) => (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 3_600_000).sort((a, b) => a - b);
    const review_sla_hours_median = slas.length ? slas[Math.floor(slas.length / 2)] : null;
    const { count: planCount } = await this.sb.from("plans").select("id", { count: "exact", head: true }).eq("status", "approved");
    const { count: orderCount } = await this.sb.from("orders").select("id", { count: "exact", head: true });
    const plan_view_to_kit_rate = planCount ? (orderCount ?? 0) / planCount : 0;
    const byUser = new Map<string, number>();
    for (const s of rows) if (s.user_id) byUser.set(s.user_id, (byUser.get(s.user_id) ?? 0) + 1);
    const multi = [...byUser.values()].filter((n) => n > 1).length;
    const rescan_rate_m2 = byUser.size ? multi / byUser.size : 0;
    return { stage_funnel, review_sla_hours_median, plan_view_to_kit_rate, rescan_rate_m2, red_flag_misses: 0 };
  }

  async ensureSeededFlags() {
    const seed: [string, boolean][] = [
      ["root_scan", true], ["cosmetic_kits", true],
      ["teleconsult_booking", false], ["prescription_commerce", false],
    ];
    for (const [key, is_enabled] of seed) {
      await this.sb.from("feature_flags").upsert({ key, is_enabled }, { onConflict: "key", ignoreDuplicates: true });
    }
  }

  async seedScanRules(rules: Omit<import("./types").ScanRule, "id" | "created_at">[]) {
    // only seed if table empty (mirrors 001_init.sql seed; admin edits win)
    const { count } = await this.sb.from("scan_rules").select("id", { count: "exact", head: true });
    if (count) return;
    await this.sb.from("scan_rules").insert(rules);
  }
}

export function randomId() { return randomUUID(); }
