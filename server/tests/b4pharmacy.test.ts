// Batch-4 (010) pharmacy routes P28–P45: role gates, validation, bulk status,
// rush-first queue, refund admin gate, proof upload (scan-photos bucket).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let pharmacyToken = "";
let adminToken = "";
let custToken = "";
let custId = "";
let kitId = "";
let kit2Id = "";
let orderId = "";
let order2Id = "";

async function jpeg() {
  return sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 210, g: 190, b: 170 } },
  }).jpeg().toBuffer();
}

function mkOrder(no: string, status: "paid" | "packed" = "paid") {
  return store.createOrder({
    order_no: no, user_id: custId, kit_id: kitId,
    subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
    payment_method: "cod", idempotency_key: `b4-${no}`,
    shipping_address: { name: "B4 Customer", phone: "+9779841040003", city: "Kathmandu", address_line: "Boudha 5" },
    status,
  });
}

beforeAll(async () => {
  const pharmacy = await store.createUser({ phone: "+9779841040001", role: "pharmacy" });
  const admin = await store.createUser({ phone: "+9779841040002", role: "admin" });
  const cust = await store.createUser({ phone: "+9779841040003", role: "customer" });
  pharmacyToken = tokenFor(pharmacy);
  adminToken = tokenFor(admin);
  custToken = tokenFor(cust);
  custId = cust.id;

  const product = await store.createProduct({ name_en: "B4 Oil", kind: "cosmetic", price_npr: 500 });
  const kit = await store.createKit({ name_en: "B4 Kit", product_ids: [product.id], total_npr: 500, stock: 10 });
  kitId = kit.id;
  const kit2 = await store.createKit({ name_en: "B4 Kit 2", product_ids: [product.id], total_npr: 700, stock: 5 });
  kit2Id = kit2.id;

  const o1 = await mkOrder("JR-B4-1");
  const o2 = await mkOrder("JR-B4-2");
  orderId = o1.id;
  order2Id = o2.id;
});

describe("role gates (P28–P45)", () => {
  it("customer gets 403 on pharmacy routes", async () => {
    for (const r of [
      await request(app).get("/api/v1/pharmacy/manifest").set(auth(custToken)),
      await request(app).post(`/api/v1/pharmacy/orders/${orderId}/attempts`).set(auth(custToken)).send({ status: "failed" }),
      await request(app).get("/api/v1/pharmacy/batches/expiring").set(auth(custToken)),
      await request(app).post("/api/v1/pharmacy/courier-claims").set(auth(custToken)).send({ courier_name: "X", reason: "y" }),
      await request(app).get("/api/v1/pharmacy/holidays").set(auth(custToken)),
    ]) {
      expect(r.status).toBe(403);
    }
  });

  it("refund decision is admin-only: pharmacy 403, admin 200", async () => {
    const created = await request(app)
      .post(`/api/v1/pharmacy/orders/${orderId}/refund-request`)
      .set(auth(pharmacyToken)).send({ reason: "damaged in transit" });
    expect(created.status).toBe(201);
    const id = created.body.request.id;

    const asPharmacy = await request(app)
      .patch(`/api/v1/pharmacy/refund-requests/${id}/decide`)
      .set(auth(pharmacyToken)).send({ approved: true });
    expect(asPharmacy.status).toBe(403);

    const asAdmin = await request(app)
      .patch(`/api/v1/pharmacy/refund-requests/${id}/decide`)
      .set(auth(adminToken)).send({ approved: true });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.request.status).toBe("approved");
  });
});

describe("validation (P28–P45)", () => {
  it("attempt with bad status -> 400", async () => {
    const r = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/attempts`)
      .set(auth(pharmacyToken)).send({ status: "teleported" });
    expect(r.status).toBe(400);
  });

  it("monthly CSV with bad month -> 400", async () => {
    const r = await request(app).get("/api/v1/pharmacy/reports/monthly.csv?month=2026-13")
      .set(auth(pharmacyToken));
    expect(r.status).toBe(400);
  });

  it("bulk status with invalid target -> 400; empty ids -> 400", async () => {
    const bad = await request(app).post("/api/v1/pharmacy/orders/bulk-status")
      .set(auth(pharmacyToken)).send({ ids: [orderId], status: "teleported" });
    expect(bad.status).toBe(400);
    const empty = await request(app).post("/api/v1/pharmacy/orders/bulk-status")
      .set(auth(pharmacyToken)).send({ ids: [], status: "packed" });
    expect(empty.status).toBe(400);
  });

  it("holiday duplicate date -> 409; bad date -> 400", async () => {
    const first = await request(app).post("/api/v1/pharmacy/holidays")
      .set(auth(pharmacyToken)).send({ date: "2026-10-20", label: "Dashain" });
    expect(first.status).toBe(201);
    const dup = await request(app).post("/api/v1/pharmacy/holidays")
      .set(auth(pharmacyToken)).send({ date: "2026-10-20", label: "Again" });
    expect(dup.status).toBe(409);
    const bad = await request(app).post("/api/v1/pharmacy/holidays")
      .set(auth(pharmacyToken)).send({ date: "20-10-2026", label: "Bad" });
    expect(bad.status).toBe(400);
    const del = await request(app).delete(`/api/v1/pharmacy/holidays/${first.body.holiday.id}`)
      .set(auth(pharmacyToken));
    expect(del.status).toBe(200);
  });
});

describe("bulk status + rush-first queue (P29/P34)", () => {
  it("bulk advances paid -> packed for both orders", async () => {
    const r = await request(app).post("/api/v1/pharmacy/orders/bulk-status")
      .set(auth(pharmacyToken)).send({ ids: [orderId, order2Id], status: "packed" });
    expect(r.status).toBe(200);
    expect(r.body.updated).toHaveLength(2);
    expect(r.body.updated.every((o: { status: string }) => o.status === "packed")).toBe(true);
  });

  it("queue lists rush orders first", async () => {
    await request(app).patch(`/api/v1/pharmacy/orders/${order2Id}/rush`)
      .set(auth(pharmacyToken)).send({ rush: true });
    const q = await request(app).get("/api/v1/pharmacy/orders").set(auth(pharmacyToken));
    expect(q.status).toBe(200);
    // contract order id is the human order_no (pre-existing shop contract)
    const ids = q.body.orders.map((o: { id: string }) => o.id);
    expect(ids[0]).toBe("JR-B4-2");
    expect(q.body.orders[0].is_rush).toBe(true);
  });
});

describe("re-verify checks (P28)", () => {
  it("POST /checks/reverify recreates pending checks", async () => {
    const r = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/checks/reverify`)
      .set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    expect(r.body.checks).toHaveLength(3);
    // OrderCheck has no status column: pending == checked_by null
    expect(r.body.checks.every((c: { checked_by: string | null }) => c.checked_by === null)).toBe(true);
    expect(r.body.checks.map((c: { check_type: string }) => c.check_type).sort())
      .toEqual(["address", "name", "phone"]);
  });
});

describe("attempts + manifest + search (P31/P32/P42)", () => {
  it("attempt lifecycle + validation", async () => {
    const created = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/attempts`)
      .set(auth(pharmacyToken)).send({ status: "failed", note: "nobody home" });
    expect(created.status).toBe(201);
    expect(created.body.attempt.status).toBe("failed");

    const list = await request(app).get(`/api/v1/pharmacy/orders/${orderId}/attempts`)
      .set(auth(pharmacyToken));
    expect(list.status).toBe(200);
    expect(list.body.attempts.map((a: { id: string }) => a.id)).toContain(created.body.attempt.id);
  });

  it("manifest returns today's queue", async () => {
    const r = await request(app).get("/api/v1/pharmacy/manifest").set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    expect(r.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.total).toBeGreaterThanOrEqual(2);
  });

  it("search finds the order by phone fragment", async () => {
    const r = await request(app).get("/api/v1/pharmacy/orders/search?q=9841040003")
      .set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    // contract id is the human order_no
    expect(r.body.orders.map((o: { id: string }) => o.id)).toContain("JR-B4-1");
  });
});

describe("stock count + expiring batches (P33/P36-alt)", () => {
  it("count posts variance; history lists it", async () => {
    const r = await request(app).post(`/api/v1/pharmacy/kits/${kitId}/count`)
      .set(auth(pharmacyToken)).send({ counted_qty: 7 });
    expect(r.status).toBe(201);
    expect(r.body.count.counted_qty).toBe(7);
    expect(r.body.count.system_qty).toBe(10);
    expect(r.body.count.variance).toBe(-3);

    const hist = await request(app).get(`/api/v1/pharmacy/kits/${kitId}/counts`)
      .set(auth(pharmacyToken));
    expect(hist.status).toBe(200);
    expect(hist.body.counts.length).toBeGreaterThanOrEqual(1);
  });

  it("expiring batches surface soon-expiring kit batches", async () => {
    const soon = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    await store.createKitBatch(kitId, { batch_no: "B4-EXP", expires_on: soon, qty: 4 });
    const r = await request(app).get("/api/v1/pharmacy/batches/expiring?days=30")
      .set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    const found = r.body.batches.find((b: { batch_no: string }) => b.batch_no === "B4-EXP");
    expect(found).toBeDefined();
    expect(found.days_left).toBeLessThanOrEqual(10);
  });
});

describe("monthly CSV (P37)", () => {
  it("returns text/csv with BOM + header", async () => {
    const r = await request(app).get("/api/v1/pharmacy/reports/monthly.csv?month=2026-09")
      .set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.text.charCodeAt(0)).toBe(0xFEFF);
    expect(r.text).toContain("order_no,order_date,status,kit_name");
  });
});

describe("substitutions + proof upload (P38/P39)", () => {
  it("substitution lifecycle", async () => {
    const created = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/substitutions`)
      .set(auth(pharmacyToken)).send({ from_kit_id: kitId, to_kit_id: kit2Id, reason: "OOS" });
    expect(created.status).toBe(201);
    expect(created.body.substitution.reason).toBe("OOS");

    const list = await request(app).get(`/api/v1/pharmacy/orders/${orderId}/substitutions`)
      .set(auth(pharmacyToken));
    expect(list.body.substitutions.map((s: { id: string }) => s.id))
      .toContain(created.body.substitution.id);
  });

  it("proof upload -> 201 with signed url; customer 403; non-image 400", async () => {
    const up = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/proof`)
      .set(auth(pharmacyToken))
      .field("note", "left at door")
      .attach("photo", await jpeg(), "proof.jpg");
    expect(up.status).toBe(201);
    expect(up.body.proof.url).toBeTruthy();
    expect(up.body.proof.storage_path).toContain(`proofs/${orderId}/`);

    const cust = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/proof`)
      .set(auth(custToken)).attach("photo", await jpeg(), "proof.jpg");
    expect(cust.status).toBe(403);

    const bad = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/proof`)
      .set(auth(pharmacyToken)).attach("photo", Buffer.from("not-an-image"), "x.txt");
    expect(bad.status).toBe(400);
  });
});

describe("announcements + claims (P40/P45)", () => {
  it("active announcements are visible to pharmacy", async () => {
    await store.createAnnouncement({ title_en: "B4 notice", body_en: "hello", created_by: null });
    const r = await request(app).get("/api/v1/pharmacy/announcements").set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    expect(r.body.announcements.map((a: { title_en: string }) => a.title_en)).toContain("B4 notice");
  });

  it("courier claim lifecycle", async () => {
    const created = await request(app).post("/api/v1/pharmacy/courier-claims")
      .set(auth(pharmacyToken)).send({ courier_name: "Pathao", amount_npr: 500, reason: "box crushed" });
    expect(created.status).toBe(201);
    expect(created.body.claim.status).toBe("open");

    const patched = await request(app).patch(`/api/v1/pharmacy/courier-claims/${created.body.claim.id}`)
      .set(auth(pharmacyToken)).send({ status: "settled" });
    expect(patched.status).toBe(200);
    expect(patched.body.claim.status).toBe("settled");

    const bad = await request(app).patch(`/api/v1/pharmacy/courier-claims/${created.body.claim.id}`)
      .set(auth(pharmacyToken)).send({ status: "lost" });
    expect(bad.status).toBe(400);
  });
});
