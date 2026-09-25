import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import type { Deps } from "../../deps";
import {
  asyncHandler, badRequest, notFound, unauthorized, clientIp,
  HttpError,
} from "../../http";
import type { AuthedRequest } from "../../middleware/auth";
import { featureEnabled } from "../../middleware/flags";
import {
  ANGLES, MAX_BYTES, processUpload, PhotoError, type StorageAdapter,
} from "../../lib/photos";
import { checkPhotoQuality } from "../../lib/gemini";
import { sendEmail, scanSubmittedEmail } from "../../lib/brevo";
import { evaluateRedFlags } from "../scan/redflags";
import { computeRootScores, ROOT_LABELS, ROOTS, scoreColor, weakestRoots, type RootKey, type RootScore } from "../scan/scoring";
import { STAGES, stageName, stageNumber, validateTransition, stagesCompleted, evaluatePaths, toContractScan } from "../scan/engine";
import type { Scan, RootScoreRow } from "../../db/types";

const EVENT_TYPES = [
  "shedding_onset", "illness_fever", "childbirth", "crash_diet", "medication_change",
  "stress_period", "moved_city_water", "hair_treatment", "other",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

// light per-IP draft-scan throttle (contract: 429 on too many drafts)
const draftHits = new Map<string, number[]>();

export function scansRoutes(deps: Deps): Router {
  const r = Router();
  const { store, storage, chunks } = deps;
  const pendingUploads = new Map<string, Buffer>(); // uploadId -> assembled bytes

  /** Load a scan the caller owns. 404 (not 403) to avoid leaking existence. */
  async function owned(req: AuthedRequest, id: string, opts?: { authRequired?: boolean }): Promise<Scan> {
    const scan = await store.getScan(id);
    if (!scan) throw notFound("Not found.");
    if (scan.user_id) {
      if (!req.user || req.user.id !== scan.user_id) throw notFound("Not found.");
      return scan;
    }
    const token = (req.headers["x-guest-token"] as string) || (req.query.guest_token as string);
    if (opts?.authRequired) throw unauthorized("Sign in to continue — your photos stay private.");
    if (!token || token !== scan.guest_token) throw notFound("Not found.");
    return scan;
  }

  async function flagContext(scan: Scan) {
    const pins = await store.listTimelineEvents(scan.id);
    const profile = scan.user_id ? await store.getProfile(scan.user_id) : null;
    return {
      pins: pins.map((p) => ({ event_type: p.event_type, occurred_on: p.occurred_on, followup_answers: p.followup_answers })),
      answers: scan.answers,
      profile: profile ? { age_band: profile.age_band, gender: profile.gender, is_minor: profile.is_minor } : undefined,
    };
  }

  /** Persist newly-raised flags (dedupe by flag_type among unresolved). Returns all raised. */
  async function raiseFlags(scan: Scan, raised: { flag_type: string; detail: string }[]) {
    const existing = await store.listRedFlags(scan.id, { unresolvedOnly: true });
    const have = new Set(existing.map((f) => f.flag_type));
    const out = [];
    for (const f of raised) {
      if (have.has(f.flag_type)) continue;
      out.push(await store.addRedFlag({ scan_id: scan.id, flag_type: f.flag_type, detail: f.detail }));
      have.add(f.flag_type);
    }
    return out;
  }

  async function recomputeScores(scan: Scan) {
    const ctx = await flagContext(scan);
    const scores = computeRootScores(ctx);
    await store.setRootScores(scan.id, ROOTS.map((k) => ({
      root: k, score: scores[k].score, signals: scores[k].signals,
    })));
    return scores;
  }

  // POST /scans — guest allowed (draft)
  r.post("/", asyncHandler(async (req: AuthedRequest, res) => {
    const ip = clientIp(req);
    const arr = (draftHits.get(ip) ?? []).filter((t) => Date.now() - t < 3_600_000);
    if (arr.length >= 20) {
      res.status(429).json({ code: "rate_limited", message: "Too many scans started. Please continue an existing draft." });
      return;
    }
    arr.push(Date.now()); draftHits.set(ip, arr);
    const guest = !req.user;
    const scan = await store.createScan({
      user_id: req.user?.id ?? null,
      guest_token: guest ? randomUUID() : null,
    });
    const body: Record<string, unknown> = toContractScan(scan, 0);
    if (guest) body.guest_token = scan.guest_token;
    res.status(201).json(body);
  }));

  // GET /scans/:id — resume state
  r.get("/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id);
    const [events, photos, scores, flags] = await Promise.all([
      store.listTimelineEvents(scan.id),
      store.listPhotos(scan.id),
      store.getRootScores(scan.id),
      store.listRedFlags(scan.id),
    ]);
    const photosOut = await Promise.all(photos.map(async (p) => ({
      id: p.id, scan_id: p.scan_id, angle: p.angle,
      thumb_url: p.thumb_path ? await storage.getSignedUrl(p.thumb_path, 900) : null,
      signed_url: await storage.getSignedUrl(p.storage_path, 900),
      consent_id: p.consent_id, created_at: p.created_at,
    })));
    const byRoot = new Map(scores.map((s: RootScoreRow) => [s.root, s]));
    res.json({
      ...toContractScan(scan, flags.filter((f) => !f.resolved_at).length),
      timeline_events: events,
      photos: photosOut,
      root_scores: scores.length ? Object.fromEntries(ROOTS.map((k) => {
        const s = byRoot.get(k);
        return [k, { score: s?.score ?? 0, label_en: ROOT_LABELS[k].en, label_ne: ROOT_LABELS[k].ne, signals: s?.signals ?? {} }];
      })) : null,
      red_flags: flags,
    });
  }));

  // PATCH /scans/:id/stage
  r.patch("/:id/stage", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id);
    const { stage } = req.body ?? {};
    if (!STAGES.includes(stage)) throw badRequest("Request failed validation.", { field: "stage" });
    const to = stageNumber(stage);
    if (to === 2 && !scan.user_id) {
      res.status(403).json({ code: "guest_forbidden", message: "Sign in to continue — your photos stay private." });
      return;
    }
    validateTransition(scan.current_stage, to);
    const ctx = await flagContext(scan);
    const openFlags = (await store.listRedFlags(scan.id, { unresolvedOnly: true })).length;
    const activePaths = evaluatePaths(await store.listScanRules(true), { ...ctx, hasUnresolvedRedFlag: openFlags > 0 });
    const patch: Partial<Scan> = { current_stage: to, active_path: activePaths[0] ?? null };
    if (to > scan.current_stage && to === 4) {
      // entering Root Map: (re)compute scores so GET root-map is ready
      await recomputeScores(scan);
    }
    const updated = (await store.updateScan(scan.id, patch))!;
    const flags = await store.listRedFlags(scan.id);
    res.json({ scan: toContractScan(updated, flags.filter((f) => !f.resolved_at).length), active_paths: activePaths });
  }));

  // POST /scans/:id/answers — Stage-3 Jara answers (contract extension)
  r.post("/:id/answers", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id);
    const { answers } = req.body ?? {};
    if (!answers || typeof answers !== "object") throw badRequest("Request failed validation.", { field: "answers" });
    const merged = { ...scan.answers, ...(answers as Record<string, unknown>) };
    await store.updateScan(scan.id, { answers: merged });
    const ctx = await flagContext({ ...scan, answers: merged });
    const raised = await raiseFlags(scan, evaluateRedFlags(ctx));
    const scores = await recomputeScores({ ...scan, answers: merged });
    res.json({
      answers: merged,
      red_flags_raised: raised,
      scores: Object.fromEntries(ROOTS.map((k) => [k, scores[k].score])),
    });
  }));

  // POST /scans/:id/timeline-events
  r.post("/:id/timeline-events", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id);
    const { event_type, occurred_on, note, followup_answers } = req.body ?? {};
    if (!EVENT_TYPES.includes(event_type)) throw badRequest("Request failed validation.", { field: "event_type" });
    const event = await store.addTimelineEvent({
      scan_id: scan.id, event_type,
      occurred_on: occurred_on ?? null, note: note ? String(note).slice(0, 2000) : null,
      followup_answers: followup_answers ?? {},
    });
    const ctx = await flagContext(scan);
    const raised = await raiseFlags(scan, evaluateRedFlags({
      ...ctx,
      pin: { event_type, followup_answers: followup_answers ?? {}, occurred_on: occurred_on ?? null },
    }));
    const body = { event, red_flags_raised: raised };
    if (raised.length) { res.status(409).json(body); return; }
    res.status(201).json(body);
  }));

  async function storePhoto(req: AuthedRequest, scan: Scan, angle: string, bytes: Buffer, consentId?: string) {
    if (!ANGLES.includes(angle as (typeof ANGLES)[number])) throw badRequest("Request failed validation.", { field: "angle" });
    // consent: explicit consent_id wins, else latest granted photo consent
    let consent = null;
    if (consentId) {
      const rows = await store.listConsents(scan.user_id!);
      consent = rows.find((c) => c.id === consentId && c.type === "photo" && c.granted) ?? null;
      if (!consent) throw badRequest("Request failed validation.", { field: "consent_id" });
    } else {
      const rows = await store.listConsents(scan.user_id!);
      consent = rows.find((c) => c.type === "photo" && c.granted) ?? null;
      if (!consent) {
        throw new HttpError(403, "consent_required",
          "Photo consent is required before uploading. Record it via POST /me/consents.");
      }
    }
    const processed = await processUpload(storage, { scanId: scan.id, angle: angle as (typeof ANGLES)[number], bytes });
    const ai_quality = await checkPhotoQuality(processed.thumbBytes, angle);
    const photo = await store.upsertPhoto({
      scan_id: scan.id, angle: angle as (typeof ANGLES)[number],
      storage_path: processed.storagePath, thumb_path: processed.thumbPath,
      consent_id: consent.id, ai_quality,
      width: processed.width, height: processed.height,
    });
    return {
      id: photo.id, scan_id: photo.scan_id, angle: photo.angle,
      thumb_url: processed.thumbUrl, signed_url: processed.signedUrl,
      consent_id: photo.consent_id, created_at: photo.created_at,
    };
  }

  // POST /scans/:id/photos — multipart upload (auth + photo consent required)
  r.post("/:id/photos", upload.single("photo"), asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id, { authRequired: true });
    if (!req.user || scan.user_id !== req.user.id) throw notFound("Not found.");
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw badRequest("Request failed validation.", { field: "photo" });
    const { angle, consent_id } = req.body ?? {};
    try {
      const out = await storePhoto(req, scan, String(angle), file.buffer, consent_id ? String(consent_id) : undefined);
      res.status(201).json(out);
    } catch (e) {
      if (e instanceof PhotoError) {
        const code = e.status === 413 ? 413 : e.status === 415 ? 400 : 422;
        res.status(code).json({ code: "validation_error", message: e.message });
        return;
      }
      throw e;
    }
  }));

  // POST /scans/:id/photos/upload-chunk — resumable upload, one chunk at a time
  r.post("/:id/photos/upload-chunk", asyncHandler(async (req: AuthedRequest, res) => {
    await owned(req, req.params.id, { authRequired: true });
    const { uploadId, index, total, chunk } = req.body ?? {};
    if (!uploadId || !Number.isInteger(index) || !Number.isInteger(total) || typeof chunk !== "string") {
      throw badRequest("Request failed validation.", { field: "uploadId|index|total|chunk" });
    }
    const buf = Buffer.from(chunk, "base64");
    if (buf.length > 2 * 1024 * 1024) throw badRequest("Chunk too large (2 MB max).");
    const done = chunks.addChunk(String(uploadId), index, total, buf);
    if (done) {
      pendingUploads.set(String(uploadId), done);
      setTimeout(() => pendingUploads.delete(String(uploadId)), 30 * 60 * 1000).unref?.();
      res.json({ complete: true, uploadId });
      return;
    }
    res.json({ complete: false, received: index + 1, of: total });
  }));

  // POST /scans/:id/photos/upload-complete — assemble finished, run pipeline
  r.post("/:id/photos/upload-complete", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id, { authRequired: true });
    if (!req.user || scan.user_id !== req.user.id) throw notFound("Not found.");
    const { uploadId, angle, consent_id } = req.body ?? {};
    const bytes = pendingUploads.get(String(uploadId));
    if (!bytes) throw badRequest("Unknown or expired uploadId — re-upload chunks.");
    pendingUploads.delete(String(uploadId));
    try {
      const out = await storePhoto(req, scan, String(angle), bytes, consent_id ? String(consent_id) : undefined);
      res.status(201).json(out);
    } catch (e) {
      if (e instanceof PhotoError) {
        res.status(e.status === 413 ? 413 : 400).json({ code: "validation_error", message: e.message });
        return;
      }
      throw e;
    }
  }));

  // DELETE /scans/:id/photos/:photoId
  r.delete("/:id/photos/:photoId", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id, { authRequired: true });
    const photo = await store.getPhoto(req.params.photoId);
    if (!photo || photo.scan_id !== scan.id) throw notFound("Not found.");
    if (photo.thumb_path) await storage.delete(photo.thumb_path).catch(() => {});
    await storage.delete(photo.storage_path).catch(() => {});
    await store.deletePhoto(photo.id);
    res.status(204).end();
  }));

  function rootMapPayload(scan: Scan, scores: Record<RootKey, RootScore>, statusCard: string) {
    const ordered = ROOTS.slice().sort((a, b) => scores[a].score - scores[b].score);
    const roots: Record<string, unknown> = {};
    for (const k of ROOTS) {
      roots[k] = { score: scores[k].score, label_en: ROOT_LABELS[k].en, label_ne: ROOT_LABELS[k].ne, signals: scores[k].signals };
    }
    const svgRoots = ROOTS.map((k, i) => {
      const s = scores[k].score;
      return {
        root: k, x1: 200, y1: 120,
        x2: Math.round(200 + (i - 2.5) * 58), y2: Math.round(120 + s),
        color: scoreColor(s), length: s,
        label_en: ROOT_LABELS[k].en, label_ne: ROOT_LABELS[k].ne,
      };
    });
    return {
      scan_id: scan.id, version: scan.version, status_card: statusCard,
      generated_at: scan.updated_at,
      weakest_roots: weakestRoots(scores, 2),
      roots,
      svg: { viewBox: "0 0 400 360", roots: svgRoots },
      footer_note: "Jaraa organizes the evidence; your dermatologist makes the decisions.",
      share_image_url: null,
    };
  }

  // GET /scans/:id/root-map
  r.get("/:id/root-map", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id);
    const rows = await store.getRootScores(scan.id);
    if (!rows.length) {
      res.status(422).json({
        code: "scan_incomplete",
        message: "Root scores are not ready — complete the Jara stage first.",
        details: { missing: ["root_scores"] },
      });
      return;
    }
    const scores = Object.fromEntries(rows.map((s: RootScoreRow) => [s.root, { score: s.score, signals: s.signals }])) as Record<RootKey, RootScore>;
    const kase = await store.getCaseByScan(scan.id);
    const openFlags = (await store.listRedFlags(scan.id, { unresolvedOnly: true })).length;
    const statusCard = kase?.status === "reviewed" ? "reviewed" : openFlags ? "red_flagged" : "pending_review";
    res.json(rootMapPayload(scan, scores, statusCard));
  }));

  // POST /scans/:id/submit
  r.post("/:id/submit", asyncHandler(async (req: AuthedRequest, res) => {
    const scan = await owned(req, req.params.id, { authRequired: true });
    if (!req.user || scan.user_id !== req.user.id) throw notFound("Not found.");

    // red flags block first (409), per contract
    const openFlags = await store.listRedFlags(scan.id, { unresolvedOnly: true });
    if (openFlags.length) {
      res.status(409).json({
        code: "red_flag_unresolved",
        message: "We spotted something a doctor should look at first. Your scan is saved — a dermatologist will review it.",
        details: { unresolved_flags: openFlags },
      });
      return;
    }

    const missing: string[] = [];
    const pins = await store.listTimelineEvents(scan.id);
    if (!pins.length) missing.push("stage1: at least one timeline pin");
    const photos = await store.listPhotos(scan.id);
    if (photos.length < 3) missing.push(`photos: ${photos.length} of 5 uploaded (need 3)`);
    const scores = await store.getRootScores(scan.id);
    const missingRoots = ROOTS.filter((k) => !scores.some((s: RootScoreRow) => s.root === k));
    if (missingRoots.length) missing.push(`root_scores: ${missingRoots.join(", ")}`);
    if (!(await store.consentGranted(scan.user_id, "photo"))) missing.push("consent: photo");
    if (!(await store.consentGranted(scan.user_id, "data"))) missing.push("consent: data");
    if (missing.length) {
      res.status(422).json({ code: "scan_incomplete", message: "Your scan is not complete yet.", details: { missing } });
      return;
    }

    const existing = await store.getCaseByScan(scan.id);
    if (existing) { res.status(201).json(toContractCase(existing, scan.user_id)); return; }

    const hadFlags = (await store.listRedFlags(scan.id)).length > 0;
    const kase = await store.createCase({
      scan_id: scan.id,
      priority: hadFlags ? 100 : 0,
      sla_due_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    await store.updateScan(scan.id, { status: "submitted", version: scan.version + 1 });
    // journey email: scan submitted (fire-and-forget — a failed email must never break the request)
    try {
      const user = await store.getUserById(scan.user_id);
      const profile = user ? await store.getProfile(user.id) : null;
      if (user?.email) {
        const m = scanSubmittedEmail(profile?.name);
        sendEmail(user.email, m.subject, m.html).catch((e) => console.error("[brevo]", e));
      }
    } catch (e) { console.error("[scan-submitted notify]", e); }
    // P-6: in-app notification (fire-and-forget)
    store.createNotification({
      user_id: scan.user_id, type: "case_submitted", link: "/progress",
      title_en: "Scan submitted — with the dermatologist",
      title_ne: "स्क्यान बुझाइयो — छाला रोग विशेषज्ञसँग",
      body_en: "Your case is in the dermatologist review queue. We'll notify you when the review is done.",
      body_ne: "तपाईंको केस छाला रोग विशेषज्ञको समीक्षा सूचीमा छ। समीक्षा सकिएपछि हामी जानकारी दिनेछौं।",
    }).catch((e) => console.error("[notify case_submitted]", e));
    res.status(201).json(toContractCase(kase, scan.user_id));
  }));

  function toContractCase(kase: { id: string; scan_id: string; assigned_doctor_id: string | null; priority: number; sla_due_at: string | null; status: string; created_at: string }, userId: string | null) {
    return {
      id: kase.id, scan_id: kase.scan_id, user_id: userId,
      assigned_doctor_id: kase.assigned_doctor_id,
      priority: kase.priority >= 100 ? "red_flag" : kase.priority >= 50 ? "high" : "normal",
      sla_due_at: kase.sla_due_at, status: kase.status, created_at: kase.created_at,
    };
  }

  void featureEnabled; void unauthorized; void clientIp; void STAGES; void stageName; void stagesCompleted;
  return r;
}
