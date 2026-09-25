import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, forbidden, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { buildNudges } from "../../lib/nudges";
import { weakestRoots, ROOTS, type RootKey } from "../scan/scoring";
import type { Checkin, Challenge, ChallengeAssignment } from "../../db/types";

export function coachRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  // Router-wide floor: customers (own data), coaches, admins. The console
  // endpoints below add a stricter per-route requireCoach guard.
  r.use(requireRole("customer", "coach", "admin"));
  const requireCoach = requireRole("coach", "admin");

  // GET /coach/nudges — habit nudges from latest root scores (no medical claims)
  r.get("/nudges", asyncHandler(async (req: AuthedRequest, res) => {
    let userId = req.user!.id;
    if (req.user!.role === "coach") {
      if (typeof req.query.user_id !== "string") throw badRequest("Coach must pass ?user_id.");
      userId = req.query.user_id;
    }
    const scans = await store.listUserScans(userId);
    let weakest: string[] = [];
    for (const scan of scans) {
      const scores = await store.getRootScores(scan.id);
      if (scores.length) {
        const byKey = Object.fromEntries(scores.map((s) => [s.root, { score: s.score, signals: s.signals }])) as Record<RootKey, { score: number; signals: Record<string, unknown> }>;
        const full = Object.fromEntries(ROOTS.map((k) => [k, byKey[k] ?? { score: 100, signals: {} }])) as Record<RootKey, { score: number; signals: Record<string, unknown> }>;
        weakest = weakestRoots(full, 2);
        break;
      }
    }
    const plan = await store.getLatestApprovedPlanForUser(userId);
    const checkins = await store.listCheckins(userId);
    const last = checkins[0]?.created_at ? new Date(checkins[0].created_at).getTime() : null;
    const nudges = buildNudges({
      weakestRoots: weakest,
      rescanDueOn: plan?.rescan_due_on ?? null,
      daysSinceLastCheckin: last === null ? null : Math.floor((Date.now() - last) / 86_400_000),
    });
    res.json({ nudges });
  }));

  // ---- coach console (role coach | admin) ----

  function toContractCheckin(c: Checkin) {
    return {
      id: c.id, user_id: c.user_id, plan_id: c.plan_id,
      shedding_estimate: c.shedding_estimate, note: c.note,
      photo_ids: c.photo_ids, created_at: c.created_at,
    };
  }

  // GET /coach/customers/:id/checkins (C1)
  r.get("/customers/:id/checkins", requireCoach, asyncHandler(async (req, res) => {
    const rows = await store.listCheckins(req.params.id);
    res.json({ checkins: rows.map(toContractCheckin) });
  }));

  // GET /coach/challenges (C4)
  r.get("/challenges", requireCoach, asyncHandler(async (_req, res) => {
    res.json({ challenges: await store.listChallenges() });
  }));

  // POST /coach/challenges (C4)
  r.post("/challenges", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, days, description_en, description_ne } = req.body ?? {};
    const title = typeof title_en === "string" ? title_en.trim() : "";
    if (!title) throw badRequest("Request failed validation.", { field: "title_en" });
    if (![7, 14, 30].includes(days)) throw badRequest("Request failed validation.", { field: "days" });
    const opt = (v: unknown, max: number): string | undefined => {
      const s = typeof v === "string" ? v.trim() : "";
      return s ? s.slice(0, max) : undefined;
    };
    const challenge = await store.createChallenge({
      title_en: title.slice(0, 200),
      title_ne: opt(title_ne, 200),
      days,
      description_en: opt(description_en, 2000),
      description_ne: opt(description_ne, 2000),
      created_by: req.user!.id,
    });
    await audit(store, { actorId: req.user!.id, action: "challenge.create", entity: "challenge", entityId: challenge.id, ip: clientIp(req) });
    res.status(201).json({ challenge });
  }));

  // POST /coach/challenges/:id/assign (C4)
  r.post("/challenges/:id/assign", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id } = req.body ?? {};
    if (!user_id) throw badRequest("Request failed validation.", { field: "user_id" });
    const challenge = (await store.listChallenges()).find((c) => c.id === req.params.id);
    if (!challenge) throw notFound("Not found.");
    const target = await store.getUserById(String(user_id));
    if (!target) throw notFound("Not found.");
    const assignment = await store.assignChallenge(challenge.id, target.id);
    // notify the customer (fire-and-forget — a failed notification must never break the request)
    store.createNotification({
      user_id: target.id, type: "challenge_assigned",
      title_en: "New challenge assigned", title_ne: "नयाँ चुनौती तोकियो",
      link: "/progress",
    }).catch(() => {});
    await audit(store, { actorId: req.user!.id, action: "challenge.assign", entity: "challenge_assignment", entityId: assignment.id, ip: clientIp(req) });
    res.status(201).json({ assignment });
  }));

  // GET /coach/customers/:id/notes (C5)
  r.get("/customers/:id/notes", requireCoach, asyncHandler(async (req, res) => {
    res.json({ notes: await store.listCoachNotes(req.params.id) });
  }));

  // POST /coach/customers/:id/notes (C5)
  r.post("/customers/:id/notes", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!note) throw badRequest("Request failed validation.", { field: "note" });
    if (note.length > 2000) throw badRequest("Request failed validation.", { field: "note" });
    const row = await store.addCoachNote(req.user!.id, req.params.id, note);
    await audit(store, { actorId: req.user!.id, action: "coach.note", entity: "coach_note", entityId: row.id, ip: clientIp(req) });
    res.status(201).json({ note: row });
  }));

  // POST /coach/customers/:id/escalate (C6) — notify every doctor
  r.post("/customers/:id/escalate", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) throw badRequest("Request failed validation.", { field: "reason" });
    if (reason.length > 2000) throw badRequest("Request failed validation.", { field: "reason" });
    const escalation = await store.createEscalation(req.params.id, req.user!.id, reason);
    const doctors = (await store.listUsers()).filter((u) => u.role === "doctor");
    for (const d of doctors) {
      store.createNotification({
        user_id: d.id, type: "escalation",
        title_en: "Coach escalation needs review", title_ne: "कोच एस्केलेसन समीक्षा आवश्यक",
        body_en: reason.slice(0, 200), link: "/doctor",
      }).catch(() => {});
    }
    await audit(store, { actorId: req.user!.id, action: "coach.escalate", entity: "escalation", entityId: escalation.id, ip: clientIp(req) });
    res.status(201).json({ escalation });
  }));

  // GET /coach/escalations?status= (C6)
  r.get("/escalations", requireCoach, asyncHandler(async (req, res) => {
    const { status } = req.query;
    const s = status === undefined ? undefined : String(status);
    if (s !== undefined && !["open", "acknowledged", "resolved"].includes(s)) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    res.json({ escalations: await store.listEscalations(s as "open" | "acknowledged" | "resolved" | undefined) });
  }));

  // GET /coach/nudges/scheduled (C7)
  r.get("/nudges/scheduled", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ nudges: await store.listScheduledNudges(req.user!.id) });
  }));

  // POST /coach/nudges/scheduled (C7)
  r.post("/nudges/scheduled", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id, message_en, message_ne, send_at } = req.body ?? {};
    if (!user_id) throw badRequest("Request failed validation.", { field: "user_id" });
    const msg = typeof message_en === "string" ? message_en.trim() : "";
    if (!msg) throw badRequest("Request failed validation.", { field: "message_en" });
    if (msg.length > 500) throw badRequest("Request failed validation.", { field: "message_en" });
    const sendAt = new Date(String(send_at));
    if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() <= Date.now()) {
      throw badRequest("Request failed validation.", { field: "send_at" });
    }
    const nudge = await store.scheduleNudge({
      coach_id: req.user!.id, user_id: String(user_id), message_en: msg,
      message_ne: typeof message_ne === "string" && message_ne.trim() ? message_ne.trim().slice(0, 500) : null,
      send_at: sendAt.toISOString(),
    });
    await audit(store, { actorId: req.user!.id, action: "nudge.schedule", entity: "scheduled_nudge", entityId: nudge.id, ip: clientIp(req) });
    res.status(201).json({ nudge });
  }));

  // POST /coach/nudges/scheduled/:id/send (C7)
  r.post("/nudges/scheduled/:id/send", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const nudge = (await store.listScheduledNudges(req.user!.id)).find((n) => n.id === req.params.id);
    if (!nudge) throw notFound("Not found.");
    if (nudge.sent_at) {
      res.status(409).json({ code: "conflict", message: "This nudge was already sent." });
      return;
    }
    await store.createNotification({
      user_id: nudge.user_id, type: "coach_nudge",
      title_en: "Message from your coach", title_ne: "तपाईंको कोचबाट सन्देश",
      body_en: nudge.message_en, body_ne: nudge.message_ne, link: "/notifications",
    });
    const updated = (await store.markNudgeSent(nudge.id))!;
    await audit(store, { actorId: req.user!.id, action: "nudge.send", entity: "scheduled_nudge", entityId: nudge.id, ip: clientIp(req) });
    res.json({ nudge: updated });
  }));

  // DELETE /coach/nudges/scheduled/:id (C7)
  r.delete("/nudges/scheduled/:id", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteScheduledNudge(req.params.id, req.user!.id);
    if (!ok) throw notFound("Not found.");
    res.status(204).end();
  }));

  // GET /coach/customers/:id/satisfaction (C8)
  r.get("/customers/:id/satisfaction", requireCoach, asyncHandler(async (req, res) => {
    res.json({ ratings: await store.listSatisfactionRatings(req.params.id) });
  }));

  // POST /coach/customers/:id/satisfaction (C8)
  r.post("/customers/:id/satisfaction", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { rating, comment } = req.body ?? {};
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw badRequest("Request failed validation.", { field: "rating" });
    }
    const c = typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 500) : undefined;
    const row = await store.addSatisfactionRating(req.params.id, req.user!.id, rating, c);
    await audit(store, { actorId: req.user!.id, action: "coach.satisfaction", entity: "satisfaction_rating", entityId: row.id, ip: clientIp(req) });
    res.status(201).json({ rating: row });
  }));

  // GET /coach/articles (C9)
  r.get("/articles", requireCoach, asyncHandler(async (_req, res) => {
    res.json({ articles: await store.listArticles(true) });
  }));

  /* ---------------- Batch 2 (008): C10–C18 ---------------- */
  const coachOnly = requireRole("coach", "admin");

  // POST /coach/challenge-groups — C10
  r.post("/challenge-groups", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, description_en, description_ne, starts_on, ends_on } = req.body ?? {};
    if (!title_en || !String(title_en).trim()) throw badRequest("title_en is required.", { field: "title_en" });
    const g = await store.createChallengeGroup({
      title_en: String(title_en).slice(0, 200), title_ne: title_ne ? String(title_ne).slice(0, 200) : null,
      description_en: description_en ? String(description_en).slice(0, 1000) : null,
      description_ne: description_ne ? String(description_ne).slice(0, 1000) : null,
      starts_on: starts_on ? String(starts_on).slice(0, 10) : null,
      ends_on: ends_on ? String(ends_on).slice(0, 10) : null, created_by: req.user!.id,
    });
    res.status(201).json(g);
  }));

  // GET /coach/challenge-groups — C10
  r.get("/challenge-groups", coachOnly, asyncHandler(async (_req, res) => {
    res.json({ groups: await store.listChallengeGroups() });
  }));

  // POST /coach/challenge-groups/:id/assign — C10: add customer to group
  r.post("/challenge-groups/:id/assign", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id } = req.body ?? {};
    if (!user_id) throw badRequest("user_id is required.", { field: "user_id" });
    const ok = await store.addChallengeGroupMember(req.params.id, String(user_id));
    if (!ok) throw notFound("Challenge group not found.");
    await audit(store, { actorId: req.user!.id, action: "challenge.assign", entity: "challenge_group", entityId: req.params.id, ip: clientIp(req) });
    res.status(201).json({ ok: true });
  }));

  // POST /coach/customers/:id/badges — C11: award badge
  r.post("/customers/:id/badges", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { badge } = req.body ?? {};
    if (!badge || !/^[a-z0-9_]{2,40}$/.test(String(badge))) throw badRequest("badge must be a 2-40 char slug.", { field: "badge" });
    const b = await store.awardBadge(req.params.id, String(badge), req.user!.id);
    res.status(201).json(b);
  }));

  // GET /coach/customers/:id/badges — C11
  r.get("/customers/:id/badges", coachOnly, asyncHandler(async (req, res) => {
    res.json({ badges: await store.listBadges(req.params.id) });
  }));

  // POST /coach/customers/:id/sessions — C12: session summary
  r.post("/customers/:id/sessions", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { summary } = req.body ?? {};
    if (!summary || !String(summary).trim()) throw badRequest("summary is required.", { field: "summary" });
    const s = await store.addSessionSummary(req.user!.id, req.params.id, String(summary).slice(0, 2000));
    res.status(201).json(s);
  }));

  // GET /coach/customers/:id/sessions — C12
  r.get("/customers/:id/sessions", coachOnly, asyncHandler(async (req, res) => {
    res.json({ sessions: await store.listSessionSummaries(req.params.id) });
  }));

  // POST /coach/customers/:id/goals — C13
  r.post("/customers/:id/goals", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, target_date } = req.body ?? {};
    if (!title_en || !String(title_en).trim()) throw badRequest("title_en is required.", { field: "title_en" });
    const g = await store.createCustomerGoal(req.user!.id, req.params.id, {
      title_en: String(title_en).slice(0, 200), title_ne: title_ne ? String(title_ne).slice(0, 200) : null,
      target_date: target_date ? String(target_date).slice(0, 10) : null,
    });
    res.status(201).json(g);
  }));

  // GET /coach/customers/:id/goals — C13
  r.get("/customers/:id/goals", coachOnly, asyncHandler(async (req, res) => {
    res.json({ goals: await store.listCustomerGoals(req.params.id) });
  }));

  // PATCH /coach/goals/:id/complete — C13
  r.patch("/goals/:id/complete", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const g = await store.completeCustomerGoal(req.params.id, req.user!.id);
    if (!g) throw notFound("Goal not found.");
    res.json(g);
  }));

  // DELETE /coach/goals/:id — C13
  r.delete("/goals/:id", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteCustomerGoal(req.params.id, req.user!.id);
    if (!ok) throw notFound("Goal not found.");
    res.json({ ok: true });
  }));

  // POST /coach/habit-templates — C14
  r.post("/habit-templates", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, description_en, description_ne } = req.body ?? {};
    if (!title_en || !String(title_en).trim()) throw badRequest("title_en is required.", { field: "title_en" });
    const t = await store.createHabitTemplate({
      title_en: String(title_en).slice(0, 200), title_ne: title_ne ? String(title_ne).slice(0, 200) : null,
      description_en: description_en ? String(description_en).slice(0, 1000) : null,
      description_ne: description_ne ? String(description_ne).slice(0, 1000) : null, created_by: req.user!.id,
    });
    res.status(201).json(t);
  }));

  // GET /coach/habit-templates — C14
  r.get("/habit-templates", coachOnly, asyncHandler(async (_req, res) => {
    res.json({ templates: await store.listHabitTemplates() });
  }));

  // DELETE /coach/habit-templates/:id — C14
  r.delete("/habit-templates/:id", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteHabitTemplate(req.params.id);
    if (!ok) throw notFound("Template not found.");
    res.json({ ok: true });
  }));

  // PATCH /coach/habit-templates/:id — C14: update template
  r.patch("/habit-templates/:id", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, description_en, description_ne } = req.body ?? {};
    const patch: { title_en?: string; title_ne?: string | null; description_en?: string | null; description_ne?: string | null } = {};
    if (title_en !== undefined) {
      if (!String(title_en).trim()) throw badRequest("title_en cannot be empty.", { field: "title_en" });
      patch.title_en = String(title_en).slice(0, 200);
    }
    if (title_ne !== undefined) patch.title_ne = title_ne ? String(title_ne).slice(0, 200) : null;
    if (description_en !== undefined) patch.description_en = description_en ? String(description_en).slice(0, 1000) : null;
    if (description_ne !== undefined) patch.description_ne = description_ne ? String(description_ne).slice(0, 1000) : null;
    const t = await store.updateHabitTemplate(req.params.id, patch);
    if (!t) throw notFound("Template not found.");
    res.json(t);
  }));

  // POST /coach/digest/preview — C15: weekly digest preview (counts only, no send)
  r.post("/digest/preview", coachOnly, asyncHandler(async (_req, res) => {
    const flags = await store.coachRiskFlags();
    res.json({ at_risk_count: flags.length, at_risk: flags.slice(0, 50) });
  }));

  // POST /coach/digest/send — C15: push weekly digest to at-risk customers' inboxes
  r.post("/digest/send", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { headline_en, headline_ne, body_en, body_ne } = req.body ?? {};
    if (!headline_en || !String(headline_en).trim()) throw badRequest("headline_en is required.", { field: "headline_en" });
    const flags = await store.coachRiskFlags();
    let sent = 0;
    for (const f of flags) {
      await store.createNotification({
        user_id: f.user_id, type: "weekly_digest",
        title_en: String(headline_en).slice(0, 200),
        title_ne: headline_ne ? String(headline_ne).slice(0, 200) : null,
        body_en: body_en ? String(body_en).slice(0, 1000) : "Your weekly hair-health check-in is ready.",
        body_ne: body_ne ? String(body_ne).slice(0, 1000) : null,
        link: "/home",
      });
      sent++;
    }
    await audit(store, { actorId: req.user!.id, action: "digest.send", entity: "digest", entityId: "weekly", ip: clientIp(req) });
    res.json({ sent });
  }));

  // POST /coach/note-templates — C16
  r.post("/note-templates", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title, body_en, body_ne } = req.body ?? {};
    if (!title || !body_en) throw badRequest("title and body_en are required.", { field: "title" });
    const t = await store.createNoteTemplate(req.user!.id, {
      title: String(title).slice(0, 120), body_en: String(body_en).slice(0, 2000),
      body_ne: body_ne ? String(body_ne).slice(0, 2000) : null,
    });
    res.status(201).json(t);
  }));

  // GET /coach/note-templates — C16
  r.get("/note-templates", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ templates: await store.listNoteTemplates(req.user!.id) });
  }));

  // DELETE /coach/note-templates/:id — C16
  r.delete("/note-templates/:id", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteNoteTemplate(req.params.id, req.user!.id);
    if (!ok) throw notFound("Template not found.");
    res.json({ ok: true });
  }));

  // PATCH /coach/note-templates/:id — C16: update template (owner only)
  r.patch("/note-templates/:id", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title, body_en, body_ne } = req.body ?? {};
    const patch: { title?: string; body_en?: string; body_ne?: string | null } = {};
    if (title !== undefined) {
      if (!String(title).trim()) throw badRequest("title cannot be empty.", { field: "title" });
      patch.title = String(title).slice(0, 120);
    }
    if (body_en !== undefined) {
      if (!String(body_en).trim()) throw badRequest("body_en cannot be empty.", { field: "body_en" });
      patch.body_en = String(body_en).slice(0, 2000);
    }
    if (body_ne !== undefined) patch.body_ne = body_ne ? String(body_ne).slice(0, 2000) : null;
    const t = await store.updateNoteTemplate(req.params.id, req.user!.id, patch);
    if (!t) throw notFound("Template not found.");
    res.json(t);
  }));

  // GET /coach/risk-flags — C17
  r.get("/risk-flags", coachOnly, asyncHandler(async (_req, res) => {
    res.json({ flags: await store.coachRiskFlags() });
  }));

  // POST /coach/articles/:id/assign — C18: assign article to customer (with inbox item)
  r.post("/articles/:id/assign", coachOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id } = req.body ?? {};
    if (!user_id) throw badRequest("user_id is required.", { field: "user_id" });
    const a = await store.assignArticle(req.params.id, String(user_id), req.user!.id);
    await store.createNotification({
      user_id: String(user_id), type: "article_assigned",
      title_en: "Your coach shared an article with you",
      title_ne: "तपाईंको कोचले लेख पठाउनुभयो",
      body_en: "Tap to read it in the Learn section.",
      body_ne: "पढ्नका लागि थिच्नुहोस्।",
      link: "/learn",
    });
    res.status(201).json(a);
  }));

  /* ---------------- Batch 3 (009): C19–C27 ---------------- */

  // GET /coach/leaderboard (C19) — opt-in only, anonymized display
  r.get("/leaderboard", requireCoach, asyncHandler(async (req, res) => {
    const raw = req.query.limit;
    const limit = raw === undefined ? 10 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw badRequest("Request failed validation.", { field: "limit" });
    }
    res.json({ leaderboard: await store.streakLeaderboard(limit) });
  }));

  // GET /coach/escalations/sla (C20) — degraded by design: escalations has no
  // acknowledged_at/resolved_at columns, so both fields are null. Do not treat
  // them as measured times.
  r.get("/escalations/sla", requireCoach, asyncHandler(async (_req, res) => {
    res.json({ sla: await store.escalationSla() });
  }));

  // POST /coach/nudges/recurring (C21)
  r.post("/nudges/recurring", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id, message_en, message_ne, send_at, recurrence } = req.body ?? {};
    if (!user_id) throw badRequest("Request failed validation.", { field: "user_id" });
    const target = await store.getUserById(String(user_id));
    if (!target) throw notFound("Not found.");
    const msg = typeof message_en === "string" ? message_en.trim() : "";
    if (!msg) throw badRequest("Request failed validation.", { field: "message_en" });
    if (msg.length > 500) throw badRequest("Request failed validation.", { field: "message_en" });
    const sendAt = new Date(String(send_at));
    if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() <= Date.now()) {
      throw badRequest("Request failed validation.", { field: "send_at" });
    }
    if (recurrence !== "daily" && recurrence !== "weekly") {
      throw badRequest("Request failed validation.", { field: "recurrence" });
    }
    const nudge = await store.createRecurringNudge({
      coach_id: req.user!.id, user_id: String(user_id), message_en: msg,
      message_ne: typeof message_ne === "string" && message_ne.trim() ? message_ne.trim().slice(0, 500) : null,
      send_at: sendAt.toISOString(), recurrence,
    });
    await audit(store, { actorId: req.user!.id, action: "nudge.recurring.schedule", entity: "scheduled_nudge", entityId: nudge.id, ip: clientIp(req) });
    res.status(201).json({ nudge });
  }));

  // GET /coach/satisfaction/trend (C22)
  r.get("/satisfaction/trend", requireCoach, asyncHandler(async (_req, res) => {
    res.json({ trend: await store.satisfactionTrend() });
  }));

  // GET /coach/customers/:id/progress-compare (C23) — degraded: compares
  // customer-reported shedding_estimate from earliest vs latest checkin. No
  // assignment concept exists on this side, so any coach may view it.
  r.get("/customers/:id/progress-compare", requireCoach, asyncHandler(async (req, res) => {
    const target = await store.getUserById(req.params.id);
    if (!target) throw notFound("Not found.");
    res.json(await store.progressCompare(req.params.id));
  }));

  // GET /coach/customers/:id/onboarding (C24)
  r.get("/customers/:id/onboarding", requireCoach, asyncHandler(async (req, res) => {
    res.json({ checklist: await store.getOnboardingChecklist(req.params.id) });
  }));

  // PATCH /coach/customers/:id/onboarding (C24)
  r.patch("/customers/:id/onboarding", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const steps = req.body?.steps;
    if (!Array.isArray(steps)) throw badRequest("Request failed validation.", { field: "steps" });
    const clean = steps.map((s) => {
      const key = typeof s?.key === "string" ? s.key.trim().slice(0, 100) : "";
      if (!key) throw badRequest("Request failed validation.", { field: "steps" });
      return { key, done: s.done === true };
    });
    const row = await store.saveOnboardingChecklist(req.params.id, clean);
    await audit(store, { actorId: req.user!.id, action: "coach.onboarding", entity: "onboarding_checklist", entityId: row.id, ip: clientIp(req) });
    res.json({ checklist: row });
  }));

  // GET /coach/missed-checkins (C25)
  r.get("/missed-checkins", requireCoach, asyncHandler(async (req, res) => {
    const raw = req.query.days;
    const days = raw === undefined ? 7 : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw badRequest("Request failed validation.", { field: "days" });
    }
    res.json({ missed: await store.missedCheckins(days) });
  }));

  // GET /coach/availability (C26)
  r.get("/availability", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ availability: await store.getCoachAvailability(req.user!.id) });
  }));

  // PUT /coach/availability (C26)
  r.put("/availability", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { status, note } = req.body ?? {};
    if (status !== "available" && status !== "on_leave") {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    const row = await store.setCoachAvailability(
      req.user!.id, status,
      typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
    );
    res.json({ availability: row });
  }));

  // GET /coach/customers/:id/adherence-detail (C27) — degraded by design:
  // progress_checkins has no habit column, so rows are checkin-dimension
  // proxies over the last 30 days, not habit-level adherence.
  r.get("/customers/:id/adherence-detail", requireCoach, asyncHandler(async (req, res) => {
    const target = await store.getUserById(req.params.id);
    if (!target) throw notFound("Not found.");
    res.json({ detail: await store.adherenceDetail(req.params.id) });
  }));

  /* ---------------- Batch 4 (010): C28–C45 ---------------- */

  // C28 — certificate data for a completed challenge assignment. The coach
  // must own the challenge (created_by); admins may view any. The Store
  // contract has no single-assignment lookup, so customers' assignment lists
  // are scanned and we stop at the first match (fine at this scale).
  r.get("/challenges/assignments/:id/certificate", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const assignmentId = req.params.id;
    const users = (await store.listUsers()).filter((u) => u.role === "customer");
    let found: (ChallengeAssignment & { challenge: Challenge | null }) | null = null;
    for (const u of users) {
      const rows = await store.listChallengeAssignments(u.id);
      const row = rows.find((a) => a.id === assignmentId);
      if (row) { found = row; break; }
    }
    if (!found) throw notFound("Not found.");
    const challenge = found.challenge
      ?? (await store.listChallenges()).find((c) => c.id === found!.challenge_id)
      ?? null;
    if (!challenge) throw notFound("Not found.");
    if (req.user!.role !== "admin" && challenge.created_by !== req.user!.id) {
      throw forbidden("Only the coach who created this challenge can view its certificates.");
    }
    if (!found.completed_at) throw conflict("This challenge is not completed yet.");
    const profile = await store.getProfile(found.user_id);
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

  // C29 — feedback aggregate for the logged-in coach ONLY (avg + count).
  // Individual rows are never returned to the coach.
  r.get("/feedback", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ feedback: await store.getCoachFeedbackAggregate(req.user!.id) });
  }));

  // C30 — streak freeze: at most ONE per customer per calendar month (409).
  r.post("/customers/:id/streak-freeze", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { frozen_date } = req.body ?? {};
    if (typeof frozen_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(frozen_date)) {
      throw badRequest("Request failed validation.", { field: "frozen_date" });
    }
    const target = await store.getUserById(req.params.id);
    if (!target) throw notFound("Not found.");
    const month = frozen_date.slice(0, 7);
    const existing = await store.listStreakFreezes(req.params.id, month);
    if (existing.length > 0) {
      throw conflict("Only one streak freeze per customer per calendar month.", { field: "frozen_date" });
    }
    const row = await store.createStreakFreeze({ customer_id: req.params.id, coach_id: req.user!.id, frozen_date });
    await audit(store, { actorId: req.user!.id, action: "coach.streak_freeze", entity: "streak_freeze", entityId: row.id, ip: clientIp(req) });
    res.status(201).json({ freeze: row });
  }));

  // C31 — nudge stats for the logged-in coach. Honest degradation:
  // scheduled_nudges records sent_at only — there is no open/read/delivery
  // tracking, so open rates cannot be measured. We report sent vs pending and
  // say so in the response.
  r.get("/nudges/stats", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const nudges = await store.listScheduledNudges(req.user!.id);
    const sent = nudges.filter((n) => n.sent_at).length;
    res.json({
      stats: {
        total: nudges.length,
        sent,
        pending: nudges.length - sent,
        open_rate: null,
        note: "Open rates are not tracked — scheduled_nudges records sent_at only.",
      },
    });
  }));

  // C32 — customer tags (coach-scoped, idempotent add).
  r.get("/customers/:id/tags", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ tags: await store.listCustomerTags(req.user!.id, req.params.id) });
  }));

  r.post("/customers/:id/tags", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { tag } = req.body ?? {};
    const clean = typeof tag === "string" ? tag.trim() : "";
    if (!clean) throw badRequest("Request failed validation.", { field: "tag" });
    if (clean.length > 60) throw badRequest("Request failed validation.", { field: "tag" });
    const row = await store.addCustomerTag(req.user!.id, req.params.id, clean);
    res.status(201).json({ tag: row });
  }));

  r.delete("/customers/:id/tags", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { tag } = req.body ?? {};
    const clean = typeof tag === "string" ? tag.trim() : "";
    if (!clean) throw badRequest("Request failed validation.", { field: "tag" });
    await store.removeCustomerTag(req.user!.id, req.params.id, clean);
    res.json({ ok: true });
  }));

  // C33 — bulk nudge: one scheduled nudge to many customers. send_at is
  // required (consistent with C7); title_en/title_ne are folded into the
  // message body since scheduled_nudges has no title column.
  r.post("/nudges/bulk", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { customer_ids, title_en, title_ne, body_en, body_ne, send_at } = req.body ?? {};
    if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
      throw badRequest("Request failed validation.", { field: "customer_ids" });
    }
    if (customer_ids.length > 200) {
      throw badRequest("Request failed validation.", { field: "customer_ids" });
    }
    const body = typeof body_en === "string" ? body_en.trim() : "";
    if (!body) throw badRequest("Request failed validation.", { field: "body_en" });
    if (body.length > 500) throw badRequest("Request failed validation.", { field: "body_en" });
    const title = typeof title_en === "string" ? title_en.trim() : "";
    if (title.length > 200) throw badRequest("Request failed validation.", { field: "title_en" });
    const sendAt = new Date(String(send_at));
    if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() <= Date.now()) {
      throw badRequest("Request failed validation.", { field: "send_at" });
    }
    const message_en = title ? `${title}\n${body}` : body;
    const titleNe = typeof title_ne === "string" && title_ne.trim() ? title_ne.trim().slice(0, 200) : "";
    const bodyNe = typeof body_ne === "string" && body_ne.trim() ? body_ne.trim().slice(0, 500) : "";
    const message_ne = titleNe || bodyNe ? `${titleNe ? `${titleNe}\n` : ""}${bodyNe}`.trim().slice(0, 500) || null : null;
    const ids = [...new Set(customer_ids.map((id: unknown) => String(id)))];
    const targets: string[] = [];
    for (const id of ids) {
      const u = await store.getUserById(id);
      if (!u) throw notFound("Not found.");
      targets.push(u.id);
    }
    const created: unknown[] = [];
    for (const id of targets) {
      created.push(await store.scheduleNudge({
        coach_id: req.user!.id, user_id: id, message_en,
        message_ne, send_at: sendAt.toISOString(),
      }));
    }
    await audit(store, { actorId: req.user!.id, action: "nudge.bulk", entity: "scheduled_nudge", entityId: `bulk:${created.length}`, ip: clientIp(req) });
    res.status(201).json({ sent: created.length, nudges: created });
  }));

  // C34 — handover note when a customer moves between coaches.
  r.post("/customers/:id/handover", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { to_coach_id, note } = req.body ?? {};
    const clean = typeof note === "string" ? note.trim() : "";
    if (!clean) throw badRequest("Request failed validation.", { field: "note" });
    if (clean.length > 2000) throw badRequest("Request failed validation.", { field: "note" });
    const target = await store.getUserById(req.params.id);
    if (!target) throw notFound("Not found.");
    let toId: string | null = null;
    if (to_coach_id !== undefined && to_coach_id !== null && String(to_coach_id).trim() !== "") {
      const to = await store.getUserById(String(to_coach_id));
      if (!to) throw notFound("Not found.");
      if (to.role !== "coach" && to.role !== "admin") {
        throw badRequest("Request failed validation.", { field: "to_coach_id" });
      }
      toId = to.id;
    }
    const row = await store.createCoachHandover({
      customer_id: req.params.id, from_coach_id: req.user!.id, to_coach_id: toId, note: clean,
    });
    await audit(store, { actorId: req.user!.id, action: "coach.handover", entity: "coach_handover", entityId: row.id, ip: clientIp(req) });
    res.status(201).json({ handover: row });
  }));

  r.get("/customers/:id/handovers", requireCoach, asyncHandler(async (req, res) => {
    res.json({ handovers: await store.listCoachHandovers(req.params.id) });
  }));

  // C35 — customers with no check-in for 14+ days (reuses missedCheckins).
  r.get("/inactive", requireCoach, asyncHandler(async (_req, res) => {
    res.json({ inactive: await store.missedCheckins(14) });
  }));

  // C37 — this week's own activity: notes / nudges / escalations created
  // since Monday 00:00 UTC.
  r.get("/weekly-report", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ report: await store.getCoachWeeklyReport(req.user!.id) });
  }));

  // C38 — milestone timeline for a customer: badges, completed goals,
  // completed challenges (newest first).
  r.get("/customers/:id/milestones", requireCoach, asyncHandler(async (req, res) => {
    const target = await store.getUserById(req.params.id);
    if (!target) throw notFound("Not found.");
    res.json({ milestones: await store.listCustomerMilestones(req.params.id) });
  }));

  // C41 — computed journey stage for a customer (rule documented in the
  // store implementation: new | active | returning | dormant).
  r.get("/customers/:id/journey", requireCoach, asyncHandler(async (req, res) => {
    const target = await store.getUserById(req.params.id);
    if (!target) throw notFound("Not found.");
    res.json({ stage: await store.getJourneyStage(req.params.id) });
  }));

  // C42 — record the outcome of a resolved escalation.
  r.patch("/escalations/:id/outcome", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { outcome } = req.body ?? {};
    const clean = typeof outcome === "string" ? outcome.trim() : "";
    if (!clean) throw badRequest("Request failed validation.", { field: "outcome" });
    if (clean.length > 500) throw badRequest("Request failed validation.", { field: "outcome" });
    const esc = (await store.listEscalations()).find((e) => e.id === req.params.id);
    if (!esc) throw notFound("Not found.");
    if (esc.status !== "resolved") throw conflict("Outcomes can only be recorded on resolved escalations.");
    const updated = await store.setEscalationOutcome(req.params.id, clean);
    await audit(store, { actorId: req.user!.id, action: "coach.escalation_outcome", entity: "escalation", entityId: req.params.id, ip: clientIp(req) });
    res.json({ escalation: updated });
  }));

  // C43 — anonymized peer tips. Bodies containing phone-number-like or
  // email-like patterns are rejected (no patient data).
  const TIP_PII = [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /(?:^|[^0-9])(?:\+?[\d][\d\s\-()]{6,}[\d])(?:$|[^0-9])/];
  r.get("/tips", requireCoach, asyncHandler(async (_req, res) => {
    res.json({ tips: await store.listCoachTips() });
  }));

  r.post("/tips", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const { title, body } = req.body ?? {};
    const t = typeof title === "string" ? title.trim() : "";
    const b = typeof body === "string" ? body.trim() : "";
    if (!t) throw badRequest("Request failed validation.", { field: "title" });
    if (!b) throw badRequest("Request failed validation.", { field: "body" });
    if (t.length > 200 || b.length > 2000) throw badRequest("Request failed validation.", { field: "body" });
    if (TIP_PII.some((re) => re.test(t) || re.test(b))) {
      throw badRequest("Tips must not contain phone numbers or email addresses (no patient data).", { field: "body" });
    }
    const tip = await store.createCoachTip({ coach_id: req.user!.id, title: t, body: b });
    await audit(store, { actorId: req.user!.id, action: "coach.tip", entity: "coach_tip", entityId: tip.id, ip: clientIp(req) });
    res.status(201).json({ tip });
  }));

  r.delete("/tips/:id", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteCoachTip(req.params.id, req.user!.id);
    if (!ok) throw notFound("Not found.");
    res.json({ ok: true });
  }));

  // C45 — survey results for a challenge's assignments (coach must own the
  // challenge; admins may view any).
  r.get("/challenges/:id/surveys", requireCoach, asyncHandler(async (req: AuthedRequest, res) => {
    const challenge = (await store.listChallenges()).find((c) => c.id === req.params.id);
    if (!challenge) throw notFound("Not found.");
    if (req.user!.role !== "admin" && challenge.created_by !== req.user!.id) {
      throw forbidden("Only the coach who created this challenge can view its surveys.");
    }
    res.json({ surveys: await store.listChallengeSurveys(req.params.id) });
  }));

  return r;
}
