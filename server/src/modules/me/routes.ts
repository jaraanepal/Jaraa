import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, clientIp } from "../../http";
import { requireAuth, type AuthedRequest } from "../../middleware/auth";
import type { Plan, RootScoreRow } from "../../db/types";
import { ROOT_LABELS, ROOTS, scoreColor, weakestRoots } from "../scan/scoring";
import { stageName } from "../scan/engine";

const AGE_BANDS = ["16-22", "23-29", "30-39", "40-49", "50+"];
const GENDERS = ["female", "male", "other"];
const CONSENT_TYPES = ["photo", "teleconsult", "marketing", "data"];

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

export function meRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireAuth);

  // GET /me/profile
  r.get("/profile", asyncHandler(async (req: AuthedRequest, res) => {
    const user = (await store.getUserById(req.user!.id))!;
    const profile = await store.getProfile(user.id);
    res.json({
      user_id: user.id, phone: user.phone, email: user.email,
      name: profile?.name ?? null,
      age_band: profile?.age_band ?? null,
      gender: profile?.gender ?? null,
      language: user.language,
      guardian_consent: !!profile?.guardian_consented_at,
      timezone: "Asia/Kathmandu",
    });
  }));

  // PATCH /me/profile
  r.patch("/profile", asyncHandler(async (req: AuthedRequest, res) => {
    const { name, age_band, gender, language } = req.body ?? {};
    if (age_band !== undefined && !AGE_BANDS.includes(age_band)) throw badRequest("Request failed validation.", { field: "age_band" });
    if (gender !== undefined && !GENDERS.includes(gender)) throw badRequest("Request failed validation.", { field: "gender" });
    if (language !== undefined && !["ne", "en"].includes(language)) throw badRequest("Request failed validation.", { field: "language" });
    const user = (await store.getUserById(req.user!.id))!;
    if (language) { (user as { language: string }).language = language; }
    const profile = await store.upsertProfile(user.id, {
      ...(name !== undefined ? { name: String(name).slice(0, 120) } : {}),
      ...(age_band !== undefined ? { age_band } : {}),
      ...(gender !== undefined ? { gender } : {}),
    });
    res.json({
      user_id: user.id, phone: user.phone, email: user.email,
      name: profile.name, age_band: profile.age_band, gender: profile.gender,
      language: user.language, guardian_consent: !!profile.guardian_consented_at,
      timezone: "Asia/Kathmandu",
    });
  }));

  // POST /me/consents (append-only; replay guard -> 409)
  r.post("/consents", asyncHandler(async (req: AuthedRequest, res) => {
    const { type, version, granted } = req.body ?? {};
    if (!CONSENT_TYPES.includes(type)) throw badRequest("Request failed validation.", { field: "type" });
    if (typeof granted !== "boolean") throw badRequest("Request failed validation.", { field: "granted" });
    const existing = (await store.listConsents(req.user!.id))
      .find((c) => c.type === type && c.version === String(version ?? "v1") && c.granted === granted);
    if (existing) {
      res.status(409).json({ code: "conflict", message: "This consent was already recorded." });
      return;
    }
    const row = await store.addConsent({
      user_id: req.user!.id, type, version: String(version ?? "v1"),
      granted, ip: clientIp(req),
    });
    res.status(201).json({
      id: row.id, user_id: row.user_id, type: row.type, version: row.version,
      granted: row.granted, granted_at: row.granted_at, ip: row.ip,
    });
  }));

  // GET /me/plan — latest approved plan or 404 not_ready
  r.get("/plan", asyncHandler(async (req: AuthedRequest, res) => {
    const plan = await store.getLatestApprovedPlanForUser(req.user!.id);
    if (!plan) {
      res.status(404).json({ code: "not_ready", message: "Your scan is still with the dermatologist." });
      return;
    }
    res.json(toContractPlan(plan));
  }));

  // GET /me/root-map/history — versioned root maps, newest first
  r.get("/root-map/history", asyncHandler(async (req: AuthedRequest, res) => {
    const scans = await store.listUserScans(req.user!.id);
    const versions: unknown[] = [];
    for (const scan of scans) {
      const scores = await store.getRootScores(scan.id);
      if (!scores.length) continue;
      const kase = await store.getCaseByScan(scan.id);
      const byRoot = new Map(scores.map((s: RootScoreRow) => [s.root, s]));
      const roots: Record<string, unknown> = {};
      for (const k of ROOTS) {
        const s = byRoot.get(k);
        roots[k] = { score: s?.score ?? 0, label_en: ROOT_LABELS[k].en, label_ne: ROOT_LABELS[k].ne, signals: s?.signals ?? {} };
      }
      const ordered = ROOTS.map((k) => ({ k, score: (byRoot.get(k)?.score ?? 0) }))
        .sort((a, b) => a.score - b.score).map((x) => x.k);
      const openFlags = (await store.listRedFlags(scan.id, { unresolvedOnly: true })).length;
      versions.push({
        scan_id: scan.id, version: scan.version,
        status_card: kase?.status === "reviewed" ? "reviewed" : openFlags ? "red_flagged" : "pending_review",
        generated_at: scan.updated_at,
        weakest_roots: ordered.slice(0, 2),
        roots,
      });
    }
    res.json({ versions });
  }));

  // POST /me/checkins
  r.post("/checkins", asyncHandler(async (req: AuthedRequest, res) => {
    const { plan_id, shedding_estimate, note, photo_ids } = req.body ?? {};
    if (shedding_estimate !== undefined && shedding_estimate !== null &&
        (!Number.isInteger(shedding_estimate) || shedding_estimate < 0 || shedding_estimate > 500)) {
      throw badRequest("Request failed validation.", { field: "shedding_estimate" });
    }
    const row = await store.addCheckin({
      user_id: req.user!.id,
      plan_id: plan_id ?? null,
      shedding_estimate: shedding_estimate ?? null,
      note: note ? String(note).slice(0, 2000) : null,
      photo_ids: Array.isArray(photo_ids) ? photo_ids.slice(0, 5).map(String) : [],
    });
    res.status(201).json({
      id: row.id, user_id: row.user_id, plan_id: row.plan_id,
      shedding_estimate: row.shedding_estimate, note: row.note,
      photo_ids: row.photo_ids, created_at: row.created_at,
    });
  }));

  // GET /me/checkins
  r.get("/checkins", asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await store.listCheckins(req.user!.id);
    res.json({
      checkins: rows.map((c) => ({
        id: c.id, user_id: c.user_id, plan_id: c.plan_id,
        shedding_estimate: c.shedding_estimate, note: c.note,
        photo_ids: c.photo_ids, created_at: c.created_at,
      })),
    });
  }));

  // GET /me/progress
  r.get("/progress", asyncHandler(async (req: AuthedRequest, res) => {
    const scans = await store.listUserScans(req.user!.id);
    const root_score_history: unknown[] = [];
    for (const scan of scans) {
      const scores = await store.getRootScores(scan.id);
      if (!scores.length) continue;
      const roots: Record<string, number> = {};
      for (const s of scores) roots[s.root] = s.score;
      root_score_history.push({ version: scan.version, generated_at: scan.updated_at, roots });
    }
    root_score_history.sort((a: unknown, b: unknown) =>
      (b as { version: number }).version - (a as { version: number }).version);
    const checkins = await store.listCheckins(req.user!.id);
    const plan = await store.getLatestApprovedPlanForUser(req.user!.id);
    res.json({
      root_score_history,
      checkins: checkins.map((c) => ({
        id: c.id, user_id: c.user_id, plan_id: c.plan_id,
        shedding_estimate: c.shedding_estimate, note: c.note,
        photo_ids: c.photo_ids, created_at: c.created_at,
      })),
      next_rescan_due_on: plan?.rescan_due_on ?? null,
    });
  }));

  // DELETE /me/data — 7-day SLA deletion request
  r.delete("/data", asyncHandler(async (req: AuthedRequest, res) => {
    const scheduled_for = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const row = await store.createDeletionRequest({
      user_id: req.user!.id,
      scheduled_for,
      note: "Photos, scans, profile and consents will be deleted within 7 days. Anonymized analytics and legally required financial records are kept.",
    });
    res.status(202).json({ request_id: row.id, scheduled_for: row.scheduled_for, note: row.note });
  }));

  void stageName; void scoreColor; void weakestRoots; void conflict; void notFound;
  return r;
}
