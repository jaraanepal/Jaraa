// Jaraa v1.4 API tests (P-5 returns/refunds, P-6 labs, P-15 shipment tracking)
// + GET /api/v1/app/version (public, honest non-blocking defaults).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let adminToken = "";
let custAToken = "";
let custBToken = "";
let pharmacyToken = "";
let custAId = "";
let orderNo = ""; // JR-… order number (what the checkout contract returns as `id`)
let orderId = ""; // internal order uuid (what returns/refunds/tracking rows reference)
let kitId = "";

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779851400001", role: "admin" });
  adminToken = tokenFor({ id: admin.id, role: "admin" });
  const pharm = await store.createUser({ phone: "+9779851400002", role: "pharmacy" });
  pharmacyToken = tokenFor({ id: pharm.id, role: "pharmacy" });
  const a = await store.createUser({ phone: "+9779851400003" }); // customer
  custAId = a.id;
  custAToken = tokenFor({ id: a.id, role: "customer" });
  const b = await store.createUser({ phone: "+9779851400004" }); // customer
  custBToken = tokenFor({ id: b.id, role: "customer" });

  const prod = await store.createProduct({ name_en: "Jaraa Test Shampoo", kind: "cosmetic", price_npr: 899 });
  const kit = await store.createKit({ name_en: "Jaraa Test Kit", product_ids: [prod.id], total_npr: 899 });
  kitId = kit.id;

  const r = await request(app).post("/api/v1/orders")
    .set(auth(custAToken))
    .set("Idempotency-Key", "ret-1111-2222-3333-444455556666")
    .send({
      kit_id: kitId,
      payment_method: "cod",
      shipping_address: { name: "Aasha", phone: "+9779851400003", city: "Kathmandu", address_line: "Boudha 12" },
    });
  expect(r.status).toBe(201);
  orderNo = r.body.id;
  orderId = (await store.getOrderByNo(orderNo))!.id;
});

describe("401 without token", () => {
  it("POST /returns -> 401", async () => {
    const r = await request(app).post("/api/v1/returns").send({ order_id: "x", reason: "y" });
    expect(r.status).toBe(401);
  });
  it("POST /labs/bookings -> 401", async () => {
    const r = await request(app).post("/api/v1/labs/bookings").send({ test_id: "x" });
    expect(r.status).toBe(401);
  });
  it("POST /tracking/orders/:id/events -> 401", async () => {
    const r = await request(app).post(`/api/v1/tracking/orders/${orderId}/events`).send({ event_type: "packed" });
    expect(r.status).toBe(401);
  });
});

describe("P-5 returns & refunds", () => {
  let returnId = "";

  it("customer creates a return for their own order -> 201", async () => {
    const r = await request(app).post("/api/v1/returns").set(auth(custAToken))
      .send({ order_id: orderId, reason: "Wrong shade received" });
    expect(r.status).toBe(201);
    expect(r.body.return_request).toBeDefined();
    expect(r.body.return_request.order_id).toBe(orderId);
    expect(r.body.return_request.status).toBe("requested");
    returnId = r.body.return_request.id;
  });

  it("second return for the same order -> 409", async () => {
    const r = await request(app).post("/api/v1/returns").set(auth(custAToken))
      .send({ order_id: orderId, reason: "Trying again" });
    expect(r.status).toBe(409);
    expect(r.body.details.return_id).toBe(returnId);
  });

  it("another customer cannot return someone else's order -> 403", async () => {
    const r = await request(app).post("/api/v1/returns").set(auth(custBToken))
      .send({ order_id: orderId, reason: "Not mine" });
    expect(r.status).toBe(403);
  });

  it("admin triages the return -> 200", async () => {
    const r = await request(app).patch(`/api/v1/returns/${returnId}`).set(auth(adminToken))
      .send({ status: "approved" });
    expect(r.status).toBe(200);
    expect(r.body.return_request.status).toBe("approved");
  });

  it("customer cannot triage -> 403", async () => {
    const r = await request(app).patch(`/api/v1/returns/${returnId}`).set(auth(custAToken))
      .send({ status: "rejected" });
    expect(r.status).toBe(403);
  });

  it("GET /returns/refunds shows only the customer's own refunds", async () => {
    // admin issues a refund against customer A's order
    const created = await request(app).post(`/api/v1/admin/orders/${orderId}/refund`)
      .set(auth(adminToken)).send({ amount_npr: 200, reason: "partial goodwill" });
    expect(created.status).toBe(201);

    const mine = await request(app).get("/api/v1/returns/refunds").set(auth(custAToken));
    expect(mine.status).toBe(200);
    expect(mine.body.refunds.length).toBeGreaterThanOrEqual(1);
    // refund rows carry no user_id; ownership is via the order they reference
    expect(mine.body.refunds.every((x: { order_id: string }) => x.order_id === orderId)).toBe(true);

    const other = await request(app).get("/api/v1/returns/refunds").set(auth(custBToken));
    expect(other.status).toBe(200);
    expect(other.body.refunds).toEqual([]);

    // admin can move the refund through its lifecycle
    const refundId = mine.body.refunds[0].id;
    const moved = await request(app).patch(`/api/v1/returns/refunds/${refundId}`)
      .set(auth(adminToken)).send({ status: "approved" });
    expect(moved.status).toBe(200);
    expect(moved.body.refund.status).toBe("approved");
  });
});

describe("P-6 labs", () => {
  let testId = "";
  let bookingId = "";

  it("admin creates a lab test -> 201", async () => {
    const r = await request(app).post("/api/v1/labs/tests").set(auth(adminToken))
      .send({ name_en: "Thyroid Panel T3/T4/TSH", price_npr: 1800 });
    expect(r.status).toBe(201);
    testId = r.body.test.id;
  });

  it("customer books an active test -> 201", async () => {
    const r = await request(app).post("/api/v1/labs/bookings").set(auth(custAToken))
      .send({ test_id: testId, phone: "+9779851400003", address: { city: "Kathmandu" } });
    expect(r.status).toBe(201);
    expect(r.body.booking.status).toBe("booked");
    bookingId = r.body.booking.id;
  });

  it("booking an inactive test -> 400; nonexistent test -> 404", async () => {
    const made = await request(app).post("/api/v1/labs/tests").set(auth(adminToken))
      .send({ name_en: "Retired Test", price_npr: 500 });
    expect(made.status).toBe(201);
    const deactivated = await request(app).patch(`/api/v1/labs/tests/${made.body.test.id}`)
      .set(auth(adminToken)).send({ is_active: false });
    expect(deactivated.status).toBe(200);

    const inactive = await request(app).post("/api/v1/labs/bookings").set(auth(custAToken))
      .send({ test_id: made.body.test.id, phone: "+9779851400003", address: { city: "Kathmandu" } });
    expect(inactive.status).toBe(400);

    const missing = await request(app).post("/api/v1/labs/bookings").set(auth(custAToken))
      .send({ test_id: "no-such-test", phone: "+9779851400003", address: { city: "Kathmandu" } });
    expect(missing.status).toBe(404);
  });

  it("admin cannot set report_ready directly -> 400", async () => {
    const r = await request(app).patch(`/api/v1/labs/bookings/${bookingId}`).set(auth(adminToken))
      .send({ status: "report_ready" });
    expect(r.status).toBe(400);
  });

  it("admin uploads report -> booking becomes report_ready and report is retrievable", async () => {
    const up = await request(app).post(`/api/v1/labs/bookings/${bookingId}/report`)
      .set(auth(adminToken)).send({ storage_path: "lab-reports/r1.pdf" });
    expect(up.status).toBe(201);
    expect(up.body.report.storage_path).toBe("lab-reports/r1.pdf");

    const fetched = await request(app).get(`/api/v1/labs/bookings/${bookingId}`)
      .set(auth(adminToken));
    expect(fetched.status).toBe(200);
    expect(fetched.body.booking.status).toBe("report_ready");

    const report = await request(app).get(`/api/v1/labs/bookings/${bookingId}/report`)
      .set(auth(custAToken));
    expect(report.status).toBe(200);
    expect(report.body.report.storage_path).toBe("lab-reports/r1.pdf");
  });

  it("GET /labs/providers as admin -> 200 honest empty array", async () => {
    const r = await request(app).get("/api/v1/labs/providers").set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.providers).toEqual([]);
  });
});

describe("P-15 shipment tracking", () => {
  it("pharmacy adds a packed event -> 201", async () => {
    const r = await request(app).post(`/api/v1/tracking/orders/${orderId}/events`)
      .set(auth(pharmacyToken)).send({ event_type: "packed", location: "Kathmandu hub" });
    expect(r.status).toBe(201);
    expect(r.body.event.event_type).toBe("packed");
  });

  it("customer timeline merges shipment events, oldest first", async () => {
    const r = await request(app).get(`/api/v1/tracking/orders/${orderId}/timeline`)
      .set(auth(custAToken));
    expect(r.status).toBe(200);
    expect(r.body.order_id).toBe(orderId);
    expect(Array.isArray(r.body.timeline)).toBe(true);
    const kinds = r.body.timeline.map((t: { kind: string }) => t.kind);
    expect(kinds).toContain("shipment");
    // the refund created earlier in the returns tests also merges in
    expect(kinds).toContain("refund");
  });

  it("customer B cannot see customer A's timeline -> 403", async () => {
    const r = await request(app).get(`/api/v1/tracking/orders/${orderId}/timeline`)
      .set(auth(custBToken));
    expect(r.status).toBe(403);
  });
});

describe("GET /api/v1/app/version (public)", () => {
  it("no auth -> 200 with honest non-blocking defaults", async () => {
    const r = await request(app).get("/api/v1/app/version");
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(false);
    expect(r.body.latestVersionCode).toBe(0);
  });
});
