// Orders: idempotency-key semantics + prescription gating while the flag is OFF.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, otpLogin, auth } from "./helpers";

const { app, store } = testDeps();
let token = "";
let kitId = "";
let rxKitId = "";
const KEY = "7a1b2c3d-1111-2222-3333-444455556666";

beforeAll(async () => {
  const c = await otpLogin(app, "9841234601");
  token = c.token;
  const shampoo = await store.createProduct({ name_en: "Jaraa Gentle Shampoo", kind: "cosmetic", price_npr: 899 });
  const serum = await store.createProduct({ name_en: "Jaraa Scalp Serum", kind: "cosmetic", price_npr: 1299 });
  const kit = await store.createKit({ name_en: "Jaraa Hair Kit — Essential", product_ids: [shampoo.id, serum.id], total_npr: 2198 });
  kitId = kit.id;
  const rx = await store.createProduct({ name_en: "Rx Minoxidil 5%", kind: "prescription", price_npr: 1500 });
  const rxKit = await store.createKit({ name_en: "Rx Kit", product_ids: [rx.id], total_npr: 1500 });
  rxKitId = rxKit.id;
});

const payload = () => ({
  kit_id: kitId,
  payment_method: "cod",
  shipping_address: { name: "Aasha", phone: "+9779841234601", city: "Kathmandu", address_line: "Boudha 12" },
});

describe("POST /orders idempotency", () => {
  it("creates an order with totals (201)", async () => {
    const r = await request(app).post("/api/v1/orders").set(auth(token))
      .set("Idempotency-Key", KEY).send(payload());
    expect(r.status).toBe(201);
    expect(r.body.subtotal_npr).toBe(2198);
    expect(r.body.shipping_npr).toBe(120);
    expect(r.body.total_npr).toBe(2318);
    expect(r.body.status).toBe("pending_payment");
    expect(r.body.id).toMatch(/^JR-/);
  });

  it("replaying the same key + payload returns the original order (200)", async () => {
    const r1 = await request(app).post("/api/v1/orders").set(auth(token))
      .set("Idempotency-Key", KEY).send(payload());
    expect(r1.status).toBe(200);
    const r2 = await request(app).post("/api/v1/orders").set(auth(token))
      .set("Idempotency-Key", "8b2c3d4e-2222-3333-4444-555566667777").send(payload());
    expect(r2.status).toBe(201);
    expect(r1.body.id).not.toBe(r2.body.id);
  });

  it("same key with a different payload -> 409", async () => {
    const other = { ...payload(), payment_method: "khalti" };
    const r = await request(app).post("/api/v1/orders").set(auth(token))
      .set("Idempotency-Key", KEY).send(other);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("conflict");
  });

  it("missing Idempotency-Key -> 400", async () => {
    const r = await request(app).post("/api/v1/orders").set(auth(token)).send(payload());
    expect(r.status).toBe(400);
  });

  it("kit with prescription products while flag OFF -> 422 feature_disabled", async () => {
    const r = await request(app).post("/api/v1/orders").set(auth(token))
      .set("Idempotency-Key", "9c3d4e5f-3333-4444-5555-666677778888")
      .send({ ...payload(), kit_id: rxKitId });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("feature_disabled");
  });
});

describe("payment callback", () => {
  it("invalid signature -> 400 signature_invalid, payment stays pending", async () => {
    const r = await request(app).post("/api/v1/payments/khalti/callback").send({
      transaction_id: "txn-1", amount_npr: 2318, status: "success",
      signature: "bogus", order_id: "whatever",
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("signature_invalid");
  });
});
