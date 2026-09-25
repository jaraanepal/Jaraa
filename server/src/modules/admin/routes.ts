import { Router } from "express";
import multer from "multer";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, conflict, notFound, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { invalidateFlagCache } from "../../middleware/flags";
import { MAX_BYTES, processKitImage, PhotoError, pathFromPublicUrl } from "../../lib/photos";
import { validatePasswordStrength, placeholderPhoneForEmail, EMAIL_RE } from "../../lib/password";
import { hashPassword } from "../../lib/jwt";
import { audit } from "../../lib/audit";
import type { Role } from "../../db/types";

const ROLES: Role[] = ["customer", "doctor", "admin", "pharmacy", "coach"];
const STAFF_ROLES: Role[] = ["doctor", "pharmacy", "coach"];
const RULE_ACTIONS = ["next_stage", "raise_flag", "skip_root", "activate_path"];

export function adminRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole("admin"));

  // GET /admin/flags
  r.get("/flags", asyncHandler(async (_req, res) => {
    res.json({ flags: await store.listFeatureFlags() });
  }));

  // PUT /admin/flags/:key
  r.put("/flags/:key", asyncHandler(async (req: AuthedRequest, res) => {
    const { is_enabled } = req.body ?? {};
    if (typeof is_enabled !== "boolean") throw badRequest("Request failed validation.", { field: "is_enabled" });
    const flag = await store.setFeatureFlag(req.params.key, is_enabled, req.user!.id);
    if (!flag) throw notFound("Unknown flag.");
    invalidateFlagCache(req.params.key);
    await audit(store, { actorId: req.user!.id, action: "flag.toggle", entity: "flag", entityId: flag.key, ip: clientIp(req) });
    res.json(flag);
  }));

  // GET /admin/scan-rules
  r.get("/scan-rules", asyncHandler(async (req, res) => {
    const activeOnly = req.query.active_only !== "false";
    const rules = await store.listScanRules(activeOnly);
    res.json({
      rules: rules.map((x) => ({
        id: x.id,
        trigger_condition: x.trigger_condition,
        action: x.action,
        action_detail: (x.action_params as { path?: string; flag?: string })?.path
          ?? (x.action_params as { flag?: string })?.flag ?? null,
        priority: x.priority,
        is_active: x.is_active,
      })),
    });
  }));

  // PUT /admin/scan-rules/:id
  r.put("/scan-rules/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const { trigger_condition, action, action_detail, priority, is_active } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (trigger_condition !== undefined) {
      if (typeof trigger_condition !== "object") throw badRequest("Request failed validation.", { field: "trigger_condition" });
      patch.trigger_condition = trigger_condition;
    }
    if (action !== undefined) {
      if (!RULE_ACTIONS.includes(action)) throw badRequest("Request failed validation.", { field: "action" });
      patch.action = action;
    }
    if (action_detail !== undefined) patch.action_params = { path: action_detail, flag: action_detail };
    if (priority !== undefined) {
      if (!Number.isInteger(priority)) throw badRequest("Request failed validation.", { field: "priority" });
      patch.priority = priority;
    }
    if (is_active !== undefined) {
      if (typeof is_active !== "boolean") throw badRequest("Request failed validation.", { field: "is_active" });
      patch.is_active = is_active;
    }
    const rule = await store.updateScanRule(req.params.id, patch);
    if (!rule) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "rule.update", entity: "rule", entityId: rule.id, ip: clientIp(req) });
    res.json({
      id: rule.id, trigger_condition: rule.trigger_condition, action: rule.action,
      action_detail: (rule.action_params as { path?: string })?.path ?? null,
      priority: rule.priority, is_active: rule.is_active,
    });
  }));

  // GET /admin/analytics/funnel
  r.get("/analytics/funnel", asyncHandler(async (_req, res) => {
    res.json(await store.analyticsSnapshot());
  }));

  // GET /admin/audit
  r.get("/audit", asyncHandler(async (req, res) => {
    const { actor_id, entity, from, to, limit } = req.query;
    const entries = await store.listAudit({
      actor_id: typeof actor_id === "string" ? actor_id : undefined,
      entity: typeof entity === "string" ? entity : undefined,
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
      limit: Math.min(Math.max(parseInt(String(limit ?? "50"), 10) || 50, 1), 200),
    });
    res.json({ entries });
  }));

  // GET /admin/users
  r.get("/users", asyncHandler(async (_req, res) => {
    const users = await store.listUsers();
    res.json({
      users: users.map((u) => ({
        id: u.id, phone: u.phone, email: u.email, role: u.role,
        is_active: u.is_active, created_at: u.created_at,
      })),
    });
  }));

  // PATCH /admin/users/:id/role
  r.patch("/users/:id/role", asyncHandler(async (req: AuthedRequest, res) => {
    const { role } = req.body ?? {};
    if (!ROLES.includes(role)) throw badRequest("Request failed validation.", { field: "role" });
    const user = await store.updateUserRole(req.params.id, role);
    if (!user) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "user.role", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.json({ id: user.id, phone: user.phone, email: user.email, role: user.role });
  }));

  // POST /admin/staff — create a staff account (doctor/pharmacy/coach only).
  // Admin-only (r.use(requireRole("admin")) above). Staff sign in at
  // /{role}/login with email + password — same password rules as everyone.
  r.post("/staff", asyncHandler(async (req: AuthedRequest, res) => {
    const { email, password, role } = req.body ?? {};
    if (!STAFF_ROLES.includes(role)) throw badRequest("Request failed validation.", { field: "role" });
    if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      throw badRequest("Request failed validation.", { field: "email" });
    }
    const strength = validatePasswordStrength(typeof password === "string" ? password : "");
    if (!strength.ok) throw badRequest("Password does not meet the strength rules.", { field: "password", errors: strength.errors });
    const emailNorm = email.trim().toLowerCase();
    if (await store.getUserByEmail(emailNorm)) throw conflict("A user with this email already exists.");
    const user = await store.createUser({
      phone: placeholderPhoneForEmail(emailNorm),
      email: emailNorm,
      role: role as Role,
      passwordHash: await hashPassword(String(password)),
    });
    await audit(store, { actorId: req.user!.id, action: "staff.create", entity: "user", entityId: user.id, ip: clientIp(req) });
    // Never return the password hash.
    res.status(201).json({ id: user.id, email: user.email, role: user.role, is_active: user.is_active });
  }));

  // ---- kit catalog (cosmetic commerce; prescription rows stay inert while flag OFF) ----
  // DELETE /admin/kits/:id is a SOFT delete (is_active=false): orders already
  // placed against the kit stay resolvable, and the public catalogue simply
  // stops listing it. There is no hard-delete endpoint.
  const toContractKit = (k: import("../../db/types").Kit) => ({
    id: k.id, plan_id: k.plan_id, name_en: k.name_en, name_ne: k.name_ne,
    product_ids: k.product_ids, total_npr: k.total_npr,
    category: k.category, images: k.images,
    whats_included: k.whats_included, usage_instructions: k.usage_instructions,
    stock: k.stock,
    is_active: k.is_active, created_at: k.created_at, updated_at: k.updated_at,
  });

  const kitUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
  });

  function validText(v: unknown, max = 5000): v is string {
    return typeof v === "string" && v.trim().length > 0 && v.length <= max;
  }
  function validInt(v: unknown): v is number {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0;
  }

  async function validateKitProductIds(product_ids: unknown): Promise<string[]> {
    if (product_ids === undefined || product_ids === null) return [];
    if (!Array.isArray(product_ids)) throw badRequest("Request failed validation.", { field: "product_ids" });
    for (const pid of product_ids) {
      if (!(await store.getProduct(String(pid)))) throw badRequest("Unknown product.", { field: "product_ids" });
    }
    return product_ids.map(String);
  }

  // POST /admin/products
  r.post("/products", asyncHandler(async (req: AuthedRequest, res) => {
    const { name_en, name_ne, kind, price_npr, image_url } = req.body ?? {};
    if (!name_en || typeof name_en !== "string") throw badRequest("Request failed validation.", { field: "name_en" });
    if (!["cosmetic", "prescription"].includes(kind)) throw badRequest("Request failed validation.", { field: "kind" });
    const price = Number(price_npr);
    if (!Number.isInteger(price) || price < 0) throw badRequest("Request failed validation.", { field: "price_npr" });
    const p = await store.createProduct({ name_en, name_ne: name_ne ?? null, kind, price_npr: price, image_url: image_url ?? null });
    await audit(store, { actorId: req.user!.id, action: "product.create", entity: "product", entityId: p.id, ip: clientIp(req) });
    res.status(201).json({ id: p.id, name_en: p.name_en, kind: p.kind, price_npr: p.price_npr, is_active: p.is_active });
  }));

  // POST /admin/kits
  r.post("/kits", asyncHandler(async (req: AuthedRequest, res) => {
    const { name_en, name_ne, product_ids, total_npr, price_npr, category, images, whats_included, usage_instructions, stock, is_active } = req.body ?? {};
    if (!validText(name_en, 200)) throw badRequest("Request failed validation.", { field: "name_en" });
    // price: total_npr is the canonical contract field; price_npr accepted as an alias.
    const priceRaw = total_npr !== undefined ? total_npr : price_npr;
    if (!validInt(priceRaw)) throw badRequest("Request failed validation.", { field: "total_npr" });
    if (stock !== undefined && !validInt(stock)) throw badRequest("Request failed validation.", { field: "stock" });
    if (category !== undefined && category !== null && typeof category !== "string")
      throw badRequest("Request failed validation.", { field: "category" });
    if (images !== undefined && (!Array.isArray(images) || !images.every((u) => typeof u === "string")))
      throw badRequest("Request failed validation.", { field: "images" });
    const ids = await validateKitProductIds(product_ids);
    const k = await store.createKit({
      name_en: name_en.trim(), name_ne: name_ne ?? null, product_ids: ids, total_npr: Number(priceRaw),
      category: category ? String(category).slice(0, 100) : null,
      images: images ?? [],
      whats_included: whats_included ?? null, usage_instructions: usage_instructions ?? null,
      stock: stock === undefined ? 0 : Number(stock),
      // Honor the admin form's "Active (visible in shop)" checkbox on create, not just on update.
      is_active: typeof is_active === "boolean" ? is_active : undefined,
    });
    await audit(store, { actorId: req.user!.id, action: "kit.create", entity: "kit", entityId: k.id, ip: clientIp(req) });
    res.status(201).json(toContractKit(k));
  }));

  // GET /admin/kits — list with search/filter/pagination (admin sees inactive too)
  r.get("/kits", asyncHandler(async (req, res) => {
    const q = req.query;
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const isActive = q.is_active === undefined ? undefined : q.is_active === "true";
    const { kits, total } = await store.listKitsAdmin({
      search: typeof q.search === "string" ? q.search : undefined,
      category: typeof q.category === "string" ? q.category : undefined,
      isActive, limit, offset,
    });
    res.json({ kits: kits.map(toContractKit), total, limit, offset });
  }));

  // GET /admin/kits/leaderboard — A26: per-kit order counts + revenue, revenue desc.
  // Registered BEFORE /kits/:id so "leaderboard" isn't captured as a kit id.
  r.get("/kits/leaderboard", asyncHandler(async (_req, res) => {
    res.json({ leaderboard: await store.kitLeaderboard() });
  }));

  // GET /admin/kits/:id — full detail (admin sees inactive too)
  r.get("/kits/:id", asyncHandler(async (req, res) => {
    const k = await store.getKit(req.params.id);
    if (!k) throw notFound("Not found.");
    res.json(toContractKit(k));
  }));

  // PATCH /admin/kits/:id — edit any catalogue field
  r.patch("/kits/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const { name_en, name_ne, product_ids, total_npr, price_npr, category, images, whats_included, usage_instructions, stock, is_active } = req.body ?? {};
    const patch: Partial<import("../../db/types").Kit> = {};
    if (name_en !== undefined) {
      if (!validText(name_en, 200)) throw badRequest("Request failed validation.", { field: "name_en" });
      patch.name_en = name_en.trim();
    }
    if (name_ne !== undefined) patch.name_ne = name_ne === null ? null : String(name_ne);
    if (product_ids !== undefined) patch.product_ids = await validateKitProductIds(product_ids);
    const priceRaw = total_npr !== undefined ? total_npr : price_npr;
    if (priceRaw !== undefined) {
      if (!validInt(priceRaw)) throw badRequest("Request failed validation.", { field: "total_npr" });
      patch.total_npr = Number(priceRaw);
    }
    if (category !== undefined) {
      if (category !== null && typeof category !== "string")
        throw badRequest("Request failed validation.", { field: "category" });
      patch.category = category ? String(category).slice(0, 100) : null;
    }
    if (images !== undefined) {
      if (!Array.isArray(images) || !images.every((u) => typeof u === "string"))
        throw badRequest("Request failed validation.", { field: "images" });
      patch.images = images;
    }
    if (whats_included !== undefined) patch.whats_included = whats_included === null ? null : String(whats_included);
    if (usage_instructions !== undefined) patch.usage_instructions = usage_instructions === null ? null : String(usage_instructions);
    if (stock !== undefined) {
      if (!validInt(stock)) throw badRequest("Request failed validation.", { field: "stock" });
      patch.stock = Number(stock);
    }
    if (is_active !== undefined) patch.is_active = Boolean(is_active);
    const k = await store.updateKit(req.params.id, patch);
    if (!k) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "kit.update", entity: "kit", entityId: k.id, ip: clientIp(req) });
    res.json(toContractKit(k));
  }));

  // DELETE /admin/kits/:id — SOFT delete (sets is_active=false)
  r.delete("/kits/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const k = await store.updateKit(req.params.id, { is_active: false });
    if (!k) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "kit.delete", entity: "kit", entityId: k.id, ip: clientIp(req) });
    res.json(toContractKit(k));
  }));

  // POST /admin/kits/:id/images — multipart kit image upload (field "image")
  r.post("/kits/:id/images", kitUpload.single("image"), asyncHandler(async (req: AuthedRequest, res) => {
    const kit = await store.getKit(req.params.id);
    if (!kit) throw notFound("Not found.");
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw badRequest("Request failed validation.", { field: "image" });
    try {
      const out = await processKitImage(deps.kitStorage, {
        kitId: kit.id, bytes: file.buffer, filename: file.originalname,
      });
      const updated = (await store.updateKit(kit.id, { images: [...kit.images, out.imageUrl] }))!;
      await audit(store, {
        actorId: req.user!.id, action: "kit.image.add", entity: "kit", entityId: kit.id,
        ip: clientIp(req),
      });
      res.status(201).json({
        image_url: out.imageUrl, thumb_url: out.thumbUrl,
        width: out.width, height: out.height,
        images: updated.images,
      });
    } catch (e) {
      if (e instanceof PhotoError) {
        const code = e.status === 413 ? 413 : e.status === 415 ? 400 : 422;
        res.status(code).json({ code: "validation_error", message: e.message });
        return;
      }
      throw e;
    }
  }));

  // DELETE /admin/kits/:id/images — remove one image (storage + kit.images[])
  r.delete("/kits/:id/images", asyncHandler(async (req: AuthedRequest, res) => {
    const kit = await store.getKit(req.params.id);
    if (!kit) throw notFound("Not found.");
    const { image_url } = req.body ?? {};
    if (typeof image_url !== "string" || !kit.images.includes(image_url))
      throw badRequest("Request failed validation.", { field: "image_url" });
    const path = pathFromPublicUrl("kit-images", image_url);
    // remove the file + its thumbnail; storage errors must not fail the request
    try { await deps.kitStorage.delete(path); } catch (e) { console.error("[kit-image delete]", e); }
    try { await deps.kitStorage.delete(path.replace(/\.jpg$/, "-thumb.jpg")); } catch (e) { console.error("[kit-image delete]", e); }
    const updated = (await store.updateKit(kit.id, { images: kit.images.filter((u) => u !== image_url) }))!;
    await audit(store, {
      actorId: req.user!.id, action: "kit.image.remove", entity: "kit", entityId: kit.id,
      ip: clientIp(req),
    });
    res.json({ removed: image_url, images: updated.images });
  }));

  // ---- admin broadcast (A1) ----
  // POST /admin/broadcast
  const BROADCAST_ROLES: Role[] = ["customer", "doctor", "pharmacy", "coach"];
  r.post("/broadcast", asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, body_en, body_ne, role, link } = req.body ?? {};
    if (!validText(title_en, 120)) throw badRequest("Request failed validation.", { field: "title_en" });
    if (role !== undefined && !BROADCAST_ROLES.includes(role))
      throw badRequest("Request failed validation.", { field: "role" });
    const users = await store.listUsers();
    const targets = users.filter((u) => u.is_active && (role === undefined || u.role === role));
    let sent = 0;
    let failed = 0;
    for (const u of targets) {
      try {
        await store.createNotification({
          user_id: u.id, type: "broadcast",
          title_en: title_en.trim(),
          title_ne: title_ne === undefined || title_ne === null ? null : String(title_ne),
          body_en: body_en === undefined || body_en === null ? null : String(body_en),
          body_ne: body_ne === undefined || body_ne === null ? null : String(body_ne),
          link: link === undefined || link === null ? null : String(link),
        });
        sent++;
      } catch (e) {
        failed++;
        console.error("[broadcast]", e);
      }
    }
    await audit(store, { actorId: req.user!.id, action: "broadcast.send", entity: "notification", entityId: "broadcast", ip: clientIp(req) });
    res.json({ sent, failed });
  }));

  // ---- admin refunds (A3) ----
  // POST /admin/orders/:id/refund — :id accepts the order id or the JR- order_no.
  r.post("/orders/:id/refund", asyncHandler(async (req: AuthedRequest, res) => {
    const { amount_npr, reason } = req.body ?? {};
    let order = await store.getOrder(req.params.id);
    if (!order) order = await store.getOrderByNo(req.params.id);
    if (!order) throw notFound("Not found.");
    const amount = Number(amount_npr);
    if (!Number.isInteger(amount) || amount <= 0 || amount > order.total_npr)
      throw badRequest("Request failed validation.", { field: "amount_npr" });
    const refund = await store.createRefund({
      order_id: order.id, amount_npr: amount,
      reason: reason === undefined || reason === null ? null : String(reason),
      created_by: req.user!.id,
    });
    if (amount >= order.total_npr) order = (await store.updateOrder(order.id, { status: "refunded" }))!;
    await audit(store, { actorId: req.user!.id, action: "refund.create", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json({ refund, order });
  }));

  // GET /admin/refunds
  r.get("/refunds", asyncHandler(async (_req, res) => {
    res.json({ refunds: await store.listRefunds() });
  }));

  // ---- SLA monitor (A4) ----
  // GET /admin/sla
  r.get("/sla", asyncHandler(async (_req, res) => {
    const cases = await store.listOverdueCases();
    const now = Date.now();
    const enriched = await Promise.all(cases.map(async (c) => {
      const scan = await store.getScan(c.scan_id);
      const dueMs = c.sla_due_at ? Date.parse(c.sla_due_at) : NaN;
      return {
        id: c.id, scan_id: c.scan_id, user_id: scan?.user_id ?? null,
        status: c.status, priority: c.priority,
        sla_due_at: c.sla_due_at, created_at: c.created_at,
        hours_overdue: Number.isNaN(dueMs) ? 0 : Math.round((now - dueMs) / 3.6e6),
      };
    }));
    res.json({ cases: enriched });
  }));

  // ---- staff verification (A5) ----
  // GET /admin/verifications?status=pending|approved|rejected
  r.get("/verifications", asyncHandler(async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !["pending", "approved", "rejected"].includes(String(status)))
      throw badRequest("Request failed validation.", { field: "status" });
    const verifications = await store.listStaffVerifications(status as import("../../db/types").StaffVerificationStatus | undefined);
    const enriched = await Promise.all(verifications.map(async (v) => {
      const user = await store.getUserById(v.user_id);
      const profile = await store.getProfile(v.user_id);
      return { ...v, phone: user?.phone ?? null, name: profile?.name ?? null };
    }));
    res.json({ verifications: enriched });
  }));

  // POST /admin/verifications/:id/decide
  r.post("/verifications/:id/decide", asyncHandler(async (req: AuthedRequest, res) => {
    const { approved, note } = req.body ?? {};
    if (typeof approved !== "boolean") throw badRequest("Request failed validation.", { field: "approved" });
    const verification = await store.decideStaffVerification(
      req.params.id, approved, req.user!.id, note ?? null);
    if (!verification) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "verification.decide", entity: "verification", entityId: verification.id, ip: clientIp(req) });
    res.json({ verification });
  }));

  // ---- finance snapshot (A6) ----
  // GET /admin/finance
  const REVENUE_STATUSES: import("../../db/types").OrderStatus[] = ["paid", "fulfilling", "shipped", "delivered"];
  const COD_PENDING_STATUSES: import("../../db/types").OrderStatus[] = ["pending", "paid", "fulfilling", "shipped"];
  r.get("/finance", asyncHandler(async (_req, res) => {
    const orders = await store.listAllOrders();
    const refunds = await store.listRefunds();
    const by_status: Record<string, number> = {};
    let order_count = 0;
    let revenue_npr = 0;
    let cod_pending_npr = 0;
    let cod_collected_npr = 0;
    for (const o of orders) {
      order_count++;
      by_status[o.status] = (by_status[o.status] ?? 0) + 1;
      if (REVENUE_STATUSES.includes(o.status)) revenue_npr += o.total_npr;
      if (o.payment_method === "cod" && COD_PENDING_STATUSES.includes(o.status)) cod_pending_npr += o.total_npr;
      if (o.payment_method === "cod" && o.status === "delivered") cod_collected_npr += o.total_npr;
    }
    const refunds_npr = refunds.reduce((sum, x) => sum + x.amount_npr, 0);
    res.json({
      finance: {
        order_count, revenue_npr, cod_pending_npr, cod_collected_npr,
        refunds_npr, by_status,
      },
    });
  }));

  // ---- support tickets (A7) ----
  // GET /admin/tickets/sla — A34. Registered BEFORE /tickets/:id so "sla"
  // isn't swallowed by the :id param.
  r.get("/tickets/sla", asyncHandler(async (_req, res) => {
    res.json({ sla: await store.getTicketSla() });
  }));

  // GET /admin/tickets?status=
  r.get("/tickets", asyncHandler(async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !["open", "answered", "closed"].includes(String(status)))
      throw badRequest("Request failed validation.", { field: "status" });
    const tickets = await store.listTickets({ status: status as import("../../db/types").TicketStatus | undefined });
    res.json({ tickets });
  }));

  // GET /admin/tickets/:id
  r.get("/tickets/:id", asyncHandler(async (req, res) => {
    const ticket = await store.getTicket(req.params.id);
    if (!ticket) throw notFound("Not found.");
    res.json({ ticket, replies: await store.listTicketReplies(ticket.id) });
  }));

  // POST /admin/tickets/:id/reply
  r.post("/tickets/:id/reply", asyncHandler(async (req: AuthedRequest, res) => {
    const { body } = req.body ?? {};
    if (!validText(body, 4000)) throw badRequest("Request failed validation.", { field: "body" });
    const ticket = await store.getTicket(req.params.id);
    if (!ticket) throw notFound("Not found.");
    const reply = await store.addTicketReply(ticket.id, req.user!.id, "admin", body.trim());
    // Notify the customer; a notification failure must not fail the reply.
    store.createNotification({
      user_id: ticket.user_id, type: "ticket_reply",
      title_en: "Support replied to your ticket",
      title_ne: "समर्थनले तपाईंको टिकटको जवाफ दियो",
      link: "/notifications",
    }).catch((e) => console.error("[ticket-reply notification]", e));
    await audit(store, { actorId: req.user!.id, action: "ticket.reply", entity: "ticket", entityId: ticket.id, ip: clientIp(req) });
    res.status(201).json({ reply });
  }));

  // PATCH /admin/tickets/:id
  r.patch("/tickets/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.body ?? {};
    if (!["open", "answered", "closed"].includes(status))
      throw badRequest("Request failed validation.", { field: "status" });
    const ticket = await store.updateTicketStatus(req.params.id, status);
    if (!ticket) throw notFound("Not found.");
    res.json({ ticket });
  }));

  // ---- education articles (A8) ----
  // GET /admin/articles
  r.get("/articles", asyncHandler(async (_req, res) => {
    res.json({ articles: await store.listArticles(false) });
  }));

  // POST /admin/articles
  r.post("/articles", asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, body_en, body_ne, is_published } = req.body ?? {};
    if (!validText(title_en, 300)) throw badRequest("Request failed validation.", { field: "title_en" });
    if (!validText(body_en, 100000)) throw badRequest("Request failed validation.", { field: "body_en" });
    const article = await store.createArticle({
      title_en: title_en.trim(), title_ne: title_ne ?? null,
      body_en: body_en.trim(), body_ne: body_ne ?? null,
      is_published: typeof is_published === "boolean" ? is_published : undefined,
      created_by: req.user!.id,
    });
    await audit(store, { actorId: req.user!.id, action: "article.create", entity: "article", entityId: article.id, ip: clientIp(req) });
    res.status(201).json({ article });
  }));

  // PATCH /admin/articles/:id
  r.patch("/articles/:id", asyncHandler(async (req, res) => {
    const { title_en, title_ne, body_en, body_ne, is_published } = req.body ?? {};
    const patch: Partial<Pick<import("../../db/types").EducationArticle,
      "title_en" | "title_ne" | "body_en" | "body_ne" | "is_published">> = {};
    if (title_en !== undefined) {
      if (!validText(title_en, 300)) throw badRequest("Request failed validation.", { field: "title_en" });
      patch.title_en = title_en.trim();
    }
    if (title_ne !== undefined) patch.title_ne = title_ne === null ? null : String(title_ne);
    if (body_en !== undefined) {
      if (!validText(body_en, 100000)) throw badRequest("Request failed validation.", { field: "body_en" });
      patch.body_en = body_en.trim();
    }
    if (body_ne !== undefined) patch.body_ne = body_ne === null ? null : String(body_ne);
    if (is_published !== undefined) {
      if (typeof is_published !== "boolean") throw badRequest("Request failed validation.", { field: "is_published" });
      patch.is_published = is_published;
    }
    const article = await store.updateArticle(req.params.id, patch);
    if (!article) throw notFound("Not found.");
    res.json({ article });
  }));

  // DELETE /admin/articles/:id
  r.delete("/articles/:id", asyncHandler(async (req, res) => {
    if (!(await store.getArticle(req.params.id))) throw notFound("Not found.");
    await store.deleteArticle(req.params.id);
    res.status(204).end();
  }));

  // ---- doctor availability (D9 admin view) ----
  // GET /admin/doctors/availability
  r.get("/doctors/availability", asyncHandler(async (_req, res) => {
    res.json({ doctors: await store.listDoctorAvailability() });
  }));

  /* ---------------- Batch 2 (008): A12–A20 ---------------- */
  const PERM_RE = /^[a-z0-9_.-]{2,60}$/;

  // GET /admin/roles/:role/permissions — A12
  r.get("/roles/:role/permissions", asyncHandler(async (req, res) => {
    const role = String(req.params.role);
    if (!["doctor", "admin", "pharmacy", "coach"].includes(role)) throw badRequest("Unknown role.", { field: "role" });
    res.json({ role, permissions: await store.getRolePermissions(role) });
  }));

  // PUT /admin/roles/:role/permissions — A12: replace permission set
  r.put("/roles/:role/permissions", asyncHandler(async (req: AuthedRequest, res) => {
    const role = String(req.params.role);
    if (!["doctor", "admin", "pharmacy", "coach"].includes(role)) throw badRequest("Unknown role.", { field: "role" });
    const perms = req.body?.permissions;
    if (!Array.isArray(perms)) throw badRequest("permissions must be an array.", { field: "permissions" });
    const out = [];
    for (const p of perms.slice(0, 100)) {
      const permission = String(p.permission ?? "").trim();
      if (!PERM_RE.test(permission)) continue;
      out.push(await store.setRolePermission(role, permission, p.granted !== false, req.user!.id));
    }
    await audit(store, { actorId: req.user!.id, action: "roles.permissions", entity: "role", entityId: role, ip: clientIp(req) });
    res.json({ role, permissions: out });
  }));

  // POST /admin/announcements — A13
  r.post("/announcements", asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, body_en, body_ne, link, starts_at, ends_at } = req.body ?? {};
    if (!title_en || !String(title_en).trim()) throw badRequest("title_en is required.", { field: "title_en" });
    const a = await store.createAnnouncement({
      title_en: String(title_en).slice(0, 200), title_ne: title_ne ? String(title_ne).slice(0, 200) : null,
      body_en: body_en ? String(body_en).slice(0, 2000) : null, body_ne: body_ne ? String(body_ne).slice(0, 2000) : null,
      link: link ? String(link).slice(0, 500) : null,
      starts_at: starts_at ? String(starts_at) : null, ends_at: ends_at ? String(ends_at) : null,
      created_by: req.user!.id,
    });
    res.status(201).json(a);
  }));

  // GET /admin/announcements — A13
  r.get("/announcements", asyncHandler(async (_req, res) => {
    res.json({ announcements: await store.listAnnouncements(false) });
  }));

  // PATCH /admin/announcements/:id — A13
  r.patch("/announcements/:id", asyncHandler(async (req, res) => {
    const patch: Record<string, unknown> = {};
    for (const k of ["title_en", "title_ne", "body_en", "body_ne", "link", "starts_at", "ends_at"]) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k] ? String(req.body[k]).slice(0, 2000) : null;
    }
    if (req.body?.is_active !== undefined) patch.is_active = req.body.is_active === true;
    const a = await store.updateAnnouncement(req.params.id, patch as never);
    if (!a) throw notFound("Announcement not found.");
    res.json(a);
  }));

  // DELETE /admin/announcements/:id — A13
  r.delete("/announcements/:id", asyncHandler(async (req, res) => {
    const ok = await store.deleteAnnouncement(req.params.id);
    if (!ok) throw notFound("Announcement not found.");
    res.json({ ok: true });
  }));

  // GET /admin/sessions?user_id= — A14: active refresh-token sessions
  r.get("/sessions", asyncHandler(async (req, res) => {
    const userId = typeof req.query.user_id === "string" ? req.query.user_id : "";
    if (!userId) throw badRequest("user_id is required.", { field: "user_id" });
    const sessions = await store.listRefreshSessions(userId);
    res.json({ sessions: sessions.map((s) => ({ ...s, token_hash: `${s.token_hash.slice(0, 12)}…` })) });
  }));

  // DELETE /admin/sessions/:id — A14: revoke (id = token hash prefix match).
  // The GET list truncates token_hash with a trailing "…"; strip it here so
  // the value the UI hands back actually matches the stored hash.
  r.delete("/sessions/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const rawId = req.params.id.replace(/…$/, "");
    if (!rawId) throw badRequest("Session id is required.", { field: "id" });
    const sessions = await store.listRefreshSessions(typeof req.query.user_id === "string" ? req.query.user_id : "");
    const match = sessions.find((s) => s.token_hash === rawId || s.token_hash.startsWith(rawId));
    if (!match) throw notFound("Session not found.");
    await store.revokeRefreshSession(match.token_hash);
    await audit(store, { actorId: req.user!.id, action: "session.revoke", entity: "user", entityId: match.user_id, ip: clientIp(req) });
    res.json({ ok: true });
  }));

  // GET /admin/login-attempts — A15
  r.get("/login-attempts", asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
    res.json({ attempts: await store.listLoginAttempts(limit) });
  }));

  // POST /admin/coupons — A16 (cosmetic kits only, enforced at apply time)
  r.post("/coupons", asyncHandler(async (req: AuthedRequest, res) => {
    const { code, kind, value, max_uses, min_order_npr, starts_at, ends_at } = req.body ?? {};
    if (!code || !String(code).trim()) throw badRequest("code is required.", { field: "code" });
    if (!["percent", "fixed_npr"].includes(kind)) throw badRequest("kind must be percent or fixed_npr.", { field: "kind" });
    const v = parseInt(String(value), 10);
    if (!Number.isFinite(v) || v <= 0 || (kind === "percent" && v > 90)) throw badRequest("Invalid value (percent coupons max 90).", { field: "value" });
    const c = await store.createCoupon({
      code: String(code), kind, value: v,
      max_uses: max_uses ? parseInt(String(max_uses), 10) : null,
      min_order_npr: min_order_npr ? parseInt(String(min_order_npr), 10) : 0,
      starts_at: starts_at ? String(starts_at) : null, ends_at: ends_at ? String(ends_at) : null,
      created_by: req.user!.id,
    });
    res.status(201).json(c);
  }));

  // GET /admin/coupons — A16
  r.get("/coupons", asyncHandler(async (_req, res) => {
    res.json({ coupons: await store.listCoupons() });
  }));

  // PATCH /admin/coupons/:id — A16: activate/deactivate
  r.patch("/coupons/:id", asyncHandler(async (req, res) => {
    const c = await store.updateCoupon(req.params.id, { is_active: req.body?.is_active === true });
    if (!c) throw notFound("Coupon not found.");
    res.json(c);
  }));

  // GET /admin/health — A17: live DB latency + recent audit activity
  r.get("/health", asyncHandler(async (_req, res) => {
    const t0 = Date.now();
    let dbOk = true;
    try { await store.listLoginAttempts(1); } catch { dbOk = false; }
    const dbLatencyMs = Date.now() - t0;
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const recent = await store.listAudit({ from: hourAgo, limit: 1000 });
    const byAction: Record<string, number> = {};
    for (const e of recent) byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    res.json({ db_ok: dbOk, db_latency_ms: dbLatencyMs, audit_events_1h: recent.length, by_action: byAction });
  }));

  // GET /admin/storage — A18: tracked file counts per bucket
  r.get("/storage", asyncHandler(async (_req, res) => {
    res.json({ buckets: await store.storageUsage() });
  }));

  // GET /admin/backups — A19
  r.get("/backups", asyncHandler(async (_req, res) => {
    res.json({ backups: await store.listBackups(50) });
  }));

  // POST /admin/backups — A19: record a backup
  r.post("/backups", asyncHandler(async (req: AuthedRequest, res) => {
    const { label, status, size_bytes, note } = req.body ?? {};
    if (!label || !String(label).trim()) throw badRequest("label is required.", { field: "label" });
    if (status && !["ok", "failed", "running"].includes(status)) throw badRequest("Invalid status.", { field: "status" });
    const b = await store.recordBackup({
      label: String(label).slice(0, 200), status: status ?? "ok",
      size_bytes: size_bytes ? parseInt(String(size_bytes), 10) : null,
      note: note ? String(note).slice(0, 1000) : null, recorded_by: req.user!.id,
    });
    res.status(201).json(b);
  }));

  // POST /admin/notification-templates — A20
  r.post("/notification-templates", asyncHandler(async (req: AuthedRequest, res) => {
    const { name, title_en, title_ne, body_en, body_ne, link } = req.body ?? {};
    if (!name || !title_en) throw badRequest("name and title_en are required.", { field: "name" });
    const t = await store.createNotificationTemplate({
      name: String(name).slice(0, 120), title_en: String(title_en).slice(0, 200),
      title_ne: title_ne ? String(title_ne).slice(0, 200) : null,
      body_en: body_en ? String(body_en).slice(0, 2000) : null,
      body_ne: body_ne ? String(body_ne).slice(0, 2000) : null,
      link: link ? String(link).slice(0, 500) : null, created_by: req.user!.id,
    });
    res.status(201).json(t);
  }));

  // GET /admin/notification-templates — A20
  r.get("/notification-templates", asyncHandler(async (_req, res) => {
    res.json({ templates: await store.listNotificationTemplates() });
  }));

  // DELETE /admin/notification-templates/:id — A20
  r.delete("/notification-templates/:id", asyncHandler(async (req, res) => {
    const ok = await store.deleteNotificationTemplate(req.params.id);
    if (!ok) throw notFound("Template not found.");
    res.json({ ok: true });
  }));

  /* ---------------- Batch 3 (009): A21–A29 ---------------- */
  const DISPUTE_STATUSES = ["open", "in_review", "resolved", "rejected"] as const;
  const EXPORT_FREQUENCIES = ["daily", "weekly", "monthly"];
  const EXPORT_KINDS = ["orders"];
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

  // ---- dispute resolution center (A21) ----
  // GET /admin/disputes?status=
  r.get("/disputes", asyncHandler(async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !(DISPUTE_STATUSES as readonly string[]).includes(String(status)))
      throw badRequest("Request failed validation.", { field: "status" });
    res.json({ disputes: await store.listDisputes(status === undefined ? undefined : String(status)) });
  }));

  // POST /admin/disputes — file a dispute against an order (admin desk filing).
  r.post("/disputes", asyncHandler(async (req: AuthedRequest, res) => {
    const { order_id, user_id, subject, body } = req.body ?? {};
    if (typeof order_id !== "string" || !order_id.trim()) throw badRequest("Request failed validation.", { field: "order_id" });
    if (typeof user_id !== "string" || !user_id.trim()) throw badRequest("Request failed validation.", { field: "user_id" });
    if (!validText(subject, 200)) throw badRequest("Request failed validation.", { field: "subject" });
    if (!validText(body, 5000)) throw badRequest("Request failed validation.", { field: "body" });
    const dispute = await store.createDispute({
      order_id: order_id.trim(), user_id: user_id.trim(),
      subject: subject.trim(), body: body.trim(),
    });
    await audit(store, { actorId: req.user!.id, action: "dispute.create", entity: "dispute", entityId: dispute.id, ip: clientIp(req) });
    res.status(201).json({ dispute });
  }));

  // GET /admin/disputes/:id
  r.get("/disputes/:id", asyncHandler(async (req, res) => {
    const dispute = await store.getDispute(req.params.id);
    if (!dispute) throw notFound("Not found.");
    res.json({ dispute });
  }));

  // POST /admin/disputes/:id/resolve
  r.post("/disputes/:id/resolve", asyncHandler(async (req: AuthedRequest, res) => {
    const { resolution, approved } = req.body ?? {};
    if (!validText(resolution, 2000)) throw badRequest("Request failed validation.", { field: "resolution" });
    if (typeof approved !== "boolean") throw badRequest("Request failed validation.", { field: "approved" });
    const dispute = await store.resolveDispute(req.params.id, req.user!.id, resolution.trim(), approved);
    if (!dispute) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "dispute.resolve", entity: "dispute", entityId: dispute.id, ip: clientIp(req) });
    res.json({ dispute });
  }));

  // ---- doctor payout report (A22) ----
  // GET /admin/payouts?month=YYYY-MM — counts only; no per-case fee exists anywhere.
  r.get("/payouts", asyncHandler(async (req, res) => {
    const { month } = req.query;
    if (typeof month !== "string" || !MONTH_RE.test(month))
      throw badRequest("month must be YYYY-MM.", { field: "month" });
    res.json({ payouts: await store.doctorPayouts(month) });
  }));

  // ---- content moderation queue (A23) ----
  // GET /admin/moderation — pending community tips only.
  r.get("/moderation", asyncHandler(async (_req, res) => {
    res.json({ tips: await store.listModerationQueue() });
  }));

  // POST /admin/moderation/:id/decide
  r.post("/moderation/:id/decide", asyncHandler(async (req: AuthedRequest, res) => {
    const { approved } = req.body ?? {};
    if (typeof approved !== "boolean") throw badRequest("Request failed validation.", { field: "approved" });
    const tip = await store.decideCommunityTip(req.params.id, approved, req.user!.id);
    if (!tip) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "moderation.decide", entity: "tip", entityId: tip.id, ip: clientIp(req) });
    res.json({ tip });
  }));

  // ---- plan template manager (A24) ----
  // GET /admin/plan-templates?activeOnly=true
  r.get("/plan-templates", asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly === "true";
    res.json({ templates: await store.listPlanTemplates(activeOnly) });
  }));

  // POST /admin/plan-templates
  r.post("/plan-templates", asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, items, created_by } = req.body ?? {};
    if (!validText(title_en, 300)) throw badRequest("Request failed validation.", { field: "title_en" });
    if (!Array.isArray(items)) throw badRequest("Request failed validation.", { field: "items" });
    for (const it of items) {
      if (typeof it !== "object" || it === null || typeof (it as { kind?: unknown }).kind !== "string" || !(it as { kind: string }).kind.trim())
        throw badRequest("Each item needs a kind.", { field: "items" });
    }
    const template = await store.createPlanTemplate({
      title_en: title_en.trim(), title_ne: title_ne ?? null, items,
      created_by: created_by ?? req.user!.id,
    });
    await audit(store, { actorId: req.user!.id, action: "plan_template.create", entity: "plan_template", entityId: template.id, ip: clientIp(req) });
    res.status(201).json({ template });
  }));

  // PATCH /admin/plan-templates/:id
  r.patch("/plan-templates/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, items, is_active } = req.body ?? {};
    const patch: Partial<import("../../db/types").PlanTemplate> = {};
    if (title_en !== undefined) {
      if (!validText(title_en, 300)) throw badRequest("Request failed validation.", { field: "title_en" });
      patch.title_en = title_en.trim();
    }
    if (title_ne !== undefined) patch.title_ne = title_ne === null ? null : String(title_ne);
    if (items !== undefined) {
      if (!Array.isArray(items)) throw badRequest("Request failed validation.", { field: "items" });
      patch.items = items;
    }
    if (is_active !== undefined) {
      if (typeof is_active !== "boolean") throw badRequest("Request failed validation.", { field: "is_active" });
      patch.is_active = is_active;
    }
    const template = await store.updatePlanTemplate(req.params.id, patch);
    if (!template) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "plan_template.update", entity: "plan_template", entityId: template.id, ip: clientIp(req) });
    res.json({ template });
  }));

  // DELETE /admin/plan-templates/:id
  r.delete("/plan-templates/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const deleted = await store.deletePlanTemplate(req.params.id);
    if (!deleted) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "plan_template.delete", entity: "plan_template", entityId: req.params.id, ip: clientIp(req) });
    res.json({ deleted: true });
  }));

  // ---- scan quality stats (A25) ----
  // GET /admin/scan-quality — per-angle pass = lighting_ok && blur_ok.
  r.get("/scan-quality", asyncHandler(async (_req, res) => {
    res.json({ stats: await store.scanQualityStats() });
  }));

  // ---- order export scheduler (A27) ----
  // GET /admin/export-schedules
  r.get("/export-schedules", asyncHandler(async (_req, res) => {
    res.json({ schedules: await store.listExportSchedules() });
  }));

  // POST /admin/export-schedules
  r.post("/export-schedules", asyncHandler(async (req: AuthedRequest, res) => {
    const { kind, frequency, created_by } = req.body ?? {};
    if (kind !== undefined && !EXPORT_KINDS.includes(String(kind)))
      throw badRequest("Request failed validation.", { field: "kind" });
    if (!EXPORT_FREQUENCIES.includes(String(frequency)))
      throw badRequest("Request failed validation.", { field: "frequency" });
    const schedule = await store.createExportSchedule({
      kind: kind === undefined ? undefined : String(kind),
      frequency: String(frequency),
      created_by: created_by ?? req.user!.id,
    });
    await audit(store, { actorId: req.user!.id, action: "export_schedule.create", entity: "export_schedule", entityId: schedule.id, ip: clientIp(req) });
    res.status(201).json({ schedule });
  }));

  // PATCH /admin/export-schedules/:id
  r.patch("/export-schedules/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const { frequency, is_active, next_run_at } = req.body ?? {};
    const patch: Partial<import("../../db/types").ExportSchedule> = {};
    if (frequency !== undefined) {
      if (!EXPORT_FREQUENCIES.includes(String(frequency)))
        throw badRequest("Request failed validation.", { field: "frequency" });
      patch.frequency = String(frequency);
    }
    if (is_active !== undefined) {
      if (typeof is_active !== "boolean") throw badRequest("Request failed validation.", { field: "is_active" });
      patch.is_active = is_active;
    }
    if (next_run_at !== undefined)
      patch.next_run_at = next_run_at === null ? null : String(next_run_at);
    const schedule = await store.updateExportSchedule(req.params.id, patch);
    if (!schedule) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "export_schedule.update", entity: "export_schedule", entityId: schedule.id, ip: clientIp(req) });
    res.json({ schedule });
  }));

  // DELETE /admin/export-schedules/:id
  r.delete("/export-schedules/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const deleted = await store.deleteExportSchedule(req.params.id);
    if (!deleted) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "export_schedule.delete", entity: "export_schedule", entityId: req.params.id, ip: clientIp(req) });
    res.json({ deleted: true });
  }));

  // ---- staff onboarding checklist (A28) ----
  // GET /admin/staff/:id/checklist
  r.get("/staff/:id/checklist", asyncHandler(async (req, res) => {
    if (!(await store.getUserById(req.params.id))) throw notFound("Not found.");
    res.json({ checklist: await store.getStaffChecklist(req.params.id) });
  }));

  // PATCH /admin/staff/:id/checklist — create-or-replace the item list.
  r.patch("/staff/:id/checklist", asyncHandler(async (req: AuthedRequest, res) => {
    if (!(await store.getUserById(req.params.id))) throw notFound("Not found.");
    const { items } = req.body ?? {};
    if (!Array.isArray(items)) throw badRequest("Request failed validation.", { field: "items" });
    const clean: { key: string; done: boolean }[] = items.map((it) => {
      if (typeof it !== "object" || it === null || typeof (it as { key?: unknown }).key !== "string" || !(it as { key: string }).key.trim())
        throw badRequest("Each item needs a key.", { field: "items" });
      return { key: (it as { key: string }).key.trim(), done: (it as { done?: unknown }).done === true };
    });
    const checklist = await store.saveStaffChecklist(req.params.id, clean);
    await audit(store, { actorId: req.user!.id, action: "staff.checklist.save", entity: "user", entityId: req.params.id, ip: clientIp(req) });
    res.json({ checklist });
  }));

  // ---- audit export CSV (A29) ----
  // GET /admin/audit/export.csv — CSV of audit_log, capped at 10k rows.
  r.get("/audit/export.csv", asyncHandler(async (req, res) => {
    const { actor_id, entity, from, to } = req.query;
    const entries = await store.listAudit({
      actor_id: typeof actor_id === "string" ? actor_id : undefined,
      entity: typeof entity === "string" ? entity : undefined,
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
      limit: 10000,
    });
    const cell = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ["id,actor_id,action,entity,entity_id,at,ip"];
    for (const e of entries)
      lines.push([e.id, e.actor_id, e.action, e.entity, e.entity_id, e.at, e.ip].map(cell).join(","));
    const day = new Date().toISOString().slice(0, 10);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="jaraa-audit-${day}.csv"`);
    res.send(lines.join("\n") + "\n");
  }));

  // ==========================================================================
  // Batch 4 admin (A30–A47)
  // ==========================================================================

  const DASH_ROLES = ["doctor", "admin", "pharmacy", "coach", "customer"];

  // ---- A30: role dashboard card toggles ----
  // GET /admin/dashboard-config/:role
  r.get("/dashboard-config/:role", asyncHandler(async (req, res) => {
    if (!DASH_ROLES.includes(req.params.role)) throw badRequest("Unknown role.", { field: "role" });
    res.json({ config: await store.getDashboardConfig(req.params.role) });
  }));

  // PUT /admin/dashboard-config/:role { config }
  r.put("/dashboard-config/:role", asyncHandler(async (req: AuthedRequest, res) => {
    if (!DASH_ROLES.includes(req.params.role)) throw badRequest("Unknown role.", { field: "role" });
    const { config } = req.body ?? {};
    if (typeof config !== "object" || config === null || Array.isArray(config))
      throw badRequest("Request failed validation.", { field: "config" });
    const row = await store.setDashboardConfig(req.params.role, config as Record<string, unknown>);
    await audit(store, { actorId: req.user!.id, action: "dashboard_config.set", entity: "dashboard_config", entityId: row.role, ip: clientIp(req) });
    res.json({ config: row });
  }));

  // ---- A31: courier performance ----
  // GET /admin/couriers/performance
  r.get("/couriers/performance", asyncHandler(async (_req, res) => {
    const orders = await store.listOrdersForPharmacy();
    const damage = await store.listDamageReports();
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const damageByCourier = new Map<string, number>();
    for (const d of damage) {
      const o = orderById.get(d.order_id);
      const c = o?.courier_name?.trim();
      if (c) damageByCourier.set(c, (damageByCourier.get(c) ?? 0) + 1);
    }
    const byCourier = new Map<string, { orders: number; deliveryDays: number[] }>();
    for (const o of orders) {
      const c = o.courier_name?.trim();
      if (!c) continue;
      const g = byCourier.get(c) ?? { orders: 0, deliveryDays: [] };
      g.orders++;
      // No delivered_at column exists — updated_at on a delivered order is the closest honest proxy.
      if (o.status === "delivered") {
        g.deliveryDays.push((new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 86400_000);
      }
      byCourier.set(c, g);
    }
    const couriers = [...byCourier.entries()].map(([courier, g]) => ({
      courier,
      orders: g.orders,
      avg_delivery_days: g.deliveryDays.length > 0
        ? Math.round((g.deliveryDays.reduce((a, b) => a + b, 0) / g.deliveryDays.length) * 10) / 10
        : null,
      damage_reports: damageByCourier.get(courier) ?? 0,
    })).sort((a, b) => b.orders - a.orders);
    res.json({
      couriers,
      // Honest note: avg_delivery_days uses updated_at − created_at on delivered orders only;
      // the schema has no delivered_at column.
      note: "avg_delivery_days is measured on delivered orders only (updated_at − created_at); the schema has no delivered_at column.",
    });
  }));

  // ---- A32: refund analytics (by reason) ----
  // GET /admin/returns/analytics
  r.get("/returns/analytics", asyncHandler(async (_req, res) => {
    res.json({ by_reason: await store.getRefundAnalytics() });
  }));

  // ---- A46: refund rate by reason ----
  // GET /admin/refunds/analytics
  r.get("/refunds/analytics", asyncHandler(async (_req, res) => {
    const rows = await store.getRefundAnalytics();
    const total = rows.reduce((s, r) => s + r.count, 0);
    res.json({
      by_reason: rows.map((r) => ({ ...r, rate: total > 0 ? Math.round((r.count / total) * 1000) / 1000 : 0 })),
      total_refunds: total,
    });
  }));

  // ---- A33: verification document expiry ----
  // GET /admin/verifications/expiring?days=30
  r.get("/verifications/expiring", asyncHandler(async (req, res) => {
    const days = req.query.days === undefined ? 30 : parseInt(String(req.query.days), 10);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw badRequest("days must be an integer 0–365.", { field: "days" });
    res.json({ verifications: await store.listExpiringVerifications(days) });
  }));

  // PATCH /admin/verifications/:id/expiry { expires_at }
  r.patch("/verifications/:id/expiry", asyncHandler(async (req: AuthedRequest, res) => {
    const { expires_at } = req.body ?? {};
    if (expires_at !== null && (typeof expires_at !== "string" || Number.isNaN(Date.parse(expires_at))))
      throw badRequest("Request failed validation.", { field: "expires_at" });
    const v = await store.setVerificationExpiry(req.params.id, expires_at ?? null);
    if (!v) throw notFound("Verification not found.");
    await audit(store, { actorId: req.user!.id, action: "verification.expiry", entity: "staff_verification", entityId: v.id, ip: clientIp(req) });
    res.json({ verification: v });
  }));

  // ---- A34: support ticket SLA ----
  // (route registered above, before /tickets/:id — see A7 section)

  // ---- A35: feature-flag change history ----
  // GET /admin/flags/history
  r.get("/flags/history", asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 500);
    const entries = await store.listAudit({ entity: "flag", limit });
    res.json({ history: entries.filter((e) => e.action.startsWith("flag.")) });
  }));

  // ---- A36: bulk suspend/activate users ----
  // POST /admin/users/bulk-status { ids, disabled }
  r.post("/users/bulk-status", asyncHandler(async (req: AuthedRequest, res) => {
    const { ids, disabled } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === "string"))
      throw badRequest("Request failed validation.", { field: "ids" });
    if (typeof disabled !== "boolean") throw badRequest("Request failed validation.", { field: "disabled" });
    if (disabled === true) {
      // Never allow disabling the last active admin.
      const users = await store.listUsers();
      const activeAdmins = users.filter((u) => u.role === "admin" && u.is_active);
      const idsSet = new Set(ids);
      const wouldDisableAll = activeAdmins.length > 0 && activeAdmins.every((a) => idsSet.has(a.id));
      if (wouldDisableAll) throw conflict("Cannot disable the last active admin.");
    }
    const updated = await store.bulkSetUserStatus(ids, disabled);
    await audit(store, {
      actorId: req.user!.id, action: disabled ? "users.bulk_disable" : "users.bulk_enable",
      entity: "user", entityId: ids.join(","), ip: clientIp(req),
    });
    res.json({ updated });
  }));

  // ---- A37: email delivery log ----
  // GET /admin/email-logs?limit=50
  r.get("/email-logs", asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 500);
    res.json({ logs: await store.listEmailLogs(limit) });
  }));

  // ---- A38: deletion-request queue ----
  // GET /admin/deletion-requests
  r.get("/deletion-requests", asyncHandler(async (_req, res) => {
    res.json({ requests: await store.listDeletionRequests() });
  }));

  // ---- A39: referral code stats ----
  // GET /admin/referrals
  r.get("/referrals", asyncHandler(async (_req, res) => {
    res.json({ stats: await store.getReferralStats() });
  }));

  // ---- A40: challenge analytics ----
  // GET /admin/challenges/analytics
  r.get("/challenges/analytics", asyncHandler(async (_req, res) => {
    res.json({ challenges: await store.getChallengeAnalytics() });
  }));

  // ---- A41: coach performance ----
  // GET /admin/coaches/performance
  r.get("/coaches/performance", asyncHandler(async (_req, res) => {
    res.json({ coaches: await store.getCoachPerformance() });
  }));

  // ---- A42: pharmacy fulfilment performance ----
  // GET /admin/pharmacy/performance
  r.get("/pharmacy/performance", asyncHandler(async (_req, res) => {
    res.json({
      performance: await store.getPharmacyPerformance(),
      // Honest note: avg_ship_min uses updated_at − pack_completed_at; no shipped_at column exists.
      note: "avg_ship_min is measured pack_completed_at → updated_at; the schema has no shipped_at column.",
    });
  }));

  // ---- A43: schedule an announcement ----
  // POST /admin/announcements/:id/schedule { publish_at }
  r.post("/announcements/:id/schedule", asyncHandler(async (req: AuthedRequest, res) => {
    const { publish_at } = req.body ?? {};
    if (publish_at !== null && (typeof publish_at !== "string" || Number.isNaN(Date.parse(publish_at))))
      throw badRequest("Request failed validation.", { field: "publish_at" });
    const a = await store.updateAnnouncement(req.params.id, { publish_at: publish_at ?? null } as never);
    if (!a) throw notFound("Announcement not found.");
    await audit(store, { actorId: req.user!.id, action: "announcement.schedule", entity: "announcement", entityId: a.id, ip: clientIp(req) });
    res.json({ announcement: a });
  }));

  // ---- A44: internal admin notices ----
  // GET /admin/notices (per-admin read flags)
  r.get("/notices", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ notices: await store.listAdminNotices(req.user!.id) });
  }));

  // POST /admin/notices { title_en, title_ne?, body_en?, body_ne? }
  r.post("/notices", asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, body_en, body_ne } = req.body ?? {};
    if (!title_en || !String(title_en).trim()) throw badRequest("title_en is required.", { field: "title_en" });
    const n = await store.createAdminNotice({
      title_en: String(title_en).slice(0, 200),
      title_ne: title_ne ? String(title_ne).slice(0, 200) : null,
      body_en: body_en ? String(body_en).slice(0, 2000) : null,
      body_ne: body_ne ? String(body_ne).slice(0, 2000) : null,
    });
    await audit(store, { actorId: req.user!.id, action: "notice.create", entity: "admin_notice", entityId: n.id, ip: clientIp(req) });
    res.status(201).json({ notice: n });
  }));

  // POST /admin/notices/:id/read
  r.post("/notices/:id/read", asyncHandler(async (req: AuthedRequest, res) => {
    await store.markAdminNoticeRead(req.user!.id, req.params.id);
    res.json({ ok: true });
  }));

  // ---- A45: consent text versions ----
  // GET /admin/consents/versions?kind=
  r.get("/consents/versions", asyncHandler(async (req, res) => {
    const kind = typeof req.query.kind === "string" && req.query.kind ? req.query.kind : undefined;
    res.json({ versions: await store.listConsentVersions(kind) });
  }));

  // POST /admin/consents/versions { kind, version, text_en, text_ne?, active? }
  r.post("/consents/versions", asyncHandler(async (req: AuthedRequest, res) => {
    const { kind, version, text_en, text_ne, active } = req.body ?? {};
    const KINDS = ["signup", "scan", "photo"];
    if (!KINDS.includes(kind)) throw badRequest("Request failed validation.", { field: "kind" });
    if (!Number.isInteger(version) || version < 1) throw badRequest("Request failed validation.", { field: "version" });
    if (!text_en || !String(text_en).trim()) throw badRequest("text_en is required.", { field: "text_en" });
    const v = await store.createConsentVersion({
      kind, version,
      text_en: String(text_en),
      text_ne: text_ne ? String(text_ne) : null,
      active: active === true,
    });
    await audit(store, { actorId: req.user!.id, action: "consent.create", entity: "consent_version", entityId: v.id, ip: clientIp(req) });
    res.status(201).json({ version: v });
  }));

  // POST /admin/consents/versions/:id/activate (deactivates other versions of the kind)
  r.post("/consents/versions/:id/activate", asyncHandler(async (req: AuthedRequest, res) => {
    const v = await store.activateConsentVersion(req.params.id);
    if (!v) throw notFound("Consent version not found.");
    await audit(store, { actorId: req.user!.id, action: "consent.activate", entity: "consent_version", entityId: v.id, ip: clientIp(req) });
    res.json({ version: v });
  }));

  // ---- A47: morning ops digest ----
  // GET /admin/digest
  r.get("/digest", asyncHandler(async (_req, res) => {
    res.json({ digest: await store.getOpsDigest() });
  }));

  return r;
}
