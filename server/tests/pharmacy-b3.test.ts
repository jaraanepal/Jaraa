// Batch-3 pharmacy wave 2: P19–P27 routes + U26 gift wiring.
// Covers: role gates, quarantine lifecycle, shift summary, courier
// performance, return analytics, pack timer idempotency, packaging CRUD,
// COD reconciliation, threshold validation, notes isolation, gift wiring.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, otpLogin, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let pharmacyToken = "";
let adminToken = "";
let custToken = "";
let cust2Token = "";
let custId = "";
let cust2Id = "";
let kitId = "";
let kit2Id = "";
let giftOrderNo = "";

beforeAll(async () => {
  const pharmacy = await store.createUser({ phone: "+9779841030001", role: "pharmacy" });
  const admin = await store.createUser({ phone: "+9779841030002", role: "admin" });
  pharmacyToken = tokenFor(pharmacy);
  adminToken = tokenFor(admin);

  // orders.test.ts pattern: real OTP login for the customer who places orders.
  const c = await otpLogin(app, "+9779841030003");
  custToken = c.token;
  custId = c.user.id;
  const c2 = await store.createUser({ phone: "+9779841030004", role: "customer" });
  cust2Token = tokenFor(c2);
  cust2Id = c2.id;

  const product = await store.createProduct({ name_en: "B3 Oil", kind: "cosmetic", price_npr: 500 });
  const kit = await store.createKit({ name_en: "B3 Kit", product_ids: [product.id], total_npr: 500, stock: 10 });
  kitId = kit.id;
  const kit2 = await store.createKit({ name_en: "B3 Kit 2", product_ids: [product.id], total_npr: 700, stock: 5 });
  kit2Id = kit2.id;
});

const giftPayload = () => ({
  kit_id: kitId,
  payment_method: "cod",
  shipping_address: { name: "Gifter", phone: "+9779841030003", city: "Kathmandu", address_line: "Boudha 5" },
});

describe("P19 damaged-stock quarantine", () => {
  it("POST -> GET -> PATCH lifecycle; customer gets 403", async () => {
    const create = await request(app).post("/api/v1/pharmacy/quarantine")
      .set(auth(pharmacyToken)).send({ kit_id: kitId, qty: 2, reason: "Leaking bottle" });
    expect(create.status).toBe(201);
    const entry = create.body.entry;
    expect(entry.status).toBe("quarantined");
    expect(entry.qty).toBe(2);
    expect(entry.kit_id).toBe(kitId);

    const list = await request(app).get("/api/v1/pharmacy/quarantine").set(auth(pharmacyToken));
    expect(list.status).toBe(200);
    expect(list.body.entries.map((e: { id: string }) => e.id)).toContain(entry.id);

    const filtered = await request(app).get("/api/v1/pharmacy/quarantine?status=quarantined").set(auth(pharmacyToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.entries.every((e: { status: string }) => e.status === "quarantined")).toBe(true);

    const rel = await request(app).patch(`/api/v1/pharmacy/quarantine/${entry.id}`)
      .set(auth(pharmacyToken)).send({ status: "released" });
    expect(rel.status).toBe(200);
    expect(rel.body.entry.status).toBe("released");

    const wo = await request(app).patch(`/api/v1/pharmacy/quarantine/${entry.id}`)
      .set(auth(adminToken)).send({ status: "written_off" });
    expect(wo.status).toBe(200);
    expect(wo.body.entry.status).toBe("written_off");

    const forbidden = await request(app).post("/api/v1/pharmacy/quarantine")
      .set(auth(custToken)).send({ kit_id: kitId, qty: 1 });
    expect(forbidden.status).toBe(403);
  });

  it("rejects bad payloads: qty, unknown kit, bad status, unknown id", async () => {
    for (const qty of [0, -1, 1.5, "x", null]) {
      const r = await request(app).post("/api/v1/pharmacy/quarantine")
        .set(auth(pharmacyToken)).send({ kit_id: kitId, qty });
      expect(r.status).toBe(400);
    }
    const noKit = await request(app).post("/api/v1/pharmacy/quarantine")
      .set(auth(pharmacyToken)).send({ kit_id: "does-not-exist", qty: 1 });
    expect(noKit.status).toBe(404);

    const badStatus = await request(app).patch("/api/v1/pharmacy/quarantine/some-id")
      .set(auth(pharmacyToken)).send({ status: "bogus" });
    expect(badStatus.status).toBe(400);

    const noId = await request(app).patch("/api/v1/pharmacy/quarantine/does-not-exist")
      .set(auth(pharmacyToken)).send({ status: "released" });
    expect(noId.status).toBe(404);

    const badFilter = await request(app).get("/api/v1/pharmacy/quarantine?status=bogus").set(auth(pharmacyToken));
    expect(badFilter.status).toBe(400);
  });
});

describe("P20 shift summary / P21 couriers / P22 return analytics", () => {
  it("GET /pharmacy/shift-summary returns counts + handover notes shape; 403 for customer", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await request(app).get(`/api/v1/pharmacy/shift-summary?date=${today}`).set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    expect(r.body.date).toBe(today);
    expect(typeof r.body.handled).toBe("number");
    expect(typeof r.body.pending).toBe("number");
    expect(typeof r.body.cod_orders).toBe("number");
    expect(Array.isArray(r.body.handover_notes)).toBe(true);

    const badDate = await request(app).get("/api/v1/pharmacy/shift-summary?date=25-09-2026").set(auth(pharmacyToken));
    expect(badDate.status).toBe(400);

    const cust = await request(app).get("/api/v1/pharmacy/shift-summary").set(auth(custToken));
    expect(cust.status).toBe(403);
  });

  it("GET /pharmacy/couriers/performance aggregates orders/delivered; 403 for customer", async () => {
    // seed a courier order + a delivered one
    const o = await store.createOrder({
      order_no: "JR-B3-C1", user_id: custId, kit_id: kitId,
      subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
      payment_method: "cod", idempotency_key: "b3-c1", shipping_address: {},
    });
    await store.setOrderCourier(o.id, "Pathao", null);
    await store.updateOrder(o.id, { status: "delivered" });

    const r = await request(app).get("/api/v1/pharmacy/couriers/performance").set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    const pathao = r.body.couriers.find((c: { courier: string }) => c.courier === "Pathao");
    expect(pathao).toBeDefined();
    expect(pathao.orders).toBeGreaterThanOrEqual(1);
    expect(pathao.delivered).toBeGreaterThanOrEqual(1);

    const cust = await request(app).get("/api/v1/pharmacy/couriers/performance").set(auth(custToken));
    expect(cust.status).toBe(403);
  });

  it("GET /pharmacy/returns/analytics reads from refunds; 403 for customer", async () => {
    const o = await store.createOrder({
      order_no: "JR-B3-R1", user_id: custId, kit_id: kitId,
      subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
      payment_method: "cod", idempotency_key: "b3-r1", shipping_address: {},
    });
    await store.createRefund({ order_id: o.id, amount_npr: 500, reason: "Damaged in transit", created_by: custId });

    const r = await request(app).get("/api/v1/pharmacy/returns/analytics").set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    const row = r.body.kits.find((k: { kit_id: string }) => k.kit_id === kitId);
    expect(row).toBeDefined();
    expect(row.returns).toBeGreaterThanOrEqual(1);
    expect(row.reasons["Damaged in transit"]).toBeGreaterThanOrEqual(1);

    const cust = await request(app).get("/api/v1/pharmacy/returns/analytics").set(auth(custToken));
    expect(cust.status).toBe(403);
  });
});

describe("P23 pick/pack timer", () => {
  it("pack-start -> pack-complete is idempotent; unknown order 404", async () => {
    const o = await store.createOrder({
      order_no: "JR-B3-P1", user_id: custId, kit_id: kitId,
      subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
      payment_method: "cod", idempotency_key: "b3-p1", shipping_address: {},
    });

    const s1 = await request(app).post(`/api/v1/pharmacy/orders/${o.order_no}/pack-start`).set(auth(pharmacyToken));
    expect(s1.status).toBe(200);
    expect(s1.body.order.pack_started_at).toBeTruthy();

    // re-start is safe (idempotent): still 200, timer reset
    const s2 = await request(app).post(`/api/v1/pharmacy/orders/${o.order_no}/pack-start`).set(auth(pharmacyToken));
    expect(s2.status).toBe(200);
    expect(s2.body.order.pack_started_at).toBeTruthy();

    const c = await request(app).post(`/api/v1/pharmacy/orders/${o.order_no}/pack-complete`).set(auth(pharmacyToken));
    expect(c.status).toBe(200);
    expect(c.body.order.pack_completed_at).toBeTruthy();

    const missing = await request(app).post("/api/v1/pharmacy/orders/does-not-exist/pack-start").set(auth(pharmacyToken));
    expect(missing.status).toBe(404);

    const cust = await request(app).post(`/api/v1/pharmacy/orders/${o.order_no}/pack-start`).set(auth(custToken));
    expect(cust.status).toBe(403);
  });

  it("order outside the fulfilment queue is rejected", async () => {
    const o = await store.createOrder({
      order_no: "JR-B3-P2", user_id: custId, kit_id: kitId,
      subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
      payment_method: "cod", idempotency_key: "b3-p2", shipping_address: {},
    });
    await store.updateOrder(o.id, { status: "cancelled" });
    const r = await request(app).post(`/api/v1/pharmacy/orders/${o.order_no}/pack-start`).set(auth(pharmacyToken));
    expect(r.status).toBe(400);
  });
});

describe("P24 packaging materials CRUD", () => {
  it("create -> list -> patch -> delete lifecycle; 403 for customer", async () => {
    const create = await request(app).post("/api/v1/pharmacy/packaging")
      .set(auth(pharmacyToken)).send({ name: "Mailer box", qty: 50, unit: "pcs", low_threshold: 10 });
    expect(create.status).toBe(201);
    const m = create.body.material;
    expect(m.name).toBe("Mailer box");
    expect(m.qty).toBe(50);
    const matId = m.id;

    const list = await request(app).get("/api/v1/pharmacy/packaging").set(auth(pharmacyToken));
    expect(list.status).toBe(200);
    expect(list.body.materials.map((x: { id: string }) => x.id)).toContain(matId);

    const patch = await request(app).patch(`/api/v1/pharmacy/packaging/${matId}`)
      .set(auth(pharmacyToken)).send({ qty: 45 });
    expect(patch.status).toBe(200);
    expect(patch.body.material.qty).toBe(45);

    const del = await request(app).delete(`/api/v1/pharmacy/packaging/${matId}`).set(auth(pharmacyToken));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
    const del2 = await request(app).delete(`/api/v1/pharmacy/packaging/${matId}`).set(auth(pharmacyToken));
    expect(del2.status).toBe(404);

    const cust = await request(app).get("/api/v1/pharmacy/packaging").set(auth(custToken));
    expect(cust.status).toBe(403);
  });

  it("rejects missing name, bad qty/threshold, unknown id", async () => {
    const noName = await request(app).post("/api/v1/pharmacy/packaging")
      .set(auth(pharmacyToken)).send({ qty: 5 });
    expect(noName.status).toBe(400);

    const badQty = await request(app).post("/api/v1/pharmacy/packaging")
      .set(auth(pharmacyToken)).send({ name: "Tape", qty: -1 });
    expect(badQty.status).toBe(400);

    const noId = await request(app).patch("/api/v1/pharmacy/packaging/does-not-exist")
      .set(auth(pharmacyToken)).send({ qty: 1 });
    expect(noId.status).toBe(404);
  });
});

describe("P25 COD reconciliation", () => {
  it("returns expected vs collected with per-order collected flags; 403 for customer", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const o = await store.createOrder({
      order_no: "JR-B3-D1", user_id: custId, kit_id: kitId,
      subtotal_npr: 500, shipping_npr: 120, total_npr: 620,
      payment_method: "cod", idempotency_key: "b3-d1", shipping_address: {},
    });

    const r = await request(app).get(`/api/v1/pharmacy/cod-reconciliation?date=${today}`).set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    expect(r.body.date).toBe(today);
    const row = r.body.orders.find((x: { order_no: string }) => x.order_no === "JR-B3-D1");
    expect(row).toBeDefined();
    expect(row.collected).toBe(false);
    expect(r.body.expected_npr).toBeGreaterThanOrEqual(620);

    // mark the COD payment as collected -> collected_npr moves
    const payment = await store.createPayment({ order_id: o.id, provider: "cod", amount_npr: 620 });
    await store.updatePayment(payment.id, { status: "succeeded" });

    const r2 = await request(app).get(`/api/v1/pharmacy/cod-reconciliation?date=${today}`).set(auth(pharmacyToken));
    const row2 = r2.body.orders.find((x: { order_no: string }) => x.order_no === "JR-B3-D1");
    expect(row2.collected).toBe(true);
    expect(r2.body.collected_npr).toBeGreaterThanOrEqual(620);

    const badDate = await request(app).get("/api/v1/pharmacy/cod-reconciliation?date=nope").set(auth(pharmacyToken));
    expect(badDate.status).toBe(400);

    const cust = await request(app).get("/api/v1/pharmacy/cod-reconciliation").set(auth(custToken));
    expect(cust.status).toBe(403);
  });
});

describe("P26 low-stock threshold", () => {
  it("PATCH sets threshold; negative/non-integer -> 400; unknown kit -> 404; 403 for customer", async () => {
    const r = await request(app).patch(`/api/v1/pharmacy/kits/${kitId}/threshold`)
      .set(auth(pharmacyToken)).send({ threshold: 3 });
    expect(r.status).toBe(200);
    expect(r.body.kit.low_stock_threshold).toBe(3);

    for (const threshold of [-1, 1.5, "x", null]) {
      const bad = await request(app).patch(`/api/v1/pharmacy/kits/${kitId}/threshold`)
        .set(auth(pharmacyToken)).send({ threshold });
      expect(bad.status).toBe(400);
    }

    const missing = await request(app).patch("/api/v1/pharmacy/kits/does-not-exist/threshold")
      .set(auth(pharmacyToken)).send({ threshold: 2 });
    expect(missing.status).toBe(404);

    const cust = await request(app).patch(`/api/v1/pharmacy/kits/${kitId}/threshold`)
      .set(auth(custToken)).send({ threshold: 9 });
    expect(cust.status).toBe(403);
  });
});

describe("P27 order internal notes", () => {
  it("POST/GET round-trip; notes are isolated per order; 404 unknown order", async () => {
    const o1 = await store.createOrder({
      order_no: "JR-B3-N1", user_id: custId, kit_id: kitId,
      subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
      payment_method: "cod", idempotency_key: "b3-n1", shipping_address: {},
    });
    const o2 = await store.createOrder({
      order_no: "JR-B3-N2", user_id: custId, kit_id: kitId,
      subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
      payment_method: "cod", idempotency_key: "b3-n2", shipping_address: {},
    });

    const p1 = await request(app).post(`/api/v1/pharmacy/orders/${o1.order_no}/notes`)
      .set(auth(pharmacyToken)).send({ note: "Call customer before noon" });
    expect(p1.status).toBe(201);
    expect(p1.body.note.note).toBe("Call customer before noon");
    expect(p1.body.note.order_id).toBe(o1.id);

    const p2 = await request(app).post(`/api/v1/pharmacy/orders/${o2.order_no}/notes`)
      .set(auth(pharmacyToken)).send({ note: "Fragile item inside" });
    expect(p2.status).toBe(201);

    const g1 = await request(app).get(`/api/v1/pharmacy/orders/${o1.order_no}/notes`).set(auth(pharmacyToken));
    expect(g1.status).toBe(200);
    expect(g1.body.notes).toHaveLength(1);
    expect(g1.body.notes[0].note).toBe("Call customer before noon");

    const g2 = await request(app).get(`/api/v1/pharmacy/orders/${o2.order_no}/notes`).set(auth(pharmacyToken));
    expect(g2.body.notes).toHaveLength(1);
    expect(g2.body.notes[0].note).toBe("Fragile item inside");

    const bad = await request(app).post(`/api/v1/pharmacy/orders/${o1.order_no}/notes`)
      .set(auth(pharmacyToken)).send({ note: "   " });
    expect(bad.status).toBe(400);

    const missing = await request(app).get("/api/v1/pharmacy/orders/does-not-exist/notes").set(auth(pharmacyToken));
    expect(missing.status).toBe(404);

    const cust = await request(app).get(`/api/v1/pharmacy/orders/${o1.order_no}/notes`).set(auth(custToken));
    expect(cust.status).toBe(403);
  });
});

describe("U26 gift wiring on POST /orders", () => {
  it("gift fields are persisted and returned on the created order", async () => {
    const r = await request(app).post("/api/v1/orders").set(auth(custToken))
      .set("Idempotency-Key", "b3-gift-1")
      .send({
        ...giftPayload(),
        gift_recipient_name: "Sita",
        gift_recipient_phone: "+9779841999999",
        gift_message: "Happy birthday!",
      });
    expect(r.status).toBe(201);
    expect(r.body.is_gift).toBe(true);
    expect(r.body.gift_recipient_name).toBe("Sita");
    expect(r.body.gift_recipient_phone).toBe("+9779841999999");
    expect(r.body.gift_message).toBe("Happy birthday!");
    giftOrderNo = r.body.id;

    const row = await store.getOrderByNo(giftOrderNo);
    expect(row?.gift_recipient_name).toBe("Sita");
  });

  it("order without gift fields is not a gift", async () => {
    const r = await request(app).post("/api/v1/orders").set(auth(custToken))
      .set("Idempotency-Key", "b3-gift-2")
      .send(giftPayload());
    expect(r.status).toBe(201);
    expect(r.body.is_gift).toBe(false);
    expect(r.body.gift_recipient_name).toBeNull();
  });

  it("empty recipient_name -> 400; other customers' gift fields don't leak", async () => {
    const r = await request(app).post("/api/v1/orders").set(auth(custToken))
      .set("Idempotency-Key", "b3-gift-3")
      .send({ ...giftPayload(), gift_recipient_name: "   " });
    expect(r.status).toBe(400);

    // a second customer cannot read the first customer's order with gift data
    const other = await request(app).get(`/api/v1/orders/${giftOrderNo}`).set(auth(cust2Token));
    expect(other.status).toBe(404);
  });
});
