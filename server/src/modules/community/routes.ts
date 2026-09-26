// P-12: community Q&A — customers ask, doctors answer, everyone sees a medical
// disclaimer. EVERY JSON response carries disclaimer_en + disclaimer_ne at the
// top level, nested with the payload under `data`.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, forbidden, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import type { QaQuestionStatus } from "../../db/types";

const MEDICAL_DISCLAIMER_EN =
  "Community answers are general information from doctors, not a diagnosis or personal medical advice. Please consult a qualified dermatologist for your own condition.";
const MEDICAL_DISCLAIMER_NE =
  "समुदायका उत्तरहरू चिकित्सकहरूबाट सामान्य जानकारी हुन्, निदान वा व्यक्तिगत चिकित्सा सल्लाह होइनन्। आफ्नै अवस्थाका लागि योग्य छाला रोग विशेषज्ञसँग परामर्श लिनुहोस्।";

const ALL_ROLES = ["customer", "doctor", "admin", "pharmacy", "coach"] as const;
const STATUSES: QaQuestionStatus[] = ["open", "answered", "flagged", "hidden"];
const PUBLIC_STATUSES: QaQuestionStatus[] = ["open", "answered"];

function wrap(res: { json: (b: unknown) => unknown }, data: Record<string, unknown>) {
  return res.json({ disclaimer_en: MEDICAL_DISCLAIMER_EN, disclaimer_ne: MEDICAL_DISCLAIMER_NE, data });
}

function pageParams(req: AuthedRequest): { limit: number; offset: number } {
  const rawLimit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  const rawOffset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw badRequest("Request failed validation.", { field: "limit" });
  }
  if (!Number.isInteger(rawOffset) || rawOffset < 0) {
    throw badRequest("Request failed validation.", { field: "offset" });
  }
  return { limit: rawLimit, offset: rawOffset };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function communityRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole(...ALL_ROLES));

  const adminOnly = requireRole("admin");
  const doctorOnly = requireRole("doctor");
  const customerOnly = requireRole("customer");

  function visibleStatus(q: { status: string }, role: string): boolean {
    return role === "admin" || PUBLIC_STATUSES.includes(q.status as QaQuestionStatus);
  }

  // POST /community/questions (customer) — ask a question
  r.post("/questions", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const title = str(req.body?.title).trim();
    const body = str(req.body?.body).trim();
    if (title.length < 5 || title.length > 200) throw badRequest("Request failed validation.", { field: "title" });
    if (body.length < 10 || body.length > 5000) throw badRequest("Request failed validation.", { field: "body" });
    const q = await store.createQaQuestion(req.user!.id, title, body);
    res.status(201);
    return wrap(res, { question: q });
  }));

  // GET /community/questions — non-admins see only open/answered
  r.get("/questions", asyncHandler(async (req: AuthedRequest, res) => {
    const { limit, offset } = pageParams(req);
    const isAdmin = req.user!.role === "admin";
    const requested = req.query.status === undefined ? undefined : String(req.query.status);
    if (requested !== undefined && !STATUSES.includes(requested as QaQuestionStatus)) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    if (isAdmin) {
      const { questions, total } = await store.listQaQuestions({
        status: requested, limit, offset,
      });
      return wrap(res, { questions, total });
    }
    if (requested !== undefined && !PUBLIC_STATUSES.includes(requested as QaQuestionStatus)) {
      throw forbidden("This status is not visible to you.");
    }
    // non-admin: only open + answered, merged and re-paginated
    const want = requested ? [requested as QaQuestionStatus] : PUBLIC_STATUSES;
    const merged: Awaited<ReturnType<typeof store.listQaQuestions>>["questions"] = [];
    let total = 0;
    for (const s of want) {
      // fetch enough to paginate after merging (fine at this scale)
      const page = await store.listQaQuestions({ status: s, limit: offset + limit, offset: 0 });
      total += page.total;
      merged.push(...page.questions);
    }
    merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return wrap(res, { questions: merged.slice(offset, offset + limit), total });
  }));

  // GET /community/questions/:id — question + answers; hidden/flagged 404 for non-admin
  r.get("/questions/:id", asyncHandler(async (req: AuthedRequest, res) => {
    const q = await store.getQaQuestion(req.params.id);
    if (!q || !visibleStatus(q, req.user!.role)) throw notFound("Not found.");
    const answers = await store.listQaAnswers(q.id);
    return wrap(res, { question: q, answers });
  }));

  // POST /community/questions/:id/answers (doctor) — answer + mark answered
  r.post("/questions/:id/answers", doctorOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const q = await store.getQaQuestion(req.params.id);
    if (!q || !visibleStatus(q, req.user!.role)) throw notFound("Not found.");
    const body = str(req.body?.body).trim();
    if (body.length < 10 || body.length > 5000) throw badRequest("Request failed validation.", { field: "body" });
    const answer = await store.createQaAnswer(q.id, req.user!.id, body);
    await store.updateQaQuestionStatus(q.id, "answered");
    res.status(201);
    return wrap(res, { answer });
  }));

  // POST /community/answers/:id/agree (doctor) — idempotent peer agreement.
  // A repeat agree by the same doctor is a no-op success (200), not a 404:
  // agreeQaAnswer returns false when the agree already exists, and this
  // endpoint is documented as idempotent, so success is always reported.
  r.post("/answers/:id/agree", doctorOnly, asyncHandler(async (req: AuthedRequest, res) => {
    await store.agreeQaAnswer(req.params.id, req.user!.id);
    return wrap(res, { agreed: true });
  }));

  // POST /community/answers/:id/helpful (any authed)
  r.post("/answers/:id/helpful", asyncHandler(async (req: AuthedRequest, res) => {
    const { helpful } = req.body ?? {};
    if (typeof helpful !== "boolean") throw badRequest("Request failed validation.", { field: "helpful" });
    await store.setQaHelpful(req.params.id, req.user!.id, helpful);
    return wrap(res, { helpful });
  }));

  // POST /community/flag (any authed) — exactly one target
  r.post("/flag", asyncHandler(async (req: AuthedRequest, res) => {
    const questionId = req.body?.question_id !== undefined && req.body?.question_id !== null
      ? String(req.body.question_id) : null;
    const answerId = req.body?.answer_id !== undefined && req.body?.answer_id !== null
      ? String(req.body.answer_id) : null;
    const reason = str(req.body?.reason).trim();
    if ((questionId ? 1 : 0) + (answerId ? 1 : 0) !== 1) {
      throw badRequest("Exactly one of question_id or answer_id is required.", { field: "question_id" });
    }
    if (reason.length < 5 || reason.length > 500) throw badRequest("Request failed validation.", { field: "reason" });
    const flag = await store.flagQaContent({
      question_id: questionId, answer_id: answerId, user_id: req.user!.id, reason,
    });
    res.status(201);
    return wrap(res, { flag });
  }));

  // GET /community/flags (admin) — moderation queue
  r.get("/flags", adminOnly, asyncHandler(async (req: AuthedRequest, res) => {
    return wrap(res, { flags: await store.listQaFlags() });
  }));

  // PATCH /community/questions/:id/status (admin) — moderation
  r.patch("/questions/:id/status", adminOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const status = str(req.body?.status);
    if (!STATUSES.includes(status as QaQuestionStatus)) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    const q = await store.updateQaQuestionStatus(req.params.id, status as QaQuestionStatus);
    if (!q) throw notFound("Not found.");
    await audit(store, {
      actorId: req.user!.id, action: "qa.status", entity: "qa_question",
      entityId: q.id, ip: clientIp(req), detail: status,
    });
    return wrap(res, { question: q });
  }));

  return r;
}
