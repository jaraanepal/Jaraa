// Supabase Store implementation (production): Postgres via supabase-js service
// role (bypasses RLS; RLS policies remain as defense-in-depth for anon keys)
// + private Storage bucket 'scan-photos' for uploads.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import type {
  AppFeedback,
  AuditEntry,
  Case,
  CaseMessage,
  Challenge,
  ChallengeAssignment,
  CoachAvailability,
  CommunityTip,
  CoachFeedback, StreakFreeze, CustomerTag, CoachHandover, CoachTip, ChallengeSurvey, JourneyStage,
  Dispute,
  ExportSchedule,
  FollowUp,
  Kit,
  KitReminder,
  KitUsage,
  LoyaltyEntry,
  OnboardingChecklist,
  OrderNote,
  PackagingMaterial,
  PlanTemplate,
  QuarantineEntry,
  ReviewRequest,
  Role,
  RoutineItem,
  SecondOpinion,
  StaffChecklist,
  TriagePreset,
  WishlistItem,
} from "./types";

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
  async createPlan(p: { case_id: string; doctor_id: string; review_notes?: string | null; rescan_due_on?: string | null; items: import("./types").PlanItemInput[]; resolved_flag_ids?: string[]; resolved_flag_notes?: Record<string, string> | null }) {
    const { data: plan, error } = await this.sb.from("plans").insert({
      case_id: p.case_id, doctor_id: p.doctor_id,
      review_notes: p.review_notes ?? null, rescan_due_on: p.rescan_due_on ?? null,
    }).select().single();
    if (error) throw error;
    const items = p.items.map((it, i) => ({
      plan_id: plan.id, kind: it.kind, title_ne: it.title_ne ?? null, title_en: it.title_en ?? null,
      detail: { text: it.detail ?? null, product_id: it.product_id ?? null, kit_id: it.kit_id ?? null }, sort: it.sort_order ?? i,
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
  async createKit(k: { name_en: string; name_ne?: string | null; product_ids: string[]; total_npr: number; is_active?: boolean; category?: string | null; images?: string[]; whats_included?: string | null; usage_instructions?: string | null; stock?: number }) {
    const { data, error } = await this.sb.from("kits").insert({
      name_en: k.name_en, name_ne: k.name_ne ?? null, product_ids: k.product_ids,
      total_npr: k.total_npr, is_active: k.is_active ?? true,
      category: k.category ?? null, images: k.images ?? [],
      whats_included: k.whats_included ?? null, usage_instructions: k.usage_instructions ?? null,
      stock: k.stock ?? 0,
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
  async listKitsAdmin(opts: { search?: string; category?: string; isActive?: boolean; limit: number; offset: number }) {
    let q = this.sb.from("kits").select("*", { count: "exact" });
    const search = (opts.search ?? "").trim().replace(/[%_]/g, "");
    if (search) q = q.or(`name_en.ilike.%${search}%,name_ne.ilike.%${search}%`);
    if (opts.category !== undefined) q = q.eq("category", opts.category);
    if (opts.isActive !== undefined) q = q.eq("is_active", opts.isActive);
    q = q.order("created_at", { ascending: false }).range(opts.offset, opts.offset + opts.limit - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    return { kits: data ?? [], total: count ?? 0 };
  }
  async getKit(id: string) {
    const { data } = await this.sb.from("kits").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async updateKit(id: string, patch: Partial<import("./types").Kit>) {
    // U33 (batch 4): price-drop alerts need the pre-update price. The admin
    // PATCH /admin/kits/:id route can only see the Store interface, which
    // cannot enumerate wishlists, so the hook lives here on the kit-update
    // path. Alert failures must never break the kit update itself.
    let oldPrice: number | null = null;
    if (patch.total_npr !== undefined) {
      const { data: prev } = await this.sb.from("kits").select("total_npr").eq("id", id).maybeSingle();
      oldPrice = typeof prev?.total_npr === "number" ? prev.total_npr : null;
    }
    const { data, error } = await this.sb.from("kits").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    if (data && oldPrice !== null && Number(patch.total_npr) < oldPrice) {
      try {
        const { data: wishers } = await this.sb.from("wishlist").select("user_id").eq("kit_id", id);
        const kitName: string = data.name_en ?? "Kit";
        for (const w of wishers ?? []) {
          await this.createNotification({
            user_id: w.user_id as string, type: "price_drop",
            title_en: `Price drop: ${kitName}`,
            title_ne: `मूल्य घट्यो: ${kitName}`,
            body_en: `A kit on your wishlist is now NPR ${patch.total_npr} (was NPR ${oldPrice}).`,
            body_ne: `तपाईंको विशलिस्टमा रहेको किट अब रू ${patch.total_npr} (पहिले रू ${oldPrice}) मा छ।`,
            link: `/kits/${id}`,
          });
        }
      } catch { /* alert failure must not fail the kit update */ }
    }
    return data;
  }

  // ---- orders ----
  async createOrder(o: { order_no: string; user_id: string; kit_id: string | null; subtotal_npr: number; shipping_npr: number; total_npr: number; payment_method: string; idempotency_key: string; shipping_address: Record<string, unknown>; delivery_instructions?: string | null; coupon_code?: string | null; discount_npr?: number }) {
    const { data, error } = await this.sb.from("orders").insert({
      order_no: o.order_no, user_id: o.user_id, kit_id: o.kit_id,
      subtotal_npr: o.subtotal_npr, shipping_npr: o.shipping_npr, total_npr: o.total_npr,
      payment_method: o.payment_method, idempotency_key: o.idempotency_key,
      shipping_address: o.shipping_address, delivery_instructions: o.delivery_instructions ?? null,
      coupon_code: o.coupon_code ?? null, discount_npr: o.discount_npr ?? 0,
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
    // P34: rush orders sort first, then oldest-first.
    const { data, error } = await this.sb.from("orders").select("*")
      .or("status.in.(paid,fulfilling,shipped),and(status.eq.pending,payment_method.eq.cod)")
      .order("is_rush", { ascending: false }).order("created_at");
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
  async addAudit(a: { actor_id?: string | null; action: string; entity: string; entity_id?: string | null; ip?: string | null; detail?: string | null }) {
    const { data, error } = await this.sb.from("audit_log").insert({
      actor_id: a.actor_id ?? null, action: a.action, entity: a.entity,
      entity_id: a.entity_id ?? null, ip: a.ip ?? null, detail: a.detail ?? null,
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

  // ---- password resets ----
  async savePasswordReset(r: { token_hash: string; user_id: string; expires_at: string }) {
    const { error } = await this.sb.from("password_resets").upsert(r, { onConflict: "token_hash" });
    if (error) throw error;
  }
  async getPasswordReset(tokenHash: string) {
    const { data } = await this.sb.from("password_resets").select("*").eq("token_hash", tokenHash).maybeSingle();
    return data;
  }
  async deletePasswordReset(tokenHash: string) {
    await this.sb.from("password_resets").delete().eq("token_hash", tokenHash);
  }

  // ---- deletion requests ----
  async createDeletionRequest(r: { user_id: string; scheduled_for: string; note: string }) {
    const { data, error } = await this.sb.from("deletion_requests").insert(r).select().single();
    if (error) throw error;
    return data;
  }

  // ---- notifications (P-6) ----
  async createNotification(n: { user_id: string; type: string; title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null }) {
    const { data, error } = await this.sb.from("notifications").insert({
      user_id: n.user_id, type: n.type, title_en: n.title_en,
      title_ne: n.title_ne ?? null, body_en: n.body_en ?? null, body_ne: n.body_ne ?? null,
      link: n.link ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async listNotifications(userId: string, opts: { limit: number; offset: number }) {
    const { data, error } = await this.sb.from("notifications")
      .select("*").eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (error) throw error;
    const { count, error: e2 } = await this.sb.from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).is("read_at", null);
    if (e2) throw e2;
    return { notifications: data ?? [], unreadCount: count ?? 0 };
  }

  async markNotificationRead(id: string, userId: string) {
    const { data, error } = await this.sb.from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", userId)
      .select().maybeSingle();
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

  // ---------------- P-12 dashboard features (007) ----------------
  async listCasesByUser(userId: string) {
    const { data: scans, error: e1 } = await this.sb.from("scans").select("id").eq("user_id", userId);
    if (e1) throw e1;
    const ids = (scans ?? []).map((s: { id: string }) => s.id);
    if (!ids.length) return [];
    const { data, error } = await this.sb.from("cases").select("*").in("scan_id", ids).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async searchPatients(q: string) {
    const needle = q.trim();
    if (!needle) return [];
    const [byPhone, byName] = await Promise.all([
      this.sb.from("users").select("*").ilike("phone", `%${needle}%`).limit(20),
      this.sb.from("profiles").select("*, user:users(*)").ilike("name", `%${needle}%`).limit(20),
    ]);
    if (byPhone.error) throw byPhone.error;
    if (byName.error) throw byName.error;
    const seen = new Set<string>();
    const out: { user: import("./types").User; profile: import("./types").Profile | null }[] = [];
    for (const u of byPhone.data ?? []) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      const { data: p } = await this.sb.from("profiles").select("*").eq("user_id", u.id).maybeSingle();
      out.push({ user: u, profile: p });
    }
    for (const p of byName.data ?? []) {
      const u = (p as { user: import("./types").User | null }).user;
      if (!u || seen.has(u.id)) continue;
      seen.add(u.id);
      const { user: _omit, ...profile } = p as Record<string, unknown>;
      out.push({ user: u, profile: profile as unknown as import("./types").Profile });
    }
    return out.slice(0, 20);
  }
  async bulkUpdateCasePriority(ids: string[], priority: number) {
    if (!ids.length) return 0;
    const { data, error } = await this.sb.from("cases").update({ priority })
      .in("id", ids).in("status", ["queued", "in_review"]).select("id");
    if (error) throw error;
    return (data ?? []).length;
  }
  async listOverdueCases() {
    const { data, error } = await this.sb.from("cases").select("*")
      .in("status", ["queued", "in_review"]).lt("sla_due_at", new Date().toISOString())
      .order("sla_due_at");
    if (error) throw error;
    return data;
  }
  async createFollowUp(f: { case_id: string; doctor_id: string; due_on: string; note?: string | null }) {
    const { data, error } = await this.sb.from("follow_ups")
      .insert({ case_id: f.case_id, doctor_id: f.doctor_id, due_on: f.due_on, note: f.note ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listFollowUps(doctorId: string, opts?: { dueOnly?: boolean }) {
    let q = this.sb.from("follow_ups").select("*").eq("doctor_id", doctorId).is("done_at", null);
    if (opts?.dueOnly) q = q.lte("due_on", new Date().toISOString().slice(0, 10));
    const { data, error } = await q.order("due_on");
    if (error) throw error;
    return data;
  }
  async completeFollowUp(id: string, doctorId: string) {
    const { data, error } = await this.sb.from("follow_ups")
      .update({ done_at: new Date().toISOString() }).eq("id", id).eq("doctor_id", doctorId)
      .select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async setDoctorAvailability(doctorId: string, status: import("./types").DoctorAvailabilityStatus, note?: string | null) {
    const { data, error } = await this.sb.from("doctor_availability")
      .upsert({ doctor_id: doctorId, status, note: note ?? null, updated_at: new Date().toISOString() }, { onConflict: "doctor_id" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async getDoctorAvailability(doctorId: string) {
    const { data } = await this.sb.from("doctor_availability").select("*").eq("doctor_id", doctorId).maybeSingle();
    return data;
  }
  async listDoctorAvailability() {
    const { data, error } = await this.sb.from("users").select("id, phone").eq("role", "doctor");
    if (error) throw error;
    const out: (import("./types").DoctorAvailability & { name: string | null; phone: string })[] = [];
    for (const u of data ?? []) {
      const { data: a } = await this.sb.from("doctor_availability").select("*").eq("doctor_id", u.id).maybeSingle();
      const { data: p } = await this.sb.from("profiles").select("name").eq("user_id", u.id).maybeSingle();
      out.push({
        doctor_id: u.id, status: a?.status ?? "available", note: a?.note ?? null,
        updated_at: a?.updated_at ?? "", name: p?.name ?? null, phone: u.phone,
      });
    }
    return out;
  }
  async listAllOrders() {
    const { data, error } = await this.sb.from("orders").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async createRefund(r: { order_id: string; amount_npr: number; reason?: string | null; created_by: string }) {
    const { data, error } = await this.sb.from("refunds")
      .insert({ order_id: r.order_id, amount_npr: r.amount_npr, reason: r.reason ?? null, created_by: r.created_by })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listRefunds() {
    const { data, error } = await this.sb.from("refunds").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async upsertStaffVerification(userId: string, requestedRole: string) {
    const { data: existing } = await this.sb.from("staff_verifications")
      .select("*").eq("user_id", userId).eq("status", "pending").maybeSingle();
    if (existing) return existing;
    const { data, error } = await this.sb.from("staff_verifications")
      .insert({ user_id: userId, requested_role: requestedRole }).select().single();
    if (error) throw error;
    return data;
  }
  async listStaffVerifications(status?: import("./types").StaffVerificationStatus) {
    let q = this.sb.from("staff_verifications").select("*");
    if (status) q = q.eq("status", status);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async decideStaffVerification(id: string, approved: boolean, decidedBy: string, note?: string | null) {
    const { data: v } = await this.sb.from("staff_verifications").select("*").eq("id", id).maybeSingle();
    if (!v || v.status !== "pending") return null;
    const patch = {
      status: approved ? "approved" : "rejected", decided_by: decidedBy,
      decided_at: new Date().toISOString(), note: note ?? null,
    };
    const { data, error } = await this.sb.from("staff_verifications").update(patch).eq("id", id).select().single();
    if (error) throw error;
    if (approved) {
      const { error: e2 } = await this.sb.from("users").update({ role: v.requested_role }).eq("id", v.user_id);
      if (e2) throw e2;
    }
    return data;
  }
  async createTicket(t: { user_id: string; subject: string; body: string }) {
    const { data: ticket, error: e1 } = await this.sb.from("support_tickets")
      .insert({ user_id: t.user_id, subject: t.subject }).select().single();
    if (e1) throw e1;
    const { error: e2 } = await this.sb.from("ticket_replies")
      .insert({ ticket_id: ticket.id, author_id: t.user_id, author_role: "customer", body: t.body });
    if (e2) throw e2;
    return ticket;
  }
  async listTickets(opts: { user_id?: string; status?: import("./types").TicketStatus }) {
    let q = this.sb.from("support_tickets").select("*");
    if (opts.user_id) q = q.eq("user_id", opts.user_id);
    if (opts.status) q = q.eq("status", opts.status);
    const { data, error } = await q.order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async getTicket(id: string) {
    const { data } = await this.sb.from("support_tickets").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async addTicketReply(ticketId: string, authorId: string, authorRole: string, body: string) {
    const { data, error } = await this.sb.from("ticket_replies")
      .insert({ ticket_id: ticketId, author_id: authorId, author_role: authorRole, body })
      .select().single();
    if (error) throw error;
    await this.sb.from("support_tickets").update({
      updated_at: new Date().toISOString(),
      status: authorRole === "customer" ? "open" : "answered",
    }).eq("id", ticketId);
    return data;
  }
  async listTicketReplies(ticketId: string) {
    const { data, error } = await this.sb.from("ticket_replies").select("*").eq("ticket_id", ticketId).order("created_at");
    if (error) throw error;
    return data;
  }
  async updateTicketStatus(id: string, status: import("./types").TicketStatus) {
    const { data, error } = await this.sb.from("support_tickets")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async createArticle(a: { title_en: string; title_ne?: string | null; body_en: string; body_ne?: string | null; is_published?: boolean; created_by: string | null }) {
    const { data, error } = await this.sb.from("education_articles").insert({
      title_en: a.title_en, title_ne: a.title_ne ?? null, body_en: a.body_en,
      body_ne: a.body_ne ?? null, is_published: a.is_published ?? false, created_by: a.created_by,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listArticles(publishedOnly: boolean) {
    let q = this.sb.from("education_articles").select("*");
    if (publishedOnly) q = q.eq("is_published", true);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async getArticle(id: string) {
    const { data } = await this.sb.from("education_articles").select("*").eq("id", id).maybeSingle();
    return data;
  }
  async updateArticle(id: string, patch: Partial<Pick<import("./types").EducationArticle, "title_en" | "title_ne" | "body_en" | "body_ne" | "is_published">>) {
    const { data, error } = await this.sb.from("education_articles")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async deleteArticle(id: string) {
    const { error } = await this.sb.from("education_articles").delete().eq("id", id);
    if (error) throw error;
  }
  async adjustKitStock(kitId: string, delta: number) {
    const { data: kit } = await this.sb.from("kits").select("*").eq("id", kitId).maybeSingle();
    if (!kit) return null;
    const { data, error } = await this.sb.from("kits")
      .update({ stock: Math.max(0, kit.stock + delta) }).eq("id", kitId).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async setOrderCourier(orderId: string, courierName: string | null, trackingId: string | null) {
    const { data, error } = await this.sb.from("orders")
      .update({ courier_name: courierName, tracking_id: trackingId }).eq("id", orderId)
      .select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async addOrderCheck(orderId: string, checkType: import("./types").OrderCheckType, checkedBy: string) {
    const { data, error } = await this.sb.from("order_checks")
      .upsert({ order_id: orderId, check_type: checkType, checked_by: checkedBy }, { onConflict: "order_id,check_type" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listOrderChecks(orderId: string) {
    const { data, error } = await this.sb.from("order_checks").select("*").eq("order_id", orderId);
    if (error) throw error;
    return data;
  }
  async addDamageReport(orderId: string, reporterId: string, description: string) {
    const { data, error } = await this.sb.from("damage_reports")
      .insert({ order_id: orderId, reporter_id: reporterId, description }).select().single();
    if (error) throw error;
    return data;
  }
  async listDamageReports(orderId?: string) {
    let q = this.sb.from("damage_reports").select("*");
    if (orderId) q = q.eq("order_id", orderId);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async addHandoverNote(orderId: string, authorId: string, note: string) {
    const { data, error } = await this.sb.from("handover_notes")
      .insert({ order_id: orderId, author_id: authorId, note }).select().single();
    if (error) throw error;
    return data;
  }
  async listHandoverNotes(orderId: string) {
    const { data, error } = await this.sb.from("handover_notes").select("*").eq("order_id", orderId).order("created_at");
    if (error) throw error;
    return data;
  }
  async createChallenge(c: { title_en: string; title_ne?: string | null; days: 7 | 14 | 30; description_en?: string | null; description_ne?: string | null; created_by: string | null }) {
    const { data, error } = await this.sb.from("challenges").insert({
      title_en: c.title_en, title_ne: c.title_ne ?? null, days: c.days,
      description_en: c.description_en ?? null, description_ne: c.description_ne ?? null,
      created_by: c.created_by,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listChallenges() {
    const { data, error } = await this.sb.from("challenges").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async assignChallenge(challengeId: string, userId: string) {
    const { data, error } = await this.sb.from("challenge_assignments")
      .upsert({ challenge_id: challengeId, user_id: userId }, { onConflict: "challenge_id,user_id" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listChallengeAssignments(userId: string): Promise<(ChallengeAssignment & { challenge: Challenge | null })[]> {
    const { data, error } = await this.sb.from("challenge_assignments")
      .select("*, challenge:challenges(*)").eq("user_id", userId).order("started_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as (ChallengeAssignment & { challenge: Challenge | null })[]);
  }
  async completeChallengeAssignment(id: string, userId: string) {
    const { data, error } = await this.sb.from("challenge_assignments")
      .update({ completed_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId)
      .select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async addCoachNote(coachId: string, customerId: string, note: string) {
    const { data, error } = await this.sb.from("coach_notes")
      .insert({ coach_id: coachId, customer_id: customerId, note }).select().single();
    if (error) throw error;
    return data;
  }
  async listCoachNotes(customerId: string) {
    const { data, error } = await this.sb.from("coach_notes").select("*").eq("customer_id", customerId).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async createEscalation(customerId: string, coachId: string, reason: string) {
    const { data, error } = await this.sb.from("escalations")
      .insert({ customer_id: customerId, coach_id: coachId, reason }).select().single();
    if (error) throw error;
    return data;
  }
  async listEscalations(status?: import("./types").EscalationStatus) {
    let q = this.sb.from("escalations").select("*");
    if (status) q = q.eq("status", status);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async updateEscalationStatus(id: string, status: import("./types").EscalationStatus) {
    const { data, error } = await this.sb.from("escalations").update({ status }).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async scheduleNudge(n: { coach_id: string; user_id: string; message_en: string; message_ne?: string | null; send_at: string }) {
    const { data, error } = await this.sb.from("scheduled_nudges").insert({
      coach_id: n.coach_id, user_id: n.user_id, message_en: n.message_en,
      message_ne: n.message_ne ?? null, send_at: n.send_at,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listScheduledNudges(coachId: string) {
    const { data, error } = await this.sb.from("scheduled_nudges").select("*").eq("coach_id", coachId).order("send_at");
    if (error) throw error;
    return data;
  }
  async markNudgeSent(id: string) {
    const { data, error } = await this.sb.from("scheduled_nudges")
      .update({ sent_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async deleteScheduledNudge(id: string, coachId: string) {
    const { data, error } = await this.sb.from("scheduled_nudges").delete()
      .eq("id", id).eq("coach_id", coachId).is("sent_at", null).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async addSatisfactionRating(customerId: string, coachId: string, rating: number, comment?: string | null) {
    const { data, error } = await this.sb.from("satisfaction_ratings")
      .insert({ customer_id: customerId, coach_id: coachId, rating, comment: comment ?? null }).select().single();
    if (error) throw error;
    return data;
  }
  async listSatisfactionRatings(customerId: string) {
    const { data, error } = await this.sb.from("satisfaction_ratings").select("*").eq("customer_id", customerId).order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async addToWishlist(userId: string, kitId: string) {
    const { data, error } = await this.sb.from("wishlist")
      .upsert({ user_id: userId, kit_id: kitId }, { onConflict: "user_id,kit_id" }).select().single();
    if (error) throw error;
    return data;
  }
  async removeFromWishlist(userId: string, kitId: string) {
    const { data, error } = await this.sb.from("wishlist").delete()
      .eq("user_id", userId).eq("kit_id", kitId).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async listWishlist(userId: string): Promise<(WishlistItem & { kit: Kit | null })[]> {
    const { data, error } = await this.sb.from("wishlist")
      .select("*, kit:kits(*)").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as (WishlistItem & { kit: Kit | null })[]);
  }


  /* ---------------- Batch 2 (008) ---------------- */
  // ---- doctor (D10–D18) ----
  async doctorWorkload(doctorId: string) {
    const { data, error } = await this.sb.from("cases").select("id,status,sla_due_at")
      .eq("assigned_doctor_id", doctorId).in("status", ["queued", "in_review"]);
    if (error) throw error;
    const t = Date.now();
    let claimed = 0, in_review = 0, due_soon = 0, overdue = 0;
    for (const c of data ?? []) {
      if (c.status === "queued") claimed++;
      if (c.status === "in_review") in_review++;
      if (c.sla_due_at) {
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
  async createSnippet(doctorId: string, s: { title: string; body_en: string; body_ne?: string | null }) {
    const { data, error } = await this.sb.from("doctor_snippets")
      .insert({ doctor_id: doctorId, title: s.title, body_en: s.body_en, body_ne: s.body_ne ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listSnippets(doctorId: string) {
    const { data, error } = await this.sb.from("doctor_snippets").select("*")
      .eq("doctor_id", doctorId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }
  async deleteSnippet(id: string, doctorId: string) {
    const { data, error } = await this.sb.from("doctor_snippets").delete()
      .eq("id", id).eq("doctor_id", doctorId).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async bookmarkCase(caseId: string, doctorId: string) {
    const { data, error } = await this.sb.from("case_bookmarks")
      .upsert({ case_id: caseId, doctor_id: doctorId }, { onConflict: "case_id,doctor_id" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async unbookmarkCase(caseId: string, doctorId: string) {
    const { data, error } = await this.sb.from("case_bookmarks").delete()
      .eq("case_id", caseId).eq("doctor_id", doctorId).select("case_id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async listBookmarks(doctorId: string) {
    const { data, error } = await this.sb.from("case_bookmarks").select("case_id").eq("doctor_id", doctorId);
    if (error) throw error;
    return (data ?? []).map((b) => b.case_id as string);
  }
  async getChecklist(caseId: string, doctorId: string) {
    const { data: cl } = await this.sb.from("review_checklists").select("*")
      .eq("case_id", caseId).eq("doctor_id", doctorId).maybeSingle();
    if (!cl) return null;
    const { data: items, error } = await this.sb.from("review_checklist_items").select("*")
      .eq("checklist_id", cl.id).order("sort");
    if (error) throw error;
    return { ...cl, items: items ?? [] };
  }
  async createChecklist(caseId: string, doctorId: string, items: { label_en: string; label_ne?: string | null }[]) {
    const existing = await this.getChecklist(caseId, doctorId);
    if (existing) return existing;
    const { data: cl, error } = await this.sb.from("review_checklists")
      .insert({ case_id: caseId, doctor_id: doctorId }).select().single();
    if (error) throw error;
    if (items.length) {
      const { error: e2 } = await this.sb.from("review_checklist_items").insert(
        items.map((it, i) => ({ checklist_id: cl.id, label_en: it.label_en, label_ne: it.label_ne ?? null, sort: i })));
      if (e2) throw e2;
    }
    return (await this.getChecklist(caseId, doctorId))!;
  }
  async setChecklistItemDone(itemId: string, doctorId: string, done: boolean) {
    const { data: item } = await this.sb.from("review_checklist_items").select("*, checklist:review_checklists!inner(doctor_id)")
      .eq("id", itemId).maybeSingle();
    if (!item || (item.checklist as unknown as { doctor_id: string }).doctor_id !== doctorId) return null;
    const { data, error } = await this.sb.from("review_checklist_items")
      .update({ done }).eq("id", itemId).select().single();
    if (error) throw error;
    return data;
  }
  async patientRisk(userId: string) {
    const { data: scans } = await this.sb.from("scans").select("id").eq("user_id", userId);
    const scanIds = (scans ?? []).map((s) => s.id as string);
    let red_flag_cases = 0;
    if (scanIds.length) {
      const { data: cases } = await this.sb.from("cases").select("id").in("scan_id", scanIds).gte("priority", 100);
      red_flag_cases = (cases ?? []).length;
    }
    const today = new Date().toISOString().slice(0, 10);
    const { data: plans } = await this.sb.from("plans").select("id,rescan_due_on,case_id")
      .not("rescan_due_on", "is", null).lt("rescan_due_on", today);
    let missed_rescans = 0;
    if (scanIds.length && plans?.length) {
      const { data: pcases } = await this.sb.from("cases").select("id").in("scan_id", scanIds);
      const caseIds = new Set((pcases ?? []).map((c) => c.id as string));
      missed_rescans = plans.filter((p) => caseIds.has(p.case_id as string)).length;
    }
    const level: "low" | "medium" | "high" = red_flag_cases > 0 || missed_rescans > 1 ? "high" : missed_rescans > 0 ? "medium" : "low";
    return { level, red_flag_cases, missed_rescans };
  }
  async createPhotoRequest(caseId: string, doctorId: string, angles: string, note?: string | null) {
    const { data, error } = await this.sb.from("photo_requests")
      .insert({ case_id: caseId, doctor_id: doctorId, angles, note: note ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listPhotoRequests(caseId: string) {
    const { data, error } = await this.sb.from("photo_requests").select("*")
      .eq("case_id", caseId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async doctorReviewStats(doctorId: string) {
    const entries = await this.listAudit({ actor_id: doctorId, limit: 10000 });
    const t = Date.now();
    const approves = entries.filter((e) => e.action === "plan.approve");
    const reviewed_7d = approves.filter((e) => t - new Date(e.at).getTime() < 7 * 86400_000).length;
    const reviewed_30d = approves.filter((e) => t - new Date(e.at).getTime() < 30 * 86400_000).length;
    const claims = new Map(entries.filter((e) => e.action === "case.claim").map((e) => [e.entity_id as string, new Date(e.at).getTime()]));
    const durs: number[] = [];
    for (const a of approves) {
      const { data: plan } = await this.sb.from("plans").select("case_id").eq("id", a.entity_id).maybeSingle();
      const c0 = plan ? claims.get(plan.case_id as string) : undefined;
      if (c0 !== undefined) durs.push((new Date(a.at).getTime() - c0) / 3600_000);
    }
    const avg_review_hours = durs.length ? Math.round((durs.reduce((s, d) => s + d, 0) / durs.length) * 10) / 10 : null;
    return { reviewed_7d, reviewed_30d, avg_review_hours };
  }
  async searchDoctorNotes(doctorId: string, q: string) {
    const needle = q.trim();
    if (needle.length < 2) return [];
    const { data, error } = await this.sb.from("plans").select("case_id,review_notes,created_at")
      .eq("doctor_id", doctorId).not("review_notes", "is", null).ilike("review_notes", `%${needle}%`).limit(20);
    if (error) throw error;
    return (data ?? []).map((p) => {
      const note = p.review_notes as string;
      const idx = note.toLowerCase().indexOf(needle.toLowerCase());
      const start = Math.max(0, idx - 40);
      return { case_id: p.case_id as string, snippet: (start > 0 ? "…" : "") + note.slice(start, idx + needle.length + 40) + "…", created_at: p.created_at as string };
    });
  }


  // ---- admin (A12–A20) ----
  async getRolePermissions(role: string) {
    const { data, error } = await this.sb.from("role_permissions").select("*")
      .eq("role", role).order("permission");
    if (error) throw error;
    return data ?? [];
  }
  async setRolePermission(role: string, permission: string, granted: boolean, updatedBy: string | null) {
    const { data, error } = await this.sb.from("role_permissions")
      .upsert({ role, permission, granted, updated_by: updatedBy }, { onConflict: "role,permission" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async createAnnouncement(a: { title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null; starts_at?: string | null; ends_at?: string | null; created_by?: string | null }) {
    const { data, error } = await this.sb.from("announcements")
      .insert({ title_en: a.title_en, title_ne: a.title_ne ?? null, body_en: a.body_en ?? null, body_ne: a.body_ne ?? null, link: a.link ?? null, starts_at: a.starts_at ?? null, ends_at: a.ends_at ?? null, created_by: a.created_by ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listAnnouncements(activeOnly: boolean) {
    let q = this.sb.from("announcements").select("*").order("created_at", { ascending: false });
    if (activeOnly) {
      const t = new Date().toISOString();
      q = q.eq("is_active", true).or(`starts_at.is.null,starts_at.lte.${t}`).or(`ends_at.is.null,ends_at.gte.${t}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }
  async updateAnnouncement(id: string, patch: Partial<import("./types").Announcement>) {
    const { id: _drop, created_at: _c, ...rest } = patch as Record<string, unknown>;
    const { data, error } = await this.sb.from("announcements").update(rest).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async deleteAnnouncement(id: string) {
    const { data, error } = await this.sb.from("announcements").delete().eq("id", id).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async listRefreshSessions(userId: string) {
    const { data, error } = await this.sb.from("refresh_tokens").select("token_hash,user_id,expires_at,created_at")
      .eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async revokeRefreshSession(tokenHash: string) {
    const { data, error } = await this.sb.from("refresh_tokens").delete().eq("token_hash", tokenHash).select("token_hash");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async logLoginAttempt(a: { phone?: string | null; email?: string | null; success: boolean; ip?: string | null; user_agent?: string | null }) {
    const { data, error } = await this.sb.from("login_attempts")
      .insert({ phone: a.phone ?? null, email: a.email ?? null, success: a.success, ip: a.ip ?? null, user_agent: a.user_agent ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listLoginAttempts(limit: number) {
    const { data, error } = await this.sb.from("login_attempts").select("*")
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }
  async createCoupon(c: { code: string; kind: import("./types").CouponKind; value: number; max_uses?: number | null; min_order_npr?: number; starts_at?: string | null; ends_at?: string | null; created_by?: string | null }) {
    const { data, error } = await this.sb.from("coupons")
      .insert({ code: c.code.toUpperCase().trim(), kind: c.kind, value: c.value, max_uses: c.max_uses ?? null, min_order_npr: c.min_order_npr ?? 0, starts_at: c.starts_at ?? null, ends_at: c.ends_at ?? null, created_by: c.created_by ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listCoupons() {
    const { data, error } = await this.sb.from("coupons").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async updateCoupon(id: string, patch: { is_active?: boolean }) {
    const { data, error } = await this.sb.from("coupons").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async getCouponByCode(code: string) {
    const { data } = await this.sb.from("coupons").select("*").eq("code", code.toUpperCase().trim()).maybeSingle();
    return data ?? null;
  }
  async incrementCouponUses(id: string) {
    const { data: c } = await this.sb.from("coupons").select("uses").eq("id", id).maybeSingle();
    if (!c) return null;
    const { data, error } = await this.sb.from("coupons").update({ uses: (c.uses as number) + 1 }).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async recordBackup(b: { label: string; status?: "ok" | "failed" | "running"; size_bytes?: number | null; note?: string | null; recorded_by?: string | null }) {
    const { data, error } = await this.sb.from("backups")
      .insert({ label: b.label, status: b.status ?? "ok", size_bytes: b.size_bytes ?? null, note: b.note ?? null, recorded_by: b.recorded_by ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listBackups(limit: number) {
    const { data, error } = await this.sb.from("backups").select("*")
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }
  async createNotificationTemplate(t: { name: string; title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null; link?: string | null; created_by?: string | null }) {
    const { data, error } = await this.sb.from("notification_templates")
      .insert({ name: t.name, title_en: t.title_en, title_ne: t.title_ne ?? null, body_en: t.body_en ?? null, body_ne: t.body_ne ?? null, link: t.link ?? null, created_by: t.created_by ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listNotificationTemplates() {
    const { data, error } = await this.sb.from("notification_templates").select("*").order("name");
    if (error) throw error;
    return data ?? [];
  }
  async deleteNotificationTemplate(id: string) {
    const { data, error } = await this.sb.from("notification_templates").delete().eq("id", id).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  // ---- pharmacy (P10–P18) ----
  async logStockMovement(kitId: string, delta: number, reason: string | null, actorId: string | null) {
    const { data, error } = await this.sb.from("stock_movements")
      .insert({ kit_id: kitId, delta, reason, actor_id: actorId }).select().single();
    if (error) throw error;
    return data;
  }
  async listStockMovements(kitId: string, limit: number) {
    const { data, error } = await this.sb.from("stock_movements").select("*")
      .eq("kit_id", kitId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }
  async reorderSuggestions(): Promise<{ kit: import("./types").Kit; threshold: number }[]> {
    const { data, error } = await this.sb.from("kits").select("*").eq("is_active", true).order("stock");
    if (error) throw error;
    return (data ?? [])
      .map((k) => ({ kit: k as unknown as import("./types").Kit, threshold: (k as Record<string, unknown>).low_stock_threshold as number ?? 5 }))
      .filter(({ kit, threshold }) => kit.stock <= (threshold ?? 5));
  }
  async getPackingChecks(orderId: string) {
    const { data, error } = await this.sb.from("packing_checks").select("*").eq("order_id", orderId).order("step");
    if (error) throw error;
    return data ?? [];
  }
  async setPackingCheck(orderId: string, step: string, done: boolean, checkedBy: string | null) {
    const { data, error } = await this.sb.from("packing_checks")
      .upsert({ order_id: orderId, step, done, checked_by: checkedBy }, { onConflict: "order_id,step" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async orderLabel(orderId: string) {
    const { data: order } = await this.sb.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) return null;
    const items: { kit_id: string; name: string; qty: number }[] = [];
    if (order.kit_id) {
      const { data: kit } = await this.sb.from("kits").select("id,name_en").eq("id", order.kit_id).maybeSingle();
      if (kit) items.push({ kit_id: kit.id as string, name: kit.name_en as string, qty: 1 });
    }
    return { order: order as unknown as import("./types").Order, items };
  }
  async zoneStats() {
    const { data, error } = await this.sb.from("orders").select("status,shipping_address").limit(5000);
    if (error) throw error;
    const zones = new Map<string, { orders: number; delivered: number }>();
    for (const o of data ?? []) {
      const addr = (o.shipping_address ?? {}) as Record<string, unknown>;
      const zone = String(addr.city ?? addr.district ?? "unknown");
      const z = zones.get(zone) ?? { orders: 0, delivered: 0 };
      z.orders++;
      if (o.status === "delivered") z.delivered++;
      zones.set(zone, z);
    }
    return [...zones.entries()].map(([zone, s]) => ({ zone, ...s })).sort((a, b) => b.orders - a.orders);
  }
  async duplicateOrders() {
    const { data, error } = await this.sb.from("orders").select("*").not("kit_id", "is", null).order("created_at").limit(5000);
    if (error) throw error;
    const seen = new Map<string, string>();
    const dups: import("./types").Order[] = [];
    for (const o of (data ?? []) as unknown as import("./types").Order[]) {
      const key = `${o.user_id}:${o.kit_id}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, o.created_at);
      else if (new Date(o.created_at).getTime() - new Date(first).getTime() < 24 * 3600_000) dups.push(o);
    }
    return dups;
  }
  async createKitBatch(kitId: string, b: { batch_no: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }) {
    const { data, error } = await this.sb.from("kit_batches")
      .insert({ kit_id: kitId, batch_no: b.batch_no, expires_on: b.expires_on ?? null, qty: b.qty ?? 0, supplier_id: b.supplier_id ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listKitBatches(kitId?: string) {
    let q = this.sb.from("kit_batches").select("*, kit:kits(name_en)").order("expires_on", { ascending: true, nullsFirst: false });
    if (kitId) q = q.eq("kit_id", kitId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((b) => ({ ...(b as Record<string, unknown>), kit_name: (b as unknown as { kit: { name_en: string } | null }).kit?.name_en } as unknown as import("./types").KitBatch & { kit_name?: string }));
  }
  async deleteKitBatch(id: string) {
    const { data, error } = await this.sb.from("kit_batches").delete().eq("id", id).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async updateKitBatch(id: string, b: { batch_no?: string; expires_on?: string | null; qty?: number; supplier_id?: string | null }) {
    const patch: Record<string, unknown> = {};
    if (b.batch_no !== undefined) patch.batch_no = b.batch_no;
    if (b.expires_on !== undefined) patch.expires_on = b.expires_on;
    if (b.qty !== undefined) patch.qty = b.qty;
    if (b.supplier_id !== undefined) patch.supplier_id = b.supplier_id;
    if (Object.keys(patch).length === 0) {
      const { data } = await this.sb.from("kit_batches").select("*").eq("id", id).maybeSingle();
      return data ?? null;
    }
    const { data, error } = await this.sb.from("kit_batches").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data ?? null;
  }
  async createSupplier(s: { name: string; contact?: string | null; phone?: string | null; address?: string | null; note?: string | null }) {
    const { data, error } = await this.sb.from("suppliers")
      .insert({ name: s.name, contact: s.contact ?? null, phone: s.phone ?? null, address: s.address ?? null, note: s.note ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listSuppliers() {
    const { data, error } = await this.sb.from("suppliers").select("*").order("name");
    if (error) throw error;
    return data ?? [];
  }
  async updateSupplier(id: string, patch: Partial<import("./types").Supplier>) {
    const { id: _d, created_at: _c, ...rest } = patch as Record<string, unknown>;
    const { data, error } = await this.sb.from("suppliers").update(rest).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async deleteSupplier(id: string) {
    const { data, error } = await this.sb.from("suppliers").delete().eq("id", id).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  // ---- coach (C10–C18) ----
  async createChallengeGroup(g: { title_en: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null; starts_on?: string | null; ends_on?: string | null; created_by?: string | null }) {
    const { data, error } = await this.sb.from("challenge_groups")
      .insert({ title_en: g.title_en, title_ne: g.title_ne ?? null, description_en: g.description_en ?? null, description_ne: g.description_ne ?? null, starts_on: g.starts_on ?? null, ends_on: g.ends_on ?? null, created_by: g.created_by ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listChallengeGroups(): Promise<import("./types").ChallengeGroup[]> {
    const { data, error } = await this.sb.from("challenge_groups").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    const out: import("./types").ChallengeGroup[] = [];
    for (const g of data ?? []) {
      const { count } = await this.sb.from("challenge_group_members").select("user_id", { count: "exact", head: true }).eq("group_id", (g as Record<string, unknown>).id);
      out.push({ ...(g as unknown as import("./types").ChallengeGroup), member_count: count ?? 0 });
    }
    return out;
  }
  async addChallengeGroupMember(groupId: string, userId: string) {
    const { error } = await this.sb.from("challenge_group_members")
      .upsert({ group_id: groupId, user_id: userId }, { onConflict: "group_id,user_id" });
    if (error) throw error;
    return true;
  }
  async listChallengeGroupMembers(groupId: string) {
    const { data, error } = await this.sb.from("challenge_group_members").select("user_id").eq("group_id", groupId);
    if (error) throw error;
    return (data ?? []).map((m) => m.user_id as string);
  }
  async awardBadge(userId: string, badge: string, awardedBy: string | null) {
    const { data, error } = await this.sb.from("badges")
      .insert({ user_id: userId, badge, awarded_by: awardedBy }).select().single();
    if (error) throw error;
    return data;
  }
  async listBadges(userId: string) {
    const { data, error } = await this.sb.from("badges").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async addSessionSummary(coachId: string, customerId: string, summary: string) {
    const { data, error } = await this.sb.from("session_summaries")
      .insert({ coach_id: coachId, customer_id: customerId, summary }).select().single();
    if (error) throw error;
    return data;
  }
  async listSessionSummaries(customerId: string) {
    const { data, error } = await this.sb.from("session_summaries").select("*")
      .eq("customer_id", customerId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async createCustomerGoal(coachId: string, customerId: string, g: { title_en: string; title_ne?: string | null; target_date?: string | null }) {
    const { data, error } = await this.sb.from("customer_goals")
      .insert({ coach_id: coachId, customer_id: customerId, title_en: g.title_en, title_ne: g.title_ne ?? null, target_date: g.target_date ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listCustomerGoals(customerId: string) {
    const { data, error } = await this.sb.from("customer_goals").select("*")
      .eq("customer_id", customerId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async completeCustomerGoal(id: string, coachId: string) {
    const { data, error } = await this.sb.from("customer_goals")
      .update({ done_at: new Date().toISOString() }).eq("id", id).eq("coach_id", coachId).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async deleteCustomerGoal(id: string, coachId: string) {
    const { data, error } = await this.sb.from("customer_goals").delete()
      .eq("id", id).eq("coach_id", coachId).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async createHabitTemplate(t: { title_en: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null; created_by?: string | null }) {
    const { data, error } = await this.sb.from("habit_templates")
      .insert({ title_en: t.title_en, title_ne: t.title_ne ?? null, description_en: t.description_en ?? null, description_ne: t.description_ne ?? null, created_by: t.created_by ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listHabitTemplates() {
    const { data, error } = await this.sb.from("habit_templates").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async deleteHabitTemplate(id: string) {
    const { data, error } = await this.sb.from("habit_templates").delete().eq("id", id).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async updateHabitTemplate(id: string, t: { title_en?: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null }) {
    const patch: Record<string, unknown> = {};
    if (t.title_en !== undefined) patch.title_en = t.title_en;
    if (t.title_ne !== undefined) patch.title_ne = t.title_ne;
    if (t.description_en !== undefined) patch.description_en = t.description_en;
    if (t.description_ne !== undefined) patch.description_ne = t.description_ne;
    if (Object.keys(patch).length === 0) {
      const { data } = await this.sb.from("habit_templates").select("*").eq("id", id).maybeSingle();
      return data ?? null;
    }
    const { data, error } = await this.sb.from("habit_templates").update(patch).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data ?? null;
  }
  async createNoteTemplate(coachId: string | null, t: { title: string; body_en: string; body_ne?: string | null }) {
    const { data, error } = await this.sb.from("note_templates")
      .insert({ coach_id: coachId, title: t.title, body_en: t.body_en, body_ne: t.body_ne ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listNoteTemplates(coachId: string) {
    const { data, error } = await this.sb.from("note_templates").select("*")
      .or(`coach_id.is.null,coach_id.eq.${coachId}`).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async deleteNoteTemplate(id: string, coachId: string) {
    const { data, error } = await this.sb.from("note_templates").delete()
      .eq("id", id).eq("coach_id", coachId).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async updateNoteTemplate(id: string, coachId: string, t: { title?: string; body_en?: string; body_ne?: string | null }) {
    const patch: Record<string, unknown> = {};
    if (t.title !== undefined) patch.title = t.title;
    if (t.body_en !== undefined) patch.body_en = t.body_en;
    if (t.body_ne !== undefined) patch.body_ne = t.body_ne;
    if (Object.keys(patch).length === 0) {
      const { data } = await this.sb.from("note_templates").select("*").eq("id", id).eq("coach_id", coachId).maybeSingle();
      return data ?? null;
    }
    const { data, error } = await this.sb.from("note_templates").update(patch).eq("id", id).eq("coach_id", coachId).select().maybeSingle();
    if (error) throw error;
    return data ?? null;
  }
  async assignArticle(articleId: string, userId: string, assignedBy: string | null) {
    const { data, error } = await this.sb.from("article_assignments")
      .upsert({ article_id: articleId, user_id: userId, assigned_by: assignedBy }, { onConflict: "article_id,user_id" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listArticleAssignments(userId: string) {
    const { data, error } = await this.sb.from("article_assignments").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async coachRiskFlags() {
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: users, error } = await this.sb.from("users").select("id,created_at").eq("role", "customer").lt("created_at", cutoff).limit(1000);
    if (error) throw error;
    const out: { user_id: string; name: string | null; missed_checkins: number }[] = [];
    for (const u of users ?? []) {
      const uid = (u as Record<string, unknown>).id as string;
      const { data: cis } = await this.sb.from("progress_checkins").select("id,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(1);
      if (!cis || cis.length === 0 || (cis[0].created_at as string) < cutoff) {
        const { data: prof } = await this.sb.from("profiles").select("name").eq("user_id", uid).maybeSingle();
        const { count } = await this.sb.from("progress_checkins").select("id", { count: "exact", head: true }).eq("user_id", uid);
        out.push({ user_id: uid, name: (prof?.name as string) ?? null, missed_checkins: count ?? 0 });
      }
    }
    return out;
  }
  // ---- customer (U12–U20) ----
  async planHistory(userId: string) {
    const { data: scans } = await this.sb.from("scans").select("id").eq("user_id", userId);
    const scanIds = (scans ?? []).map((s) => s.id as string);
    if (!scanIds.length) return [];
    const { data: cases } = await this.sb.from("cases").select("id").in("scan_id", scanIds);
    const caseIds = (cases ?? []).map((c) => c.id as string);
    if (!caseIds.length) return [];
    const { data, error } = await this.sb.from("plans").select("*").in("case_id", caseIds).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async upsertSymptomEntry(userId: string, entryDate: string, note: string) {
    const { data, error } = await this.sb.from("symptom_entries")
      .upsert({ user_id: userId, entry_date: entryDate, note }, { onConflict: "user_id,entry_date" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listSymptomEntries(userId: string, limit: number) {
    const { data, error } = await this.sb.from("symptom_entries").select("*")
      .eq("user_id", userId).order("entry_date", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }
  async deleteSymptomEntry(id: string, userId: string) {
    const { data, error } = await this.sb.from("symptom_entries").delete()
      .eq("id", id).eq("user_id", userId).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async setWaterLog(userId: string, logDate: string, glasses: number) {
    const { data, error } = await this.sb.from("water_logs")
      .upsert({ user_id: userId, log_date: logDate, glasses: Math.max(0, glasses) }, { onConflict: "user_id,log_date" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async getWaterLog(userId: string, logDate: string) {
    const { data } = await this.sb.from("water_logs").select("*")
      .eq("user_id", userId).eq("log_date", logDate).maybeSingle();
    return data ?? null;
  }
  async upsertSleepLog(userId: string, logDate: string, s: { bedtime?: string | null; wake_time?: string | null; quality?: number | null }) {
    const { data, error } = await this.sb.from("sleep_logs")
      .upsert({ user_id: userId, log_date: logDate, bedtime: s.bedtime ?? null, wake_time: s.wake_time ?? null, quality: s.quality ?? null }, { onConflict: "user_id,log_date" })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listSleepLogs(userId: string, limit: number) {
    const { data, error } = await this.sb.from("sleep_logs").select("*")
      .eq("user_id", userId).order("log_date", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }
  async deleteSleepLog(id: string, userId: string) {
    const { data, error } = await this.sb.from("sleep_logs").delete()
      .eq("id", id).eq("user_id", userId).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }
  async getNotificationPrefs(userId: string) {
    const { data } = await this.sb.from("notification_prefs").select("*").eq("user_id", userId).maybeSingle();
    if (data) return data;
    const { data: created, error } = await this.sb.from("notification_prefs")
      .insert({ user_id: userId }).select().single();
    if (error) throw error;
    return created;
  }
  async setNotificationPrefs(userId: string, p: Partial<import("./types").NotificationPrefs>) {
    await this.getNotificationPrefs(userId);
    const { user_id: _u, ...rest } = p as Record<string, unknown>;
    const { data, error } = await this.sb.from("notification_prefs").update(rest).eq("user_id", userId).select().single();
    if (error) throw error;
    return data;
  }
  async createEmergencyContact(userId: string, c: { name: string; phone: string; relation?: string | null }) {
    const { data, error } = await this.sb.from("emergency_contacts")
      .insert({ user_id: userId, name: c.name, phone: c.phone, relation: c.relation ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listEmergencyContacts(userId: string) {
    const { data, error } = await this.sb.from("emergency_contacts").select("*")
      .eq("user_id", userId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }
  async deleteEmergencyContact(id: string, userId: string) {
    const { data, error } = await this.sb.from("emergency_contacts").delete()
      .eq("id", id).eq("user_id", userId).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async storageUsage(): Promise<{ bucket: string; files: number }[]> {
    const { count: photos } = await this.sb.from("photos").select("id", { count: "exact", head: true });
    const { data: kits } = await this.sb.from("kits").select("images");
    let kitImages = 0;
    for (const k of kits ?? []) kitImages += (((k as Record<string, unknown>).images as string[]) ?? []).length;
    const { count: profilePhotos } = await this.sb.from("profiles").select("user_id", { count: "exact", head: true }).not("photo_path", "is", null);
    return [
      { bucket: "scan-photos", files: photos ?? 0 },
      { bucket: "kit-images", files: kitImages },
      { bucket: "profile-photos", files: profilePhotos ?? 0 },
    ];
  }

  /* ---------------- Batch 3 (009) — doctor ---------------- */
  // ---- D19 doctor audit trail ----
  async listDoctorAudit(doctorId: string, limit: number): Promise<AuditEntry[]> {
    const { data, error } = await this.sb.from("audit_log").select("*")
      .eq("actor_id", doctorId).order("at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  }

  // ---- D20 case archive ----
  async archiveCase(id: string): Promise<Case | null> {
    const { data, error } = await this.sb.from("cases")
      .update({ archived_at: new Date().toISOString() }).eq("id", id)
      .select().maybeSingle();
    if (error) throw error;
    return data;
  }
  async listArchivedCases(doctorId: string): Promise<Case[]> {
    const { data, error } = await this.sb.from("cases").select("*")
      .eq("assigned_doctor_id", doctorId).not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // ---- D22 second opinions ----
  async createSecondOpinion(o: { case_id: string; requester_id: string; reviewer_id: string; note?: string | null }): Promise<SecondOpinion> {
    const { data, error } = await this.sb.from("second_opinions").insert({
      case_id: o.case_id, requester_id: o.requester_id,
      reviewer_id: o.reviewer_id, note: o.note ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listSecondOpinions(doctorId: string): Promise<SecondOpinion[]> {
    const { data, error } = await this.sb.from("second_opinions").select("*")
      .or(`requester_id.eq.${doctorId},reviewer_id.eq.${doctorId}`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async decideSecondOpinion(id: string, reviewerId: string, accept: boolean): Promise<SecondOpinion | null> {
    const { data: row } = await this.sb.from("second_opinions").select("*").eq("id", id).maybeSingle();
    if (!row || row.reviewer_id !== reviewerId || row.status !== "pending") return null;
    const { data, error } = await this.sb.from("second_opinions")
      .update({ status: accept ? "accepted" : "declined", decided_at: new Date().toISOString() })
      .eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- D23 follow-up calendar (date range; due_on is a date column, YYYY-MM-DD) ----
  async listFollowUpsRange(doctorId: string, from: string, to: string): Promise<FollowUp[]> {
    const { data, error } = await this.sb.from("follow_ups").select("*")
      .eq("doctor_id", doctorId).gte("due_on", from).lte("due_on", to).order("due_on");
    if (error) throw error;
    return data;
  }

  // ---- D24 triage presets ----
  async createTriagePreset(doctorId: string, name: string, priority: number): Promise<TriagePreset> {
    const { data, error } = await this.sb.from("triage_presets")
      .insert({ doctor_id: doctorId, name, priority }).select().single();
    if (error) throw error;
    return data;
  }
  async listTriagePresets(doctorId: string): Promise<TriagePreset[]> {
    const { data, error } = await this.sb.from("triage_presets").select("*")
      .eq("doctor_id", doctorId).order("priority", { ascending: false }).order("name");
    if (error) throw error;
    return data;
  }
  async deleteTriagePreset(id: string, doctorId: string): Promise<boolean> {
    const { data } = await this.sb.from("triage_presets").select("id").eq("id", id).eq("doctor_id", doctorId).maybeSingle();
    if (!data) return false;
    const { error } = await this.sb.from("triage_presets").delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  // ---- D25 patient adherence (read-only; see OPEN QUESTIONS for the "total" definition) ----
  async getPatientAdherence(userId: string): Promise<{ rate: number; done: number; total: number }> {
    const { data, error } = await this.sb.from("progress_checkins").select("created_at")
      .eq("user_id", userId).order("created_at");
    if (error) throw error;
    const rows = data ?? [];
    const done = rows.length;
    if (!done) return { rate: 0, done: 0, total: 0 };
    const first = new Date(rows[0].created_at).getTime();
    const days = Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1);
    return { rate: Math.min(1, done / days), done, total: days };
  }

  // ---- D26 case transfer (route should addAudit 'case.transfer' after this) ----
  async transferCase(id: string, toDoctorId: string): Promise<Case | null> {
    const { data, error } = await this.sb.from("cases")
      .update({ assigned_doctor_id: toDoctorId }).eq("id", id)
      .select().maybeSingle();
    if (error) throw error;
    return data;
  }

  /* ---------------- Batch 3 (009) — admin ---------------- */
async createDispute(d: { order_id: string; user_id: string; subject: string; body: string }) {
  const { data, error } = await this.sb.from("disputes").insert({
    order_id: d.order_id, user_id: d.user_id, subject: d.subject, body: d.body,
  }).select().single();
  if (error) throw error;
  return data;
}
async listDisputes(status?: string) {
  let q = this.sb.from("disputes").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
async getDispute(id: string) {
  const { data } = await this.sb.from("disputes").select("*").eq("id", id).maybeSingle();
  return data;
}
async resolveDispute(id: string, resolvedBy: string, resolution: string, approved: boolean) {
  const { data, error } = await this.sb.from("disputes").update({
    status: approved ? "resolved" : "rejected",
    resolution, resolved_by: resolvedBy, resolved_at: new Date().toISOString(),
  }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}

// ---- admin: doctor payout report (A22) ----
// "Reviewed" = plan.approve audit_log entry (same convention as
// doctorReviewStats); month bounds derived from the YYYY-MM argument.
async doctorPayouts(month: string) {
  const start = `${month}-01T00:00:00.000Z`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString();
  const { data: entries, error } = await this.sb.from("audit_log")
    .select("entity_id,at").eq("action", "plan.approve")
    .gte("at", start).lt("at", end);
  if (error) throw error;
  const planIds = [...new Set((entries ?? []).map((e) => e.entity_id as string).filter(Boolean))];
  const doctorByPlan = new Map<string, string>();
  if (planIds.length) {
    const { data: plans, error: pErr } = await this.sb.from("plans")
      .select("id,doctor_id").in("id", planIds);
    if (pErr) throw pErr;
    for (const p of plans ?? []) doctorByPlan.set(p.id as string, p.doctor_id as string);
  }
  const counts = new Map<string, number>();
  for (const e of entries ?? []) {
    const d = doctorByPlan.get(e.entity_id as string);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const rows = await Promise.all([...counts.entries()].map(async ([doctor_id, reviewed]) => {
    const { data: prof } = await this.sb.from("profiles")
      .select("name").eq("user_id", doctor_id).maybeSingle();
    return { doctor_id, name: (prof?.name as string | null) ?? null, reviewed };
  }));
  return rows.sort((a, b) => b.reviewed - a.reviewed);
}

// ---- admin: content moderation queue (A23) ----
async listModerationQueue() {
  const { data, error } = await this.sb.from("community_tips").select("*")
    .eq("status", "pending").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
async decideCommunityTip(id: string, approved: boolean, moderatorId: string) {
  const { data, error } = await this.sb.from("community_tips").update({
    status: approved ? "approved" : "rejected", moderated_by: moderatorId,
  }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}

// ---- admin: plan template manager (A24) ----
async createPlanTemplate(t: { title_en: string; title_ne?: string | null; items: unknown[]; created_by?: string | null }) {
  const { data, error } = await this.sb.from("plan_templates").insert({
    title_en: t.title_en, title_ne: t.title_ne ?? null,
    items: t.items, created_by: t.created_by ?? null,
  }).select().single();
  if (error) throw error;
  return data;
}
async listPlanTemplates(activeOnly: boolean) {
  let q = this.sb.from("plan_templates").select("*").order("created_at", { ascending: false });
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
async updatePlanTemplate(id: string, patch: Partial<PlanTemplate>) {
  const { id: _omit, ...rest } = patch;
  const { data, error } = await this.sb.from("plan_templates").update(rest)
    .eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
async deletePlanTemplate(id: string) {
  const { data, error } = await this.sb.from("plan_templates").delete()
    .eq("id", id).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

// ---- admin: scan quality stats (A25) ----
async scanQualityStats() {
  const { data, error } = await this.sb.from("photos").select("angle,ai_quality");
  if (error) throw error;
  const byAngle = new Map<string, { angle: string; total: number; passed: number }>();
  for (const p of data ?? []) {
    const angle = p.angle as string;
    let row = byAngle.get(angle);
    if (!row) { row = { angle, total: 0, passed: 0 }; byAngle.set(angle, row); }
    row.total += 1;
    const q = p.ai_quality as { lighting_ok?: boolean; blur_ok?: boolean } | null;
    if (q && q.lighting_ok === true && q.blur_ok === true) row.passed += 1;
  }
  return [...byAngle.values()].sort((a, b) => a.angle.localeCompare(b.angle));
}

// ---- admin: kit leaderboard (A26) ----
async kitLeaderboard() {
  const { data: orders, error } = await this.sb.from("orders").select("kit_id,total_npr,status");
  if (error) throw error;
  const { data: kits, error: kErr } = await this.sb.from("kits").select("id,name_en");
  if (kErr) throw kErr;
  const names = new Map((kits ?? []).map((k) => [k.id as string, k.name_en as string]));
  const byKit = new Map<string, { kit_id: string; name: string; orders: number; revenue_npr: number }>();
  for (const o of orders ?? []) {
    const kitId = o.kit_id as string | null;
    if (!kitId || o.status === "cancelled") continue;
    let row = byKit.get(kitId);
    if (!row) {
      row = { kit_id: kitId, name: names.get(kitId) ?? "Unknown kit", orders: 0, revenue_npr: 0 };
      byKit.set(kitId, row);
    }
    row.orders += 1;
    row.revenue_npr += o.total_npr as number;
  }
  return [...byKit.values()].sort((a, b) => b.revenue_npr - a.revenue_npr);
}

// ---- admin: order export scheduler (A27) ----
async createExportSchedule(s: { kind?: string; frequency: string; created_by?: string | null }) {
  const { data, error } = await this.sb.from("export_schedules").insert({
    kind: s.kind ?? "orders", frequency: s.frequency,
    created_by: s.created_by ?? null,
  }).select().single();
  if (error) throw error;
  return data;
}
async listExportSchedules() {
  const { data, error } = await this.sb.from("export_schedules").select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
async updateExportSchedule(id: string, patch: Partial<ExportSchedule>) {
  const { id: _omit, ...rest } = patch;
  const { data, error } = await this.sb.from("export_schedules").update(rest)
    .eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
async deleteExportSchedule(id: string) {
  const { data, error } = await this.sb.from("export_schedules").delete()
    .eq("id", id).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

// ---- admin: staff onboarding checklist (A28) ----
async getStaffChecklist(userId: string) {
  const { data } = await this.sb.from("staff_checklists").select("*")
    .eq("user_id", userId).maybeSingle();
  return data;
}
async saveStaffChecklist(userId: string, items: { key: string; done: boolean }[]) {
  const { data, error } = await this.sb.from("staff_checklists")
    .upsert(
      { user_id: userId, items, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    ).select().single();
  if (error) throw error;
  return data;
}

  /* ---------------- Batch 3 (009) — pharmacy ---------------- */
/* ---------------- Batch 3 (009) ---------------- */
// pharmacy (P19–P27)
async createQuarantine(q: { kit_id: string; qty: number; reason?: string | null; reported_by?: string | null }): Promise<QuarantineEntry> {
  const { data, error } = await this.sb.from("quarantine")
    .insert({ kit_id: q.kit_id, qty: q.qty, reason: q.reason ?? null, reported_by: q.reported_by ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
async listQuarantine(status?: string): Promise<QuarantineEntry[]> {
  let q = this.sb.from("quarantine").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
async setQuarantineStatus(id: string, status: "quarantined" | "released" | "written_off"): Promise<QuarantineEntry | null> {
  const { data, error } = await this.sb.from("quarantine").update({ status }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
async shiftSummary(date: string): Promise<{ handled: number; pending: number; cod_orders: number }> {
  // date = UTC calendar day "YYYY-MM-DD", matching the MemoryStore semantics.
  const { data, error } = await this.sb.from("orders")
    .select("id,status,payment_method,created_at,updated_at,pack_completed_at").limit(5000);
  if (error) throw error;
  const handledIds = new Set<string>();
  let pending = 0, cod_orders = 0;
  for (const o of data ?? []) {
    const createdDay = String(o.created_at).slice(0, 10);
    const packDoneAt = (o as Record<string, unknown>).pack_completed_at as string | null ?? null;
    if (createdDay === date && o.payment_method === "cod") cod_orders++;
    const packedDay = packDoneAt ? String(packDoneAt).slice(0, 10) : null;
    if (packedDay === date || (["shipped", "delivered"].includes(o.status) && String(o.updated_at).slice(0, 10) === date)) {
      handledIds.add(o.id);
    }
    if (["pending", "paid", "fulfilling"].includes(o.status) && !packDoneAt && createdDay <= date) pending++;
  }
  return { handled: handledIds.size, pending, cod_orders };
}
async courierPerformance(): Promise<{ courier: string; orders: number; delivered: number }[]> {
  const { data, error } = await this.sb.from("orders").select("courier_name,status").limit(5000);
  if (error) throw error;
  const agg = new Map<string, { orders: number; delivered: number }>();
  for (const o of data ?? []) {
    const courier = (o.courier_name as string | null) ?? "unassigned";
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
  const { data, error } = await this.sb.from("refunds").select("reason, order_id, orders ( kit_id )").limit(5000);
  if (error) throw error;
  const agg = new Map<string, { returns: number; reasons: Record<string, number> }>();
  for (const r of data ?? []) {
    const ord = r.orders as unknown as { kit_id: string | null } | { kit_id: string | null }[] | null;
    const kitId = (Array.isArray(ord) ? ord[0]?.kit_id : ord?.kit_id) ?? null;
    if (!kitId) continue;
    const a = agg.get(kitId) ?? { returns: 0, reasons: {} };
    a.returns++;
    const reason = (r.reason as string | null) ?? "unspecified";
    a.reasons[reason] = (a.reasons[reason] ?? 0) + 1;
    agg.set(kitId, a);
  }
  const names = new Map<string, string>();
  if (agg.size > 0) {
    const { data: kits } = await this.sb.from("kits").select("id,name_en,name_ne").in("id", [...agg.keys()]);
    for (const k of kits ?? []) names.set(k.id, (k.name_en as string | null) ?? (k.name_ne as string | null) ?? "unknown kit");
  }
  return [...agg.entries()].map(([kit_id, s]) => ({
    kit_id, kit_name: names.get(kit_id) ?? "unknown kit", returns: s.returns, reasons: s.reasons,
  })).sort((a, b) => b.returns - a.returns);
}
async packStart(orderId: string) {
  const { data, error } = await this.sb.from("orders")
    .update({ pack_started_at: new Date().toISOString() }).eq("id", orderId).select().maybeSingle();
  if (error) throw error;
  return data;
}
async packComplete(orderId: string) {
  const { data, error } = await this.sb.from("orders")
    .update({ pack_completed_at: new Date().toISOString() }).eq("id", orderId).select().maybeSingle();
  if (error) throw error;
  return data;
}
async createPackagingMaterial(m: { name: string; qty?: number; unit?: string | null; low_threshold?: number }): Promise<PackagingMaterial> {
  const { data, error } = await this.sb.from("packaging_materials")
    .insert({ name: m.name, qty: m.qty ?? 0, unit: m.unit ?? null, low_threshold: m.low_threshold ?? 0 })
    .select().single();
  if (error) throw error;
  return data;
}
async listPackagingMaterials(): Promise<PackagingMaterial[]> {
  const { data, error } = await this.sb.from("packaging_materials").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}
async updatePackagingMaterial(id: string, patch: Partial<PackagingMaterial>): Promise<PackagingMaterial | null> {
  const { id: _drop, ...rest } = patch; // id is immutable
  const { data, error } = await this.sb.from("packaging_materials")
    .update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
async deletePackagingMaterial(id: string): Promise<boolean> {
  const { data, error } = await this.sb.from("packaging_materials").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
async codReconciliation(date: string): Promise<{ expected_npr: number; orders: { id: string; order_no: string; total_npr: number; status: string }[] }> {
  // date = UTC calendar day "YYYY-MM-DD".
  const d = new Date(`${date}T00:00:00Z`);
  const next = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await this.sb.from("orders")
    .select("id,order_no,total_npr,status")
    .eq("payment_method", "cod")
    .gte("created_at", `${date}T00:00:00Z`).lt("created_at", `${next}T00:00:00Z`)
    .order("created_at");
  if (error) throw error;
  const rows = data ?? [];
  return {
    expected_npr: rows.reduce((s, o) => s + (o.total_npr as number), 0),
    orders: rows.map((o) => ({ id: o.id, order_no: o.order_no as string, total_npr: o.total_npr as number, status: o.status as string })),
  };
}
async setKitLowStockThreshold(kitId: string, threshold: number) {
  const { data, error } = await this.sb.from("kits")
    .update({ low_stock_threshold: threshold }).eq("id", kitId).select().maybeSingle();
  if (error) throw error;
  return data;
}
async addOrderNote(orderId: string, authorId: string, note: string): Promise<OrderNote> {
  const { data, error } = await this.sb.from("order_notes")
    .insert({ order_id: orderId, author_id: authorId, note }).select().single();
  if (error) throw error;
  return data;
}
async listOrderNotes(orderId: string): Promise<OrderNote[]> {
  const { data, error } = await this.sb.from("order_notes").select("*").eq("order_id", orderId).order("created_at");
  if (error) throw error;
  return data ?? [];
}

  /* ---------------- Batch 3 (009) — coach ---------------- */
async streakLeaderboard(limit?: number) {
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const dayMs = 86400_000;
  const { data: users, error } = await this.sb.from("users")
    .select("id").eq("role", "customer").eq("leaderboard_opt_in", true).limit(1000);
  if (error) throw error;
  const rows: { user_id: string; display: string; streak: number }[] = [];
  for (const u of users ?? []) {
    const uid = (u as Record<string, unknown>).id as string;
    const { data: cis } = await this.sb.from("progress_checkins").select("created_at").eq("user_id", uid);
    const days = new Set((cis ?? []).map((c) => dayKey(new Date((c as Record<string, unknown>).created_at as string).getTime())));
    let streak = 0, cursor = Date.now();
    for (let i = 0; i < 3650; i++) {
      if (days.has(dayKey(cursor))) { streak++; cursor -= dayMs; }
      else break;
    }
    rows.push({ user_id: uid, display: `Customer #${uid.replace(/-/g, "").slice(-4).toUpperCase()}`, streak });
  }
  rows.sort((a, b) => b.streak - a.streak || a.user_id.localeCompare(b.user_id));
  return rows.slice(0, limit ?? 10);
}

async escalationSla() {
  // escalations has no acknowledged_at / resolved_at columns — hours are null by design.
  const { data, error } = await this.sb.from("escalations").select("id,customer_id,status").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id as string, customer_id: e.customer_id as string, status: e.status as string,
    hours_to_ack: null as number | null, hours_to_resolve: null as number | null,
  }));
}

async createRecurringNudge(n: { coach_id: string; user_id: string; message_en: string; message_ne?: string | null; send_at: string; recurrence: "daily" | "weekly" }) {
  const { data, error } = await this.sb.from("scheduled_nudges").insert({
    coach_id: n.coach_id, user_id: n.user_id, message_en: n.message_en,
    message_ne: n.message_ne ?? null, send_at: n.send_at, recurrence: n.recurrence,
  }).select().single();
  if (error) throw error;
  return data;
}

async satisfactionTrend() {
  const { data, error } = await this.sb.from("satisfaction_ratings")
    .select("rating,created_at").order("created_at", { ascending: true }).limit(5000);
  if (error) throw error;
  const groups = new Map<string, { sum: number; count: number }>();
  for (const r of data ?? []) {
    const d = new Date(r.created_at as string);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    const bucket = monday.toISOString().slice(0, 10);
    const g = groups.get(bucket) ?? { sum: 0, count: 0 };
    g.sum += r.rating as number; g.count++;
    groups.set(bucket, g);
  }
  return [...groups.entries()]
    .map(([bucket, g]) => ({ bucket, avg: Math.round((g.sum / g.count) * 100) / 100, count: g.count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

async progressCompare(userId: string) {
  // Degraded: compares shedding_estimate of earliest vs latest progress_checkins.
  const toRecord = (c: Record<string, unknown> | null | undefined): Record<string, number> | null =>
    c && typeof c.shedding_estimate === "number" ? { shedding_estimate: c.shedding_estimate as number } : null;
  const { data: first, error: e1 } = await this.sb.from("progress_checkins")
    .select("shedding_estimate").eq("user_id", userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (e1) throw e1;
  const { data: last, error: e2 } = await this.sb.from("progress_checkins")
    .select("shedding_estimate").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (e2) throw e2;
  if (!first && !last) return { baseline: null, current: null };
  return { baseline: toRecord(first), current: toRecord(last) };
}

async getOnboardingChecklist(userId: string) {
  const { data, error } = await this.sb.from("onboarding_checklists").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async saveOnboardingChecklist(userId: string, steps: { key: string; done: boolean }[]) {
  const { data, error } = await this.sb.from("onboarding_checklists")
    .upsert({ user_id: userId, steps: steps.map((s) => ({ key: s.key, done: !!s.done })), updated_at: new Date().toISOString() }, { onConflict: "user_id" })
    .select().single();
  if (error) throw error;
  return data;
}

async missedCheckins(days?: number) {
  const n = days ?? 7;
  const cutoff = new Date(Date.now() - n * 86400_000).toISOString();
  const { data: users, error } = await this.sb.from("users").select("id,created_at").eq("role", "customer").lt("created_at", cutoff).limit(1000);
  if (error) throw error;
  const out: { user_id: string; name: string | null; days_missed: number }[] = [];
  for (const u of users ?? []) {
    const uid = (u as Record<string, unknown>).id as string;
    const { data: latest } = await this.sb.from("progress_checkins").select("created_at")
      .eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const latestTs = latest ? new Date((latest as Record<string, unknown>).created_at as string).getTime() : 0;
    if (latestTs < Date.now() - n * 86400_000) {
      const since = latestTs || new Date((u as Record<string, unknown>).created_at as string).getTime();
      const { data: prof } = await this.sb.from("profiles").select("name").eq("user_id", uid).maybeSingle();
      out.push({ user_id: uid, name: (prof?.name as string) ?? null, days_missed: Math.floor((Date.now() - since) / 86400_000) });
    }
  }
  return out.sort((a, b) => b.days_missed - a.days_missed);
}

async getCoachAvailability(coachId: string) {
  const { data, error } = await this.sb.from("coach_availability").select("*").eq("coach_id", coachId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async setCoachAvailability(coachId: string, status: "available" | "on_leave", note?: string | null) {
  const { data, error } = await this.sb.from("coach_availability")
    .upsert({ coach_id: coachId, status, note: note ?? null, updated_at: new Date().toISOString() }, { onConflict: "coach_id" })
    .select().single();
  if (error) throw error;
  return data;
}

async adherenceDetail(userId: string) {
  // Degraded: no habit column on progress_checkins; report 30-day done/total
  // across the checkin dimensions that exist.
  const windowStart = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data, error } = await this.sb.from("progress_checkins")
    .select("created_at,shedding_estimate,note,photo_ids").eq("user_id", userId).gte("created_at", windowStart).limit(5000);
  if (error) throw error;
  const cis = (data ?? []) as Record<string, unknown>[];
  const daysWithCheckin = new Set(cis.map((c) => (c.created_at as string).slice(0, 10))).size;
  return [
    { habit: "daily_checkin", done: daysWithCheckin, total: 30 },
    { habit: "photo_logged", done: cis.filter((c) => Array.isArray(c.photo_ids) && (c.photo_ids as unknown[]).length > 0).length, total: cis.length },
    { habit: "shedding_logged", done: cis.filter((c) => typeof c.shedding_estimate === "number").length, total: cis.length },
    { habit: "note_logged", done: cis.filter((c) => !!c.note).length, total: cis.length },
  ];
}

  /* ---------------- Batch 3 (009) — customer ---------------- */
  /* ---------------- Batch 3 (009) — customer (U21–U29) ---------------- */
  // ---- U21 case Q&A ----
  async listCaseMessages(caseId: string) {
    const { data, error } = await this.sb.from("case_messages").select("*")
      .eq("case_id", caseId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }
  async addCaseMessage(caseId: string, authorId: string, authorRole: "customer" | "doctor", body: string) {
    const { data, error } = await this.sb.from("case_messages")
      .insert({ case_id: caseId, author_id: authorId, author_role: authorRole, body })
      .select().single();
    if (error) throw error;
    return data;
  }
  // ---- U22 follow-up review requests (appointment-free) ----
  async createReviewRequest(r: { user_id: string; case_id?: string | null; reason?: string | null }) {
    const { data, error } = await this.sb.from("review_requests")
      .insert({ user_id: r.user_id, case_id: r.case_id ?? null, reason: r.reason ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listReviewRequests(userId: string) {
    const { data, error } = await this.sb.from("review_requests").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  // ---- U23 community tips (moderated) ----
  async listCommunityTips(approvedOnly: boolean) {
    let q = this.sb.from("community_tips").select("*");
    if (approvedOnly) q = q.eq("status", "approved");
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  async createCommunityTip(userId: string, title: string, body: string) {
    const { data, error } = await this.sb.from("community_tips")
      .insert({ user_id: userId, title, body }) // status defaults to 'pending'
      .select().single();
    if (error) throw error;
    return data;
  }
  // ---- U25 loyalty (earn derived at READ time; ledger adjustments only) ----
  async getLoyalty(userId: string) {
    // 001 order_status enum: 'delivered' is the fulfilled terminal state.
    const { data: orders, error: e1 } = await this.sb.from("orders")
      .select("total_npr").eq("user_id", userId).eq("status", "delivered");
    if (e1) throw e1;
    const earnedNpr = (orders ?? []).reduce((s, o) => s + (o.total_npr ?? 0), 0);
    const { data: history, error: e2 } = await this.sb.from("loyalty_points").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    if (e2) throw e2;
    const rows = history ?? [];
    const adjustments = rows.reduce((s, e) => s + e.points, 0);
    return { balance: Math.floor(earnedNpr / 100) + adjustments, history: rows };
  }
  async addLoyaltyEntry(userId: string, points: number, reason?: string | null, orderId?: string | null) {
    const { data, error } = await this.sb.from("loyalty_points")
      .insert({ user_id: userId, points, reason: reason ?? null, order_id: orderId ?? null })
      .select().single();
    if (error) throw error;
    return data;
  }
  // ---- U26 gift-a-kit (store method only; POST /orders wiring is a separate track) ----
  async setOrderGift(orderId: string, g: { recipient_name: string; recipient_phone?: string | null; message?: string | null }) {
    const { data, error } = await this.sb.from("orders")
      .update({
        is_gift: true,
        gift_recipient_name: g.recipient_name,
        gift_recipient_phone: g.recipient_phone ?? null,
        gift_message: g.message ?? null,
      })
      .eq("id", orderId).select().maybeSingle();
    if (error) throw error;
    return data;
  }
  // ---- U24 adherence history (reuses 001 progress_checkins) ----
  async adherenceHistory(userId: string) {
    // Rate definition (documented in endpoints.md, not in the migration):
    // per calendar week (Monday-start), distinct days with ≥1 check-in / 7.
    const { data, error } = await this.sb.from("progress_checkins")
      .select("created_at").eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 12 * 7 * 86_400_000).toISOString())
      .order("created_at");
    if (error) throw error;
    const dayMs = 86_400_000;
    const nowT = new Date();
    const monday = new Date(Date.UTC(nowT.getUTCFullYear(), nowT.getUTCMonth(), nowT.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const weeks: { week: string; days: Set<string> }[] = [];
    for (let w = 11; w >= 0; w--) {
      weeks.push({ week: new Date(monday.getTime() - w * 7 * dayMs).toISOString().slice(0, 10), days: new Set() });
    }
    const byWeek = new Map(weeks.map((x) => [x.week, x]));
    for (const c of data ?? []) {
      const d = new Date(c.created_at as string);
      const ws = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      ws.setUTCDate(ws.getUTCDate() - ((ws.getUTCDay() + 6) % 7));
      const key = ws.toISOString().slice(0, 10);
      byWeek.get(key)?.days.add(d.toISOString().slice(0, 10));
    }
    return weeks.map(({ week, days }) => ({ week, rate: Math.round((days.size / 7) * 100) / 100 }));
  }
  // ---- U29 routine library (published only) ----
  async listRoutines() {
    const { data, error } = await this.sb.from("routine_library").select("*")
      .eq("is_published", true).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  // ---- leaderboard opt-in (009 users.leaderboard_opt_in; needed by coach C19) ----
  async getLeaderboardOptIn(userId: string) {
    const { data } = await this.sb.from("users").select("leaderboard_opt_in").eq("id", userId).maybeSingle();
    return data?.leaderboard_opt_in === true;
  }
  async setLeaderboardOptIn(userId: string, optIn: boolean) {
    const { error } = await this.sb.from("users").update({ leaderboard_opt_in: optIn }).eq("id", userId);
    if (error) throw error;
  }

// __B4_DOCTOR_METHODS__
  // ---- Batch 4 (010) — doctor (D28–D45) ----
  // NOTE: cases.sla_paused_at exists in the DB (010_batch4.sql) but not on
  // the shared Case type; the untyped Supabase client accepts it as-is.

  // ---- D29 doctor directory (excludes self) ----
  async listDoctorPeers(excludeId: string) {
    const { data, error } = await this.sb.from("users").select("*")
      .eq("role", "doctor").neq("id", excludeId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }

  // ---- D30 SLA pause / resume ----
  async setCaseSlaPaused(caseId: string, pausedAt: string | null) {
    const { data, error } = await this.sb.from("cases")
      .update({ sla_paused_at: pausedAt }).eq("id", caseId)
      .select().maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  // ---- D32 doctor-only internal comment thread (oldest first) ----
  async createCaseComment(c: { case_id: string; doctor_id: string; body: string }) {
    const { data, error } = await this.sb.from("case_comments")
      .insert({ case_id: c.case_id, doctor_id: c.doctor_id, body: c.body })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listCaseComments(caseId: string) {
    const { data, error } = await this.sb.from("case_comments").select("*")
      .eq("case_id", caseId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }

  // ---- D33 non-diagnostic concern tags (idempotent add) ----
  async addCaseConcernTag(caseId: string, tag: string) {
    const { data: existing } = await this.sb.from("case_concern_tags").select("*")
      .eq("case_id", caseId).eq("tag", tag).maybeSingle();
    if (existing) return existing;
    const { data, error } = await this.sb.from("case_concern_tags")
      .insert({ case_id: caseId, tag }).select().single();
    if (error) throw error;
    return data;
  }
  async removeCaseConcernTag(caseId: string, tag: string) {
    const { error } = await this.sb.from("case_concern_tags")
      .delete().eq("case_id", caseId).eq("tag", tag);
    if (error) throw error;
  }
  async listCaseConcernTags(caseId: string) {
    const { data, error } = await this.sb.from("case_concern_tags").select("*")
      .eq("case_id", caseId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }

  // ---- D37 weekly digest ----
  async getDoctorDigest(doctorId: string) {
    // "decided" is not a CaseStatus (queued | in_review | reviewed); the
    // reviewed bucket is status === "reviewed" within the last 7 days.
    // No timing data is recorded, so avgMinutes is honestly null.
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const nowD = new Date();
    const dow = (nowD.getDay() + 6) % 7;
    const mon = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - dow);
    const weekStart = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
    const { data, error } = await this.sb.from("cases")
      .select("id,updated_at,sla_due_at")
      .eq("assigned_doctor_id", doctorId)
      .eq("status", "reviewed")
      .gte("updated_at", cutoff);
    if (error) throw error;
    const rows = data ?? [];
    const slaHits = rows.filter((r: { sla_due_at: string | null; updated_at: string }) =>
      r.sla_due_at != null && r.updated_at <= r.sla_due_at).length;
    return { reviewed: rows.length, avgMinutes: null as number | null, slaHits, weekStart };
  }

  // ---- D38 similar past cases by root-score distance ----
  async listSimilarCases(caseId: string, doctorId: string) {
    const { data: kase } = await this.sb.from("cases").select("id,scan_id")
      .eq("id", caseId).maybeSingle();
    if (!kase) return [];
    const baseRows = await this.getRootScores(kase.scan_id) as { root: string; score: number }[];
    const base = new Map(baseRows.map((s) => [s.root, s.score]));
    if (base.size === 0) return [];
    const { data: past, error } = await this.sb.from("cases")
      .select("id,scan_id,created_at,priority,status")
      .eq("assigned_doctor_id", doctorId)
      .eq("status", "reviewed")
      .neq("id", caseId);
    if (error) throw error;
    const out: { id: string; created_at: string; priority: number; status: string; distance: number }[] = [];
    for (const c of past ?? []) {
      const rows = await this.getRootScores(c.scan_id) as { root: string; score: number }[];
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
  async createQueueFilter(f: { doctor_id: string; name: string; filters: Record<string, unknown> }) {
    const { data, error } = await this.sb.from("queue_filters")
      .insert({ doctor_id: f.doctor_id, name: f.name, filters: f.filters })
      .select().single();
    if (error) throw error;
    return data;
  }
  async listQueueFilters(doctorId: string) {
    const { data, error } = await this.sb.from("queue_filters").select("*")
      .eq("doctor_id", doctorId).order("created_at");
    if (error) throw error;
    return data ?? [];
  }
  async deleteQueueFilter(id: string, doctorId: string) {
    const { data, error } = await this.sb.from("queue_filters")
      .delete().eq("id", id).eq("doctor_id", doctorId).select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  // ---- D43 own reviewed cases for CSV export ----
  async exportOwnCases(doctorId: string) {
    const { data, error } = await this.sb.from("cases")
      .select("id,created_at,status,priority")
      .eq("assigned_doctor_id", doctorId)
      .eq("status", "reviewed")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

// __B4_ADMIN_METHODS__
// ---- Batch 4 admin (A30–A47) ----
// ---- A30 dashboard configs ----
async getDashboardConfig(role: string) {
  const { data, error } = await this.sb.from("dashboard_configs").select("*").eq("role", role).maybeSingle();
  if (error) throw error;
  return data;
}
async setDashboardConfig(role: string, config: Record<string, unknown>) {
  const { data, error } = await this.sb.from("dashboard_configs")
    .upsert({ role, config, updated_at: new Date().toISOString() }, { onConflict: "role" })
    .select().single();
  if (error) throw error;
  return data;
}
// ---- A37 email delivery log ----
async logEmail(e: { to_email: string; template: string; status: "sent" | "failed"; error?: string | null }) {
  const { data, error } = await this.sb.from("email_logs")
    .insert({ to_email: e.to_email, template: e.template, status: e.status, error: e.error ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
async listEmailLogs(limit: number) {
  const { data, error } = await this.sb.from("email_logs")
    .select("*").order("created_at", { ascending: false }).limit(Math.max(limit, 0));
  if (error) throw error;
  return data ?? [];
}
// ---- A44 admin notices ----
async listAdminNotices(adminId: string) {
  const { data, error } = await this.sb.from("admin_notices").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const { data: reads } = await this.sb.from("admin_notice_reads").select("notice_id").eq("admin_id", adminId);
  const readSet = new Set((reads ?? []).map((r: { notice_id: string }) => r.notice_id));
  return rows.map((n) => ({ ...n, read: readSet.has(n.id as string) }));
}
async createAdminNotice(n: { title_en: string; title_ne?: string | null; body_en?: string | null; body_ne?: string | null }) {
  const { data, error } = await this.sb.from("admin_notices")
    .insert({ title_en: n.title_en, title_ne: n.title_ne ?? null, body_en: n.body_en ?? null, body_ne: n.body_ne ?? null })
    .select().single();
  if (error) throw error;
  return { ...data, read: false };
}
async markAdminNoticeRead(adminId: string, noticeId: string) {
  const { error } = await this.sb.from("admin_notice_reads")
    .upsert({ admin_id: adminId, notice_id: noticeId }, { onConflict: "admin_id,notice_id" });
  if (error) throw error;
}
// ---- A45 consent versions ----
async listConsentVersions(kind?: string) {
  let q = this.sb.from("consent_versions").select("*");
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
async createConsentVersion(v: { kind: string; version: number; text_en: string; text_ne?: string | null; active?: boolean }) {
  const { data, error } = await this.sb.from("consent_versions")
    .insert({ kind: v.kind, version: v.version, text_en: v.text_en, text_ne: v.text_ne ?? null, active: v.active ?? false })
    .select().single();
  if (error) throw error;
  return data;
}
async activateConsentVersion(id: string) {
  const { data: row, error: e1 } = await this.sb.from("consent_versions").select("*").eq("id", id).maybeSingle();
  if (e1) throw e1;
  if (!row) return null;
  const { error: e2 } = await this.sb.from("consent_versions").update({ active: false }).eq("kind", (row as { kind: string }).kind);
  if (e2) throw e2;
  const { data, error } = await this.sb.from("consent_versions").update({ active: true }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}
// ---- A33 verification document expiry ----
async listExpiringVerifications(withinDays: number) {
  const cutoff = new Date(Date.now() + withinDays * 86400_000).toISOString();
  const { data, error } = await this.sb.from("staff_verifications").select("*")
    .not("expires_at", "is", null).neq("status", "rejected").lte("expires_at", cutoff)
    .order("expires_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
async setVerificationExpiry(id: string, expiresAt: string | null) {
  const { data, error } = await this.sb.from("staff_verifications")
    .update({ expires_at: expiresAt }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}
// ---- A34 support ticket SLA ----
async getTicketSla() {
  const { data: tickets, error: e1 } = await this.sb.from("support_tickets").select("id, status, created_at, updated_at");
  if (e1) throw e1;
  const { data: replies, error: e2 } = await this.sb.from("ticket_replies")
    .select("ticket_id, author_role, created_at").neq("author_role", "customer");
  if (e2) throw e2;
  const firstByTicket = new Map<string, string>();
  for (const r of (replies ?? []) as { ticket_id: string; author_role: string; created_at: string }[]) {
    const cur = firstByTicket.get(r.ticket_id);
    if (!cur || r.created_at < cur) firstByTicket.set(r.ticket_id, r.created_at);
  }
  const firstResponseMs: number[] = [];
  const resolveMs: number[] = [];
  for (const t of (tickets ?? []) as { id: string; status: string; created_at: string; updated_at: string }[]) {
    const fr = firstByTicket.get(t.id);
    if (fr) firstResponseMs.push(new Date(fr).getTime() - new Date(t.created_at).getTime());
    // No closed_at column exists — updated_at is the closest honest proxy for resolution time.
    if (t.status === "closed") resolveMs.push(new Date(t.updated_at).getTime() - new Date(t.created_at).getTime());
  }
  const avgMin = (xs: number[]) => (xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60000) : null);
  return {
    open: ((tickets ?? []) as { status: string }[]).filter((t) => t.status === "open").length,
    avgFirstResponseMin: avgMin(firstResponseMs), avgResolveMin: avgMin(resolveMs),
  };
}
// ---- A36 bulk user status ----
async bulkSetUserStatus(ids: string[], disabled: boolean) {
  if (ids.length === 0) return 0;
  const { data, error } = await this.sb.from("users")
    .update({ is_active: !disabled }).in("id", ids).eq("is_active", disabled).select("id");
  if (error) throw error;
  return (data ?? []).length;
}
// ---- A38 deletion requests ----
async listDeletionRequests() {
  const { data, error } = await this.sb.from("deletion_requests").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
// ---- A39 referral stats ----
// No referral-code system exists in the schema (no referral tables through 010)
// — returning honest zeros rather than fabricated numbers.
async getReferralStats() {
  return { codes: 0, joined: 0 };
}
// ---- A40 challenge analytics ----
async getChallengeAnalytics() {
  const { data: challenges, error: e1 } = await this.sb.from("challenges").select("id, title_en");
  if (e1) throw e1;
  const { data: assigns, error: e2 } = await this.sb.from("challenge_assignments").select("challenge_id, completed_at");
  if (e2) throw e2;
  const byChallenge = new Map<string, { assigned: number; completed: number }>();
  for (const a of (assigns ?? []) as { challenge_id: string; completed_at: string | null }[]) {
    const g = byChallenge.get(a.challenge_id) ?? { assigned: 0, completed: 0 };
    g.assigned++;
    if (a.completed_at) g.completed++;
    byChallenge.set(a.challenge_id, g);
  }
  return ((challenges ?? []) as { id: string; title_en: string }[])
    .map((c) => {
      const g = byChallenge.get(c.id) ?? { assigned: 0, completed: 0 };
      return { challenge_id: c.id, title_en: c.title_en, assigned: g.assigned, completed: g.completed };
    })
    .sort((a, b) => b.assigned - a.assigned);
}
// ---- A41 coach performance ----
async getCoachPerformance() {
  const { data: coaches, error: e1 } = await this.sb.from("users").select("id").eq("role", "coach");
  if (e1) throw e1;
  const { data: escs, error: e2 } = await this.sb.from("escalations").select("coach_id");
  if (e2) throw e2;
  const { data: ratings, error: e3 } = await this.sb.from("satisfaction_ratings").select("coach_id, rating");
  if (e3) throw e3;
  const escCount = new Map<string, number>();
  for (const e of (escs ?? []) as { coach_id: string }[]) escCount.set(e.coach_id, (escCount.get(e.coach_id) ?? 0) + 1);
  const ratingSum = new Map<string, { sum: number; n: number }>();
  for (const r of (ratings ?? []) as { coach_id: string; rating: number }[]) {
    const g = ratingSum.get(r.coach_id) ?? { sum: 0, n: 0 };
    g.sum += r.rating; g.n++;
    ratingSum.set(r.coach_id, g);
  }
  return ((coaches ?? []) as { id: string }[]).map((c) => {
    const g = ratingSum.get(c.id);
    return {
      coach_id: c.id,
      escalations: escCount.get(c.id) ?? 0,
      avgSatisfaction: g ? Math.round((g.sum / g.n) * 10) / 10 : null,
    };
  });
}
// ---- A42 pharmacy fulfilment performance ----
async getPharmacyPerformance() {
  const { data: orders, error } = await this.sb.from("orders")
    .select("pack_started_at, pack_completed_at, updated_at").not("pack_completed_at", "is", null);
  if (error) throw error;
  const packMs: number[] = [];
  const shipMs: number[] = [];
  for (const o of (orders ?? []) as { pack_started_at: string | null; pack_completed_at: string; updated_at: string }[]) {
    if (o.pack_started_at) packMs.push(new Date(o.pack_completed_at).getTime() - new Date(o.pack_started_at).getTime());
    // No shipped_at/delivered_at column — updated_at is the closest honest proxy.
    shipMs.push(new Date(o.updated_at).getTime() - new Date(o.pack_completed_at).getTime());
  }
  const avgMin = (xs: number[]) => (xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60000) : null);
  return { handled: (orders ?? []).length, avgPackMin: avgMin(packMs), avgShipMin: avgMin(shipMs) };
}
// ---- A32/A46 refund analytics (grouped by reason, from the refunds table) ----
async getRefundAnalytics() {
  const { data, error } = await this.sb.from("refunds").select("reason, amount_npr");
  if (error) throw error;
  const byReason = new Map<string, { count: number; total: number }>();
  for (const r of (data ?? []) as { reason: string | null; amount_npr: number }[]) {
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
async getOpsDigest() {
  const dayStart = new Date().toISOString().slice(0, 10);
  const dayEnd = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const [{ count: ordersToday }, { count: slaBreaches }, { count: openTickets }, { count: pendingRefunds }] = await Promise.all([
    this.sb.from("orders").select("id", { count: "exact", head: true })
      .gte("created_at", `${dayStart}T00:00:00.000Z`).lt("created_at", `${dayEnd}T00:00:00.000Z`),
    this.sb.from("cases").select("id", { count: "exact", head: true })
      .in("status", ["queued", "in_review"]).not("sla_due_at", "is", null).lt("sla_due_at", new Date().toISOString()),
    this.sb.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
    this.sb.from("refund_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return {
    ordersToday: ordersToday ?? 0, slaBreaches: slaBreaches ?? 0,
    openTickets: openTickets ?? 0, pendingRefunds: pendingRefunds ?? 0,
  };
}

// __B4_PHARMACY_METHODS__

/* ---------------- Batch 4 (010): P28–P45 (pharmacy role) ---------------- */

// ---- P31: delivery attempts ----
async createDeliveryAttempt(a: { order_id: string; status: "failed" | "rescheduled" | "delivered"; note?: string | null }) {
  const { data, error } = await this.sb.from("delivery_attempts")
    .insert({ order_id: a.order_id, status: a.status, note: a.note ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
async listDeliveryAttempts(orderId: string) {
  const { data, error } = await this.sb.from("delivery_attempts").select("*")
    .eq("order_id", orderId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
// ---- P33: physical stock counts ----
async createStockCount(c: { kit_id: string; counted_qty: number; counted_by: string | null; system_qty: number }) {
  const { data, error } = await this.sb.from("stock_counts").insert({
    kit_id: c.kit_id, system_qty: c.system_qty, counted_qty: c.counted_qty,
    variance: c.counted_qty - c.system_qty, counted_by: c.counted_by,
  }).select().single();
  if (error) throw error;
  return data;
}
async listStockCounts(kitId: string) {
  const { data, error } = await this.sb.from("stock_counts").select("*")
    .eq("kit_id", kitId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
// ---- P38: kit substitutions ----
async createSubstitution(s: { order_id: string; from_kit_id?: string | null; to_kit_id?: string | null; reason: string }) {
  const { data, error } = await this.sb.from("substitutions").insert({
    order_id: s.order_id, from_kit_id: s.from_kit_id ?? null,
    to_kit_id: s.to_kit_id ?? null, reason: s.reason,
  }).select().single();
  if (error) throw error;
  return data;
}
async listSubstitutions(orderId: string) {
  const { data, error } = await this.sb.from("substitutions").select("*")
    .eq("order_id", orderId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
// ---- P39: delivery photo proofs ----
async createDeliveryProof(p: { order_id: string; storage_path: string; note?: string | null }) {
  const { data, error } = await this.sb.from("delivery_proofs")
    .insert({ order_id: p.order_id, storage_path: p.storage_path, note: p.note ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
async listDeliveryProofs(orderId: string) {
  const { data, error } = await this.sb.from("delivery_proofs").select("*")
    .eq("order_id", orderId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
// ---- P43: pharmacy-initiated refund requests (admin decides) ----
async createRefundRequest(r: { order_id: string; reason: string }) {
  const { data, error } = await this.sb.from("refund_requests")
    .insert({ order_id: r.order_id, reason: r.reason })
    .select().single();
  if (error) throw error;
  return data;
}
async listRefundRequests(status?: string) {
  let q = this.sb.from("refund_requests").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
async decideRefundRequest(id: string, approved: boolean) {
  const { data, error } = await this.sb.from("refund_requests")
    .update({ status: approved ? "approved" : "rejected", decided_at: new Date().toISOString() })
    .eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
// ---- P44: non-dispatch days ----
async createDispatchHoliday(h: { date: string; label: string }) {
  const { data, error } = await this.sb.from("dispatch_holidays")
    .upsert({ date: h.date, label: h.label }, { onConflict: "date" })
    .select().single();
  if (error) throw error;
  return data;
}
async listDispatchHolidays() {
  const { data, error } = await this.sb.from("dispatch_holidays").select("*")
    .order("date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
async deleteDispatchHoliday(id: string) {
  const { data, error } = await this.sb.from("dispatch_holidays").delete().eq("id", id).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
// ---- P45: courier damage claims ----
async createCourierClaim(c: { courier_name: string; order_id?: string | null; amount_npr?: number; reason: string }) {
  const { data, error } = await this.sb.from("courier_claims").insert({
    courier_name: c.courier_name, order_id: c.order_id ?? null,
    amount_npr: c.amount_npr ?? 0, reason: c.reason,
  }).select().single();
  if (error) throw error;
  return data;
}
async listCourierClaims(status?: string) {
  let q = this.sb.from("courier_claims").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
async setCourierClaimStatus(id: string, status: "open" | "filed" | "settled") {
  const { data, error } = await this.sb.from("courier_claims")
    .update({ status }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}
// ---- P34: rush flag on an order ----
async setOrderRush(orderId: string, rush: boolean) {
  const { data, error } = await this.sb.from("orders")
    .update({ is_rush: rush }).eq("id", orderId).select().maybeSingle();
  if (error) throw error;
  return data;
}
// ---- P36-alt: kit batches expiring within N days ----
async listExpiringBatches(withinDays: number) {
  const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await this.sb.from("kit_batches").select("*, kit:kits(name_en)")
    .not("expires_on", "is", null).lte("expires_on", cutoff)
    .order("expires_on", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((b) => ({
    id: b.id, kit_id: b.kit_id,
    kit_name: (b as unknown as { kit: { name_en: string } | null }).kit?.name_en ?? b.kit_id,
    batch_no: b.batch_no, expiry: b.expires_on,
    days_left: Math.round((Date.parse(b.expires_on as string) - Date.parse(today)) / 86400000),
    qty: b.qty,
  }));
}
// ---- P42: order search (order_no / phone / name; empty = full listing for the monthly report) ----
async searchOrders(q: string) {
  const needle = q.trim();
  if (!needle) {
    const { data, error } = await this.sb.from("orders").select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
  const like = `%${needle.replace(/[%_\\]/g, "")}%`;
  const found = new Map<string, import("./types").Order>();
  const add = (rows: import("./types").Order[] | null) => {
    for (const o of rows ?? []) found.set(o.id, o);
  };
  const byNo = await this.sb.from("orders").select("*").ilike("order_no", like);
  if (byNo.error) throw byNo.error;
  add(byNo.data);
  const users = await this.sb.from("users").select("id").ilike("phone", like);
  if (users.error) throw users.error;
  const profs = await this.sb.from("profiles").select("user_id").ilike("name", like);
  if (profs.error) throw profs.error;
  const userIds = [...new Set([
    ...((users.data ?? []) as { id: string }[]).map((u) => u.id),
    ...((profs.data ?? []) as { user_id: string }[]).map((p) => p.user_id),
  ])];
  if (userIds.length) {
    const byUser = await this.sb.from("orders").select("*").in("user_id", userIds);
    if (byUser.error) throw byUser.error;
    add(byUser.data);
  }
  // uuid id-fragments + shipping-address recipient names: JS fallback over the
  // 500 most recent orders (the structured queries above cover order_no, phone, name).
  const recent = await this.sb.from("orders").select("*").order("created_at", { ascending: false }).limit(500);
  if (recent.error) throw recent.error;
  const low = needle.toLowerCase();
  for (const o of (recent.data ?? []) as import("./types").Order[]) {
    if (o.id.toLowerCase().includes(low)) { found.set(o.id, o); continue; }
    const addr = o.shipping_address as Record<string, unknown> | null;
    if (addr && typeof addr.name === "string" && addr.name.toLowerCase().includes(low)) found.set(o.id, o);
  }
  return [...found.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
}
// ---- P28: clear + recreate verification checks as pending ----
async reverifyOrderChecks(orderId: string) {
  const del = await this.sb.from("order_checks").delete().eq("order_id", orderId);
  if (del.error) throw del.error;
  const rows = (["name", "phone", "address"] as const).map((check_type) => ({
    order_id: orderId, check_type, checked_by: null,
  }));
  const { data, error } = await this.sb.from("order_checks").insert(rows).select();
  if (error) throw error;
  return data ?? [];
}


/* ---------------- Batch 4 (010) — COACH (C28–C45) ---------------- */

// C29: customer rates their coach. Individual rows stay server-side — the
// coach-facing route only ever exposes the aggregate (avg + count).
async createCoachFeedback(f: { coach_id: string; customer_id: string; rating: number; note?: string | null }) {
  const { data, error } = await this.sb.from("coach_feedback")
    .insert({ coach_id: f.coach_id, customer_id: f.customer_id, rating: f.rating, note: f.note ?? null })
    .select().single();
  if (error) throw error;
  return data as CoachFeedback;
}
async getCoachFeedbackAggregate(coachId: string) {
  const { data, error } = await this.sb.from("coach_feedback").select("rating").eq("coach_id", coachId);
  if (error) throw error;
  const rows = (data ?? []) as { rating: number }[];
  if (!rows.length) return { avg: null, count: 0 };
  const sum = rows.reduce((a, r) => a + r.rating, 0);
  return { avg: Math.round((sum / rows.length) * 10) / 10, count: rows.length };
}

// C30: streak freeze for one date (one-per-month cap enforced in the route).
async createStreakFreeze(f: { customer_id: string; coach_id: string; frozen_date: string }) {
  const { data, error } = await this.sb.from("streak_freezes")
    .insert({ customer_id: f.customer_id, coach_id: f.coach_id, frozen_date: f.frozen_date })
    .select().single();
  if (error) throw error;
  return data as StreakFreeze;
}
async listStreakFreezes(customerId: string, month: string) {
  const [y, m] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // m is 1-based → next month start
  const { data, error } = await this.sb.from("streak_freezes").select("*")
    .eq("customer_id", customerId)
    .gte("frozen_date", `${month}-01`).lt("frozen_date", nextMonth)
    .order("frozen_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StreakFreeze[];
}

// C32: coach-defined customer tags (idempotent add; coach-scoped).
async addCustomerTag(coachId: string, customerId: string, tag: string) {
  const t = tag.trim().toLowerCase().slice(0, 60);
  const { data: existing, error: e1 } = await this.sb.from("customer_tags").select("*")
    .eq("coach_id", coachId).eq("customer_id", customerId).eq("tag", t).maybeSingle();
  if (e1) throw e1;
  if (existing) return existing as CustomerTag;
  const { data, error } = await this.sb.from("customer_tags")
    .insert({ coach_id: coachId, customer_id: customerId, tag: t }).select().single();
  if (error) throw error;
  return data as CustomerTag;
}
async removeCustomerTag(coachId: string, customerId: string, tag: string) {
  const { error } = await this.sb.from("customer_tags").delete()
    .eq("coach_id", coachId).eq("customer_id", customerId).eq("tag", tag.trim().toLowerCase());
  if (error) throw error;
}
async listCustomerTags(coachId: string, customerId: string) {
  const { data, error } = await this.sb.from("customer_tags").select("*")
    .eq("coach_id", coachId).eq("customer_id", customerId).order("tag", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CustomerTag[];
}

// C34: handover notes when a customer moves between coaches.
async createCoachHandover(h: { customer_id: string; from_coach_id?: string | null; to_coach_id?: string | null; note: string }) {
  const { data, error } = await this.sb.from("coach_handovers")
    .insert({ customer_id: h.customer_id, from_coach_id: h.from_coach_id ?? null, to_coach_id: h.to_coach_id ?? null, note: h.note })
    .select().single();
  if (error) throw error;
  return data as CoachHandover;
}
async listCoachHandovers(customerId: string) {
  const { data, error } = await this.sb.from("coach_handovers").select("*")
    .eq("customer_id", customerId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CoachHandover[];
}

// C37: this week's own activity (week starts Monday 00:00 UTC).
async getCoachWeeklyReport(coachId: string) {
  const d = new Date();
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset);
  const since = new Date(startMs).toISOString();
  const weekStart = since.slice(0, 10);
  const counts = await Promise.all([
    this.sb.from("coach_notes").select("id", { count: "exact", head: true }).eq("coach_id", coachId).gte("created_at", since),
    this.sb.from("scheduled_nudges").select("id", { count: "exact", head: true }).eq("coach_id", coachId).gte("created_at", since),
    this.sb.from("escalations").select("id", { count: "exact", head: true }).eq("coach_id", coachId).gte("created_at", since),
  ]);
  for (const r of counts) if (r.error) throw r.error;
  return { notes: counts[0].count ?? 0, nudges: counts[1].count ?? 0, escalations: counts[2].count ?? 0, weekStart };
}

// C38: milestone timeline — badges, completed customer goals, completed challenges.
async listCustomerMilestones(customerId: string) {
  const [badges, goals, assigns] = await Promise.all([
    this.sb.from("badges").select("badge, created_at").eq("user_id", customerId),
    this.sb.from("customer_goals").select("title_en, done_at").eq("customer_id", customerId).not("done_at", "is", null),
    this.sb.from("challenge_assignments").select("completed_at, challenge:challenges(title_en)").eq("user_id", customerId).not("completed_at", "is", null),
  ]);
  for (const r of [badges, goals, assigns]) if (r.error) throw r.error;
  const out: { kind: string; title: string; at: string }[] = [];
  for (const b of (badges.data ?? []) as { badge: string; created_at: string }[]) out.push({ kind: "badge", title: b.badge, at: b.created_at });
  for (const g of (goals.data ?? []) as { title_en: string; done_at: string }[]) out.push({ kind: "goal", title: g.title_en, at: g.done_at });
  for (const a of (assigns.data ?? []) as unknown as { completed_at: string; challenge: { title_en: string }[] }[]) {
    out.push({ kind: "challenge", title: a.challenge?.[0]?.title_en ?? "Challenge", at: a.completed_at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// C41: computed journey stage (rule documented in the memory implementation).
async getJourneyStage(customerId: string) {
  const { data: user, error: e1 } = await this.sb.from("users").select("created_at").eq("id", customerId).maybeSingle();
  if (e1) throw e1;
  const { data: cis, error: e2 } = await this.sb.from("progress_checkins").select("created_at")
    .eq("user_id", customerId).order("created_at", { ascending: false });
  if (e2) throw e2;
  const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  const rows = (cis ?? []) as { created_at: string }[];
  const last = rows[0];
  const created = (user as { created_at: string } | null)?.created_at;
  if (last && daysAgo(last.created_at) <= 7) {
    const prev = rows[1];
    if (prev && daysAgo(prev.created_at) >= 21) return "returning" as JourneyStage;
    if (!prev && created && daysAgo(created) >= 21) return "returning" as JourneyStage;
    return "active" as JourneyStage;
  }
  if (!last && created && daysAgo(created) < 7) return "new" as JourneyStage;
  return "dormant" as JourneyStage;
}

// C42: record the outcome of an escalation (escalations.outcome, 010).
async setEscalationOutcome(id: string, outcome: string) {
  const { data, error } = await this.sb.from("escalations").update({ outcome }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}

// C43: anonymized peer tips between coaches (PII rejection lives in the route).
async createCoachTip(t: { coach_id: string; title: string; body: string }) {
  const { data, error } = await this.sb.from("coach_tips")
    .insert({ coach_id: t.coach_id, title: t.title, body: t.body }).select().single();
  if (error) throw error;
  return data as CoachTip;
}
async listCoachTips() {
  const { data, error } = await this.sb.from("coach_tips").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CoachTip[];
}
async deleteCoachTip(id: string, coachId: string) {
  const { data, error } = await this.sb.from("coach_tips").delete().eq("id", id).eq("coach_id", coachId).select("id");
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).length > 0;
}

// C45: two-question end-of-challenge survey (one per assignment).
async createChallengeSurvey(s: { assignment_id: string; q1_rating: number; q2_text?: string | null }) {
  const { data, error } = await this.sb.from("challenge_surveys")
    .insert({ assignment_id: s.assignment_id, q1_rating: s.q1_rating, q2_text: s.q2_text ?? null })
    .select().single();
  if (error) throw error;
  return data as ChallengeSurvey;
}
async listChallengeSurveys(challengeId: string) {
  const { data: assigns, error: e1 } = await this.sb.from("challenge_assignments").select("id").eq("challenge_id", challengeId);
  if (e1) throw e1;
  const ids = ((assigns ?? []) as { id: string }[]).map((a) => a.id);
  if (!ids.length) return [];
  const { data, error } = await this.sb.from("challenge_surveys").select("*")
    .in("assignment_id", ids).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChallengeSurvey[];
}

// C39 helper: read receipt on an assigned article. Extra method on the
// concrete store (not part of the Store interface — the me route calls it
// through a structural cast) so store.ts stays untouched.
async markArticleAssignmentRead(id: string) {
  const { data, error } = await this.sb.from("article_assignments")
    .update({ read_at: new Date().toISOString() }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data;
}

  /* ================= Batch 4 (010) — CUSTOMER (U30–U47) ================= */

  /** Server-local calendar day key "YYYY-MM-DD". */
  private static dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** U37: app feedback. */
  async createAppFeedback(f: { user_id: string; rating: number; message?: string | null }): Promise<AppFeedback> {
    const { data, error } = await this.sb.from("app_feedback")
      .insert({ user_id: f.user_id, rating: f.rating, message: f.message ?? null })
      .select().single();
    if (error) throw error;
    return data as AppFeedback;
  }

  /** U40: create a kit reminder. */
  async createKitReminder(r: { user_id: string; kit_id?: string | null; label_en: string; label_ne?: string | null; remind_at: string }): Promise<KitReminder> {
    const { data, error } = await this.sb.from("kit_reminders")
      .insert({
        user_id: r.user_id, kit_id: r.kit_id ?? null,
        label_en: r.label_en, label_ne: r.label_ne ?? null, remind_at: r.remind_at,
      })
      .select().single();
    if (error) throw error;
    return data as KitReminder;
  }

  /** U40: my reminders, earliest reminder first. */
  async listKitReminders(userId: string): Promise<KitReminder[]> {
    const { data, error } = await this.sb.from("kit_reminders")
      .select("*").eq("user_id", userId).order("remind_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as KitReminder[];
  }

  /** U40: mark done/undone; null when missing or someone else's. */
  async setKitReminderDone(id: string, userId: string, done: boolean): Promise<KitReminder | null> {
    const { data, error } = await this.sb.from("kit_reminders")
      .update({ done }).eq("id", id).eq("user_id", userId).select().maybeSingle();
    if (error) throw error;
    return (data as KitReminder | null) ?? null;
  }

  /** U40: delete; false when missing or someone else's. */
  async deleteKitReminder(id: string, userId: string): Promise<boolean> {
    const { data, error } = await this.sb.from("kit_reminders")
      .delete().eq("id", id).eq("user_id", userId).select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  /** U42: log one product usage. */
  async logKitUsage(u: { user_id: string; kit_id?: string | null; note?: string | null }): Promise<KitUsage> {
    const { data, error } = await this.sb.from("kit_usages")
      .insert({ user_id: u.user_id, kit_id: u.kit_id ?? null, note: u.note ?? null })
      .select().single();
    if (error) throw error;
    return data as KitUsage;
  }

  /** U42: recent usage rows, newest first. */
  async listKitUsages(userId: string, limit: number): Promise<KitUsage[]> {
    const { data, error } = await this.sb.from("kit_usages")
      .select("*").eq("user_id", userId)
      .order("used_at", { ascending: false })
      .limit(Math.max(1, Math.min(100, limit || 20)));
    if (error) throw error;
    return (data ?? []) as KitUsage[];
  }

  /** U31: consecutive check-in days ending today (or yesterday). */
  async getStreak(userId: string): Promise<{ days: number }> {
    const { data, error } = await this.sb.from("progress_checkins")
      .select("created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(400);
    if (error) throw error;
    const days = new Set<string>();
    for (const c of data ?? []) days.add(SupabaseStore.dayKey(new Date(String(c.created_at))));
    let cursor = new Date();
    if (!days.has(SupabaseStore.dayKey(cursor))) cursor = new Date(cursor.getTime() - 86_400_000);
    let n = 0;
    while (days.has(SupabaseStore.dayKey(cursor))) {
      n++;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return { days: n };
  }

  /** U32: referral history. There is NO referrals table: U4 derives the code
   * deterministically from the user id (see client Referral.tsx) and never
   * tracked joins, so `joined` is honestly empty. */
  async getReferralHistory(userId: string): Promise<{ code: string | null; joined: { user_id: string; at: string }[] }> {
    return { code: `JARAA-${userId.slice(0, 6).toUpperCase()}`, joined: [] };
  }

  /** U41: kits whose latest order is 60+ days old. */
  async getReorderSuggestions(userId: string): Promise<{ kit_id: string; kit_name: string; ordered_at: string }[]> {
    const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data, error } = await this.sb.from("orders")
      .select("kit_id,created_at").eq("user_id", userId).not("kit_id", "is", null);
    if (error) throw error;
    const latest = new Map<string, string>();
    for (const o of (data ?? []) as { kit_id: string; created_at: string }[]) {
      const prev = latest.get(o.kit_id);
      if (!prev || o.created_at > prev) latest.set(o.kit_id, o.created_at);
    }
    const out: { kit_id: string; kit_name: string; ordered_at: string }[] = [];
    for (const [kitId, at] of latest) {
      if (at < cutoff) {
        const { data: kit } = await this.sb.from("kits").select("name_en").eq("id", kitId).maybeSingle();
        out.push({ kit_id: kitId, kit_name: (kit?.name_en as string) ?? "Kit", ordered_at: at });
      }
    }
    return out.sort((a, b) => a.ordered_at.localeCompare(b.ordered_at));
  }

  /** U45: own sessions from refresh tokens. The full token hash is
   * credential material — expose only an 8-char fingerprint as `id`, and
   * the schema has no last_used_at column (always null, honestly). */
  async listOwnSessions(userId: string): Promise<{ id: string; created_at: string; last_used_at: string | null }[]> {
    const { data, error } = await this.sb.from("refresh_tokens")
      .select("token_hash,created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    return (data ?? []).map((t) => ({
      id: String(t.token_hash).slice(0, 8),
      created_at: t.created_at as string,
      last_used_at: null,
    }));
  }

// __B4_CUSTOMER_METHODS__
}

export function randomId() { return randomUUID(); }
