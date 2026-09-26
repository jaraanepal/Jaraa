// P-15: shipment tracking — courier events on an order, and a merged
// order timeline (shipment events + refunds + return requests, oldest first).
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, notFound, forbidden, clientIp } from "../../http";
import { requireRole, requireAuth, type AuthedRequest } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import type { ShipmentEventType } from "../../db/types";

const EVENT_TYPES = [
  "packed", "shipped", "hub_arrival", "out_for_delivery", "delivered", "delayed", "failed",
] as const;

export function trackingRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;

  // owner, admin, or pharmacy may see the events of an order
  async function guard(req: AuthedRequest, orderId: string) {
    const order = (await store.getOrder(orderId)) ?? (await store.getOrderByNo(orderId));
    if (!order) throw notFound("Order not found.");
    const role = req.user!.role;
    if (role !== "admin" && role !== "pharmacy" && order.user_id !== req.user!.id) {
      throw forbidden("Not your order.");
    }
    return order;
  }

  // POST /tracking/orders/:id/events — admin/pharmacy append a courier event.
  r.post("/orders/:id/events", requireRole("admin", "pharmacy"),
    asyncHandler(async (req: AuthedRequest, res) => {
      const { event_type, label_en, label_ne, location } = req.body ?? {};
      if (typeof event_type !== "string" || !(EVENT_TYPES as readonly string[]).includes(event_type)) {
        throw badRequest("event_type must be one of: " + EVENT_TYPES.join(", "));
      }
      const order = (await store.getOrder(req.params.id)) ?? (await store.getOrderByNo(req.params.id));
      if (!order) throw notFound("Order not found.");
      const event = await store.addShipmentEvent(order.id, {
        event_type: event_type as ShipmentEventType,
        label_en: typeof label_en === "string" ? label_en : null,
        label_ne: typeof label_ne === "string" ? label_ne : null,
        location: typeof location === "string" ? location : null,
      });
      // Honest integration: mirror "delivered" onto the order, but never
      // fail the shipment event if the order update errors.
      if (event_type === "delivered") {
        try { await store.updateOrder(order.id, { status: "delivered" }); }
        catch (e) { console.error("[tracking] order delivered-status sync failed:", e); }
      }
      await audit(store, {
        actorId: req.user!.id, action: `shipment.${event_type}`, entity: "shipment_event",
        entityId: event.id, ip: clientIp(req),
      });
      res.status(201).json({ event });
    }));

  // GET /tracking/orders/:id/events — shipment events for an order.
  r.get("/orders/:id/events", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const order = await guard(req, req.params.id);
    res.json({ order_id: order.id, events: await store.listShipmentEvents(order.id) });
  }));

  // GET /tracking/orders/:id/timeline — merged, oldest first.
  r.get("/orders/:id/timeline", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const order = await guard(req, req.params.id);
    const [events, refunds, returns] = await Promise.all([
      store.listShipmentEvents(order.id),
      store.listRefundsByUser(order.user_id),
      store.listReturnRequestsByUser(order.user_id),
    ]);
    const timeline = [
      ...events.map((e) => ({ kind: "shipment" as const, ...e })),
      ...refunds.filter((x) => x.order_id === order.id)
        .map((x) => ({ kind: "refund" as const, ...x })),
      ...returns.filter((x) => x.order_id === order.id)
        .map((x) => ({ kind: "return" as const, ...x })),
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    res.json({ order_id: order.id, timeline });
  }));

  return r;
}
