// P-16: nutrition — food lookup (honest estimates), admin/coach diet plans,
// customer habit logs.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import type { DietPlan } from "../../db/types";

const ALL_ROLES = ["customer", "doctor", "admin", "pharmacy", "coach"] as const;

function optStr(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

export function nutritionRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole(...ALL_ROLES));

  const adminOnly = requireRole("admin");
  const coachStaff = requireRole("admin", "coach");
  const customerOnly = requireRole("customer");

  // GET /nutrition/foods?q=&limit= — search foods; rows carry `source` and are
  // estimates: clients must label them as estimates, never as lab values.
  r.get("/foods", asyncHandler(async (req: AuthedRequest, res) => {
    const raw = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(raw) || raw < 1) throw badRequest("Request failed validation.", { field: "limit" });
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    res.json({ foods: await store.searchFoods(q, Math.min(raw, 50)), estimate: true });
  }));

  // POST /nutrition/plans (admin)
  r.post("/plans", adminOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, title_ro, description_en, description_ne, protein_target_g, items } = req.body ?? {};
    const title = typeof title_en === "string" ? title_en.trim() : "";
    if (!title) throw badRequest("Request failed validation.", { field: "title_en" });
    const protein = protein_target_g === undefined || protein_target_g === null
      ? null : Number(protein_target_g);
    if (protein !== null && (!Number.isFinite(protein) || protein < 0 || protein > 1000)) {
      throw badRequest("Request failed validation.", { field: "protein_target_g" });
    }
    const plan = await store.createDietPlan({
      title_en: title.slice(0, 200),
      title_ne: optStr(title_ne, 200),
      title_ro: optStr(title_ro, 200),
      description_en: optStr(description_en, 2000),
      description_ne: optStr(description_ne, 2000),
      protein_target_g: protein,
      items: Array.isArray(items) ? items : undefined,
      created_by: req.user!.id,
    });
    await audit(store, {
      actorId: req.user!.id, action: "diet_plan.create", entity: "diet_plan",
      entityId: plan.id, ip: clientIp(req),
    });
    res.status(201).json({ plan });
  }));

  // PATCH /nutrition/plans/:id (admin) — partial update
  r.patch("/plans/:id", adminOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, title_ro, description_en, description_ne, protein_target_g, items, is_active } = req.body ?? {};
    const patch: Partial<Pick<DietPlan, "title_en" | "title_ne" | "title_ro" | "description_en" | "description_ne" | "protein_target_g" | "items" | "is_active">> = {};
    if (title_en !== undefined) {
      const t = String(title_en).trim();
      if (!t) throw badRequest("Request failed validation.", { field: "title_en" });
      patch.title_en = t.slice(0, 200);
    }
    if (title_ne !== undefined) patch.title_ne = optStr(title_ne, 200);
    if (title_ro !== undefined) patch.title_ro = optStr(title_ro, 200);
    if (description_en !== undefined) patch.description_en = optStr(description_en, 2000);
    if (description_ne !== undefined) patch.description_ne = optStr(description_ne, 2000);
    if (protein_target_g !== undefined) {
      const p = protein_target_g === null ? null : Number(protein_target_g);
      if (p !== null && (!Number.isFinite(p) || p < 0 || p > 1000)) {
        throw badRequest("Request failed validation.", { field: "protein_target_g" });
      }
      patch.protein_target_g = p;
    }
    if (items !== undefined) {
      if (!Array.isArray(items)) throw badRequest("Request failed validation.", { field: "items" });
      patch.items = items;
    }
    if (is_active !== undefined) {
      if (typeof is_active !== "boolean") throw badRequest("Request failed validation.", { field: "is_active" });
      patch.is_active = is_active;
    }
    const plan = await store.updateDietPlan(req.params.id, patch);
    if (!plan) throw notFound("Not found.");
    await audit(store, {
      actorId: req.user!.id, action: "diet_plan.update", entity: "diet_plan",
      entityId: plan.id, ip: clientIp(req),
    });
    res.json({ plan });
  }));

  // GET /nutrition/plans (admin,coach)
  r.get("/plans", coachStaff, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ plans: await store.listDietPlans(false) });
  }));

  // POST /nutrition/plans/:id/assign (admin,coach)
  r.post("/plans/:id/assign", coachStaff, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id, starts_on } = req.body ?? {};
    if (!user_id || typeof user_id !== "string") throw badRequest("Request failed validation.", { field: "user_id" });
    const target = await store.getUserById(user_id);
    if (!target) throw notFound("User not found.");
    const plan = (await store.listDietPlans(false)).find((p) => p.id === req.params.id);
    if (!plan) throw notFound("Diet plan not found.");
    const startsOn = starts_on !== undefined && starts_on !== null ? String(starts_on).slice(0, 10) : undefined;
    if (startsOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
      throw badRequest("Request failed validation.", { field: "starts_on" });
    }
    const assignment = await store.assignDietPlan(req.params.id, target.id, req.user!.id, startsOn);
    await audit(store, {
      actorId: req.user!.id, action: "diet_plan.assign", entity: "diet_assignment",
      entityId: assignment.id, ip: clientIp(req), detail: `plan ${req.params.id} -> ${target.id}`,
    });
    res.status(201).json({ assignment });
  }));

  // GET /nutrition/plan (customer) — own assignment
  r.get("/plan", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const assignment = await store.getDietAssignment(req.user!.id);
    if (!assignment) {
      res.status(404).json({ code: "no_plan", message: "No diet plan assigned yet." });
      return;
    }
    res.json({ assignment });
  }));

  // POST /nutrition/habits (customer) — idempotent upsert
  r.post("/habits", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { log_date, habit_key, done, note } = req.body ?? {};
    if (typeof log_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(log_date)) {
      throw badRequest("Request failed validation.", { field: "log_date" });
    }
    const key = typeof habit_key === "string" ? habit_key.trim() : "";
    if (!key || key.length > 100) throw badRequest("Request failed validation.", { field: "habit_key" });
    const log = await store.logHabit(
      req.user!.id, log_date, key, done === undefined ? true : done === true,
      typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
    );
    res.status(201).json({ log });
  }));

  // GET /nutrition/habits?from=&to= (customer)
  r.get("/habits", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : "";
    const to = typeof req.query.to === "string" ? req.query.to : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw badRequest("Request failed validation.", { field: "from" });
    }
    res.json({ logs: await store.listHabitLogs(req.user!.id, from, to) });
  }));

  return r;
}
