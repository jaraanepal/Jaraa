import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, clientIp, HttpError } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { featureEnabled } from "../../middleware/flags";
import { audit } from "../../lib/audit";
import { sendEmail, planApprovedEmail } from "../../lib/brevo";
import type { Case, Plan } from "../../db/types";

const PLAN_ITEM_KINDS = ["habit", "product", "consult", "referral"];

function toContractCase(kase: Case, userId: string | null) {
  return {
    id: kase.id, scan_id: kase.scan_id, user_id: userId,
    assigned_doctor_id: kase.assigned_doctor_id,
    priority: kase.priority >= 100 ? "red_flag" : kase.priority >= 50 ? "high" : "normal",
    sla_due_at: kase.sla_due_at, status: kase.status, created_at: kase.created_at,
  };
}

function toContractPlan(plan: Plan) {
  return {
    id: plan.id, case_id: plan.case_id, doctor_id: plan.doctor_id, status: plan.status,
    version: plan.version, review_notes: plan.review_notes, rescan_due_on: plan.rescan_due_on,
    created_at: plan.created_at,
    items: plan.items.map((it) => ({
      id: it.id, plan_id: it.plan_id, kind: it.kind,
      title_ne: it.title_ne, title_en: it.title_en,
      detail: (it.detail as { text?: string | null })?.text ?? null,
      product_id: (it.detail as { product_id?: string | null })?.product_id ?? null,
      sort_order: it.sort,
    })),
  };
}

export function doctorRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole("doctor", "admin"));

  async function caseUserId(kase: Case): Promise<string | null> {
    const scan = await store.getScan(kase.scan_id);
    return scan?.user_id ?? null;
  }

  // GET /doctor/cases — review queue (every read is audited)
  r.get("/cases", asyncHandler(async (req: AuthedRequest, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "queued";
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 100);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
    const { cases, nextCursor } = await store.listCases({ status, limit, cursor });
    const out = [];
    for (const c of cases) {
      await audit(store, { actorId: req.user!.id, action: "case.view", entity: "case", entityId: c.id, ip: clientIp(req) });
      out.push(toContractCase(c, await caseUserId(c)));
    }
    res.json({ cases: out, next_cursor: nextCursor });
  }));

  // GET /doctor/cases/:id — case detail (audited)
  r.get("/cases/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "case.view", entity: "case", entityId: kase.id, ip: clientIp(req) });
    const scan = await store.getScan(kase.scan_id);
    const [events, photos, scores, flags] = await Promise.all([
      store.listTimelineEvents(kase.scan_id),
      store.listPhotos(kase.scan_id),
      store.getRootScores(kase.scan_id),
      store.listRedFlags(kase.scan_id),
    ]);
    res.json({
      ...toContractCase(kase, scan?.user_id ?? null),
      scan: scan ? { id: scan.id, status: scan.status, answers: scan.answers, version: scan.version } : null,
      timeline_events: events, photos, root_scores: scores, red_flags: flags,
    });
  }));

  // POST /doctor/cases/:id/claim
  r.post("/cases/:id/claim", asyncHandler(async (req: AuthedRequest, res) => {
    const { kase, conflict: taken } = await store.claimCase(req.params.id, req.user!.id);
    if (taken) {
      res.status(409).json({ code: "conflict", message: "Case already claimed by another dermatologist." });
      return;
    }
    if (!kase) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "case.claim", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.json(toContractCase(kase, await caseUserId(kase)));
  }));

  // POST /doctor/cases/:id/annotations
  r.post("/cases/:id/annotations", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Not found.");
    const { photo_id, shape, note } = req.body ?? {};
    if (!photo_id || !shape || typeof shape !== "object") throw badRequest("Request failed validation.", { field: "photo_id|shape" });
    const photo = await store.getPhoto(String(photo_id));
    if (!photo || photo.scan_id !== kase.scan_id) throw badRequest("Request failed validation.", { field: "photo_id" });
    const ann = await store.addAnnotation({
      photo_id: photo.id, doctor_id: req.user!.id, shape,
      note: note ? String(note).slice(0, 2000) : null,
    });
    await audit(store, { actorId: req.user!.id, action: "annotation.create", entity: "photo", entityId: photo.id, ip: clientIp(req) });
    res.status(201).json({
      id: ann.id, photo_id: ann.photo_id, doctor_id: ann.doctor_id,
      shape: ann.shape, note: ann.note, created_at: ann.created_at,
    });
  }));

  // POST /doctor/cases/:id/plan — compose draft plan
  r.post("/cases/:id/plan", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Not found.");
    const { items, review_notes, rescan_due_on, resolved_flag_ids } = req.body ?? {};
    if (!Array.isArray(items) || !items.length) throw badRequest("Request failed validation.", { field: "items" });
    for (const it of items) {
      if (!PLAN_ITEM_KINDS.includes(it.kind)) throw badRequest("Request failed validation.", { field: "items[].kind" });
      if (it.product_id) {
        const product = await store.getProduct(String(it.product_id));
        if (product?.kind === "prescription" && !(await featureEnabled(store, "prescription_commerce"))) {
          throw new HttpError(422, "feature_disabled",
            "Prescription items are disabled until the medical partnership is in place.",
            { product_id: it.product_id });
        }
      }
    }
    if (resolved_flag_ids) {
      const flags = await store.listRedFlags(kase.scan_id);
      const ids = new Set(flags.map((f) => f.id));
      for (const fid of resolved_flag_ids) {
        if (!ids.has(String(fid))) throw badRequest("Request failed validation.", { field: "resolved_flag_ids" });
      }
    }
    const plan = await store.createPlan({
      case_id: kase.id, doctor_id: req.user!.id,
      review_notes: review_notes ? String(review_notes).slice(0, 4000) : null,
      rescan_due_on: rescan_due_on ?? null,
      items: items.map((it, i: number) => ({
        kind: it.kind, title_ne: it.title_ne ?? null, title_en: it.title_en ?? null,
        detail: it.detail ?? null, product_id: it.product_id ?? null,
        sort_order: Number.isInteger(it.sort_order) ? it.sort_order : i,
      })),
      resolved_flag_ids: resolved_flag_ids?.map(String),
    });
    await audit(store, { actorId: req.user!.id, action: "plan.create", entity: "plan", entityId: plan.id, ip: clientIp(req) });
    res.status(201).json(toContractPlan(plan));
  }));

  // POST /doctor/plans/:id/approve
  r.post("/plans/:id/approve", asyncHandler(async (req: AuthedRequest, res) => {
    const { plan, reason } = await store.approvePlan(req.params.id, req.user!.id);
    if (!plan) {
      if (reason === "already_approved") {
        res.status(409).json({ code: "conflict", message: "Plan is already approved." });
        return;
      }
      if (reason === "red_flag_unresolved") {
        res.status(409).json({ code: "red_flag_unresolved", message: "Resolve all red flags before approving the plan." });
        return;
      }
      throw notFound("Not found.");
    }
    await audit(store, { actorId: req.user!.id, action: "plan.approve", entity: "plan", entityId: plan.id, ip: clientIp(req) });
    // notify the customer (email if on file; never blocks the response)
    try {
      const kase = await store.getCase(plan.case_id);
      const scan = kase ? await store.getScan(kase.scan_id) : null;
      const user = scan?.user_id ? await store.getUserById(scan.user_id) : null;
      const profile = user ? await store.getProfile(user.id) : null;
      if (user?.email) {
        const m = planApprovedEmail(profile?.name);
        sendEmail(user.email, m.subject, m.html).catch((e) => console.error("[brevo]", e));
      }
    } catch (e) { console.error("[plan-approved notify]", e); }
    res.json(toContractPlan(plan));
  }));

  void conflict;
  return r;
}
