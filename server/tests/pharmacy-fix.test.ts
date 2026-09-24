// TEMPORARY verification test for the pharmacy fulfilment fixes:
// order resolution by order_no, contract<->DB status mapping, role gating.
// This file is a scratch verification — kept because it guards the fix.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, otpLogin, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let custToken = "";
let pharmToken = "";
let kitId = "";
let orderNo = "";

beforeAll(async () => {
  const c = await otpLogin(app, "9841234999");
  custToken = c.token;
  const shampoo = await store.createProduct({ name_en: "Fix Shampoo", kind: "cosmetic", price_npr: 500 });
  const kit = await store.createKit({ name_en: "Fix Kit", product_ids: [shampoo.id], total_npr: 500 });
  kitId = kit.id;
  const pharm = await store.createUser({ phone: "+9779841000001", role: "pharmacy" });
  pharmToken = tokenFor({ id: pharm.id, role: "pharmacy" });
  const r = await request(app).post("/api/v1/orders").set(auth(custToken))
    .set("Idempotency-Key", "fix-key-0001-aaaa-bbbb-ccccddddeeee")
    .send({ kit_id: kitId, payment_method: "cod",
      shipping_address: { name: "T", phone: "+9779841234999", city: "Ktm", address_line: "X" } });
  expect(r.status).toBe(201);
  orderNo = r.body.id;
  expect(orderNo).toMatch(/^JR-/);
});

describe("pharmacy fulfilment (fixed)", () => {
  it("GET /pharmacy/orders lists the order for pharmacy role", async () => {
    const r = await request(app).get("/api/v1/pharmacy/orders").set(auth(pharmToken));
    expect(r.status).toBe(200);
    expect(r.body.orders.map((o: { id: string }) => o.id)).toContain(orderNo);
  });

  it("customer cannot access the pharmacy queue (403)", async () => {
    const r = await request(app).get("/api/v1/pharmacy/orders").set(auth(custToken));
    expect(r.status).toBe(403);
  });

  it("PATCH by order_no with contract status 'packed' works", async () => {
    const r = await request(app).patch(`/api/v1/pharmacy/orders/${orderNo}`)
      .set(auth(pharmToken)).send({ status: "packed" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("packed");
  });

  it("PATCH also accepts DB status name 'shipped'", async () => {
    const r = await request(app).patch(`/api/v1/pharmacy/orders/${orderNo}`)
      .set(auth(pharmToken)).send({ status: "shipped", fulfilment_note: "sent via courier" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("shipped");
  });

  it("PATCH rejects unknown status (400)", async () => {
    const r = await request(app).patch(`/api/v1/pharmacy/orders/${orderNo}`)
      .set(auth(pharmToken)).send({ status: "flying" });
    expect(r.status).toBe(400);
  });

  it("GET /orders/:id resolves by order_no", async () => {
    const r = await request(app).get(`/api/v1/orders/${orderNo}`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("shipped");
  });

  it("customer cannot PATCH fulfilment (403)", async () => {
    const r = await request(app).patch(`/api/v1/pharmacy/orders/${orderNo}`)
      .set(auth(custToken)).send({ status: "delivered" });
    expect(r.status).toBe(403);
  });
});
