import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest } from "../../http";
import { requireAuth, type AuthedRequest } from "../../middleware/auth";

/**
 * P-6: in-app user notifications. Every authenticated user has their own
 * inbox; notifications are created by server-side hooks (case submitted,
 * plan approved, red flags resolved) — never by the client.
 */
export function notificationRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;
  r.use(requireAuth);

  // GET /notifications?limit=&offset= — own inbox, newest first
  r.get("/", asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 50);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
    const { notifications, unreadCount } = await store.listNotifications(req.user!.id, { limit, offset });
    res.json({ notifications, unread_count: unreadCount });
  }));

  // PATCH /notifications/:id/read — mark one as read (own only)
  r.patch("/:id/read", asyncHandler(async (req: AuthedRequest, res) => {
    const n = await store.markNotificationRead(req.params.id, req.user!.id);
    if (!n) throw badRequest("Not found.", { field: "id" });
    res.json({ notification: n });
  }));

  return r;
}
