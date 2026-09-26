// P-8: offline sync — idempotent check-ins and server-wins deltas.
// POST /sync/checkins accepts an Idempotency-Key header; a retry with the
// same key/user/scope replays the ORIGINAL response and is marked with
// X-Idempotent-Replay. GET /sync/delta returns everything changed since a
// timestamp so devices can catch up; server state always wins conflicts.
import { Router } from "express";
import type { Request, Response } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";

const DELTA_LIMIT = 100;

export function syncRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;

  /** Runs fn once per (key, user, scope); replays the stored response on retry. */
  async function withIdempotency(
    req: Request, res: Response, scope: string, fn: () => Promise<unknown>,
  ): Promise<void> {
    const key = req.header("Idempotency-Key");
    if (key) {
      const existing = await store.getIdempotencyRecord(key, (req as AuthedRequest).user!.id, scope);
      if (existing) {
        res.set("X-Idempotent-Replay", "true");
        res.json(existing.response);
        return;
      }
    }
    const data = await fn();
    if (key) {
      await store.saveIdempotencyRecord({
        key, user_id: (req as AuthedRequest).user!.id, scope, response: data,
      });
    }
    res.status(201).json(data);
  }

  // POST /sync/checkins — idempotent progress check-in (201 first, replay after).
  r.post("/checkins", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    try {
      await withIdempotency(req, res, "checkin", async () => {
        const { plan_id, shedding_estimate, note, photo_ids } = req.body ?? {};
        if (plan_id !== undefined && plan_id !== null && typeof plan_id !== "string") {
          throw badRequest("plan_id must be a string.");
        }
        if (shedding_estimate !== undefined && shedding_estimate !== null &&
            (typeof shedding_estimate !== "number" || shedding_estimate < 0)) {
          throw badRequest("shedding_estimate must be a non-negative number.");
        }
        if (note !== undefined && note !== null && typeof note !== "string") {
          throw badRequest("note must be a string.");
        }
        if (photo_ids !== undefined && (!Array.isArray(photo_ids) ||
            photo_ids.some((p) => typeof p !== "string"))) {
          throw badRequest("photo_ids must be an array of strings.");
        }
        const checkin = await store.addCheckin({
          user_id: req.user!.id,
          plan_id: typeof plan_id === "string" ? plan_id : null,
          shedding_estimate: typeof shedding_estimate === "number" ? shedding_estimate : null,
          note: typeof note === "string" ? note : null,
          photo_ids: Array.isArray(photo_ids) ? photo_ids : undefined,
        });
        return { checkin };
      });
    } catch (e) {
      if (e instanceof Error && (e as { status?: number }).status) throw e;
      console.error("[sync] checkin failed:", e);
      res.status(500).json({ error: "checkin_failed", message: "Could not record the check-in." });
    }
  }));

  // GET /sync/delta?since=<ISO> — server-wins deltas for the customer's data.
  r.get("/delta", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const { since } = req.query;
    let sinceDate: Date | null = null;
    if (typeof since === "string" && since) {
      const d = new Date(since);
      if (!isNaN(d.getTime())) sinceDate = d;
    }
    const after = (row: { updated_at?: string; created_at?: string }) => {
      if (!sinceDate) return true;
      const t = new Date(row.updated_at ?? row.created_at ?? 0);
      return t.getTime() > sinceDate.getTime();
    };
    const userId = req.user!.id;
    const orders = (await store.listOrdersByUser(userId)).filter(after).slice(0, DELTA_LIMIT);
    const notifications = (await store.listNotifications(userId, { limit: DELTA_LIMIT, offset: 0 }))
      .notifications.filter(after);
    const checkins = (await store.listCheckins(userId)).filter(after).slice(0, DELTA_LIMIT);
    res.json({
      server_time: new Date().toISOString(),
      notice: "Server state wins; compare updated_at stamps against your device copies.",
      changes: { orders, notifications, checkins },
    });
  }));

  return r;
}
