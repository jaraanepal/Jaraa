import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, conflict, notFound, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { invalidateFlagCache } from "../../middleware/flags";
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
  const toContractKit = (k: import("../../db/types").Kit) => ({
    id: k.id, name_en: k.name_en, name_ne: k.name_ne, product_ids: k.product_ids,
    total_npr: k.total_npr, is_active: k.is_active, created_at: k.created_at,
  });

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
    const { name_en, name_ne, product_ids, total_npr } = req.body ?? {};
    if (!name_en || typeof name_en !== "string") throw badRequest("Request failed validation.", { field: "name_en" });
    if (!Array.isArray(product_ids) || product_ids.length === 0) throw badRequest("Request failed validation.", { field: "product_ids" });
    for (const pid of product_ids) {
      if (!(await store.getProduct(String(pid)))) throw badRequest("Unknown product.", { field: "product_ids" });
    }
    const total = Number(total_npr);
    if (!Number.isInteger(total) || total < 0) throw badRequest("Request failed validation.", { field: "total_npr" });
    const k = await store.createKit({ name_en, name_ne: name_ne ?? null, product_ids: product_ids.map(String), total_npr: total });
    await audit(store, { actorId: req.user!.id, action: "kit.create", entity: "kit", entityId: k.id, ip: clientIp(req) });
    res.status(201).json(toContractKit(k));
  }));

  // PATCH /admin/kits/:id — activate/deactivate, reprice
  r.patch("/kits/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const { is_active, total_npr } = req.body ?? {};
    const patch: Partial<import("../../db/types").Kit> = {};
    if (is_active !== undefined) patch.is_active = Boolean(is_active);
    if (total_npr !== undefined) {
      const total = Number(total_npr);
      if (!Number.isInteger(total) || total < 0) throw badRequest("Request failed validation.", { field: "total_npr" });
      patch.total_npr = total;
    }
    const k = await store.updateKit(req.params.id, patch);
    if (!k) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "kit.update", entity: "kit", entityId: k.id, ip: clientIp(req) });
    res.json(toContractKit(k));
  }));

  return r;
}
