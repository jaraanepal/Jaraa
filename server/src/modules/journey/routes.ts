// P-17: milestones + coach messaging. Customers talk to coaches through their
// own thread (/thread); coaches/admins work the inbox (/threads/:id).
// Customers may ONLY use the /thread endpoints — the /threads/:id routes are
// coach/admin only.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";

const ALL_ROLES = ["customer", "doctor", "admin", "pharmacy", "coach"] as const;

function optStr(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

export function journeyRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole(...ALL_ROLES));

  const adminOnly = requireRole("admin");
  const coachStaff = requireRole("admin", "coach");
  const customerOnly = requireRole("customer");

  /* ---------------- milestones ---------------- */

  // POST /journey/milestones (admin)
  r.post("/milestones", adminOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { title_en, title_ne, title_ro, description_en, description_ne, kind, threshold } = req.body ?? {};
    const title = typeof title_en === "string" ? title_en.trim() : "";
    if (!title) throw badRequest("Request failed validation.", { field: "title_en" });
    const th = threshold === undefined || threshold === null ? null : Number(threshold);
    if (th !== null && (!Number.isFinite(th) || th < 0)) {
      throw badRequest("Request failed validation.", { field: "threshold" });
    }
    const milestone = await store.createMilestone({
      title_en: title.slice(0, 200),
      title_ne: optStr(title_ne, 200),
      title_ro: optStr(title_ro, 200),
      description_en: optStr(description_en, 2000),
      description_ne: optStr(description_ne, 2000),
      kind: typeof kind === "string" && kind.trim() ? kind.trim().slice(0, 100) : "custom",
      threshold: th,
      created_by: req.user!.id,
    });
    await audit(store, {
      actorId: req.user!.id, action: "milestone.create", entity: "milestone",
      entityId: milestone.id, ip: clientIp(req),
    });
    res.status(201).json({ milestone });
  }));

  // GET /journey/milestones (admin,coach)
  r.get("/milestones", coachStaff, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ milestones: await store.listMilestones(false) });
  }));

  // POST /journey/milestones/:id/award (admin,coach) — 409 if already awarded
  r.post("/milestones/:id/award", coachStaff, asyncHandler(async (req: AuthedRequest, res) => {
    const { user_id } = req.body ?? {};
    if (!user_id || typeof user_id !== "string") throw badRequest("Request failed validation.", { field: "user_id" });
    const target = await store.getUserById(user_id);
    if (!target) throw notFound("User not found.");
    const awarded = await store.awardMilestone(req.params.id, target.id);
    if (!awarded) throw conflict("Milestone not found, or it was already awarded to this user.");
    await audit(store, {
      actorId: req.user!.id, action: "milestone.award", entity: "user_milestone",
      entityId: awarded.id, ip: clientIp(req), detail: `${req.params.id} -> ${target.id}`,
    });
    res.status(201).json({ milestone: awarded });
  }));

  // GET /journey/mine (customer) — full milestone list merged with achievements
  r.get("/mine", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const all = await store.listMilestones(true);
    const achieved = await store.listUserMilestones(req.user!.id);
    const byMilestone = new Map<string, string>();
    for (const um of achieved) {
      if (um.milestone_id) byMilestone.set(um.milestone_id, um.achieved_at);
    }
    res.json({
      milestones: all.map((m) => ({
        milestone: m,
        achieved_at: byMilestone.get(m.id) ?? null,
      })),
    });
  }));

  /* ---------------- coach messaging ---------------- */

  // GET /journey/thread (customer) — own thread, created on first use
  r.get("/thread", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ thread: await store.getOrCreateCoachThread(req.user!.id) });
  }));

  // POST /journey/thread/messages (customer)
  r.post("/thread/messages", customerOnly, asyncHandler(async (req: AuthedRequest, res) => {
    const { body, client_message_id } = req.body ?? {};
    const text = typeof body === "string" ? body.trim() : "";
    if (!text || text.length > 2000) throw badRequest("Request failed validation.", { field: "body" });
    const thread = await store.getOrCreateCoachThread(req.user!.id);
    const message = await store.sendCoachMessage(
      thread.id, req.user!.id, "customer", text,
      typeof client_message_id === "string" && client_message_id ? client_message_id.slice(0, 100) : null,
    );
    res.status(201).json({ message });
  }));

  // access check for the inbox routes: admin may open any thread; a coach may
  // open threads assigned to them plus the unassigned pool (their visible inbox).
  async function inboxThread(req: AuthedRequest, threadId: string) {
    if (req.user!.role === "admin") return threadId;
    const inbox = await store.listCoachThreads(req.user!.id);
    const hit = inbox.find((t) => t.id === threadId);
    if (!hit) throw notFound("Not found.");
    return hit.id;
  }

  // GET /journey/threads (coach,admin) — inbox
  r.get("/threads", coachStaff, asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ threads: await store.listCoachThreads(req.user!.id) });
  }));

  // GET /journey/threads/:id/messages (coach,admin)
  r.get("/threads/:id/messages", coachStaff, asyncHandler(async (req: AuthedRequest, res) => {
    const threadId = await inboxThread(req, req.params.id);
    res.json({ messages: await store.listCoachMessages(threadId) });
  }));

  // POST /journey/threads/:id/messages (coach,admin)
  r.post("/threads/:id/messages", coachStaff, asyncHandler(async (req: AuthedRequest, res) => {
    const { body, client_message_id } = req.body ?? {};
    const text = typeof body === "string" ? body.trim() : "";
    if (!text || text.length > 2000) throw badRequest("Request failed validation.", { field: "body" });
    const threadId = await inboxThread(req, req.params.id);
    const message = await store.sendCoachMessage(
      threadId, req.user!.id, req.user!.role, text,
      typeof client_message_id === "string" && client_message_id ? client_message_id.slice(0, 100) : null,
    );
    res.status(201).json({ message });
  }));

  return r;
}
