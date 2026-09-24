import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, clientIp } from "../../http";
import { requireAuth, type AuthedRequest } from "../../middleware/auth";
import type { Plan, RootScoreRow, Profile, User, Address } from "../../db/types";
import { ROOT_LABELS, ROOTS, scoreColor, weakestRoots } from "../scan/scoring";
import { stageName } from "../scan/engine";
import { MAX_BYTES, processProfilePhoto, PhotoError } from "../../lib/photos";

const AGE_BANDS = ["16-22", "23-29", "30-39", "40-49", "50+"];
const GENDERS = ["female", "male", "other"];
const CONSENT_TYPES = ["photo", "teleconsult", "marketing", "data"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

/** Signed URL for the profile photo (null when no photo set). */
async function profilePhotoUrl(deps: Deps, profile: Profile | null): Promise<string | null> {
  if (!profile?.photo_path) return null;
  try {
    return await deps.profileStorage.getSignedUrl(profile.photo_path, 900);
  } catch {
    return null; // storage hiccup must not break the profile read
  }
}
/** Shape GET/PATCH /me/profile return: profile + fresh signed photo URL + addresses. */
function toContractProfile(user: User, profile: Profile | null, photoUrl: string | null) {
  return {
    user_id: user.id, phone: user.phone, email: user.email,
    name: profile?.name ?? null,
    age_band: profile?.age_band ?? null,
    gender: profile?.gender ?? null,
    language: user.language,
    guardian_consent: !!profile?.guardian_consented_at,
    photo_url: photoUrl,
    addresses: profile?.addresses ?? [],
    timezone: "Asia/Kathmandu",
  };
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Validate an address body; returns the cleaned fields or throws 400. */
function validateAddressBody(body: Record<string, unknown>): Omit<Address, "id"> {
  const name = str(body.name, 120);
  const phone = str(body.phone, 20);
  const city = str(body.city, 80);
  const address_line = str(body.address_line, 300);
  const label = str(body.label, 40);
  if (!name) throw badRequest("Request failed validation.", { field: "name" });
  if (!phone || !/^[+0-9][0-9\s-]{5,18}$/.test(phone)) throw badRequest("Request failed validation.", { field: "phone" });
  if (!city) throw badRequest("Request failed validation.", { field: "city" });
  if (!address_line) throw badRequest("Request failed validation.", { field: "address_line" });
  const is_default = body.is_default === undefined ? undefined : body.is_default === true;
  return { name, phone, city, address_line, label, is_default: is_default ?? false };
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

export function meRoutes(deps: Deps): Router {
  const r = Router();
  const { store, profileStorage } = deps;
  r.use(requireAuth);

  // GET /me/profile
  r.get("/profile", asyncHandler(async (req: AuthedRequest, res) => {
    const user = (await store.getUserById(req.user!.id))!;
    const profile = await store.getProfile(user.id);
    res.json(toContractProfile(user, profile, await profilePhotoUrl(deps, profile)));
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
    res.json(toContractProfile(user, profile, await profilePhotoUrl(deps, profile)));
  }));

  // POST /me/profile/photo — upload/replace the profile photo (multipart, ≤8MB)
  r.post("/profile/photo", upload.single("photo"), asyncHandler(async (req: AuthedRequest, res) => {
    const file = (req as AuthedRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer?.length) throw badRequest("Request failed validation.", { field: "photo" });
    const userId = req.user!.id;
    try {
      const out = await processProfilePhoto(profileStorage, { userId, bytes: file.buffer });
      const profile = await store.upsertProfile(userId, { photo_path: out.storagePath });
      res.status(201).json({
        photo_url: out.signedUrl,
        photo_path: out.storagePath,
        addresses: profile.addresses ?? [],
      });
    } catch (e) {
      if (e instanceof PhotoError) {
        res.status(e.status === 413 ? 413 : 400).json({ code: "validation_error", message: e.message });
        return;
      }
      throw e;
    }
  }));

  // DELETE /me/profile/photo — remove the profile photo
  r.delete("/profile/photo", asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const profile = await store.getProfile(userId);
    if (profile?.photo_path) {
      try { await profileStorage.delete(profile.photo_path); } catch { /* already gone */ }
      await store.upsertProfile(userId, { photo_path: null });
    }
    res.status(204).end();
  }));

  // GET /me/addresses — list saved order addresses
  r.get("/addresses", asyncHandler(async (req: AuthedRequest, res) => {
    const profile = await store.getProfile(req.user!.id);
    res.json({ addresses: profile?.addresses ?? [] });
  }));

  // POST /me/addresses — add an address
  r.post("/addresses", asyncHandler(async (req: AuthedRequest, res) => {
    const cleaned = validateAddressBody(req.body ?? {});
    const profile = await store.getProfile(req.user!.id);
    const addresses = [...(profile?.addresses ?? [])];
    const address: Address = { id: randomUUID(), ...cleaned };
    if (address.is_default || addresses.length === 0) {
      // First address becomes default; a new default clears the others.
      address.is_default = true;
      for (const a of addresses) a.is_default = false;
    }
    addresses.push(address);
    await store.upsertProfile(req.user!.id, { addresses });
    res.status(201).json({ address });
  }));

  // PATCH /me/addresses/:id — edit an address
  r.patch("/addresses/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body ?? {};
    const profile = await store.getProfile(req.user!.id);
    const addresses = [...(profile?.addresses ?? [])];
    const i = addresses.findIndex((a) => a.id === req.params.id);
    if (i < 0) throw notFound("Address not found.");
    const cur = addresses[i];
    const next: Address = { ...cur };
    for (const k of ["name", "phone", "city", "address_line", "label"] as const) {
      if (body[k] !== undefined) {
        const v = k === "label" ? (typeof body[k] === "string" && body[k].trim() ? String(body[k]).trim().slice(0, 40) : null) : str(body[k], k === "address_line" ? 300 : 120);
        if (k !== "label" && !v) throw badRequest("Request failed validation.", { field: k });
        if (k === "phone" && v && !/^[+0-9][0-9\s-]{5,18}$/.test(v)) throw badRequest("Request failed validation.", { field: "phone" });
        (next as unknown as Record<string, unknown>)[k] = v;
      }
    }
    if (body.is_default === true) {
      next.is_default = true;
      for (const a of addresses) if (a.id !== next.id) a.is_default = false;
    } else if (body.is_default === false) {
      next.is_default = false;
      // Never leave the list without a default: promote the first remaining one.
      if (!addresses.some((a) => a.id !== next.id && a.is_default)) {
        const other = addresses.find((a) => a.id !== next.id);
        if (other) other.is_default = true;
      }
    }
    addresses[i] = next;
    await store.upsertProfile(req.user!.id, { addresses });
    res.json({ address: next });
  }));

  // DELETE /me/addresses/:id — remove an address
  r.delete("/addresses/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const profile = await store.getProfile(req.user!.id);
    const addresses = (profile?.addresses ?? []).filter((a) => a.id !== req.params.id);
    if (addresses.length === (profile?.addresses ?? []).length) throw notFound("Address not found.");
    if (addresses.length && !addresses.some((a) => a.is_default)) {
      addresses[0].is_default = true;
    }
    await store.upsertProfile(req.user!.id, { addresses });
    res.status(204).end();
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
