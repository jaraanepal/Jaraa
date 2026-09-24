import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Deps } from "../../deps";
import {
  asyncHandler, badRequest, notFound, conflict, clientIp, featureDisabled,
} from "../../http";
import { requireAuth, requireRole, type AuthedRequest } from "../../middleware/auth";
import { featureEnabled } from "../../middleware/flags";
import { audit } from "../../lib/audit";
import { providerFor } from "../../lib/payments";
import { sendEmail, orderConfirmationEmail, orderShippedEmail } from "../../lib/brevo";
import type { Kit, Product, Order } from "../../db/types";

const ORDER_METHODS = ["esewa", "khalti", "cod"];
const FULFIL_STATUSES = ["pending", "paid", "fulfilling", "shipped", "delivered", "cancelled", "refunded"];

// contract status names vs DB order_status enum
function toContractStatus(s: string): string {
  if (s === "pending") return "pending_payment";
  if (s === "fulfilling") return "packed";
  return s;
}
function fromContractStatus(s: string): string {
  if (s === "pending_payment") return "pending";
  if (s === "packed") return "fulfilling";
  return s;
}
// Contract Order.id is the human-readable order_no (e.g. JR-20260924-0007);
// resolve accepts either the UUID or the order_no.
async function resolveOrder(store: Deps["store"], param: string) {
  return (await store.getOrder(param)) ?? (await store.getOrderByNo(param));
}

function toContractProduct(p: Product) {
  return {
    id: p.id, name: p.name_en, kind: p.kind, price_npr: p.price_npr,
    image_url: p.image_url, is_active: p.is_active,
  };
}

function kitHasPrescription(kit: Kit, products: Map<string, Product>): boolean {
  return kit.product_ids.some((id) => products.get(id)?.kind === "prescription");
}

export function shopRoutes(deps: Deps): Router {
  const r = Router();
  const { store } = deps;

  /** Kits visible under the current prescription_commerce flag. */
  async function visibleKits(activeOnly: boolean) {
    const rxOff = !(await featureEnabled(store, "prescription_commerce"));
    const kits = await store.listKits(activeOnly);
    const products = new Map((await store.listProducts({ activeOnly: false, cosmeticOnly: false })).map((p) => [p.id, p]));
    const out = [];
    for (const kit of kits) {
      const kitProducts = kit.product_ids
        .map((id) => products.get(id))
        .filter((p): p is Product => !!p && p.is_active && (!rxOff || p.kind === "cosmetic"));
      if (rxOff && kitHasPrescription(kit, products) && kitProducts.length === 0) continue; // rx-only kit hidden
      out.push({
        id: kit.id, name: kit.name_en, description: kit.name_ne,
        total_npr: kit.total_npr, is_active: kit.is_active,
        category: kit.category, images: kit.images,
        whats_included: kit.whats_included, usage_instructions: kit.usage_instructions,
        stock: kit.stock,
        products: kitProducts.map(toContractProduct),
      });
    }
    return out;
  }

  // GET /kits — public catalog (cosmetic only while prescription_commerce OFF)
  r.get("/kits", asyncHandler(async (_req, res) => {
    const activeOnly = _req.query.active_only !== "false";
    res.json({ kits: await visibleKits(activeOnly) });
  }));

  // GET /kits/:id — direct access: 403 if rx items while flag OFF
  r.get("/kits/:id", asyncHandler(async (req, res) => {
    const kit = await store.getKit(req.params.id);
    if (!kit || !kit.is_active) throw notFound("Not found.");
    const products = new Map((await store.listProducts({ activeOnly: false, cosmeticOnly: false })).map((p) => [p.id, p]));
    const rxOff = !(await featureEnabled(store, "prescription_commerce"));
    const kitProducts = kit.product_ids
      .map((id) => products.get(id))
      .filter((p): p is Product => !!p && p.is_active && (!rxOff || p.kind === "cosmetic"));
    if (rxOff && kitHasPrescription(kit, products) && kitProducts.length === 0) {
      // rx-only kit: nothing legal to show -> direct access is forbidden
      throw featureDisabled("Prescription items are disabled until the medical partnership is in place.",
        { kit_id: kit.id });
    }
    res.json({
      id: kit.id, name: kit.name_en, description: kit.name_ne,
      total_npr: kit.total_npr, is_active: kit.is_active,
      category: kit.category, images: kit.images,
      whats_included: kit.whats_included, usage_instructions: kit.usage_instructions,
      stock: kit.stock,
      products: kitProducts.map(toContractProduct),
    });
  }));

  function toContractOrder(o: Order) {
    return {
      id: o.order_no, user_id: o.user_id, kit_id: o.kit_id,
      status: toContractStatus(o.status),
      subtotal_npr: o.subtotal_npr, shipping_npr: o.shipping_npr, total_npr: o.total_npr,
      payment_method: o.payment_method, idempotency_key: o.idempotency_key,
      created_at: o.created_at,
    };
  }

  function orderNo(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `JR-${ymd}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  // POST /orders — idempotent order creation
  r.post("/orders", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const idemKey = req.headers["idempotency-key"] as string | undefined;
    if (!idemKey) throw badRequest("Idempotency-Key header is required.");
    const { kit_id, payment_method, shipping_address } = req.body ?? {};
    if (!kit_id || !ORDER_METHODS.includes(payment_method)) {
      throw badRequest("Request failed validation.", { field: !kit_id ? "kit_id" : "payment_method" });
    }
    const addr = shipping_address ?? {};
    for (const f of ["name", "phone", "city", "address_line"]) {
      if (!addr[f]) throw badRequest("Request failed validation.", { field: `shipping_address.${f}` });
    }

    // idempotency: replay same key -> original order
    const prior = await store.getOrderByIdempotency(idemKey);
    if (prior) {
      const samePayload = prior.kit_id === kit_id && prior.payment_method === payment_method;
      if (!samePayload) {
        res.status(409).json({ code: "conflict", message: "Idempotency-Key was already used with a different order payload." });
        return;
      }
      res.status(200).json(toContractOrder(prior));
      return;
    }

    const kit = await store.getKit(String(kit_id));
    if (!kit || !kit.is_active) throw badRequest("Kit unavailable.", { field: "kit_id" });
    const rxOff = !(await featureEnabled(store, "prescription_commerce"));
    const products = new Map((await store.listProducts({ activeOnly: false, cosmeticOnly: false })).map((p) => [p.id, p]));
    if (rxOff && kitHasPrescription(kit, products)) {
      res.status(422).json({ code: "feature_disabled", message: "This kit contains prescription items, disabled until the medical partnership is in place." });
      return;
    }

    const subtotal = kit.total_npr;
    const shipping = subtotal >= 5000 ? 0 : 120;
    const order = await store.createOrder({
      order_no: orderNo(), user_id: req.user!.id, kit_id: kit.id,
      subtotal_npr: subtotal, shipping_npr: shipping, total_npr: subtotal + shipping,
      payment_method, idempotency_key: idemKey, shipping_address: addr,
    });
    await store.createPayment({ order_id: order.id, provider: payment_method, amount_npr: order.total_npr });

    const user = await store.getUserById(req.user!.id);
    if (user?.email) {
      const m = orderConfirmationEmail(order.order_no, order.total_npr);
      sendEmail(user.email, m.subject, m.html).catch((e) => console.error("[brevo]", e));
    }
    await audit(store, { actorId: req.user!.id, action: "order.create", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json(toContractOrder(order));
  }));

  // GET /orders/:id — owner, pharmacy, admin
  r.get("/orders/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const role = req.user!.role;
    if (order.user_id !== req.user!.id && !["pharmacy", "admin"].includes(role)) throw notFound("Not found.");
    res.json(toContractOrder(order));
  }));

  // GET /my/orders — my order history (contract extension)
  r.get("/my/orders", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const orders = await store.listOrdersByUser(req.user!.id);
    res.json({ orders: orders.map(toContractOrder) });
  }));

  // POST /payments/:provider/callback — provider webhook, signature-verified, no auth
  r.post("/payments/:provider/callback", asyncHandler(async (req, res) => {
    const providerName = req.params.provider;
    if (!["esewa", "khalti"].includes(providerName)) throw badRequest("Unknown provider.");
    const { transaction_id, amount_npr, status, signature, order_id } = req.body ?? {};
    if (!transaction_id || !Number.isInteger(amount_npr) || !["success", "failed"].includes(status) || !signature) {
      throw badRequest("Request failed validation.", { field: "transaction_id|amount_npr|status|signature" });
    }
    if (!order_id) throw badRequest("Request failed validation.", { field: "order_id" });

    let verified = false;
    try {
      verified = providerFor(providerName).verifyWebhook({ transaction_id, amount_npr, status }, String(signature));
    } catch (e) {
      // missing sandbox keys -> cannot verify; treat as unverified, never approve
      console.error(`[payments] ${providerName} verify unavailable:`, (e as Error).message);
    }
    if (!verified) {
      res.status(400).json({ code: "signature_invalid", message: "Webhook signature verification failed." });
      return;
    }

    // idempotent on provider_ref
    const dup = await store.getPaymentByProviderRef(providerName, String(transaction_id));
    if (dup) {
      res.json({ verified: true, payment: toContractPayment(dup) });
      return;
    }

    const order = await resolveOrder(store, String(order_id));
    if (!order) throw badRequest("Unknown order.", { field: "order_id" });
    if (order.total_npr !== amount_npr) {
      res.status(400).json({ code: "signature_invalid", message: "Amount mismatch — payment stays pending." });
      return;
    }
    const payments = await store.listPaymentsByOrder(order.id);
    const payment = payments.find((p) => p.provider === providerName && p.status === "pending") ?? payments[0];
    if (!payment) throw badRequest("No payable payment row for this order.");
    const updated = (await store.updatePayment(payment.id, {
      provider_ref: String(transaction_id),
      status: status === "success" ? "succeeded" : "failed",
      webhook_log: [...(payment.webhook_log ?? []), { transaction_id, amount_npr, status, at: new Date().toISOString() }],
    }))!;
    if (status === "success") {
      await store.updateOrder(order.id, { status: "paid" });
      const user = await store.getUserById(order.user_id);
      if (user?.email) {
        const m = orderConfirmationEmail(order.order_no, order.total_npr);
        sendEmail(user.email, m.subject, m.html).catch((e) => console.error("[brevo]", e));
      }
    }
    res.json({ verified: true, payment: toContractPayment(updated) });
  }));

  function toContractPayment(p: { id: string; order_id: string; provider: string; provider_ref: string | null; amount_npr: number; status: string; webhook_log: unknown[] }) {
    return {
      id: p.id, order_id: p.order_id, provider: p.provider, provider_ref: p.provider_ref,
      amount_npr: p.amount_npr, status: p.status, webhook_log: p.webhook_log,
    };
  }

  // ---- pharmacy fulfilment (role pharmacy | admin) ----
  r.get("/pharmacy/orders", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    const orders = await store.listOrdersForPharmacy();
    res.json({ orders: orders.map(toContractOrder) });
  }));

  r.patch("/pharmacy/orders/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const { status, fulfilment_note } = req.body ?? {};
    const dbStatus = status !== undefined ? fromContractStatus(String(status)) : undefined;
    if (dbStatus !== undefined && !FULFIL_STATUSES.includes(dbStatus)) throw badRequest("Request failed validation.", { field: "status" });
    const updated = (await store.updateOrder(order.id, {
      ...(dbStatus ? { status: dbStatus as Order["status"] } : {}),
      ...(fulfilment_note !== undefined ? { fulfilment_note: String(fulfilment_note).slice(0, 2000) } : {}),
    }))!;
    await audit(store, { actorId: req.user!.id, action: "order.fulfil", entity: "order", entityId: order.id, ip: clientIp(req) });
    // journey email: order shipped (fire-and-forget — a failed email must never break the request)
    if (dbStatus === "shipped") {
      try {
        const user = await store.getUserById(order.user_id);
        if (user?.email) {
          const m = orderShippedEmail(updated.order_no);
          sendEmail(user.email, m.subject, m.html).catch((e) => console.error("[brevo]", e));
        }
      } catch (e) { console.error("[order-shipped notify]", e); }
    }
    res.json(toContractOrder(updated));
  }));

  void conflict;
  return r;
}
