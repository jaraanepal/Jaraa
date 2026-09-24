// Admin kit-catalog CRUD: create product, create kit, activate/deactivate.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let adminToken = "";

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779841000002", role: "admin" });
  adminToken = tokenFor({ id: admin.id, role: "admin" });
});

describe("admin catalog", () => {
  let productId = "";
  let kitId = "";

  it("creates a cosmetic product (201)", async () => {
    const r = await request(app).post("/api/v1/admin/products").set(auth(adminToken))
      .send({ name_en: "Jaraa Oil", kind: "cosmetic", price_npr: 750 });
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe("cosmetic");
    productId = r.body.id;
  });

  it("rejects bad kind (400)", async () => {
    const r = await request(app).post("/api/v1/admin/products").set(auth(adminToken))
      .send({ name_en: "X", kind: "magic", price_npr: 10 });
    expect(r.status).toBe(400);
  });

  it("creates a kit from the product (201) and it lists publicly", async () => {
    const r = await request(app).post("/api/v1/admin/kits").set(auth(adminToken))
      .send({ name_en: "Starter Kit", product_ids: [productId], total_npr: 750 });
    expect(r.status).toBe(201);
    kitId = r.body.id;
    const list = await request(app).get("/api/v1/kits");
    expect(list.body.kits.map((k: { id: string }) => k.id)).toContain(kitId);
  });

  it("rejects a kit payload with client-style `name` but no `name_en` (400)", async () => {
    // Regression: the admin UI once sent `name` instead of the server's
    // `name_en`, which the server must reject loudly (not save half a kit).
    const r = await request(app).post("/api/v1/admin/kits").set(auth(adminToken))
      .send({ name: "Wrong Field Kit", price_npr: 500 });
    expect(r.status).toBe(400);
  });

  it("honors is_active=false on create (stays hidden from the public catalog)", async () => {
    const r = await request(app).post("/api/v1/admin/kits").set(auth(adminToken))
      .send({ name_en: "Hidden Kit", product_ids: [productId], total_npr: 999, is_active: false });
    expect(r.status).toBe(201);
    expect(r.body.is_active).toBe(false);
    const list = await request(app).get("/api/v1/kits");
    expect(list.body.kits.map((k: { id: string }) => k.id)).not.toContain(r.body.id);
  });

  it("creates an active kit by default when is_active is omitted", async () => {
    const r = await request(app).post("/api/v1/admin/kits").set(auth(adminToken))
      .send({ name_en: "Default Active Kit", product_ids: [productId], total_npr: 111 });
    expect(r.status).toBe(201);
    expect(r.body.is_active).toBe(true);
  });

  it("rejects a kit with unknown product (400)", async () => {
    const r = await request(app).post("/api/v1/admin/kits").set(auth(adminToken))
      .send({ name_en: "Bad Kit", product_ids: ["nope"], total_npr: 10 });
    expect(r.status).toBe(400);
  });

  it("deactivating a kit hides it from the public catalog", async () => {
    const r = await request(app).patch(`/api/v1/admin/kits/${kitId}`).set(auth(adminToken))
      .send({ is_active: false });
    expect(r.status).toBe(200);
    expect(r.body.is_active).toBe(false);
    const list = await request(app).get("/api/v1/kits");
    expect(list.body.kits.map((k: { id: string }) => k.id)).not.toContain(kitId);
  });

  it("non-admin cannot manage the catalog (403)", async () => {
    const cust = await store.createUser({ phone: "+9779841000003", role: "customer" });
    const t = tokenFor({ id: cust.id, role: "customer" });
    const r = await request(app).post("/api/v1/admin/products").set(auth(t))
      .send({ name_en: "Y", kind: "cosmetic", price_npr: 10 });
    expect(r.status).toBe(403);
  });
});
