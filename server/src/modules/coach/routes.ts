import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { buildNudges } from "../../lib/nudges";
import { weakestRoots, ROOTS, type RootKey } from "../scan/scoring";

export function coachRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireRole("customer", "coach"));

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

  return r;
}
