// Admin kit management: CRUD, search/filter/pagination, soft-delete,
// kit image upload/remove, and public-catalogue visibility rules.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let adminToken = "";
let custToken = "";

async function testImage(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 120, b: 60 } },
  }).jpeg().toBuffer();
}

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779841000101", role: "admin" });
  adminToken = tokenFor({ id: admin.id, role: "admin" });
  const cust = await store.createUser({ phone: "+9779841000102", role: "customer" });
  custToken = tokenFor({ id: cust.id, role: "customer" });
});

const A = () => ({ Authorization: `Bearer ${adminToken}` });
const C = () => ({ Authorization: `Bearer ${custToken}` });

describe("admin kit RBAC", () => {
  it("rejects unauthenticated admin calls (401)", async () => {
    const r = await request(app).get("/api/v1/admin/kits");
    expect(r.status).toBe(401);
  });
  it("rejects non-admin roles (403)", async () => {
    for (const [method, url] of [["post", "/api/v1/admin/kits"], ["get", "/api/v1/admin/kits"], ["delete", "/api/v1/admin/kits/nope"]] as const) {
      const r = await (request(app) as any)[method](url).set(C()).send({ name_en: "X", total_npr: 1 });
      expect(r.status).toBe(403);
    }
  });
});

describe("admin kit CRUD", () => {
  let kitId = "";
  const full = {
    name_en: "Jaraa Root Revival Kit", name_ne: "जरा रुट किट",
    total_npr: 2499, category: "combo",
    whats_included: "Oil 100ml + Shampoo 200ml",
    usage_instructions: "Apply oil twice a week.",
    stock: 25,
  };

  it("creates a kit with full details (201)", async () => {
    const r = await request(app).post("/api/v1/admin/kits").set(A()).send(full);
    expect(r.status).toBe(201);
    expect(r.body.name_en).toBe(full.name_en);
    expect(r.body.category).toBe("combo");
    expect(r.body.whats_included).toBe(full.whats_included);
    expect(r.body.usage_instructions).toBe(full.usage_instructions);
    expect(r.body.stock).toBe(25);
    expect(r.body.images).toEqual([]);
    expect(r.body.is_active).toBe(true);
    kitId = r.body.id;
  });

  it("creates a minimal kit with sane defaults (201)", async () => {
    const r = await request(app).post("/api/v1/admin/kits").set(A())
      .send({ name_en: "Bare Kit", total_npr: 500 });
    expect(r.status).toBe(201);
    expect(r.body.stock).toBe(0);
    expect(r.body.category).toBe(null);
    expect(r.body.images).toEqual([]);
  });

  it("validates create payload (400)", async () => {
    const cases = [
      [{ total_npr: 10 }, "name_en"],                       // missing name
      [{ name_en: "", total_npr: 10 }, "name_en"],           // empty name
      [{ name_en: "X", total_npr: -5 }, "total_npr"],        // negative price
      [{ name_en: "X", total_npr: 10, stock: -1 }, "stock"], // negative stock
      [{ name_en: "X", total_npr: 10, product_ids: ["nope"] }, "product_ids"], // unknown product
    ];
    for (const [body, field] of cases) {
      const r = await request(app).post("/api/v1/admin/kits").set(A()).send(body);
      expect(r.status).toBe(400);
      expect(r.body.details?.field ?? r.body.code).toBeDefined();
      void field;
    }
  });

  it("reads a kit by id (200) and 404s unknown", async () => {
    const r = await request(app).get(`/api/v1/admin/kits/${kitId}`).set(A());
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(kitId);
    expect(r.status).toBe(200);
    const miss = await request(app).get("/api/v1/admin/kits/00000000-0000-0000-0000-000000000000").set(A());
    expect(miss.status).toBe(404);
  });

  it("edits kit fields (200) and validates (400)", async () => {
    const r = await request(app).patch(`/api/v1/admin/kits/${kitId}`).set(A())
      .send({ stock: 40, category: "hair-oil", whats_included: "Oil 200ml" });
    expect(r.status).toBe(200);
    expect(r.body.stock).toBe(40);
    expect(r.body.category).toBe("hair-oil");
    const bad = await request(app).patch(`/api/v1/admin/kits/${kitId}`).set(A()).send({ stock: -3 });
    expect(bad.status).toBe(400);
    const miss = await request(app).patch("/api/v1/admin/kits/00000000-0000-0000-0000-000000000000").set(A()).send({ stock: 1 });
    expect(miss.status).toBe(404);
  });

  it("lists with search / category / active filters + pagination", async () => {
    await request(app).post("/api/v1/admin/kits").set(A())
      .send({ name_en: "Shine Shampoo", total_npr: 899, category: "shampoo", stock: 10 });
    await request(app).post("/api/v1/admin/kits").set(A())
      .send({ name_en: "Grow Serum", total_npr: 1299, category: "serum", stock: 5, is_active: undefined });

    const all = await request(app).get("/api/v1/admin/kits").set(A());
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(4);
    expect(all.body.kits.length).toBeLessThanOrEqual(all.body.total);

    const search = await request(app).get("/api/v1/admin/kits").set(A()).query({ search: "shine" });
    expect(search.body.total).toBe(1);
    expect(search.body.kits[0].name_en).toBe("Shine Shampoo");

    const cat = await request(app).get("/api/v1/admin/kits").set(A()).query({ category: "shampoo" });
    expect(cat.body.total).toBe(1);

    const p1 = await request(app).get("/api/v1/admin/kits").set(A()).query({ limit: 2, offset: 0 });
    const p2 = await request(app).get("/api/v1/admin/kits").set(A()).query({ limit: 2, offset: 2 });
    expect(p1.body.kits).toHaveLength(2);
    expect(p2.body.kits.length).toBeGreaterThan(0);
    const ids1 = new Set(p1.body.kits.map((k: { id: string }) => k.id));
    for (const k of p2.body.kits) expect(ids1.has(k.id)).toBe(false);
  });

  it("soft-deletes a kit: admin still sees it, public catalog hides it", async () => {
    const del = await request(app).delete(`/api/v1/admin/kits/${kitId}`).set(A());
    expect(del.status).toBe(200);
    expect(del.body.is_active).toBe(false);

    // admin detail still works (inactive kits are manageable)
    const adminGet = await request(app).get(`/api/v1/admin/kits/${kitId}`).set(A());
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.is_active).toBe(false);

    // admin list with is_active=false finds it
    const filtered = await request(app).get("/api/v1/admin/kits").set(A()).query({ is_active: "false" });
    expect(filtered.body.kits.map((k: { id: string }) => k.id)).toContain(kitId);

    // public catalogue must NOT leak it
    const pub = await request(app).get("/api/v1/kits");
    expect(pub.body.kits.map((k: { id: string }) => k.id)).not.toContain(kitId);
    const pubOne = await request(app).get(`/api/v1/kits/${kitId}`);
    expect(pubOne.status).toBe(404);
  });
});

describe("admin kit image uploads", () => {
  let kitId = "";

  beforeAll(async () => {
    const r = await request(app).post("/api/v1/admin/kits").set(A())
      .send({ name_en: "Photo Kit", total_npr: 999, stock: 3 });
    kitId = r.body.id;
  });

  it("uploads an image and appends the URL (201)", async () => {
    const img = await testImage();
    const r = await request(app).post(`/api/v1/admin/kits/${kitId}/images`).set(A())
      .attach("image", img, "kit.jpg");
    expect(r.status).toBe(201);
    expect(r.body.image_url).toMatch(/^memory:\/\/kit-images\//);
    expect(r.body.thumb_url).toMatch(/-thumb\.jpg$/);
    expect(r.body.images).toHaveLength(1);

    const img2 = await testImage();
    const r2 = await request(app).post(`/api/v1/admin/kits/${kitId}/images`).set(A())
      .attach("image", img2, "kit2.jpg");
    expect(r2.status).toBe(201);
    expect(r2.body.images).toHaveLength(2);
  });

  it("exposes uploaded images on the public catalogue", async () => {
    const pub = await request(app).get(`/api/v1/kits/${kitId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.images).toHaveLength(2);
    expect(pub.body.stock).toBe(3);
    expect(pub.body.category).toBe(null);
  });

  it("rejects a non-image upload and a missing file", async () => {
    const bad = await request(app).post(`/api/v1/admin/kits/${kitId}/images`).set(A())
      .attach("image", Buffer.from("not an image"), "evil.txt");
    expect(bad.status).toBe(400);
    const missing = await request(app).post(`/api/v1/admin/kits/${kitId}/images`).set(A()).send({});
    expect(missing.status).toBe(400);
  });

  it("removes one image from storage and the array", async () => {
    const before = await request(app).get(`/api/v1/admin/kits/${kitId}`).set(A());
    const url: string = before.body.images[0];
    const del = await request(app).delete(`/api/v1/admin/kits/${kitId}/images`).set(A())
      .send({ image_url: url });
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(url);
    expect(del.body.images).toHaveLength(1);
    expect(del.body.images).not.toContain(url);

    const badUrl = await request(app).delete(`/api/v1/admin/kits/${kitId}/images`).set(A())
      .send({ image_url: "memory://kit-images/kits/nope.jpg" });
    expect(badUrl.status).toBe(400);
  });

  it("non-admin cannot upload kit images (403)", async () => {
    const img = await testImage();
    const r = await request(app).post(`/api/v1/admin/kits/${kitId}/images`).set(C())
      .attach("image", img, "kit.jpg");
    expect(r.status).toBe(403);
  });
});
