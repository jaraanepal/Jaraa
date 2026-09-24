// Feature-flag gating: consults 403 while OFF; prescription products hidden.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, otpLogin, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let customerToken = "";
let adminToken = "";
let rxOnlyKitId = "";
let mixedKitId = "";

beforeAll(async () => {
  const c = await otpLogin(app, "9841234701");
  customerToken = c.token;
  const admin = await store.createUser({ phone: "+9779800000010", role: "admin" });
  adminToken = tokenFor(admin);
  const rx = await store.createProduct({ name_en: "Rx Minoxidil", kind: "prescription", price_npr: 1500 });
  const cosmetic = await store.createProduct({ name_en: "Shampoo", kind: "cosmetic", price_npr: 899 });
  rxOnlyKitId = (await store.createKit({ name_en: "Rx Only Kit", product_ids: [rx.id], total_npr: 1500 })).id;
  mixedKitId = (await store.createKit({ name_en: "Mixed Kit", product_ids: [rx.id, cosmetic.id], total_npr: 2399 })).id;
});

describe("teleconsult_booking flag", () => {
  it("POST /consults/book -> 403 feature_disabled while OFF", async () => {
    const r = await request(app).post("/api/v1/consults/book").set(auth(customerToken)).send({
      doctor_id: "00000000-0000-0000-0000-000000000000",
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("feature_disabled");
    expect(r.body.details.flag).toBe("teleconsult_booking");
  });

  it("admin flips the flag -> booking works (201); flag toggle is audited", async () => {
    const flip = await request(app).put("/api/v1/admin/flags/teleconsult_booking").set(auth(adminToken))
      .send({ is_enabled: true });
    expect(flip.status).toBe(200);
    expect(flip.body.is_enabled).toBe(true);

    const r = await request(app).post("/api/v1/consults/book").set(auth(customerToken)).send({
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      note: "follow-up",
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("scheduled");

    const entries = await store.listAudit({ entity: "flag", limit: 10 });
    expect(entries.some((e) => e.action === "flag.toggle" && e.entity_id === "teleconsult_booking")).toBe(true);

    // flip back OFF for the rest of the suite
    await request(app).put("/api/v1/admin/flags/teleconsult_booking").set(auth(adminToken)).send({ is_enabled: false });
  });
});

describe("prescription_commerce flag", () => {
  it("rx-only kit is hidden from GET /kits and 403 on direct access", async () => {
    const list = await request(app).get("/api/v1/kits");
    expect(list.status).toBe(200);
    const ids = (list.body.kits as { id: string }[]).map((k) => k.id);
    expect(ids).not.toContain(rxOnlyKitId);

    const direct = await request(app).get(`/api/v1/kits/${rxOnlyKitId}`);
    expect(direct.status).toBe(403);
    expect(direct.body.code).toBe("feature_disabled");
  });

  it("mixed kit lists only cosmetic products", async () => {
    const r = await request(app).get(`/api/v1/kits/${mixedKitId}`);
    expect(r.status).toBe(200);
    const kinds = (r.body.products as { kind: string }[]).map((p) => p.kind);
    expect(kinds).not.toContain("prescription");
    expect(kinds).toContain("cosmetic");
  });
});
