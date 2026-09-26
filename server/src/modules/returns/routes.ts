// P-5: customer-visible returns & refunds lifecycle.
// Customer requests a return; admin/pharmacy triage it. Refunds are created
// separately (admin POST /admin/orders/:id/refund) and their lifecycle is
// exposed to the customer here.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, conflict, forbidden, clientIp } from "../../http";
import { requireRole, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import type { ReturnRequest, RefundStatus } from "../../db/types";

const RETURN_STATUSES = ["approved", "rejected", "picked_up", "completed"] as const;
const REFUND_STATUSES = ["pending", "approved", "rejected", "processed"] as const;
const OPEN_RETURN_STATUSES = ["requested", "approved"];

export function returnsRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;

  // POST /returns — customer requests a return for one of their orders.
  r.post("/", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    const { order_id, reason } = req.body ?? {};
    if (typeof order_id !== "string" || !order_id.trim()) throw badRequest("order_id is required.");
    if (typeof reason !== "string" || !reason.trim()) throw badRequest("reason is required.");
    const order = (await store.getOrder(order_id)) ?? (await store.getOrderByNo(order_id));
    if (!order) throw notFound("Order not found.");
    if (order.user_id !== req.user!.id) throw forbidden("This order is not yours.");
    const existing = await store.listReturnRequestsByUser(req.user!.id);
    const open = existing.find((x) => x.order_id === order.id && OPEN_RETURN_STATUSES.includes(x.status));
    if (open) throw conflict("A return request is already open for this order.", { return_id: open.id });
    const ret = await store.createReturnRequest({
      order_id: order.id, user_id: req.user!.id, reason: reason.trim(),
    });
    await audit(store, {
      actorId: req.user!.id, action: "return.request", entity: "return_request",
      entityId: ret.id, ip: clientIp(req),
    });
    res.status(201).json({ return_request: ret });
  }));

  // GET /returns — customer's own requests.
  r.get("/", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ return_requests: await store.listReturnRequestsByUser(req.user!.id) });
  }));

  // GET /returns/all — admin/pharmacy triage queue.
  r.get("/all", requireRole("admin", "pharmacy"), asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.query;
    const list = typeof status === "string" && status
      ? await store.listReturnRequests(status)
      : await store.listReturnRequests();
    res.json({ return_requests: list });
  }));

  // PATCH /returns/:id — admin/pharmacy triage decision.
  r.patch("/:id", requireRole("admin", "pharmacy"), asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.body ?? {};
    if (typeof status !== "string" || !(RETURN_STATUSES as readonly string[]).includes(status)) {
      throw badRequest("status must be one of: " + RETURN_STATUSES.join(", "));
    }
    const ret = await store.updateReturnRequest(req.params.id, {
      status: status as ReturnRequest["status"], decided_by: req.user!.id,
    });
    if (!ret) throw notFound("Return request not found.");
    await audit(store, {
      actorId: req.user!.id, action: `return.${status}`, entity: "return_request",
      entityId: ret.id, ip: clientIp(req),
    });
    res.json({ return_request: ret });
  }));

  // GET /returns/refunds — customer-visible refund lifecycle.
  r.get("/refunds", requireRole("customer"), asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ refunds: await store.listRefundsByUser(req.user!.id) });
  }));

  // PATCH /returns/refunds/:id — admin moves a refund through its lifecycle.
  r.patch("/refunds/:id", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.body ?? {};
    if (typeof status !== "string" || !(REFUND_STATUSES as readonly string[]).includes(status)) {
      throw badRequest("status must be one of: " + REFUND_STATUSES.join(", "));
    }
    const refund = await store.updateRefundStatus(req.params.id, status as RefundStatus, req.user!.id);
    if (!refund) throw notFound("Refund not found.");
    await audit(store, {
      actorId: req.user!.id, action: `refund.${status}`, entity: "refund",
      entityId: refund.id, ip: clientIp(req),
    });
    res.json({ refund });
  }));

  return r;
}
