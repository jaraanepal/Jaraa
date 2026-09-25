import { Router } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import type { Deps } from "../../deps";
import {
  asyncHandler, badRequest, notFound, conflict, clientIp, featureDisabled,
} from "../../http";
import { requireAuth, requireRole, type AuthedRequest } from "../../middleware/auth";
import { featureEnabled } from "../../middleware/flags";
import { audit } from "../../lib/audit";
import { MAX_BYTES } from "../../lib/photos";
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
      created_at: o.created_at, updated_at: o.updated_at,
      courier_name: o.courier_name, tracking_id: o.tracking_id,
      delivery_instructions: o.delivery_instructions,
      coupon_code: o.coupon_code, discount_npr: o.discount_npr,
      // U26 gift-a-kit (009): gift fields are null unless set at checkout.
      is_gift: o.is_gift ?? false,
      gift_recipient_name: o.gift_recipient_name ?? null,
      gift_recipient_phone: o.gift_recipient_phone ?? null,
      gift_message: o.gift_message ?? null,
      // P23 pack timer (009): null until pack-start.
      pack_started_at: o.pack_started_at ?? null,
      pack_completed_at: o.pack_completed_at ?? null,
      // P30/P35 (010): delivery note + shipping address (powers the tel: contact shortcut).
      shipping_address: o.shipping_address ?? null,
      // P34 rush flag (010): false for rows created before the 010 migration.
      is_rush: (o as Order & { is_rush?: boolean }).is_rush ?? false,
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
    const { kit_id, payment_method, shipping_address, delivery_instructions, coupon_code,
      gift_recipient_name, gift_recipient_phone, gift_message } = req.body ?? {};
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

    // A16: coupon application — validated here, at order time.
    let appliedCode: string | null = null;
    let discount = 0;
    if (coupon_code !== undefined && coupon_code !== null && String(coupon_code).trim() !== "") {
      const coupon = await store.getCouponByCode(String(coupon_code));
      const today = new Date().toISOString().slice(0, 10);
      const invalidReason =
        !coupon ? "not_found" :
        !coupon.is_active ? "inactive" :
        (coupon.starts_at && coupon.starts_at.slice(0, 10) > today) ? "not_started" :
        (coupon.ends_at && coupon.ends_at.slice(0, 10) < today) ? "expired" :
        (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) ? "exhausted" :
        (subtotal < coupon.min_order_npr) ? "min_order" : null;
      if (invalidReason) {
        res.status(422).json({ code: "coupon_invalid", message: "This coupon cannot be applied.", reason: invalidReason });
        return;
      }
      // Cosmetic kits only: a coupon never discounts a kit with prescription items.
      if (kitHasPrescription(kit, products)) {
        res.status(422).json({ code: "coupon_cosmetic_only", message: "Coupons apply to cosmetic kits only." });
        return;
      }
      appliedCode = coupon!.code;
      discount = coupon!.kind === "percent"
        ? Math.floor((subtotal * coupon!.value) / 100)
        : Math.min(coupon!.value, subtotal);
      await store.incrementCouponUses(coupon!.id);
    }

    const instr = typeof delivery_instructions === "string" ? delivery_instructions.trim().slice(0, 500) : null;
    // U26 gift-a-kit: validate the gift fields before the order is created.
    const giftName = typeof gift_recipient_name === "string" ? gift_recipient_name.trim() : "";
    const giftProvided = gift_recipient_name !== undefined && gift_recipient_name !== null;
    if (giftProvided && !giftName) {
      throw badRequest("Request failed validation.", { field: "gift_recipient_name" });
    }
    const order = await store.createOrder({
      order_no: orderNo(), user_id: req.user!.id, kit_id: kit.id,
      subtotal_npr: subtotal, shipping_npr: shipping, total_npr: subtotal - discount + shipping,
      payment_method, idempotency_key: idemKey, shipping_address: addr,
      delivery_instructions: instr || null,
      coupon_code: appliedCode, discount_npr: discount,
    });
    await store.createPayment({ order_id: order.id, provider: payment_method, amount_npr: order.total_npr });

    // U26: gift-a-kit — attach the gift after the order exists.
    let finalOrder = order;
    if (giftName) {
      finalOrder = (await store.setOrderGift(order.id, {
        recipient_name: giftName,
        recipient_phone: typeof gift_recipient_phone === "string" && gift_recipient_phone.trim()
          ? gift_recipient_phone.trim().slice(0, 40) : null,
        message: typeof gift_message === "string" && gift_message.trim()
          ? gift_message.trim().slice(0, 500) : null,
      })) ?? order;
    }

    const user = await store.getUserById(req.user!.id);
    if (user?.email) {
      const m = orderConfirmationEmail(order.order_no, order.total_npr);
      sendEmail(user.email, m.subject, m.html, { template: "order-confirmation" }).catch((e) => console.error("[brevo]", e));
    }
    await audit(store, { actorId: req.user!.id, action: "order.create", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json(toContractOrder(finalOrder));
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
        sendEmail(user.email, m.subject, m.html, { template: "order-confirmation" }).catch((e) => console.error("[brevo]", e));
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
          sendEmail(user.email, m.subject, m.html, { template: "order-shipped" }).catch((e) => console.error("[brevo]", e));
        }
      } catch (e) { console.error("[order-shipped notify]", e); }
    }
    res.json(toContractOrder(updated));
  }));

  // ---- P12 pharmacy fulfilment extensions ----
  const toContractKit = (k: Kit) => ({
    id: k.id, plan_id: k.plan_id, name: k.name_en, name_en: k.name_en, name_ne: k.name_ne,
    product_ids: k.product_ids, total_npr: k.total_npr,
    category: k.category, images: k.images,
    whats_included: k.whats_included, usage_instructions: k.usage_instructions,
    stock: k.stock,
    low_stock_threshold: k.low_stock_threshold ?? null,
    is_active: k.is_active, created_at: k.created_at, updated_at: k.updated_at,
  });

  // GET /pharmacy/kits — kit list with stock for fulfilment (P1/P2)
  r.get("/pharmacy/kits", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    const kits = await store.listKits(false);
    res.json({ kits: kits.map(toContractKit) });
  }));

  // PATCH /pharmacy/kits/:id/stock — adjust kit stock (P2)
  r.patch("/pharmacy/kits/:id/stock", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { delta } = req.body ?? {};
    if (!Number.isInteger(delta) || delta === 0 || delta < -1000 || delta > 1000) {
      throw badRequest("Request failed validation.", { field: "delta" });
    }
    const kit = await store.getKit(req.params.id);
    if (!kit) throw notFound("Not found.");
    const updated = (await store.adjustKitStock(kit.id, delta))!;
    // P41: stock adjusted to 0 -> auto-deactivate the kit so it disappears
    // from the catalogue; the indicator tells the client it happened.
    let finalKit = updated;
    let auto_hidden = false;
    if (updated.stock === 0 && updated.is_active) {
      const deactivated = await store.updateKit(kit.id, { is_active: false });
      if (deactivated) { finalKit = deactivated; auto_hidden = true; }
    }
    await store.logStockMovement(kit.id, delta, req.body?.reason ? String(req.body.reason).slice(0, 300) : null, req.user!.id);
    await audit(store, { actorId: req.user!.id, action: "kit.stock_adjust", entity: "kit", entityId: kit.id, ip: clientIp(req) });
    res.json({ kit: toContractKit(finalKit), auto_hidden });
  }));

  // PATCH /pharmacy/orders/:id/courier — assign courier + tracking id (P4)
  r.patch("/pharmacy/orders/:id/courier", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const { courier_name, tracking_id } = req.body ?? {};
    const clean = (v: unknown, field: string): string | null => {
      if (v === undefined || v === null) return null;
      if (typeof v !== "string") throw badRequest("Request failed validation.", { field });
      const s = v.trim();
      if (!s) return null;
      if (s.length > 80) throw badRequest("Request failed validation.", { field });
      return s;
    };
    const updated = (await store.setOrderCourier(
      order.id, clean(courier_name, "courier_name"), clean(tracking_id, "tracking_id")))!
    await audit(store, { actorId: req.user!.id, action: "order.courier", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.json({ order: toContractOrder(updated) });
  }));

  const CHECK_TYPES = ["name", "phone", "address"] as const;

  // POST /pharmacy/orders/:id/checks — record a verification check (P5)
  r.post("/pharmacy/orders/:id/checks", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const { check_type } = req.body ?? {};
    if (!CHECK_TYPES.includes(check_type)) throw badRequest("Request failed validation.", { field: "check_type" });
    const check = await store.addOrderCheck(order.id, check_type, req.user!.id);
    await audit(store, { actorId: req.user!.id, action: "order.check", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json({ check });
  }));

  // GET /pharmacy/orders/:id/checks (P5)
  r.get("/pharmacy/orders/:id/checks", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    res.json({ checks: await store.listOrderChecks(order.id) });
  }));

  // POST /pharmacy/orders/:id/return — mark returned + restock the kit (P6)
  r.post("/pharmacy/orders/:id/return", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) throw badRequest("Request failed validation.", { field: "reason" });
    if (reason.length > 500) throw badRequest("Request failed validation.", { field: "reason" });
    const updated = (await store.updateOrder(order.id, {
      status: "cancelled", fulfilment_note: `Returned: ${reason}`,
    }))!;
    if (order.kit_id) await store.adjustKitStock(order.kit_id, 1);
    await audit(store, { actorId: req.user!.id, action: "order.return", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.json({ order: toContractOrder(updated) });
  }));

  // POST /pharmacy/orders/:id/damage — file a damage report (P7)
  r.post("/pharmacy/orders/:id/damage", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (!description) throw badRequest("Request failed validation.", { field: "description" });
    if (description.length > 2000) throw badRequest("Request failed validation.", { field: "description" });
    const report = await store.addDamageReport(order.id, req.user!.id, description);
    await audit(store, { actorId: req.user!.id, action: "order.damage", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json({ report });
  }));

  // GET /pharmacy/orders/:id/damage (P7)
  r.get("/pharmacy/orders/:id/damage", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    res.json({ reports: await store.listDamageReports(order.id) });
  }));

  // POST /pharmacy/orders/:id/handover — add a shift handover note (P8)
  r.post("/pharmacy/orders/:id/handover", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!note) throw badRequest("Request failed validation.", { field: "note" });
    if (note.length > 2000) throw badRequest("Request failed validation.", { field: "note" });
    const row = await store.addHandoverNote(order.id, req.user!.id, note);
    await audit(store, { actorId: req.user!.id, action: "order.handover", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json({ note: row });
  }));

  // GET /pharmacy/orders/:id/handover (P8)
  r.get("/pharmacy/orders/:id/handover", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    res.json({ notes: await store.listHandoverNotes(order.id) });
  }));

  /* ---------------- Batch 2 (008): P10–P18 (pharmacy role) ---------------- */

  // GET /pharmacy/kits/:id/movements — P10: stock history log
  r.get("/pharmacy/kits/:id/movements", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const kit = await store.getKit(req.params.id);
    if (!kit) throw notFound("Not found.");
    res.json({ movements: await store.listStockMovements(kit.id, 100) });
  }));

  // GET /pharmacy/reorder-suggestions — P11: kits below threshold with suggested qty
  r.get("/pharmacy/reorder-suggestions", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    res.json({ suggestions: await store.reorderSuggestions() });
  }));

  // GET /pharmacy/orders/:id/packing — P12: packing checklist
  r.get("/pharmacy/orders/:id/packing", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Order not found.");
    res.json({ checks: await store.getPackingChecks(order.id) });
  }));

  // POST /pharmacy/orders/:id/packing — P12: check off a packing step
  r.post("/pharmacy/orders/:id/packing", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { step, done } = req.body ?? {};
    if (!step || !String(step).trim()) throw badRequest("step is required.", { field: "step" });
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Order not found.");
    const c = await store.setPackingCheck(order.id, String(step).slice(0, 60), done === true, req.user!.id);
    res.status(201).json(c);
  }));

  // GET /pharmacy/orders/:id/label — P13: printable label payload
  r.get("/pharmacy/orders/:id/label", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Order not found.");
    const label = await store.orderLabel(order.id);
    if (!label) throw notFound("Order not found.");
    res.json({ label });
  }));

  // GET /pharmacy/zones — P14: delivery-zone stats
  r.get("/pharmacy/zones", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ zones: await store.zoneStats() });
  }));

  // GET /pharmacy/duplicates — P16: same customer + kit within 24h
  r.get("/pharmacy/duplicates", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ duplicates: await store.duplicateOrders() });
  }));

  // GET /pharmacy/batches — P17: kit batches with expiry
  r.get("/pharmacy/batches", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const kitId = typeof req.query.kit_id === "string" && req.query.kit_id ? req.query.kit_id : null;
    res.json({ batches: await store.listKitBatches(kitId ?? undefined) });
  }));

  // POST /pharmacy/batches — P17
  r.post("/pharmacy/batches", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { kit_id, batch_no, expires_on, qty, supplier_id } = req.body ?? {};
    if (!kit_id || !batch_no) throw badRequest("kit_id and batch_no are required.", { field: "kit_id" });
    const kit = await store.getKit(kit_id);
    if (!kit) throw notFound("Kit not found.");
    const b = await store.createKitBatch(kit.id, {
      batch_no: String(batch_no).slice(0, 120),
      expires_on: expires_on ? String(expires_on).slice(0, 10) : null,
      qty: Number.isInteger(qty) && qty >= 0 ? qty : 0,
      supplier_id: supplier_id ? String(supplier_id) : null,
    });
    res.status(201).json(b);
  }));

  // PATCH /pharmacy/batches/:id — P17: update batch
  r.patch("/pharmacy/batches/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { batch_no, expires_on, qty, supplier_id } = req.body ?? {};
    const patch: { batch_no?: string; expires_on?: string | null; qty?: number; supplier_id?: string | null } = {};
    if (batch_no !== undefined) patch.batch_no = String(batch_no).slice(0, 120);
    if (expires_on !== undefined) patch.expires_on = expires_on ? String(expires_on).slice(0, 10) : null;
    if (qty !== undefined) patch.qty = Number.isInteger(qty) && qty >= 0 ? qty : 0;
    if (supplier_id !== undefined) patch.supplier_id = supplier_id ? String(supplier_id) : null;
    const b = await store.updateKitBatch(req.params.id, patch);
    if (!b) throw notFound("Batch not found.");
    res.json(b);
  }));

  // DELETE /pharmacy/batches/:id — P17
  r.delete("/pharmacy/batches/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteKitBatch(req.params.id);
    if (!ok) throw notFound("Batch not found.");
    res.json({ ok: true });
  }));

  // GET /pharmacy/suppliers — P18
  r.get("/pharmacy/suppliers", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ suppliers: await store.listSuppliers() });
  }));

  // POST /pharmacy/suppliers — P18
  r.post("/pharmacy/suppliers", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { name, contact, phone, address, note } = req.body ?? {};
    if (!name || !String(name).trim()) throw badRequest("name is required.", { field: "name" });
    const s = await store.createSupplier({
      name: String(name).slice(0, 200),
      contact: contact ? String(contact).slice(0, 200) : null,
      phone: phone ? String(phone).slice(0, 40) : null,
      address: address ? String(address).slice(0, 500) : null,
      note: note ? String(note).slice(0, 500) : null,
    });
    res.status(201).json(s);
  }));

  // PATCH /pharmacy/suppliers/:id — P18: update supplier fields
  r.patch("/pharmacy/suppliers/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const patch: Record<string, string | null> = {};
    for (const k of ["name", "contact", "phone", "address", "note"]) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k] ? String(req.body[k]).slice(0, 500) : null;
    }
    const s = await store.updateSupplier(req.params.id, patch);
    if (!s) throw notFound("Supplier not found.");
    res.json(s);
  }));

  // DELETE /pharmacy/suppliers/:id — P18
  r.delete("/pharmacy/suppliers/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteSupplier(req.params.id);
    if (!ok) throw notFound("Supplier not found.");
    res.json({ ok: true });
  }));

  /* ---------------- Batch 3 (009): P19–P27 (pharmacy role) ---------------- */

  const QUARANTINE_STATUSES = ["quarantined", "released", "written_off"] as const;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function shiftDay(req: AuthedRequest): string {
    const q = req.query.date;
    const d = typeof q === "string" && q ? q : new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d))) {
      throw badRequest("Request failed validation.", { field: "date" });
    }
    return d;
  }

  // ---- P19: damaged-stock quarantine ----

  // GET /pharmacy/quarantine?status=quarantined
  r.get("/pharmacy/quarantine", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !(QUARANTINE_STATUSES as readonly string[]).includes(String(status))) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    const entries = await store.listQuarantine(status ? String(status) : undefined);
    res.json({ entries });
  }));

  // POST /pharmacy/quarantine — hold damaged units out of sale
  r.post("/pharmacy/quarantine", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { kit_id, qty, reason } = req.body ?? {};
    const kit = kit_id ? await store.getKit(String(kit_id)) : null;
    if (!kit) throw notFound("Kit not found.");
    if (!Number.isInteger(qty) || qty <= 0 || qty > 100000) {
      throw badRequest("Request failed validation.", { field: "qty" });
    }
    const entry = await store.createQuarantine({
      kit_id: kit.id, qty,
      reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null,
      reported_by: req.user!.id,
    });
    await audit(store, { actorId: req.user!.id, action: "quarantine.create", entity: "quarantine", entityId: entry.id, ip: clientIp(req) });
    res.status(201).json({ entry });
  }));

  // PATCH /pharmacy/quarantine/:id — release or write off
  r.patch("/pharmacy/quarantine/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.body ?? {};
    if (!(QUARANTINE_STATUSES as readonly string[]).includes(String(status))) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    const entry = await store.setQuarantineStatus(req.params.id, status);
    if (!entry) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "quarantine.status", entity: "quarantine", entityId: entry.id, ip: clientIp(req) });
    res.json({ entry });
  }));

  // ---- P20: shift handover summary ----

  // GET /pharmacy/shift-summary?date=YYYY-MM-DD
  r.get("/pharmacy/shift-summary", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const date = shiftDay(req);
    const summary = await store.shiftSummary(date);
    // Handover notes for the shift: orders in the fulfilment queue handled on
    // this date (same date logic as shiftSummary). Delivered orders leave the
    // pharmacy queue, so their notes may not appear in this timeline.
    const queue = await store.listOrdersForPharmacy();
    const handledIds = queue.filter((o) => {
      const packDay = (o as { pack_completed_at?: string | null }).pack_completed_at?.slice(0, 10) ?? null;
      return packDay === date || (["shipped", "delivered"].includes(o.status) && o.updated_at.slice(0, 10) === date);
    }).map((o) => o.id);
    const noteLists = await Promise.all(handledIds.map((id) => store.listHandoverNotes(id)));
    const handover_notes = noteLists.flat().sort((a, b) => a.created_at.localeCompare(b.created_at));
    res.json({ date, ...summary, handover_notes });
  }));

  // ---- P21: courier performance ----

  // GET /pharmacy/couriers/performance
  r.get("/pharmacy/couriers/performance", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ couriers: await store.courierPerformance() });
  }));

  // ---- P22: return-rate analytics (refund-derived; no returns table exists) ----

  // GET /pharmacy/returns/analytics
  r.get("/pharmacy/returns/analytics", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ kits: await store.returnAnalytics() });
  }));

  // ---- P23: pick/pack timer ----

  /** Resolve an order and require it to be in the pharmacy fulfilment queue. */
  async function packableOrder(param: string) {
    const order = await resolveOrder(store, param);
    if (!order) throw notFound("Not found.");
    const queue = await store.listOrdersForPharmacy();
    if (!queue.some((o) => o.id === order.id)) {
      throw badRequest("Order is not in the fulfilment queue.", { field: "id", code: "not_in_queue" });
    }
    return order;
  }

  // POST /pharmacy/orders/:id/pack-start — idempotent re-start
  r.post("/pharmacy/orders/:id/pack-start", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await packableOrder(req.params.id);
    const updated = (await store.packStart(order.id))!;
    await audit(store, { actorId: req.user!.id, action: "order.pack_start", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.json({ order: toContractOrder(updated) });
  }));

  // POST /pharmacy/orders/:id/pack-complete
  r.post("/pharmacy/orders/:id/pack-complete", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await packableOrder(req.params.id);
    const updated = (await store.packComplete(order.id))!;
    await audit(store, { actorId: req.user!.id, action: "order.pack_complete", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.json({ order: toContractOrder(updated) });
  }));

  // ---- P24: packaging materials ----

  // GET /pharmacy/packaging
  r.get("/pharmacy/packaging", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ materials: await store.listPackagingMaterials() });
  }));

  // POST /pharmacy/packaging
  r.post("/pharmacy/packaging", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { name, qty, unit, low_threshold } = req.body ?? {};
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) throw badRequest("Request failed validation.", { field: "name" });
    const cleanQty = qty === undefined ? 0 : qty;
    const cleanThreshold = low_threshold === undefined ? 0 : low_threshold;
    if (!Number.isInteger(cleanQty) || cleanQty < 0 || cleanQty > 1000000) {
      throw badRequest("Request failed validation.", { field: "qty" });
    }
    if (!Number.isInteger(cleanThreshold) || cleanThreshold < 0 || cleanThreshold > 1000000) {
      throw badRequest("Request failed validation.", { field: "low_threshold" });
    }
    const material = await store.createPackagingMaterial({
      name: cleanName.slice(0, 200), qty: cleanQty,
      unit: typeof unit === "string" && unit.trim() ? unit.trim().slice(0, 40) : null,
      low_threshold: cleanThreshold,
    });
    await audit(store, { actorId: req.user!.id, action: "packaging.create", entity: "packaging_material", entityId: material.id, ip: clientIp(req) });
    res.status(201).json({ material });
  }));

  // PATCH /pharmacy/packaging/:id
  r.patch("/pharmacy/packaging/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const patch: Record<string, string | number | null> = {};
    const { name, qty, unit, low_threshold } = req.body ?? {};
    if (name !== undefined) {
      const cleanName = typeof name === "string" ? name.trim() : "";
      if (!cleanName) throw badRequest("Request failed validation.", { field: "name" });
      patch.name = cleanName.slice(0, 200);
    }
    if (qty !== undefined) {
      if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) throw badRequest("Request failed validation.", { field: "qty" });
      patch.qty = qty;
    }
    if (unit !== undefined) {
      patch.unit = typeof unit === "string" && unit.trim() ? unit.trim().slice(0, 40) : null;
    }
    if (low_threshold !== undefined) {
      if (!Number.isInteger(low_threshold) || low_threshold < 0 || low_threshold > 1000000) {
        throw badRequest("Request failed validation.", { field: "low_threshold" });
      }
      patch.low_threshold = low_threshold;
    }
    const material = await store.updatePackagingMaterial(req.params.id, patch);
    if (!material) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "packaging.update", entity: "packaging_material", entityId: material.id, ip: clientIp(req) });
    res.json({ material });
  }));

  // DELETE /pharmacy/packaging/:id
  r.delete("/pharmacy/packaging/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deletePackagingMaterial(req.params.id);
    if (!ok) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "packaging.delete", entity: "packaging_material", entityId: req.params.id, ip: clientIp(req) });
    res.json({ deleted: true });
  }));

  // ---- P25: COD reconciliation ----

  // GET /pharmacy/cod-reconciliation?date=YYYY-MM-DD
  r.get("/pharmacy/cod-reconciliation", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const date = shiftDay(req);
    const recon = await store.codReconciliation(date);
    // "Collected" proxy (open question 2): a payments row with provider=cod
    // and status=succeeded means the cash was collected.
    const rows = await Promise.all(recon.orders.map(async (o) => {
      const payments = await store.listPaymentsByOrder(o.id);
      const collected = payments.some((p) => p.provider === "cod" && p.status === "succeeded");
      return { ...o, collected };
    }));
    const collected_npr = rows.filter((o) => o.collected).reduce((s, o) => s + o.total_npr, 0);
    res.json({ date, expected_npr: recon.expected_npr, collected_npr, orders: rows });
  }));

  // ---- P26: low-stock threshold ----

  // PATCH /pharmacy/kits/:id/threshold
  r.patch("/pharmacy/kits/:id/threshold", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { threshold } = req.body ?? {};
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000000) {
      throw badRequest("Request failed validation.", { field: "threshold" });
    }
    const kit = await store.setKitLowStockThreshold(req.params.id, threshold);
    if (!kit) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "kit.threshold", entity: "kit", entityId: kit.id, ip: clientIp(req) });
    res.json({ kit: toContractKit(kit) });
  }));

  // ---- P27: order internal notes ----

  // GET /pharmacy/orders/:id/notes
  r.get("/pharmacy/orders/:id/notes", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    res.json({ notes: await store.listOrderNotes(order.id) });
  }));

  // POST /pharmacy/orders/:id/notes
  r.post("/pharmacy/orders/:id/notes", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!note) throw badRequest("Request failed validation.", { field: "note" });
    if (note.length > 2000) throw badRequest("Request failed validation.", { field: "note" });
    const row = await store.addOrderNote(order.id, req.user!.id, note);
    await audit(store, { actorId: req.user!.id, action: "order.note", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json({ note: row });
  }));

  /* ---------------- Batch 4 (010): P28–P45 (pharmacy role) ---------------- */

  // P42 must be registered before any GET /pharmacy/orders/:id-style route so
  // "search" is not swallowed by an :id param (there is none today, but keep it first).
  // GET /pharmacy/orders/search?q= — order id/order_no fragment, customer name, phone
  r.get("/pharmacy/orders/search", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) throw badRequest("Request failed validation.", { field: "q" });
    const orders = await store.searchOrders(q);
    res.json({ orders: orders.map(toContractOrder) });
  }));

  // ---- P28: clear + recreate verification checks as pending ----
  r.post("/pharmacy/orders/:id/checks/reverify", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const checks = await store.reverifyOrderChecks(order.id);
    await audit(store, { actorId: req.user!.id, action: "order.checks_reverify", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.json({ checks });
  }));

  // ---- P29: advance multiple orders at once; each is audited ----
  r.post("/pharmacy/orders/bulk-status", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { ids, status } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 ||
      !ids.every((x) => typeof x === "string")) {
      throw badRequest("Request failed validation.", { field: "ids" });
    }
    const dbStatus = fromContractStatus(String(status ?? ""));
    if (!FULFIL_STATUSES.includes(dbStatus)) throw badRequest("Request failed validation.", { field: "status" });
    const updated: unknown[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const raw of ids) {
      const order = await resolveOrder(store, raw);
      if (!order) { failed.push({ id: raw, reason: "not_found" }); continue; }
      const u = (await store.updateOrder(order.id, { status: dbStatus as Order["status"] }))!;
      await audit(store, { actorId: req.user!.id, action: "order.bulk_status", entity: "order", entityId: order.id, ip: clientIp(req) });
      updated.push(toContractOrder(u));
    }
    res.json({ updated, failed });
  }));

  // ---- P31: delivery attempts ----
  const ATTEMPT_STATUSES = ["failed", "rescheduled", "delivered"] as const;

  r.post("/pharmacy/orders/:id/attempts", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const { status, note } = req.body ?? {};
    if (!(ATTEMPT_STATUSES as readonly string[]).includes(String(status))) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
    const attempt = await store.createDeliveryAttempt({ order_id: order.id, status, note: cleanNote });
    await audit(store, { actorId: req.user!.id, action: "order.attempt", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json({ attempt });
  }));

  r.get("/pharmacy/orders/:id/attempts", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    res.json({ attempts: await store.listDeliveryAttempts(order.id) });
  }));

  // ---- P32: per-courier daily pickup manifest ----
  // The manifest is the live fulfilment queue snapshot for `date`, optionally
  // filtered to one courier; `date` is validated and echoed for the printable header.
  r.get("/pharmacy/manifest", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" && req.query.date
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
      throw badRequest("Request failed validation.", { field: "date" });
    }
    const courier = typeof req.query.courier === "string" && req.query.courier.trim()
      ? req.query.courier.trim()
      : null;
    const queue = await store.listOrdersForPharmacy();
    const rows = queue.filter((o) => !courier || o.courier_name === courier);
    const by_status: Record<string, number> = {};
    for (const o of rows) by_status[o.status] = (by_status[o.status] ?? 0) + 1;
    res.json({ date, courier, total: rows.length, by_status, orders: rows.map(toContractOrder) });
  }));

  // ---- P33: physical stock count; variance = counted - system ----
  r.post("/pharmacy/kits/:id/count", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const kit = await store.getKit(req.params.id);
    if (!kit) throw notFound("Not found.");
    const { counted_qty } = req.body ?? {};
    if (!Number.isInteger(counted_qty) || counted_qty < 0 || counted_qty > 1000000) {
      throw badRequest("Request failed validation.", { field: "counted_qty" });
    }
    const count = await store.createStockCount({
      kit_id: kit.id, counted_qty, counted_by: req.user!.id, system_qty: kit.stock ?? 0,
    });
    await audit(store, { actorId: req.user!.id, action: "kit.stock_count", entity: "kit", entityId: kit.id, ip: clientIp(req) });
    res.status(201).json({ count });
  }));

  // GET /pharmacy/kits/:id/counts — count history for the stock tab
  r.get("/pharmacy/kits/:id/counts", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const kit = await store.getKit(req.params.id);
    if (!kit) throw notFound("Not found.");
    res.json({ counts: await store.listStockCounts(kit.id) });
  }));

  // ---- P34: rush flag; rush orders sort first in the queue (store-level) ----
  r.patch("/pharmacy/orders/:id/rush", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const { rush } = req.body ?? {};
    if (typeof rush !== "boolean") throw badRequest("Request failed validation.", { field: "rush" });
    const updated = (await store.setOrderRush(order.id, rush))!;
    await audit(store, { actorId: req.user!.id, action: "order.rush", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.json({ order: toContractOrder(updated) });
  }));

  // ---- P36-alt: kit batches expiring within N days ----
  r.get("/pharmacy/batches/expiring", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const raw = req.query.days;
    const days = raw === undefined ? 60 : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw badRequest("Request failed validation.", { field: "days" });
    }
    res.json({ batches: await store.listExpiringBatches(days) });
  }));

  // ---- P37: monthly fulfilment CSV ----
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  r.get("/pharmacy/reports/monthly.csv", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    if (!MONTH_RE.test(month)) throw badRequest("Request failed validation.", { field: "month" });
    const orders = (await store.searchOrders(""))
      .filter((o) => o.created_at.slice(0, 7) === month)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const kits = new Map((await store.listKits(false)).map((k) => [k.id, k.name_en]));
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      "order_no,order_date,status,kit_name,subtotal_npr,shipping_npr,discount_npr,total_npr,payment_method,courier_name",
      ...orders.map((o) => [
        o.order_no, o.created_at.slice(0, 10), o.status,
        o.kit_id ? (kits.get(o.kit_id) ?? o.kit_id) : "",
        o.subtotal_npr, o.shipping_npr, o.discount_npr, o.total_npr,
        o.payment_method ?? "", o.courier_name ?? "",
      ].map(esc).join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="jaraa-fulfilment-${month}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  }));

  // ---- P38: kit substitutions ----
  r.post("/pharmacy/orders/:id/substitutions", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const { from_kit_id, to_kit_id, reason } = req.body ?? {};
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (!cleanReason) throw badRequest("Request failed validation.", { field: "reason" });
    if (cleanReason.length > 500) throw badRequest("Request failed validation.", { field: "reason" });
    const kitIdOrNull = async (v: unknown, field: string): Promise<string | null> => {
      if (v === undefined || v === null || v === "") return null;
      const kit = await store.getKit(String(v));
      if (!kit) throw notFound("Kit not found.");
      return kit.id;
    };
    const substitution = await store.createSubstitution({
      order_id: order.id,
      from_kit_id: await kitIdOrNull(from_kit_id, "from_kit_id"),
      to_kit_id: await kitIdOrNull(to_kit_id, "to_kit_id"),
      reason: cleanReason,
    });
    await audit(store, { actorId: req.user!.id, action: "order.substitution", entity: "order", entityId: order.id, ip: clientIp(req) });
    res.status(201).json({ substitution });
  }));

  r.get("/pharmacy/orders/:id/substitutions", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    res.json({ substitutions: await store.listSubstitutions(order.id) });
  }));

  // ---- P39: delivery photo proof — reuses the existing scan-photos bucket ----
  const proofUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
  });

  r.post("/pharmacy/orders/:id/proof", requireRole("pharmacy", "admin"), proofUpload.single("photo"),
    asyncHandler(async (req: AuthedRequest, res) => {
      const order = await resolveOrder(store, req.params.id);
      if (!order) throw notFound("Not found.");
      const file = (req as unknown as { file?: Express.Multer.File }).file;
      if (!file) throw badRequest("Request failed validation.", { field: "photo" });
      let meta;
      try {
        meta = await sharp(file.buffer).metadata();
      } catch {
        throw badRequest("Unsupported image type.", { field: "photo" });
      }
      if (!["jpeg", "png", "webp"].includes(meta.format || "")) {
        throw badRequest("Unsupported image type.", { field: "photo" });
      }
      // EXIF auto-rotate + strip, normalized JPEG into the scan-photos bucket.
      const normalized = await sharp(file.buffer).rotate().jpeg({ quality: 82 }).toBuffer();
      const storagePath = `proofs/${order.id}/${Date.now()}.jpg`;
      await deps.storage.putPrivate(storagePath, normalized, "image/jpeg");
      const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
      const proof = await store.createDeliveryProof({
        order_id: order.id, storage_path: storagePath, note: note || null,
      });
      await audit(store, { actorId: req.user!.id, action: "order.proof", entity: "order", entityId: order.id, ip: clientIp(req) });
      const url = await deps.storage.getSignedUrl(storagePath, 900);
      res.status(201).json({ proof: { ...proof, url } });
    }));

  r.get("/pharmacy/orders/:id/proofs", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const proofs = await store.listDeliveryProofs(order.id);
    const withUrls = await Promise.all(proofs.map(async (p) => {
      let url: string | null = null;
      try { url = await deps.storage.getSignedUrl(p.storage_path, 900); } catch { url = null; }
      return { ...p, url };
    }));
    res.json({ proofs: withUrls });
  }));

  // ---- P40: published announcements for the pharmacy notice banner ----
  r.get("/pharmacy/announcements", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ announcements: await store.listAnnouncements(true) });
  }));

  // ---- P43: pharmacy flags an order for admin refund approval ----
  r.post("/pharmacy/orders/:id/refund-request", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const order = await resolveOrder(store, req.params.id);
    if (!order) throw notFound("Not found.");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) throw badRequest("Request failed validation.", { field: "reason" });
    if (reason.length > 500) throw badRequest("Request failed validation.", { field: "reason" });
    const rr = await store.createRefundRequest({ order_id: order.id, reason });
    await audit(store, { actorId: req.user!.id, action: "refund.request", entity: "refund_request", entityId: rr.id, ip: clientIp(req) });
    res.status(201).json({ request: rr });
  }));

  // GET /pharmacy/refund-requests — queue for the admin decision UI
  r.get("/pharmacy/refund-requests", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !["pending", "approved", "rejected"].includes(String(status))) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    res.json({ requests: await store.listRefundRequests(status ? String(status) : undefined) });
  }));

  // PATCH /pharmacy/refund-requests/:id/decide — admin only
  r.patch("/pharmacy/refund-requests/:id/decide", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { approved } = req.body ?? {};
    if (typeof approved !== "boolean") throw badRequest("Request failed validation.", { field: "approved" });
    const rr = await store.decideRefundRequest(req.params.id, approved);
    if (!rr) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "refund.decide", entity: "refund_request", entityId: rr.id, ip: clientIp(req) });
    res.json({ request: rr });
  }));

  // ---- P44: non-dispatch days ----
  r.get("/pharmacy/holidays", requireRole("pharmacy", "admin"), asyncHandler(async (_req, res) => {
    res.json({ holidays: await store.listDispatchHolidays() });
  }));

  r.post("/pharmacy/holidays", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { date, label } = req.body ?? {};
    if (typeof date !== "string" || !DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
      throw badRequest("Request failed validation.", { field: "date" });
    }
    const cleanLabel = typeof label === "string" ? label.trim() : "";
    if (!cleanLabel) throw badRequest("Request failed validation.", { field: "label" });
    if (cleanLabel.length > 200) throw badRequest("Request failed validation.", { field: "label" });
    const existing = await store.listDispatchHolidays();
    if (existing.some((h) => h.date === date)) throw conflict("A holiday already exists for this date.");
    const holiday = await store.createDispatchHoliday({ date, label: cleanLabel });
    await audit(store, { actorId: req.user!.id, action: "holiday.create", entity: "dispatch_holiday", entityId: holiday.id, ip: clientIp(req) });
    res.status(201).json({ holiday });
  }));

  r.delete("/pharmacy/holidays/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await store.deleteDispatchHoliday(req.params.id);
    if (!ok) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "holiday.delete", entity: "dispatch_holiday", entityId: req.params.id, ip: clientIp(req) });
    res.json({ deleted: true });
  }));

  // ---- P45: courier damage claims ----
  const CLAIM_STATUSES = ["open", "filed", "settled"] as const;

  r.get("/pharmacy/courier-claims", requireRole("pharmacy", "admin"), asyncHandler(async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !(CLAIM_STATUSES as readonly string[]).includes(String(status))) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    res.json({ claims: await store.listCourierClaims(status ? String(status) : undefined) });
  }));

  r.post("/pharmacy/courier-claims", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { courier_name, order_id, amount_npr, reason } = req.body ?? {};
    const cleanName = typeof courier_name === "string" ? courier_name.trim() : "";
    if (!cleanName) throw badRequest("Request failed validation.", { field: "courier_name" });
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (!cleanReason) throw badRequest("Request failed validation.", { field: "reason" });
    if (cleanReason.length > 1000) throw badRequest("Request failed validation.", { field: "reason" });
    let claimOrderId: string | null = null;
    if (order_id !== undefined && order_id !== null && order_id !== "") {
      const order = await resolveOrder(store, String(order_id));
      if (!order) throw notFound("Order not found.");
      claimOrderId = order.id;
    }
    const amount = amount_npr === undefined || amount_npr === null ? 0 : amount_npr;
    if (!Number.isInteger(amount) || amount < 0 || amount > 100000000) {
      throw badRequest("Request failed validation.", { field: "amount_npr" });
    }
    const claim = await store.createCourierClaim({
      courier_name: cleanName.slice(0, 120), order_id: claimOrderId,
      amount_npr: amount, reason: cleanReason,
    });
    await audit(store, { actorId: req.user!.id, action: "claim.create", entity: "courier_claim", entityId: claim.id, ip: clientIp(req) });
    res.status(201).json({ claim });
  }));

  r.patch("/pharmacy/courier-claims/:id", requireRole("pharmacy", "admin"), asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.body ?? {};
    if (!(CLAIM_STATUSES as readonly string[]).includes(String(status))) {
      throw badRequest("Request failed validation.", { field: "status" });
    }
    const claim = await store.setCourierClaimStatus(req.params.id, status);
    if (!claim) throw notFound("Not found.");
    await audit(store, { actorId: req.user!.id, action: "claim.status", entity: "courier_claim", entityId: claim.id, ip: clientIp(req) });
    res.json({ claim });
  }));

  return r;
}
