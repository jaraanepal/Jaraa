import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, clientIp } from "../../http";
import { requireAuth, requireRole, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
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
  // U30/U46: additive preference columns from migration 010. Cast because the
  // shared Profile interface is frozen for this batch.
  const px = profile as (Profile & { content_language?: string | null; default_payment?: string | null }) | null;
  return {
    user_id: user.id, phone: user.phone, email: user.email,
    name: profile?.name ?? null,
    age_band: profile?.age_band ?? null,
    gender: profile?.gender ?? null,
    language: user.language,
    guardian_consent: !!profile?.guardian_consented_at,
    photo_url: photoUrl,
    addresses: profile?.addresses ?? [],
    delivery_instructions: profile?.delivery_instructions ?? null,
    content_language: px?.content_language ?? null,
    default_payment: px?.default_payment ?? null,
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
    const { name, age_band, gender, language, delivery_instructions, content_language, default_payment } = req.body ?? {};
    if (age_band !== undefined && !AGE_BANDS.includes(age_band)) throw badRequest("Request failed validation.", { field: "age_band" });
    if (gender !== undefined && !GENDERS.includes(gender)) throw badRequest("Request failed validation.", { field: "gender" });
    if (language !== undefined && !["ne", "en"].includes(language)) throw badRequest("Request failed validation.", { field: "language" });
    // U30: content-language preference (separate from UI language).
    if (content_language !== undefined && content_language !== null && !["ne", "en"].includes(content_language))
      throw badRequest("Request failed validation.", { field: "content_language" });
    // U46: default payment method preference.
    if (default_payment !== undefined && default_payment !== null && !["esewa", "khalti", "cod"].includes(default_payment))
      throw badRequest("Request failed validation.", { field: "default_payment" });
    const user = (await store.getUserById(req.user!.id))!;
    if (language) { (user as { language: string }).language = language; }
    const profile = await store.upsertProfile(user.id, {
      ...(name !== undefined ? { name: String(name).slice(0, 120) } : {}),
      ...(age_band !== undefined ? { age_band } : {}),
      ...(gender !== undefined ? { gender } : {}),
      ...(delivery_instructions !== undefined ? { delivery_instructions: delivery_instructions ? String(delivery_instructions).slice(0, 500) : null } : {}),
      // Additive columns (migration 010); cast because the Profile interface
      // is frozen for this batch — the stores pass them straight through.
      ...(content_language !== undefined ? { content_language: content_language === null ? null : String(content_language) } : {}),
      ...(default_payment !== undefined ? { default_payment: default_payment === null ? null : String(default_payment) } : {}),
    } as Partial<Profile>);
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
      // U16: signed photo URLs so the customer gets a true before/after photo slider.
      const photos = await store.listPhotos(scan.id);
      const photoUrls: string[] = [];
      for (const p of photos.slice(0, 4)) {
        try {
          photoUrls.push(await deps.storage.getSignedUrl(p.thumb_path ?? p.storage_path, 900));
        } catch { /* storage hiccup must not break history */ }
      }
      versions.push({
        scan_id: scan.id, version: scan.version,
        status_card: kase?.status === "reviewed" ? "reviewed" : openFlags ? "red_flagged" : "pending_review",
        generated_at: scan.updated_at, photos: photoUrls,
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

  // ---- support tickets (A7) ----

  // GET /me/tickets — my tickets
  r.get("/tickets", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ tickets: await store.listTickets({ user_id: req.user!.id }) });
  }));

  // POST /me/tickets — open a ticket
  r.post("/tickets", asyncHandler(async (req: AuthedRequest, res) => {
    const { subject, body } = req.body ?? {};
    const subj = typeof subject === "string" ? subject.trim() : "";
    const b = typeof body === "string" ? body.trim() : "";
    if (!subj) throw badRequest("Request failed validation.", { field: "subject" });
    if (subj.length > 120) throw badRequest("Request failed validation.", { field: "subject" });
    if (!b) throw badRequest("Request failed validation.", { field: "body" });
    if (b.length > 4000) throw badRequest("Request failed validation.", { field: "body" });
    const ticket = await store.createTicket({ user_id: req.user!.id, subject: subj, body: b });
    await audit(store, { actorId: req.user!.id, action: "ticket.create", entity: "support_ticket", entityId: ticket.id, ip: clientIp(req) });
    res.status(201).json({ ticket });
  }));

  /** Load a ticket owned by the caller; 404 for missing or someone else's. */
  async function ownTicket(req: AuthedRequest) {
    const ticket = await store.getTicket(req.params.id);
    if (!ticket || ticket.user_id !== req.user!.id) throw notFound("Not found.");
    return ticket;
  }

  // GET /me/tickets/:id — ticket + replies
  r.get("/tickets/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ticket = await ownTicket(req);
    res.json({ ticket, replies: await store.listTicketReplies(ticket.id) });
  }));

  // POST /me/tickets/:id/reply — customer reply
  r.post("/tickets/:id/reply", asyncHandler(async (req: AuthedRequest, res) => {
    const ticket = await ownTicket(req);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) throw badRequest("Request failed validation.", { field: "body" });
    if (body.length > 4000) throw badRequest("Request failed validation.", { field: "body" });
    const reply = await store.addTicketReply(ticket.id, req.user!.id, "customer", body);
    res.status(201).json({ reply });
  }));

  // ---- challenges (C4) ----

  // GET /me/challenges — my challenge assignments
  r.get("/challenges", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ assignments: await store.listChallengeAssignments(req.user!.id) });
  }));

  // POST /me/challenges/:id/complete — complete my own assignment
  r.post("/challenges/:id/complete", asyncHandler(async (req: AuthedRequest, res) => {
    const assignment = await store.completeChallengeAssignment(req.params.id, req.user!.id);
    if (!assignment) throw notFound("Not found.");
    res.json({ assignment });
  }));

  // ---- wishlist (U6) ----

  // GET /me/wishlist
  r.get("/wishlist", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ items: await store.listWishlist(req.user!.id) });
  }));

  // POST /me/wishlist — add a kit
  r.post("/wishlist", asyncHandler(async (req: AuthedRequest, res) => {
    const { kit_id } = req.body ?? {};
    if (!kit_id) throw badRequest("Request failed validation.", { field: "kit_id" });
    const kit = await store.getKit(String(kit_id));
    if (!kit) throw notFound("Not found.");
    const item = await store.addToWishlist(req.user!.id, kit.id);
    res.status(201).json({ item });
  }));

  // DELETE /me/wishlist/:kitId
  r.delete("/wishlist/:kitId", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.removeFromWishlist(req.user!.id, req.params.kitId);
    if (!ok) throw notFound("Not found.");
    res.status(204).end();
  }));

  /* ---------------- Batch 2 (008): U12–U20 ---------------- */

  // GET /me/plans/history — U12: past approved plan versions
  r.get("/plans/history", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ plans: await store.planHistory(req.user!.id) });
  }));

  // GET /me/symptoms — U13: symptom diary
  r.get("/symptoms", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ entries: await store.listSymptomEntries(req.user!.id, 90) });
  }));

  // POST /me/symptoms — U13: upsert today's entry
  r.post("/symptoms", asyncHandler(async (req: AuthedRequest, res) => {
    const { entry_date, note } = req.body ?? {};
    const date = entry_date ? String(entry_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("entry_date must be YYYY-MM-DD.", { field: "entry_date" });
    if (!note || !String(note).trim()) throw badRequest("note is required.", { field: "note" });
    const e = await store.upsertSymptomEntry(req.user!.id, date, String(note).slice(0, 2000));
    res.status(201).json(e);
  }));

  // DELETE /me/symptoms/:id — U13: delete own entry
  r.delete("/symptoms/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteSymptomEntry(req.params.id, req.user!.id);
    if (!ok) throw notFound("Entry not found.");
    res.json({ ok: true });
  }));

  // GET /me/water?date= — U14
  r.get("/water", asyncHandler(async (req: AuthedRequest, res) => {
    const date = typeof req.query.date === "string" && req.query.date ? req.query.date : new Date().toISOString().slice(0, 10);
    res.json({ log: await store.getWaterLog(req.user!.id, date) });
  }));

  // POST /me/water — U14: set glasses for a day
  r.post("/water", asyncHandler(async (req: AuthedRequest, res) => {
    const { log_date, glasses } = req.body ?? {};
    const date = log_date ? String(log_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("log_date must be YYYY-MM-DD.", { field: "log_date" });
    const g = parseInt(String(glasses), 10);
    if (!Number.isInteger(g) || g < 0 || g > 40) throw badRequest("glasses must be 0–40.", { field: "glasses" });
    res.status(201).json(await store.setWaterLog(req.user!.id, date, g));
  }));

  // GET /me/sleep — U15
  r.get("/sleep", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ logs: await store.listSleepLogs(req.user!.id, 30) });
  }));

  // POST /me/sleep — U15
  r.post("/sleep", asyncHandler(async (req: AuthedRequest, res) => {
    const { log_date, bedtime, wake_time, quality } = req.body ?? {};
    const date = log_date ? String(log_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("log_date must be YYYY-MM-DD.", { field: "log_date" });
    const q = quality === null || quality === undefined ? null : parseInt(String(quality), 10);
    if (q !== null && (!Number.isInteger(q) || q < 1 || q > 5)) throw badRequest("quality must be 1–5.", { field: "quality" });
    const s = await store.upsertSleepLog(req.user!.id, date, {
      bedtime: bedtime ? String(bedtime).slice(0, 5) : null,
      wake_time: wake_time ? String(wake_time).slice(0, 5) : null,
      quality: q,
    });
    res.status(201).json(s);
  }));

  // DELETE /me/sleep/:id — U15: delete own log
  r.delete("/sleep/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteSleepLog(req.params.id, req.user!.id);
    if (!ok) throw notFound("Log not found.");
    res.json({ ok: true });
  }));

  // GET /me/notification-prefs — U17
  r.get("/notification-prefs", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.getNotificationPrefs(req.user!.id));
  }));

  // PUT /me/notification-prefs — U17
  r.put("/notification-prefs", asyncHandler(async (req: AuthedRequest, res) => {
    const p: Record<string, unknown> = {};
    for (const k of ["plan_updates", "photo_requests", "digest", "marketing"]) {
      if (req.body?.[k] !== undefined) p[k] = req.body[k] === true;
    }
    if (req.body?.quiet_from !== undefined) p.quiet_from = req.body.quiet_from ? String(req.body.quiet_from).slice(0, 5) : null;
    if (req.body?.quiet_to !== undefined) p.quiet_to = req.body.quiet_to ? String(req.body.quiet_to).slice(0, 5) : null;
    res.json(await store.setNotificationPrefs(req.user!.id, p));
  }));

  // GET /me/emergency-contacts — U20
  r.get("/emergency-contacts", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ contacts: await store.listEmergencyContacts(req.user!.id) });
  }));

  // POST /me/emergency-contacts — U20
  r.post("/emergency-contacts", asyncHandler(async (req: AuthedRequest, res) => {
    const { name, phone, relation } = req.body ?? {};
    if (!name || !String(name).trim()) throw badRequest("name is required.", { field: "name" });
    if (!phone || !String(phone).trim()) throw badRequest("phone is required.", { field: "phone" });
    const c = await store.createEmergencyContact(req.user!.id, {
      name: String(name).slice(0, 120), phone: String(phone).slice(0, 40),
      relation: relation ? String(relation).slice(0, 60) : null,
    });
    res.status(201).json(c);
  }));

  // DELETE /me/emergency-contacts/:id — U20
  r.delete("/emergency-contacts/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteEmergencyContact(req.params.id, req.user!.id);
    if (!ok) throw notFound("Contact not found.");
    res.json({ ok: true });
  }));

  // GET /me/badges — C11: badges the coach awarded to me
  r.get("/badges", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ badges: await store.listBadges(req.user!.id) });
  }));

  // GET /me/articles/assigned — C18: articles my coach shared with me
  r.get("/articles/assigned", asyncHandler(async (req: AuthedRequest, res) => {
    const assignments = await store.listArticleAssignments(req.user!.id);
    const articles = [];
    for (const a of assignments) {
      const art = await store.getArticle(a.article_id);
      if (art && art.is_published) {
        articles.push({ ...art, assigned_at: a.created_at });
      }
    }
    res.json({ articles });
  }));

  /* ---------------- Batch 3 (009): U21–U29 customer ---------------- */

  /** Load a case owned by the caller (case → scan → user); 404 otherwise. */
  async function ownCase(req: AuthedRequest) {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Not found.");
    const scan = await store.getScan(kase.scan_id);
    if (!scan || scan.user_id !== req.user!.id) throw notFound("Not found.");
    return kase;
  }

  // GET /me/cases — my cases (case discovery for the U21 Q&A UI).
  r.get("/cases", asyncHandler(async (req: AuthedRequest, res) => {
    const scans = await store.listUserScans(req.user!.id);
    const cases = [];
    for (const scan of scans) {
      const kase = await store.getCaseByScan(scan.id);
      if (kase) cases.push(kase);
    }
    res.json({ cases });
  }));

  // GET /me/cases/:id/messages — U21: Q&A thread, oldest first
  r.get("/cases/:id/messages", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await ownCase(req);
    res.json({ messages: await store.listCaseMessages(kase.id) });
  }));

  // POST /me/cases/:id/messages — U21: customer asks; role is hardcoded,
  // never trusted from the client.
  r.post("/cases/:id/messages", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await ownCase(req);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) throw badRequest("Request failed validation.", { field: "body" });
    if (body.length > 2000) throw badRequest("Request failed validation.", { field: "body" });
    const msg = await store.addCaseMessage(kase.id, req.user!.id, "customer", body);
    res.status(201).json(msg);
  }));

  // POST /me/review-requests — U22: appointment-free follow-up review request
  r.post("/review-requests", asyncHandler(async (req: AuthedRequest, res) => {
    const { case_id, reason } = req.body ?? {};
    let caseId: string | null = null;
    if (case_id) {
      const kase = await store.getCase(String(case_id));
      if (!kase) throw notFound("Not found.");
      const scan = await store.getScan(kase.scan_id);
      if (!scan || scan.user_id !== req.user!.id) throw notFound("Not found.");
      caseId = kase.id;
    }
    const row = await store.createReviewRequest({
      user_id: req.user!.id,
      case_id: caseId,
      reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 2000) : null,
    });
    res.status(201).json(row);
  }));

  // GET /me/review-requests — U22: my requests, newest first
  r.get("/review-requests", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ requests: await store.listReviewRequests(req.user!.id) });
  }));

  // GET /me/community-tips — U23: approved tips only
  r.get("/community-tips", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ tips: await store.listCommunityTips(true) });
  }));

  // POST /me/community-tips — U23: always enters as pending moderation
  r.post("/community-tips", asyncHandler(async (req: AuthedRequest, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!title) throw badRequest("Request failed validation.", { field: "title" });
    if (title.length > 120) throw badRequest("Request failed validation.", { field: "title" });
    if (!body) throw badRequest("Request failed validation.", { field: "body" });
    if (body.length > 2000) throw badRequest("Request failed validation.", { field: "body" });
    const tip = await store.createCommunityTip(req.user!.id, title, body);
    res.status(201).json(tip);
  }));

  // GET /me/adherence/history — U24
  r.get("/adherence/history", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ history: await store.adherenceHistory(req.user!.id) });
  }));

  // GET /me/loyalty — U25: earn derived at read time, ledger history
  r.get("/loyalty", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.getLoyalty(req.user!.id));
  }));

  // POST /me/orders/:id/issue — U27: report an order issue (creates a dispute)
  r.post("/orders/:id/issue", asyncHandler(async (req: AuthedRequest, res) => {
    const order = await store.getOrder(req.params.id);
    if (!order || order.user_id !== req.user!.id) throw notFound("Not found.");
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!subject) throw badRequest("Request failed validation.", { field: "subject" });
    if (subject.length > 120) throw badRequest("Request failed validation.", { field: "subject" });
    if (!body) throw badRequest("Request failed validation.", { field: "body" });
    if (body.length > 4000) throw badRequest("Request failed validation.", { field: "body" });
    const dispute = await store.createDispute({
      order_id: order.id, user_id: req.user!.id, subject, body,
    });
    res.status(201).json(dispute);
  }));

  // GET /me/routines — U29: published routine library
  r.get("/routines", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ routines: await store.listRoutines() });
  }));

  // GET /me/leaderboard-opt-in — C19 support (default false)
  r.get("/leaderboard-opt-in", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ opt_in: await store.getLeaderboardOptIn(req.user!.id) });
  }));

  // PUT /me/leaderboard-opt-in — C19 support
  r.put("/leaderboard-opt-in", asyncHandler(async (req: AuthedRequest, res) => {
    const opt_in = req.body?.opt_in;
    if (typeof opt_in !== "boolean") throw badRequest("Request failed validation.", { field: "opt_in" });
    await store.setLeaderboardOptIn(req.user!.id, opt_in);
    res.json({ opt_in });
  }));

    /* ---------------- Batch 4 (010): C29/C39/C45 customer side ---------------- */

  // POST /me/coach-feedback — rate your own coach (C29 customer side).
  r.post("/coach-feedback", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const { coach_id, rating, note } = req.body ?? {};
    if (typeof coach_id !== "string" || !coach_id) throw badRequest("Request failed validation.", { field: "coach_id" });
    const coach = await store.getUserById(coach_id);
    if (!coach || (coach.role !== "coach" && coach.role !== "admin")) {
      throw badRequest("Request failed validation.", { field: "coach_id" });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw badRequest("Request failed validation.", { field: "rating" });
    }
    const clean = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
    const row = await store.createCoachFeedback({ coach_id: coach.id, customer_id: req.user!.id, rating, note: clean });
    res.status(201).json({ feedback: row });
  }));

  // PATCH /me/article-assignments/:id/read — read receipt (C39).
  // Ownership: the assignment must belong to the logged-in customer.
  r.patch("/article-assignments/:id/read", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const mine = await store.listArticleAssignments(req.user!.id);
    const row = mine.find((a) => a.id === req.params.id);
    if (!row) throw notFound("Not found.");
    const updated = await (store as unknown as { markArticleAssignmentRead(id: string): Promise<unknown> })
      .markArticleAssignmentRead(req.params.id);
    res.json({ assignment: updated ?? row });
  }));

  // POST /me/challenges/:id/survey — end-of-challenge survey (C45 customer
  // side). :id is the assignment id; it must belong to the customer, and only
  // one survey per assignment is allowed (409 on duplicate).
  r.post("/challenges/:id/survey", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const { q1_rating, q2_text } = req.body ?? {};
    if (!Number.isInteger(q1_rating) || q1_rating < 1 || q1_rating > 5) {
      throw badRequest("Request failed validation.", { field: "q1_rating" });
    }
    const text = typeof q2_text === "string" && q2_text.trim() ? q2_text.trim().slice(0, 1000) : null;
    const mine = await store.listChallengeAssignments(req.user!.id);
    const assignment = mine.find((a) => a.id === req.params.id);
    if (!assignment) throw notFound("Not found.");
    const existing = (await store.listChallengeSurveys(assignment.challenge_id))
      .find((s) => s.assignment_id === assignment.id);
    if (existing) throw conflict("A survey has already been submitted for this challenge.");
    const survey = await store.createChallengeSurvey({ assignment_id: assignment.id, q1_rating, q2_text: text });
    res.status(201).json({ survey });
  }));

  /* ---------------- Batch 4 (010): U30–U47 customer ---------------- */

  // GET /me/streak — U31: consecutive check-in days (ends today/yesterday).
  r.get("/streak", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.getStreak(req.user!.id));
  }));

  // GET /me/referrals — U32: own referral code + users who joined via it.
  // There is no referrals table (U4 is a client-derived code); `joined` is
  // honestly empty until join tracking exists.
  r.get("/referrals", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.getReferralHistory(req.user!.id));
  }));

  // GET /me/consents — U36: consent history, newest first.
  r.get("/consents", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ consents: await store.listConsents(req.user!.id) });
  }));

  // POST /me/feedback — U37: app feedback (rating 1–5 + optional message).
  r.post("/feedback", asyncHandler(async (req: AuthedRequest, res) => {
    const { rating, message } = req.body ?? {};
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5)
      throw badRequest("Request failed validation.", { field: "rating" });
    const msg = typeof message === "string" && message.trim()
      ? message.trim().slice(0, 2000)
      : null;
    const row = await store.createAppFeedback({ user_id: req.user!.id, rating: n, message: msg });
    res.status(201).json(row);
  }));

  // ---- U40: kit reminders ----

  // GET /me/kit-reminders — my reminders, earliest first.
  r.get("/kit-reminders", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ reminders: await store.listKitReminders(req.user!.id) });
  }));

  // POST /me/kit-reminders — create a reminder.
  r.post("/kit-reminders", asyncHandler(async (req: AuthedRequest, res) => {
    const { kit_id, label_en, label_ne, remind_at } = req.body ?? {};
    const label = typeof label_en === "string" ? label_en.trim() : "";
    if (!label) throw badRequest("Request failed validation.", { field: "label_en" });
    if (label.length > 200) throw badRequest("Request failed validation.", { field: "label_en" });
    const when = typeof remind_at === "string" ? remind_at : "";
    if (!when || Number.isNaN(Date.parse(when)))
      throw badRequest("Request failed validation.", { field: "remind_at" });
    const kitId = kit_id === undefined || kit_id === null ? null : String(kit_id);
    if (kitId) {
      const kit = await store.getKit(kitId);
      if (!kit) throw notFound("Not found.");
    }
    const row = await store.createKitReminder({
      user_id: req.user!.id,
      kit_id: kitId,
      label_en: label,
      label_ne: typeof label_ne === "string" && label_ne.trim() ? label_ne.trim().slice(0, 200) : null,
      remind_at: new Date(Date.parse(when)).toISOString(),
    });
    res.status(201).json(row);
  }));

  // PATCH /me/kit-reminders/:id/done — mark done/undone (own rows only).
  r.patch("/kit-reminders/:id/done", asyncHandler(async (req: AuthedRequest, res) => {
    const { done } = req.body ?? {};
    if (typeof done !== "boolean") throw badRequest("Request failed validation.", { field: "done" });
    const row = await store.setKitReminderDone(req.params.id, req.user!.id, done);
    if (!row) throw notFound("Not found.");
    res.json(row);
  }));

  // DELETE /me/kit-reminders/:id — delete (own rows only).
  r.delete("/kit-reminders/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteKitReminder(req.params.id, req.user!.id);
    if (!ok) throw notFound("Not found.");
    res.status(204).end();
  }));

  // GET /me/reorder-suggestions — U41: kits ordered 60+ days ago with no
  // later order containing them.
  r.get("/reorder-suggestions", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ suggestions: await store.getReorderSuggestions(req.user!.id) });
  }));

  // ---- U42: kit usage log ----

  // POST /me/kit-usages — log one product usage.
  r.post("/kit-usages", asyncHandler(async (req: AuthedRequest, res) => {
    const { kit_id, note } = req.body ?? {};
    const kitId = kit_id === undefined || kit_id === null ? null : String(kit_id);
    if (kitId) {
      const kit = await store.getKit(kitId);
      if (!kit) throw notFound("Not found.");
    }
    const row = await store.logKitUsage({
      user_id: req.user!.id,
      kit_id: kitId,
      note: typeof note === "string" && note.trim() ? note.trim().slice(0, 2000) : null,
    });
    res.status(201).json(row);
  }));

  // GET /me/kit-usages?limit= — recent usage rows, newest first.
  r.get("/kit-usages", asyncHandler(async (req: AuthedRequest, res) => {
    const raw = req.query.limit === undefined ? 20 : Number(req.query.limit);
    const limit = Number.isInteger(raw) ? Math.max(1, Math.min(100, raw)) : 20;
    res.json({ usages: await store.listKitUsages(req.user!.id, limit) });
  }));

  // GET /me/challenges/assignments/:id/certificate — C28 customer side.
  // Mirrors the coach certificate shape; the assignment must belong to the
  // customer and be completed (409 while in progress, 404 for others').
  r.get("/challenges/assignments/:id/certificate", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const mine = await store.listChallengeAssignments(req.user!.id);
    const found = mine.find((a) => a.id === req.params.id);
    if (!found) throw notFound("Not found.");
    if (!found.completed_at) throw conflict("This challenge is not completed yet.");
    const challenge = found.challenge
      ?? (await store.listChallenges()).find((c) => c.id === found.challenge_id)
      ?? null;
    if (!challenge) throw notFound("Not found.");
    const profile = await store.getProfile(req.user!.id);
    res.json({
      certificate: {
        assignment_id: found.id,
        customer_name: profile?.name ?? null,
        challenge_title_en: challenge.title_en,
        challenge_title_ne: challenge.title_ne,
        completed_at: found.completed_at,
      },
    });
  }));

  // GET /me/sessions — U45: own recent sessions. Only id/created_at/last_used_at
  // are returned — never token values (the store exposes a hash fingerprint).
  r.get("/sessions", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ sessions: await store.listOwnSessions(req.user!.id) });
  }));

  // __B4_ME_CUSTOMER__

  void stageName; void scoreColor; void weakestRoots; void conflict; void notFound;
  return r;
}
