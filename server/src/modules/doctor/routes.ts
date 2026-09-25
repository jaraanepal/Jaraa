import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, forbidden, clientIp, HttpError } from "../../http";
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
    archived_at: kase.archived_at ?? null,
  };
}

function toContractFollowUp(f: { id: string; case_id: string; doctor_id: string; due_on: string; note: string | null; done_at: string | null; created_at: string }) {
  return {
    id: f.id, case_id: f.case_id, doctor_id: f.doctor_id,
    due_on: f.due_on, note: f.note, done_at: f.done_at, created_at: f.created_at,
  };
}

/** Batch-3 ownership rules: admins bypass; doctors act only on their own cases. */
function isAssignedDoctor(kase: Case, user: { id: string; role: string }): boolean {
  return user.role === "admin" || kase.assigned_doctor_id === user.id;
}
function canArchiveCase(kase: Case, user: { id: string; role: string }): boolean {
  return user.role === "admin" ||
    kase.assigned_doctor_id === user.id ||
    (kase.assigned_doctor_id == null && kase.status === "reviewed");
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Monday–Sunday of the current week (local time), as YYYY-MM-DD. */
function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const f = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: f(mon), to: f(sun) };
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
      kit_id: (it.detail as { kit_id?: string | null })?.kit_id ?? null,
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

  // GET /doctor/cases — review queue (every read is audited).
  // Archived cases are excluded here (wave-2: the queue filters archived_at IS NULL);
  // they remain visible via GET /doctor/cases/archived.
  r.get("/cases", asyncHandler(async (req: AuthedRequest, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "queued";
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 100);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
    const { cases, nextCursor } = await store.listCases({ status, limit, cursor });
    const out = [];
    for (const c of cases) {
      if (c.archived_at != null) continue;
      await audit(store, { actorId: req.user!.id, action: "case.view", entity: "case", entityId: c.id, ip: clientIp(req) });
      out.push(toContractCase(c, await caseUserId(c)));
    }
    res.json({ cases: out, next_cursor: nextCursor });
  }));

  /* ---------------- Batch 3 (009): D19–D27 ----------------
   * This whole block is registered BEFORE "/cases/:id" so that
   * GET /doctor/cases/archived is not shadowed by the :id route.
   */

  // D19 — own audit trail (actor filtered to this doctor, newest first)
  r.get("/audit", asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
    res.json({ audit: await store.listDoctorAudit(req.user!.id, limit) });
  }));

  // D20 — archived cases, newest archived first
  r.get("/cases/archived", asyncHandler(async (req: AuthedRequest, res) => {
    const cases = await store.listArchivedCases(req.user!.id);
    const out = [];
    for (const c of cases) out.push(toContractCase(c, await caseUserId(c)));
    res.json({ cases: out });
  }));

  // D20 — archive a case (assigned to this doctor, or unassigned + reviewed)
  r.patch("/cases/:id/archive", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    if (!canArchiveCase(kase, req.user!)) throw forbidden("Only the assigned doctor can archive this case.");
    const archived = await store.archiveCase(kase.id);
    await audit(store, { actorId: req.user!.id, action: "case.archive", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.json({ case: toContractCase(archived!, await caseUserId(archived!)) });
  }));

  // D22 — request a second opinion from another doctor
  r.post("/cases/:id/second-opinion", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const { reviewer_id, note } = req.body ?? {};
    if (!reviewer_id || typeof reviewer_id !== "string") throw badRequest("Request failed validation.", { field: "reviewer_id" });
    if (reviewer_id === req.user!.id) throw badRequest("Request failed validation.", { field: "reviewer_id" });
    if (!isAssignedDoctor(kase, req.user!)) throw forbidden("Only the assigned doctor can request a second opinion.");
    const reviewer = await store.getUserById(reviewer_id);
    if (!reviewer) throw notFound("Reviewer not found.");
    if (reviewer.role !== "doctor") throw badRequest("Request failed validation.", { field: "reviewer_id" });
    const so = await store.createSecondOpinion({
      case_id: kase.id, requester_id: req.user!.id, reviewer_id,
      note: note ? String(note).slice(0, 2000) : null,
    });
    await store.createNotification({
      user_id: reviewer_id, type: "second_opinion", link: "/doctor",
      title_en: "Second opinion requested",
      title_ne: "दोस्रो राय मागियो",
      body_en: "A fellow dermatologist requested your second opinion on one of their cases. Open your second-opinions inbox to review it.",
      body_ne: "एक साथी छाला रोग विशेषज्ञले आफ्नो एउटा केसमा तपाईंको दोस्रो राय माग्नुभएको छ। समीक्षा गर्न आफ्नो दोस्रो-राय इनबक्स खोल्नुहोस्।",
    });
    await audit(store, { actorId: req.user!.id, action: "second_opinion.request", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.status(201).json({ secondOpinion: so });
  }));

  // D22 — second-opinion inbox (sent + received, newest first)
  r.get("/second-opinions", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ secondOpinions: await store.listSecondOpinions(req.user!.id) });
  }));

  // D22 — reviewer accepts / declines a pending request
  r.post("/second-opinions/:id/decide", asyncHandler(async (req: AuthedRequest, res) => {
    const { accept } = req.body ?? {};
    if (typeof accept !== "boolean") throw badRequest("Request failed validation.", { field: "accept" });
    const existing = (await store.listSecondOpinions(req.user!.id)).find((s) => s.id === req.params.id);
    if (!existing) throw notFound("Second-opinion request not found.");
    if (existing.reviewer_id !== req.user!.id) throw forbidden("Only the requested reviewer can decide.");
    if (existing.status !== "pending") throw conflict("This request has already been decided.");
    const so = await store.decideSecondOpinion(existing.id, req.user!.id, accept);
    await audit(store, { actorId: req.user!.id, action: "second_opinion.decide", entity: "case", entityId: existing.case_id, ip: clientIp(req) });
    res.json({ secondOpinion: so });
  }));

  // D24 — triage presets (highest priority first)
  r.get("/triage-presets", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ presets: await store.listTriagePresets(req.user!.id) });
  }));

  // D24 — create a triage preset
  r.post("/triage-presets", asyncHandler(async (req: AuthedRequest, res) => {
    const { name, priority } = req.body ?? {};
    if (!name || !String(name).trim()) throw badRequest("Request failed validation.", { field: "name" });
    const pr = priority === undefined ? 0 : priority;
    if (![0, 50, 100].includes(pr)) throw badRequest("Request failed validation.", { field: "priority" });
    const preset = await store.createTriagePreset(req.user!.id, String(name).trim().slice(0, 120), pr);
    res.status(201).json({ preset });
  }));

  // D24 — delete a triage preset (own presets only)
  r.delete("/triage-presets/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteTriagePreset(req.params.id, req.user!.id);
    if (!ok) throw notFound("Preset not found.");
    res.status(204).end();
  }));

  // D25 — patient adherence (read-only; only the assigned doctor or an
  // accepted-review second-opinion reviewer may see it)
  r.get("/patients/:userId/adherence", asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.params.userId;
    const patient = await store.getUserById(userId);
    if (!patient) throw notFound("Patient not found.");
    const cases = await store.listCasesByUser(userId);
    const isMine = cases.some((c) => c.assigned_doctor_id === req.user!.id);
    let isReviewer = false;
    if (!isMine && req.user!.role !== "admin") {
      const caseIds = new Set(cases.map((c) => c.id));
      isReviewer = (await store.listSecondOpinions(req.user!.id))
        .some((s) => s.reviewer_id === req.user!.id && caseIds.has(s.case_id));
    }
    if (!isMine && !isReviewer && req.user!.role !== "admin") {
      throw forbidden("Not your patient.");
    }
    const a = await store.getPatientAdherence(userId);
    res.json({ user_id: userId, rate: a.rate, done: a.done, total: a.total });
  }));

  // D26 — transfer a case to another doctor (reason persisted in audit_log.detail, 009)
  r.post("/cases/:id/transfer", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const { to_doctor_id, reason } = req.body ?? {};
    if (!to_doctor_id || typeof to_doctor_id !== "string") throw badRequest("Request failed validation.", { field: "to_doctor_id" });
    if (to_doctor_id === req.user!.id) throw badRequest("Request failed validation.", { field: "to_doctor_id" });
    if (!isAssignedDoctor(kase, req.user!)) throw forbidden("Only the assigned doctor can transfer this case.");
    const target = await store.getUserById(to_doctor_id);
    if (!target) throw notFound("Doctor not found.");
    if (target.role !== "doctor") throw badRequest("Request failed validation.", { field: "to_doctor_id" });
    if (reason != null && (typeof reason !== "string" || reason.length > 2000)) throw badRequest("Request failed validation.", { field: "reason" });
    const fromDoctorId = kase.assigned_doctor_id;
    // D26: reason persisted in audit_log.detail (009) — from/to doctor ids included.
    const updated = await store.transferCase(kase.id, to_doctor_id);
    await audit(store, {
      actorId: req.user!.id, action: "case.transfer", entity: "case", entityId: kase.id,
      ip: clientIp(req),
      detail: JSON.stringify({ from_doctor_id: fromDoctorId, to_doctor_id, reason: reason ?? null }),
    });
    res.json({ case: toContractCase(updated!, await caseUserId(updated!)) });
  }));

  /* ---------------- Batch 4 (010): D28–D45 ----------------
   * This whole block is registered BEFORE "/cases/:id" so that
   * GET /doctor/cases/export.csv is not shadowed by the :id route.
   */

  /** Non-diagnostic concern tags (D33) — operational only, never a diagnosis. */
  const CONCERN_TAGS = [
    "awaiting_patient_reply",
    "photos_need_retake",
    "follow_up_needed",
    "history_incomplete",
    "needs_peer_review",
    "monitor_closely",
  ] as const;

  // D28 — push a plain-language case summary into the patient's in-app notifications.
  // Any doctor may share (the route already requires the doctor/admin role).
  r.post("/cases/:id/share-summary", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const { summary, summary_ne } = req.body ?? {};
    const text = typeof summary === "string" ? summary.trim() : "";
    if (!text) throw badRequest("Request failed validation.", { field: "summary" });
    const scan = await store.getScan(kase.scan_id);
    const patientId = scan?.user_id ?? null;
    if (!patientId) throw notFound("Patient not found.");
    const notif = await store.createNotification({
      user_id: patientId, type: "case_summary", link: "/progress",
      title_en: "Your doctor shared a case summary",
      title_ne: "तपाईंको डाक्टरले केस सारांश साझा गर्नुभयो",
      body_en: text.slice(0, 2000),
      body_ne: typeof summary_ne === "string" && summary_ne.trim()
        ? summary_ne.trim().slice(0, 2000) : null,
    });
    await audit(store, { actorId: req.user!.id, action: "case.share_summary", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.status(201).json({ notification: notif });
  }));

  // D29 — doctor directory for second opinions / transfers (excludes self)
  r.get("/peers", asyncHandler(async (req: AuthedRequest, res) => {
    const peers = await store.listDoctorPeers(req.user!.id);
    const out = [];
    for (const p of peers) {
      const prof = await store.getProfile(p.id).catch(() => null);
      out.push({ id: p.id, name: prof?.name ?? null });
    }
    res.json({ peers: out });
  }));

  // D30 — pause the SLA clock
  r.post("/cases/:id/sla-pause", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const pausedAt = new Date().toISOString();
    await store.setCaseSlaPaused(kase.id, pausedAt);
    await audit(store, { actorId: req.user!.id, action: "case.sla_pause", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.json({ case_id: kase.id, sla_paused_at: pausedAt });
  }));

  // D30 — resume the SLA clock
  r.post("/cases/:id/sla-resume", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    await store.setCaseSlaPaused(kase.id, null);
    await audit(store, { actorId: req.user!.id, action: "case.sla_resume", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.json({ case_id: kase.id, sla_paused_at: null });
  }));

  // D31 — case plus its photo requests ("needs info" context)
  r.get("/cases/:id/needs-info", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.json({
      case: toContractCase(kase, await caseUserId(kase)),
      photo_requests: await store.listPhotoRequests(kase.id),
    });
  }));

  // D32 — doctor-only internal comment thread (oldest first)
  r.get("/cases/:id/comments", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.json({ comments: await store.listCaseComments(kase.id) });
  }));

  // D32 — add an internal comment
  r.post("/cases/:id/comments", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) throw badRequest("Request failed validation.", { field: "body" });
    if (body.length > 2000) throw badRequest("Request failed validation.", { field: "body" });
    const comment = await store.createCaseComment({ case_id: kase.id, doctor_id: req.user!.id, body });
    await audit(store, { actorId: req.user!.id, action: "case.comment", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.status(201).json({ comment });
  }));

  // D33 — list concern tags (+ the allowed tag vocabulary)
  r.get("/cases/:id/concerns", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.json({ concerns: await store.listCaseConcernTags(kase.id), allowed_tags: [...CONCERN_TAGS] });
  }));

  // D33 — add a concern tag (idempotent)
  r.post("/cases/:id/concerns", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const tag = typeof req.body?.tag === "string" ? req.body.tag : "";
    if (!(CONCERN_TAGS as readonly string[]).includes(tag)) {
      throw badRequest("Request failed validation.", { field: "tag" });
    }
    const concern = await store.addCaseConcernTag(kase.id, tag);
    await audit(store, {
      actorId: req.user!.id, action: "case.concern_add", entity: "case", entityId: kase.id,
      ip: clientIp(req), detail: JSON.stringify({ tag }),
    });
    res.status(201).json({ concern });
  }));

  // D33 — remove a concern tag
  r.delete("/cases/:id/concerns", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const tag = typeof req.body?.tag === "string" ? req.body.tag : "";
    if (!tag) throw badRequest("Request failed validation.", { field: "tag" });
    await store.removeCaseConcernTag(kase.id, tag);
    await audit(store, {
      actorId: req.user!.id, action: "case.concern_remove", entity: "case", entityId: kase.id,
      ip: clientIp(req), detail: JSON.stringify({ tag }),
    });
    res.json({ ok: true });
  }));

  // D35 — priority history: audit entries for this case whose action mentions priority
  r.get("/cases/:id/priority-history", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const entries = await store.listAudit({ entity: "case", limit: 200 });
    const history = entries.filter(
      (a) => a.entity_id === kase.id && a.action.includes("priority"),
    );
    res.json({ history });
  }));

  // D37 — weekly digest stats card data
  r.get("/digest", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.getDoctorDigest(req.user!.id));
  }));

  // D38 — past own cases with similar root scores (reference only, no diagnosis)
  r.get("/cases/:id/similar", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.json({ similar: await store.listSimilarCases(kase.id, req.user!.id) });
  }));

  // D40 — saved queue filter presets
  r.get("/queue-filters", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ filters: await store.listQueueFilters(req.user!.id) });
  }));

  // D40 — save the current queue filters as a named preset
  r.post("/queue-filters", asyncHandler(async (req: AuthedRequest, res) => {
    const { name, filters } = req.body ?? {};
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) throw badRequest("Request failed validation.", { field: "name" });
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
      throw badRequest("Request failed validation.", { field: "filters" });
    }
    const f = await store.createQueueFilter({
      doctor_id: req.user!.id, name: cleanName.slice(0, 120),
      filters: filters as Record<string, unknown>,
    });
    res.status(201).json({ filter: f });
  }));

  // D40 — delete a saved filter preset (own presets only)
  r.delete("/queue-filters/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteQueueFilter(req.params.id, req.user!.id);
    if (!ok) throw notFound("Filter not found.");
    res.status(204).end();
  }));

  // D41 — doctor side of the case Q&A thread (oldest first)
  r.get("/cases/:id/messages", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.json({ messages: await store.listCaseMessages(kase.id) });
  }));

  // D41 — doctor replies in the case Q&A
  r.post("/cases/:id/messages", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) throw badRequest("Request failed validation.", { field: "body" });
    if (body.length > 2000) throw badRequest("Request failed validation.", { field: "body" });
    const msg = await store.addCaseMessage(kase.id, req.user!.id, "doctor", body);
    await audit(store, { actorId: req.user!.id, action: "case.message", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.status(201).json(msg);
  }));

  // D42 — published education articles for the doctor shelf
  r.get("/articles", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ articles: await store.listArticles(true) });
  }));

  // D43 — own reviewed cases as a CSV download
  r.get("/cases/export.csv", asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await store.exportOwnCases(req.user!.id);
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      "id,created_at,status,priority",
      ...rows.map((row) => [esc(row.id), esc(row.created_at), esc(row.status), row.priority].join(",")),
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="my-reviewed-cases.csv"');
    res.send(csv);
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
      // D30: the SLA clock state (010 migration column; absent on old rows).
      sla_paused_at: (kase as unknown as { sla_paused_at?: string | null }).sla_paused_at ?? null,
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
    const { items, review_notes, rescan_due_on, resolved_flag_ids, resolved_flag_notes } = req.body ?? {};
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
      // P-8: doctor-prescribed kits — must be a real, active cosmetic kit.
      if (it.kit_id) {
        const kit = await store.getKit(String(it.kit_id));
        if (!kit || !kit.is_active) {
          throw badRequest("Request failed validation.", { field: "items[].kit_id" });
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
    // D36: when flags are resolved, every resolved flag id MUST carry a
    // non-empty resolution note.
    const flagIds = resolved_flag_ids ? resolved_flag_ids.map(String) : [];
    let flagNotes: Record<string, string> | undefined;
    if (flagIds.length > 0) {
      if (!resolved_flag_notes || typeof resolved_flag_notes !== "object" || Array.isArray(resolved_flag_notes)) {
        throw badRequest("Request failed validation.", { field: "resolved_flag_notes" });
      }
      flagNotes = {};
      for (const fid of flagIds) {
        const note = (resolved_flag_notes as Record<string, unknown>)[fid];
        if (typeof note !== "string" || !note.trim()) {
          throw badRequest("Request failed validation.", { field: "resolved_flag_notes" });
        }
        flagNotes[fid] = note.trim().slice(0, 2000);
      }
    }
    const plan = await store.createPlan({
      case_id: kase.id, doctor_id: req.user!.id,
      review_notes: review_notes ? String(review_notes).slice(0, 4000) : null,
      rescan_due_on: rescan_due_on ?? null,
      items: items.map((it, i: number) => ({
        kind: it.kind, title_ne: it.title_ne ?? null, title_en: it.title_en ?? null,
        detail: it.detail ?? null, product_id: it.product_id ?? null, kit_id: it.kit_id ?? null,
        sort_order: Number.isInteger(it.sort_order) ? it.sort_order : i,
      })),
      resolved_flag_ids: flagIds.length ? flagIds : undefined,
      resolved_flag_notes: flagNotes,
    });
    await audit(store, {
      actorId: req.user!.id, action: "plan.create", entity: "plan", entityId: plan.id, ip: clientIp(req),
      detail: flagNotes ? JSON.stringify({ resolved_flag_notes: flagNotes }) : undefined,
    });
    // P-6: notify the user when the doctor resolves their red flags (fire-and-forget)
    if (resolved_flag_ids?.length) {
      const scan = await store.getScan(kase.scan_id);
      if (scan?.user_id) {
        store.createNotification({
          user_id: scan.user_id, type: "flags_resolved", link: "/progress",
          title_en: "Doctor reviewed the flagged items",
          title_ne: "डाक्टरले चिन्ह लगाइएका विषय समीक्षा गर्नुभयो",
          body_en: "Your dermatologist has reviewed and resolved the flagged items on your scan. Your plan is being prepared.",
          body_ne: "तपाईंको छाला रोग विशेषज्ञले स्क्यानका चिन्ह लगाइएका विषयहरू समीक्षा गरी समाधान गर्नुभएको छ। तपाईंको योजना तयार हुँदैछ।",
        }).catch((e) => console.error("[notify flags_resolved]", e));
      }
    }
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
        sendEmail(user.email, m.subject, m.html, { template: "plan-approved" }).catch((e) => console.error("[brevo]", e));
      }
    } catch (e) { console.error("[plan-approved notify]", e); }
    // P-6: in-app notification (fire-and-forget)
    try {
      const kase = await store.getCase(plan.case_id);
      const scan = kase ? await store.getScan(kase.scan_id) : null;
      if (scan?.user_id) {
        await store.createNotification({
          user_id: scan.user_id, type: "plan_approved", link: "/plan",
          title_en: "Your dermatologist-approved plan is ready",
          title_ne: "तपाईंको छाला रोग विशेषज्ञले अनुमोदन गरेको योजना तयार छ",
          body_en: "Your doctor has reviewed your scan and approved your personal plan. Open it to see the next steps.",
          body_ne: "तपाईंको डाक्टरले स्क्यान समीक्षा गरी व्यक्तिगत योजना अनुमोदन गर्नुभएको छ। अर्को चरण हेर्न खोल्नुहोस्।",
        }).catch((e) => console.error("[notify plan_approved]", e));
      }
    } catch (e) { console.error("[plan-approved in-app notify]", e); }
    res.json(toContractPlan(plan));
  }));

  // GET /doctor/patients/:userId/cases — patient timeline + score trend (D3, D5)
  r.get("/patients/:userId/cases", asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.params.userId;
    const cases = await store.listCasesByUser(userId);
    const out = [];
    for (const c of cases) {
      await audit(store, { actorId: req.user!.id, action: "case.view", entity: "case", entityId: c.id, ip: clientIp(req) });
      const [scores, flags] = await Promise.all([
        store.getRootScores(c.scan_id),
        store.listRedFlags(c.scan_id),
      ]);
      out.push({
        id: c.id, scan_id: c.scan_id, status: c.status, priority: c.priority,
        sla_due_at: c.sla_due_at, created_at: c.created_at,
        root_scores: scores.map((s) => ({ root: s.root, score: s.score })),
        red_flag_count: flags.length,
      });
    }
    res.json({ cases: out });
  }));

  // GET /doctor/patients/search?q= — patient search (D7)
  r.get("/patients/search", asyncHandler(async (req: AuthedRequest, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) throw badRequest("Request failed validation.", { field: "q" });
    const hits = await store.searchPatients(q);
    res.json({
      patients: hits.map((h) => ({
        id: h.user.id, phone: h.user.phone, name: h.profile?.name ?? null,
      })),
    });
  }));

  // POST /doctor/follow-ups — schedule a follow-up (D6)
  r.post("/follow-ups", asyncHandler(async (req: AuthedRequest, res) => {
    const { case_id, due_on, note } = req.body ?? {};
    if (!case_id || typeof case_id !== "string") throw badRequest("Request failed validation.", { field: "case_id" });
    const kase = await store.getCase(case_id);
    if (!kase) throw notFound("Not found.");
    if (typeof due_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due_on)) {
      throw badRequest("Request failed validation.", { field: "due_on" });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (due_on < today) throw badRequest("Request failed validation.", { field: "due_on" });
    const f = await store.createFollowUp({
      case_id: kase.id, doctor_id: req.user!.id, due_on,
      note: note ? String(note).slice(0, 2000) : null,
    });
    await audit(store, { actorId: req.user!.id, action: "followup.create", entity: "case", entityId: kase.id, ip: clientIp(req) });
    res.status(201).json(toContractFollowUp(f));
  }));

  // GET /doctor/follow-ups?due_only=1 — own follow-ups (D6)
  // D23: with ?from=YYYY-MM-DD&to=YYYY-MM-DD, returns the follow-ups in that
  // date range (done and pending). A single bound defaults the other to the
  // current week; bad dates or from > to are 400.
  r.get("/follow-ups", asyncHandler(async (req: AuthedRequest, res) => {
    const fromQ = typeof req.query.from === "string" && req.query.from ? req.query.from : null;
    const toQ = typeof req.query.to === "string" && req.query.to ? req.query.to : null;
    if (fromQ !== null || toQ !== null) {
      const week = currentWeekRange();
      const from = fromQ ?? week.from;
      const to = toQ ?? week.to;
      if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
        throw badRequest("Request failed validation.", { field: "from|to" });
      }
      const list = await store.listFollowUpsRange(req.user!.id, from, to);
      res.json({ follow_ups: list.map(toContractFollowUp), from, to });
      return;
    }
    const dueOnly = req.query.due_only === "1" || req.query.due_only === "true";
    const list = await store.listFollowUps(req.user!.id, { dueOnly });
    res.json({ follow_ups: list.map(toContractFollowUp) });
  }));

  // PATCH /doctor/follow-ups/:id/done — mark own follow-up done (D6)
  r.patch("/follow-ups/:id/done", asyncHandler(async (req: AuthedRequest, res) => {
    const f = await store.completeFollowUp(req.params.id, req.user!.id);
    if (!f) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "followup.done", entity: "case", entityId: f.case_id, ip: clientIp(req) });
    res.json(toContractFollowUp(f));
  }));

  // PATCH /doctor/cases/bulk-priority — bulk priority update (D8)
  r.patch("/cases/bulk-priority", asyncHandler(async (req: AuthedRequest, res) => {
    const { ids, priority } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 ||
        !ids.every((i: unknown) => typeof i === "string" && i.length > 0)) {
      throw badRequest("Request failed validation.", { field: "ids" });
    }
    if (![0, 50, 100].includes(priority)) throw badRequest("Request failed validation.", { field: "priority" });
    const updated = await store.bulkUpdateCasePriority(ids, priority);
    await audit(store, { actorId: req.user!.id, action: "case.bulk_priority", entity: "case", entityId: "bulk", ip: clientIp(req) });
    res.json({ updated });
  }));

  // GET /doctor/availability — own availability (D9)
  r.get("/availability", asyncHandler(async (req: AuthedRequest, res) => {
    const a = await store.getDoctorAvailability(req.user!.id);
    res.json({ availability: a });
  }));

  // PUT /doctor/availability — set own availability (D9)
  // D39: optional auto_note — when the status becomes on_leave and no
  // explicit note was written, the auto-generated note is stored instead.
  r.put("/availability", asyncHandler(async (req: AuthedRequest, res) => {
    const { status, note, auto_note } = req.body ?? {};
    if (status !== "available" && status !== "on_leave") {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    const rawNote = status === "on_leave" ? (note ?? auto_note ?? null) : (note ?? null);
    const a = await store.setDoctorAvailability(
      req.user!.id, status, rawNote ? String(rawNote).slice(0, 1000) : null);
    res.json(a);
  }));

  /* ---------------- Batch 2 (008): D10–D18 ---------------- */

  // GET /doctor/workload — D10: today's claimed/in-review counts vs capacity
  r.get("/workload", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.doctorWorkload(req.user!.id));
  }));

  // GET /doctor/sla-summary — D11: overdue / due-within-6h counts for the SLA banner
  r.get("/sla-summary", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.doctorSlaSummary(req.user!.id));
  }));

  // GET /doctor/snippets — D12: personal reply-snippet library
  r.get("/snippets", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ snippets: await store.listSnippets(req.user!.id) });
  }));

  // POST /doctor/snippets — D12
  r.post("/snippets", asyncHandler(async (req: AuthedRequest, res) => {
    const { title, body_en, body_ne } = req.body ?? {};
    if (!title || !body_en) throw badRequest("title and body_en are required.", { field: "title" });
    const s = await store.createSnippet(req.user!.id, {
      title: String(title).slice(0, 120), body_en: String(body_en).slice(0, 2000),
      body_ne: body_ne ? String(body_ne).slice(0, 2000) : null,
    });
    res.status(201).json(s);
  }));

  // DELETE /doctor/snippets/:id — D12
  r.delete("/snippets/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteSnippet(req.params.id, req.user!.id);
    if (!ok) throw notFound("Snippet not found.");
    res.json({ ok: true });
  }));

  // POST /doctor/cases/:id/bookmark — D13
  r.post("/cases/:id/bookmark", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.status(201).json(await store.bookmarkCase(kase.id, req.user!.id));
  }));

  // DELETE /doctor/cases/:id/bookmark — D13
  r.delete("/cases/:id/bookmark", asyncHandler(async (req: AuthedRequest, res) => {
    await store.unbookmarkCase(req.params.id, req.user!.id);
    res.json({ ok: true });
  }));

  // GET /doctor/bookmarks — D13
  r.get("/bookmarks", asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ case_ids: await store.listBookmarks(req.user!.id) });
  }));

  // GET /doctor/cases/:id/checklist — D14
  r.get("/cases/:id/checklist", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.json({ checklist: await store.getChecklist(kase.id, req.user!.id) });
  }));

  // POST /doctor/cases/:id/checklist — D14: create with default items if none given
  r.post("/cases/:id/checklist", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const items = Array.isArray(req.body?.items) && req.body.items.length ? req.body.items : [
      { label_en: "Photos reviewed", label_ne: "फोटो हेरियो" },
      { label_en: "Red flags checked", label_ne: "रेड फ्ल्याग जाँचियो" },
      { label_en: "Plan composed", label_ne: "प्लान बनाइयो" },
    ];
    const cl = await store.createChecklist(kase.id, req.user!.id,
      items.slice(0, 12).map((it: { label_en: string; label_ne?: string }) => ({
        label_en: String(it.label_en ?? "").slice(0, 200),
        label_ne: it.label_ne ? String(it.label_ne).slice(0, 200) : null,
      })));
    res.status(201).json({ checklist: cl });
  }));

  // PATCH /doctor/checklist-items/:id — D14: toggle done
  r.patch("/checklist-items/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const done = req.body?.done === true;
    const item = await store.setChecklistItemDone(req.params.id, req.user!.id, done);
    if (!item) throw notFound("Checklist item not found.");
    res.json(item);
  }));

  // GET /doctor/patients/:userId/risk — D15: patient risk badge data
  r.get("/patients/:userId/risk", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.patientRisk(req.params.userId));
  }));

  // POST /doctor/cases/:id/photo-request — D16: ask patient for specific photo angles
  r.post("/cases/:id/photo-request", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    const { angles, note } = req.body ?? {};
    if (!angles || !String(angles).trim()) throw badRequest("angles is required.", { field: "angles" });
    const pr = await store.createPhotoRequest(kase.id, req.user!.id, String(angles).slice(0, 500), note ? String(note).slice(0, 500) : null);
    const patientId = await caseUserId(kase);
    if (patientId) {
      await store.createNotification({
        user_id: patientId, type: "photo_request",
        title_en: "Your doctor requested more photos",
        title_ne: "डाक्टरले थप फोटो माग्नुभयो",
        body_en: `Please retake: ${pr.angles}`,
        body_ne: `कृपया पुनः फोटो लिनुहोस्: ${pr.angles}`,
        link: `/scan/${kase.scan_id}`,
      });
    }
    res.status(201).json(pr);
  }));

  // GET /doctor/cases/:id/photo-requests — D16
  r.get("/cases/:id/photo-requests", asyncHandler(async (req: AuthedRequest, res) => {
    const kase = await store.getCase(req.params.id);
    if (!kase) throw notFound("Case not found.");
    res.json({ requests: await store.listPhotoRequests(kase.id) });
  }));

  // GET /doctor/stats — D17: personal review-time stats
  r.get("/stats", asyncHandler(async (req: AuthedRequest, res) => {
    res.json(await store.doctorReviewStats(req.user!.id));
  }));

  // GET /doctor/notes/search?q= — D18: search own review notes
  r.get("/notes/search", asyncHandler(async (req: AuthedRequest, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.trim().length < 2) throw badRequest("q must be at least 2 characters.", { field: "q" });
    res.json({ results: await store.searchDoctorNotes(req.user!.id, q) });
  }));

  void conflict;
  return r;
}
