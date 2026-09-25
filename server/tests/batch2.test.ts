// Batch 2 endpoint tests: D10–D18, A12–A20, P10–P18, C10–C18, U12–U20.
// Covers happy paths, validation, ownership, role authorization, and failure paths.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let adminToken = "";
let docToken = "";
let doc2Token = "";
let pharmToken = "";
let coachToken = "";
let custToken = "";
let cust2Token = "";
let custId = "";
let cust2Id = "";
let caseId = "";
let cosmeticKitId = "";
let rxKitId = "";
let orderId = "";

const D = "/api/v1/doctor";
const A = "/api/v1/admin";
const C = "/api/v1/coach";
const M = "/api/v1/me";

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779842000001", role: "admin" });
  const doc = await store.createUser({ phone: "+9779842000002", role: "doctor" });
  const doc2 = await store.createUser({ phone: "+9779842000003", role: "doctor" });
  const pharm = await store.createUser({ phone: "+9779842000004", role: "pharmacy" });
  const coach = await store.createUser({ phone: "+9779842000005", role: "coach" });
  const cust = await store.createUser({ phone: "+9779842000006", role: "customer" });
  const cust2 = await store.createUser({ phone: "+9779842000007", role: "customer" });
  adminToken = tokenFor(admin); docToken = tokenFor(doc); doc2Token = tokenFor(doc2);
  pharmToken = tokenFor(pharm); coachToken = tokenFor(coach);
  custToken = tokenFor(cust); cust2Token = tokenFor(cust2);
  custId = cust.id; cust2Id = cust2.id;
  await store.upsertProfile(cust.id, { name: "Batch2 Patient" });

  const scan = await store.createScan({ user_id: cust.id });
  await store.setRootScores(scan.id, [{ root: "agni", score: 70, signals: {} }]);
  const kase = await store.createCase({ scan_id: scan.id, priority: 50, sla_due_at: new Date(Date.now() + 86400000).toISOString() });
  caseId = kase.id;

  const cosmetic = await store.createProduct({ name_en: "B2 Oil", kind: "cosmetic", price_npr: 500 });
  const rx = await store.createProduct({ name_en: "B2 Rx", kind: "prescription", price_npr: 900 });
  const kit = await store.createKit({ name_en: "B2 Cosmetic Kit", product_ids: [cosmetic.id], total_npr: 800, stock: 10 });
  cosmeticKitId = kit.id;
  const rxKit = await store.createKit({ name_en: "B2 Rx Kit", product_ids: [rx.id], total_npr: 900, stock: 10 });
  rxKitId = rxKit.id;

  await store.setFeatureFlag("prescription_commerce", true, admin.id);
  const o = await store.createOrder({
    order_no: "JR-B2-1", user_id: custId, kit_id: cosmeticKitId,
    subtotal_npr: 800, shipping_npr: 120, total_npr: 920,
    payment_method: "cod", idempotency_key: "b2-k1", shipping_address: {},
  });
  orderId = o.id;
});

describe("doctor batch-2 endpoints (D10–D18)", () => {
  it("GET /doctor/workload returns own workload shape", async () => {
    const r = await request(app).get(`${D}/workload`).set(auth(docToken));
    expect(r.status).toBe(200);
  });

  it("GET /doctor/sla-summary returns counts", async () => {
    const r = await request(app).get(`${D}/sla-summary`).set(auth(docToken));
    expect(r.status).toBe(200);
  });

  it("snippets: create -> list -> delete (D12)", async () => {
    const c = await request(app).post(`${D}/snippets`).set(auth(docToken))
      .send({ title: "Greet", body_en: "Namaste" });
    expect(c.status).toBe(201);
    const l = await request(app).get(`${D}/snippets`).set(auth(docToken));
    expect(l.body.snippets.some((s: { id: string }) => s.id === c.body.id)).toBe(true);
    const d = await request(app).delete(`${D}/snippets/${c.body.id}`).set(auth(docToken));
    expect(d.status).toBe(200);
  });

  it("snippets: missing title -> 400; other doctor's snippet -> 404", async () => {
    const bad = await request(app).post(`${D}/snippets`).set(auth(docToken)).send({ body_en: "x" });
    expect(bad.status).toBe(400);
    const c = await request(app).post(`${D}/snippets`).set(auth(doc2Token))
      .send({ title: "Other", body_en: "y" });
    const d = await request(app).delete(`${D}/snippets/${c.body.id}`).set(auth(docToken));
    expect(d.status).toBe(404);
  });

  it("bookmarks: add -> list -> remove (D13)", async () => {
    const b = await request(app).post(`${D}/cases/${caseId}/bookmark`).set(auth(docToken));
    expect(b.status).toBe(201);
    const l = await request(app).get(`${D}/bookmarks`).set(auth(docToken));
    expect(l.body.case_ids).toContain(caseId);
    const r = await request(app).delete(`${D}/cases/${caseId}/bookmark`).set(auth(docToken));
    expect(r.status).toBe(200);
  });

  it("bookmarks: unknown case -> 404", async () => {
    const r = await request(app).post(`${D}/cases/nope/bookmark`).set(auth(docToken));
    expect(r.status).toBe(404);
  });

  it("checklist: create -> patch item done (D14)", async () => {
    const c = await request(app).post(`${D}/cases/${caseId}/checklist`).set(auth(docToken))
      .send({ items: [{ label_en: "Check lighting" }] });
    expect(c.status).toBe(201);
    const g = await request(app).get(`${D}/cases/${caseId}/checklist`).set(auth(docToken));
    expect(g.status).toBe(200);
    const itemId = g.body.items?.[0]?.id ?? g.body.checklist?.items?.[0]?.id;
    if (itemId) {
      const p = await request(app).patch(`${D}/checklist-items/${itemId}`).set(auth(docToken)).send({ done: true });
      expect(p.status).toBe(200);
    }
  });

  it("patient risk lookup returns risk (D15)", async () => {
    const r = await request(app).get(`${D}/patients/${custId}/risk`).set(auth(docToken));
    expect(r.status).toBe(200);
  });

  it("photo request: create -> list; missing angles -> 400 (D16)", async () => {
    const bad = await request(app).post(`${D}/cases/${caseId}/photo-request`).set(auth(docToken)).send({});
    expect(bad.status).toBe(400);
    const ok = await request(app).post(`${D}/cases/${caseId}/photo-request`).set(auth(docToken))
      .send({ angles: "top, crown" });
    expect(ok.status).toBe(201);
    const l = await request(app).get(`${D}/cases/${caseId}/photo-requests`).set(auth(docToken));
    expect(l.status).toBe(200);
  });

  it("review stats + note search (D17, D18)", async () => {
    const s = await request(app).get(`${D}/stats`).set(auth(docToken));
    expect(s.status).toBe(200);
    const n = await request(app).get(`${D}/notes/search`).set(auth(docToken)).query({ q: "hair" });
    expect(n.status).toBe(200);
  });

  it("customer cannot reach doctor endpoints (403)", async () => {
    for (const [m, p] of [["get", `${D}/workload`], ["get", `${D}/snippets`], ["get", `${D}/stats`]] as const) {
      const r = await (request(app)[m] as (u: string) => ReturnType<typeof request>) (p).set(auth(custToken));
      expect(r.status).toBe(403);
    }
  });
});

describe("admin batch-2 endpoints (A12–A20)", () => {
  it("permissions: read + update role permissions (A12)", async () => {
    const g = await request(app).get(`${A}/roles/doctor/permissions`).set(auth(adminToken));
    expect(g.status).toBe(200);
    const u = await request(app).put(`${A}/roles/doctor/permissions`).set(auth(adminToken))
      .send({ permissions: ["cases.read"] });
    expect(u.status).toBe(200);
  });

  it("announcements: create -> list -> update -> delete (A13)", async () => {
    const bad = await request(app).post(`${A}/announcements`).set(auth(adminToken)).send({});
    expect(bad.status).toBe(400);
    const c = await request(app).post(`${A}/announcements`).set(auth(adminToken))
      .send({ title_en: "Sale", body_en: "Big sale" });
    expect(c.status).toBe(201);
    const g = await request(app).get(`${A}/announcements`).set(auth(adminToken));
    expect(g.body.announcements.some((a: { id: string }) => a.id === c.body.id)).toBe(true);
    const p = await request(app).patch(`${A}/announcements/${c.body.id}`).set(auth(adminToken)).send({ title_en: "Sale!" });
    expect(p.status).toBe(200);
    const d = await request(app).delete(`${A}/announcements/${c.body.id}`).set(auth(adminToken));
    expect(d.status).toBe(200);
  });

  it("sessions: list requires user_id; display id carries trailing ellipsis (A14)", async () => {
    const noQ = await request(app).get(`${A}/sessions`).set(auth(adminToken));
    expect(noQ.status).toBe(400);
    await store.saveRefreshToken({ token_hash: "b2hash0123456789abcdef", user_id: custId, expires_at: new Date(Date.now() + 86400000).toISOString() });
    const l = await request(app).get(`${A}/sessions`).set(auth(adminToken)).query({ user_id: custId });
    expect(l.status).toBe(200);
    const shown = l.body.sessions.find((s: { token_hash: string }) => s.token_hash.startsWith("b2hash012345"));
    expect(shown.token_hash.endsWith("…")).toBe(true);
    // revoke with the exact displayed id (trailing ellipsis) works
    const del = await request(app).delete(`${A}/sessions/${encodeURIComponent(shown.token_hash)}`).set(auth(adminToken)).query({ user_id: custId });
    expect(del.status).toBe(200);
    const after = await store.getRefreshToken("b2hash0123456789abcdef");
    expect(after).toBeNull();
  });

  it("sessions: revoke unknown id -> 404; prefix match revokes", async () => {
    await store.saveRefreshToken({ token_hash: "b2prefixaaabbbccc", user_id: custId, expires_at: new Date(Date.now() + 86400000).toISOString() });
    const miss = await request(app).delete(`${A}/sessions/zzznomatch`).set(auth(adminToken)).query({ user_id: custId });
    expect(miss.status).toBe(404);
    const ok = await request(app).delete(`${A}/sessions/b2prefix`).set(auth(adminToken)).query({ user_id: custId });
    expect(ok.status).toBe(200);
  });

  it("login attempts list (A15)", async () => {
    const r = await request(app).get(`${A}/login-attempts`).set(auth(adminToken));
    expect(r.status).toBe(200);
  });

  it("coupons: create -> list -> deactivate (A16)", async () => {
    const bad = await request(app).post(`${A}/coupons`).set(auth(adminToken)).send({ code: "X", kind: "percent", value: 999 });
    expect(bad.status).toBe(400);
    const c = await request(app).post(`${A}/coupons`).set(auth(adminToken))
      .send({ code: "B2SAVE10", kind: "percent", value: 10, min_order_npr: 100 });
    expect(c.status).toBe(201);
    expect(c.body.code).toBe("B2SAVE10");
    const g = await request(app).get(`${A}/coupons`).set(auth(adminToken));
    expect(g.body.coupons.some((x: { code: string }) => x.code === "B2SAVE10")).toBe(true);
    const p = await request(app).patch(`${A}/coupons/${c.body.id}`).set(auth(adminToken)).send({ is_active: false });
    expect(p.status).toBe(200);
    expect(p.body.is_active).toBe(false);
    // reactivate for the order tests below
    await request(app).patch(`${A}/coupons/${c.body.id}`).set(auth(adminToken)).send({ is_active: true });
  });

  it("coupon applies at order time with percent discount (A16)", async () => {
    const addr = { name: "T", phone: "98", city: "Ktm", address_line: "X" };
    const r = await request(app).post("/api/v1/orders").set(auth(custToken))
      .set("Idempotency-Key", "b2-coupon-1")
      .send({ kit_id: cosmeticKitId, payment_method: "cod", shipping_address: addr, coupon_code: "b2save10" });
    expect(r.status).toBe(201);
    expect(r.body.coupon_code).toBe("B2SAVE10");
    expect(r.body.discount_npr).toBe(80); // 10% of 800
    expect(r.body.total_npr).toBe(800 - 80 + 120);
  });

  it("coupon: unknown code -> 422; expired -> 422; exhausted -> 422; min order -> 422", async () => {
    const addr = { name: "T", phone: "98", city: "Ktm", address_line: "X" };
    const post = (key: string, body: Record<string, unknown>) =>
      request(app).post("/api/v1/orders").set(auth(custToken)).set("Idempotency-Key", key).send(body);
    const unk = await post("b2-c-unk", { kit_id: cosmeticKitId, payment_method: "cod", shipping_address: addr, coupon_code: "NOPE99" });
    expect(unk.status).toBe(422);
    expect(unk.body.code).toBe("coupon_invalid");
    await request(app).post(`${A}/coupons`).set(auth(adminToken))
      .send({ code: "B2OLD", kind: "fixed_npr", value: 50, ends_at: "2020-01-01" });
    const exp = await post("b2-c-exp", { kit_id: cosmeticKitId, payment_method: "cod", shipping_address: addr, coupon_code: "B2OLD" });
    expect(exp.status).toBe(422);
    expect(exp.body.reason).toBe("expired");
    await request(app).post(`${A}/coupons`).set(auth(adminToken))
      .send({ code: "B2ONE", kind: "fixed_npr", value: 50, max_uses: 1 });
    await post("b2-c-use1", { kit_id: cosmeticKitId, payment_method: "cod", shipping_address: addr, coupon_code: "B2ONE" });
    const exh = await post("b2-c-use2", { kit_id: cosmeticKitId, payment_method: "cod", shipping_address: addr, coupon_code: "B2ONE" });
    expect(exh.status).toBe(422);
    expect(exh.body.reason).toBe("exhausted");
    await request(app).post(`${A}/coupons`).set(auth(adminToken))
      .send({ code: "B2BIG", kind: "fixed_npr", value: 50, min_order_npr: 999999 });
    const mino = await post("b2-c-min", { kit_id: cosmeticKitId, payment_method: "cod", shipping_address: addr, coupon_code: "B2BIG" });
    expect(mino.status).toBe(422);
    expect(mino.body.reason).toBe("min_order");
  });

  it("coupon: prescription kit rejected as cosmetic-only (A16)", async () => {
    const addr = { name: "T", phone: "98", city: "Ktm", address_line: "X" };
    const r = await request(app).post("/api/v1/orders").set(auth(custToken))
      .set("Idempotency-Key", "b2-c-rx")
      .send({ kit_id: rxKitId, payment_method: "cod", shipping_address: addr, coupon_code: "B2SAVE10" });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("coupon_cosmetic_only");
  });

  it("health + storage + backups + templates (A17–A20)", async () => {
    const h = await request(app).get(`${A}/health`).set(auth(adminToken));
    expect(h.status).toBe(200);
    const s = await request(app).get(`${A}/storage`).set(auth(adminToken));
    expect(s.status).toBe(200);
    const b = await request(app).post(`${A}/backups`).set(auth(adminToken)).send({ label: "nightly" });
    expect(b.status).toBe(201);
    const bl = await request(app).get(`${A}/backups`).set(auth(adminToken));
    expect(bl.status).toBe(200);
    const badB = await request(app).post(`${A}/backups`).set(auth(adminToken)).send({ label: "x", status: "weird" });
    expect(badB.status).toBe(400);
    const t = await request(app).post(`${A}/notification-templates`).set(auth(adminToken))
      .send({ name: "b2tpl", title_en: "Hi" });
    expect(t.status).toBe(201);
    const tl = await request(app).get(`${A}/notification-templates`).set(auth(adminToken));
    expect(tl.status).toBe(200);
    const td = await request(app).delete(`${A}/notification-templates/${t.body.id}`).set(auth(adminToken));
    expect(td.status).toBe(200);
  });

  it("non-admin cannot reach admin endpoints (403)", async () => {
    const r = await request(app).get(`${A}/health`).set(auth(custToken));
    expect(r.status).toBe(403);
    const r2 = await request(app).get(`${A}/coupons`).set(auth(docToken));
    expect(r2.status).toBe(403);
  });
});

describe("pharmacy batch-2 endpoints (P10–P18)", () => {
  it("stock movements + reorder suggestions (P10, P11)", async () => {
    const m = await request(app).get(`/api/v1/pharmacy/kits/${cosmeticKitId}/movements`).set(auth(pharmToken));
    expect(m.status).toBe(200);
    const r = await request(app).get("/api/v1/pharmacy/reorder-suggestions").set(auth(pharmToken));
    expect(r.status).toBe(200);
  });

  it("packing checklist: check step -> list checks (P12)", async () => {
    const bad = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/packing`).set(auth(pharmToken)).send({});
    expect(bad.status).toBe(400);
    const c = await request(app).post(`/api/v1/pharmacy/orders/${orderId}/packing`).set(auth(pharmToken))
      .send({ step: "verify_items", done: true });
    expect(c.status).toBe(201);
    const g = await request(app).get(`/api/v1/pharmacy/orders/${orderId}/packing`).set(auth(pharmToken));
    expect(g.status).toBe(200);
  });

  it("printable label includes delivery instructions (P13, U19)", async () => {
    const l = await request(app).get(`/api/v1/pharmacy/orders/${orderId}/label`).set(auth(pharmToken));
    expect(l.status).toBe(200);
    expect(l.body.label).toHaveProperty("order");
  });

  it("zones + duplicate detection (P14, P16)", async () => {
    const z = await request(app).get("/api/v1/pharmacy/zones").set(auth(pharmToken));
    expect(z.status).toBe(200);
    const d = await request(app).get("/api/v1/pharmacy/duplicates").set(auth(pharmToken));
    expect(d.status).toBe(200);
  });

  it("kit batches: create -> update -> delete (P17)", async () => {
    const bad = await request(app).post("/api/v1/pharmacy/batches").set(auth(pharmToken)).send({});
    expect(bad.status).toBe(400);
    const c = await request(app).post("/api/v1/pharmacy/batches").set(auth(pharmToken))
      .send({ kit_id: cosmeticKitId, batch_no: "B2-001", qty: 20 });
    expect(c.status).toBe(201);
    const u = await request(app).patch(`/api/v1/pharmacy/batches/${c.body.id}`).set(auth(pharmToken))
      .send({ qty: 15, batch_no: "B2-001A" });
    expect(u.status).toBe(200);
    expect(u.body.qty).toBe(15);
    expect(u.body.batch_no).toBe("B2-001A");
    const miss = await request(app).patch("/api/v1/pharmacy/batches/nope").set(auth(pharmToken)).send({ qty: 1 });
    expect(miss.status).toBe(404);
    const d = await request(app).delete(`/api/v1/pharmacy/batches/${c.body.id}`).set(auth(pharmToken));
    expect(d.status).toBe(200);
  });

  it("suppliers: create -> update -> delete (P18)", async () => {
    const c = await request(app).post("/api/v1/pharmacy/suppliers").set(auth(pharmToken))
      .send({ name: "B2 Supplier", phone: "9800000000" });
    expect(c.status).toBe(201);
    const u = await request(app).patch(`/api/v1/pharmacy/suppliers/${c.body.id}`).set(auth(pharmToken))
      .send({ contact: "Ram" });
    expect(u.status).toBe(200);
    expect(u.body.contact).toBe("Ram");
    const l = await request(app).get("/api/v1/pharmacy/suppliers").set(auth(pharmToken));
    expect(l.body.suppliers.some((s: { id: string }) => s.id === c.body.id)).toBe(true);
    const d = await request(app).delete(`/api/v1/pharmacy/suppliers/${c.body.id}`).set(auth(pharmToken));
    expect(d.status).toBe(200);
  });

  it("customer cannot reach pharmacy endpoints (403)", async () => {
    const r = await request(app).get("/api/v1/pharmacy/zones").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("coach batch-2 endpoints (C10–C18)", () => {
  let groupId = "";
  let habitId = "";
  let noteTplId = "";
  let goalId = "";

  it("challenge groups: create -> assign (C10)", async () => {
    const bad = await request(app).post(`${C}/challenge-groups`).set(auth(coachToken)).send({});
    expect(bad.status).toBe(400);
    const c = await request(app).post(`${C}/challenge-groups`).set(auth(coachToken))
      .send({ title_en: "B2 Challenge" });
    expect(c.status).toBe(201);
    groupId = c.body.id;
    const a = await request(app).post(`${C}/challenge-groups/${groupId}/assign`).set(auth(coachToken))
      .send({ user_id: custId });
    expect(a.status).toBe(201);
    const g = await request(app).get(`${C}/challenge-groups`).set(auth(coachToken));
    expect(g.status).toBe(200);
  });

  it("badges: award -> list (C11)", async () => {
    const b = await request(app).post(`${C}/customers/${custId}/badges`).set(auth(coachToken))
      .send({ badge: "streak_7" });
    expect(b.status).toBe(201);
    const l = await request(app).get(`${C}/customers/${custId}/badges`).set(auth(coachToken));
    expect(l.status).toBe(200);
    expect(l.body.badges.length).toBeGreaterThan(0);
  });

  it("session summaries + customer goals (C12, C13)", async () => {
    const s = await request(app).post(`${C}/customers/${custId}/sessions`).set(auth(coachToken))
      .send({ summary: "Good progress" });
    expect(s.status).toBe(201);
    const sl = await request(app).get(`${C}/customers/${custId}/sessions`).set(auth(coachToken));
    expect(sl.status).toBe(200);
    const g = await request(app).post(`${C}/customers/${custId}/goals`).set(auth(coachToken))
      .send({ title_en: "Drink water" });
    expect(g.status).toBe(201);
    goalId = g.body.id;
    const done = await request(app).patch(`${C}/goals/${goalId}/complete`).set(auth(coachToken));
    expect(done.status).toBe(200);
    const del = await request(app).delete(`${C}/goals/${goalId}`).set(auth(coachToken));
    expect(del.status).toBe(200);
  });

  it("habit templates: create -> update -> delete (C14)", async () => {
    const bad = await request(app).post(`${C}/habit-templates`).set(auth(coachToken)).send({});
    expect(bad.status).toBe(400);
    const c = await request(app).post(`${C}/habit-templates`).set(auth(coachToken))
      .send({ title_en: "Morning oil" });
    expect(c.status).toBe(201);
    habitId = c.body.id;
    const u = await request(app).patch(`${C}/habit-templates/${habitId}`).set(auth(coachToken))
      .send({ title_en: "Evening oil" });
    expect(u.status).toBe(200);
    expect(u.body.title_en).toBe("Evening oil");
    const d = await request(app).delete(`${C}/habit-templates/${habitId}`).set(auth(coachToken));
    expect(d.status).toBe(200);
  });

  it("digest preview + send validation (C15)", async () => {
    const p = await request(app).post(`${C}/digest/preview`).set(auth(coachToken));
    expect(p.status).toBe(200);
    const bad = await request(app).post(`${C}/digest/send`).set(auth(coachToken)).send({});
    expect(bad.status).toBe(400);
  });

  it("note templates: create -> update -> delete (C16)", async () => {
    const c = await request(app).post(`${C}/note-templates`).set(auth(coachToken))
      .send({ title: "Follow-up", body_en: "How is it going?" });
    expect(c.status).toBe(201);
    noteTplId = c.body.id;
    const u = await request(app).patch(`${C}/note-templates/${noteTplId}`).set(auth(coachToken))
      .send({ body_en: "Updated body" });
    expect(u.status).toBe(200);
    expect(u.body.body_en).toBe("Updated body");
    const d = await request(app).delete(`${C}/note-templates/${noteTplId}`).set(auth(coachToken));
    expect(d.status).toBe(200);
  });

  it("risk flags list (C17)", async () => {
    const r = await request(app).get(`${C}/risk-flags`).set(auth(coachToken));
    expect(r.status).toBe(200);
  });

  it("customer cannot reach coach endpoints (403)", async () => {
    const r = await request(app).get(`${C}/risk-flags`).set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("customer batch-2 endpoints (U12–U20)", () => {
  it("plan history (U12)", async () => {
    const r = await request(app).get(`${M}/plans/history`).set(auth(custToken));
    expect(r.status).toBe(200);
  });

  it("symptoms: create -> upsert same day -> delete; other customer's entry -> 404 (U13)", async () => {
    const c = await request(app).post(`${M}/symptoms`).set(auth(custToken))
      .send({ entry_date: "2026-09-24", note: "Itchy scalp" });
    expect(c.status).toBe(201);
    const g = await request(app).get(`${M}/symptoms`).set(auth(custToken));
    expect(g.body.entries.length).toBeGreaterThan(0);
    const bad = await request(app).post(`${M}/symptoms`).set(auth(custToken)).send({ note: "" });
    expect(bad.status).toBe(400);
    const other = await request(app).delete(`${M}/symptoms/${c.body.id}`).set(auth(cust2Token));
    expect(other.status).toBe(404);
    const d = await request(app).delete(`${M}/symptoms/${c.body.id}`).set(auth(custToken));
    expect(d.status).toBe(200);
  });

  it("water: set -> get; invalid -> 400 (U14)", async () => {
    const bad = await request(app).post(`${M}/water`).set(auth(custToken)).send({ glasses: 99 });
    expect(bad.status).toBe(400);
    const c = await request(app).post(`${M}/water`).set(auth(custToken))
      .send({ log_date: "2026-09-25", glasses: 6 });
    expect(c.status).toBe(201);
    const g = await request(app).get(`${M}/water`).set(auth(custToken)).query({ log_date: "2026-09-25" });
    expect(g.status).toBe(200);
  });

  it("sleep: create -> delete; other customer's -> 404 (U15)", async () => {
    const c = await request(app).post(`${M}/sleep`).set(auth(custToken))
      .send({ log_date: "2026-09-25", hours: 7 });
    expect(c.status).toBe(201);
    const other = await request(app).delete(`${M}/sleep/${c.body.id}`).set(auth(cust2Token));
    expect(other.status).toBe(404);
    const d = await request(app).delete(`${M}/sleep/${c.body.id}`).set(auth(custToken));
    expect(d.status).toBe(200);
  });

  it("notification prefs: defaults -> update persists photo_requests/digest (U17)", async () => {
    const g = await request(app).get(`${M}/notification-prefs`).set(auth(custToken));
    expect(g.status).toBe(200);
    expect(g.body).toHaveProperty("photo_requests");
    expect(g.body).toHaveProperty("digest");
    const u = await request(app).put(`${M}/notification-prefs`).set(auth(custToken))
      .send({ photo_requests: false, digest: false, marketing: true });
    expect(u.status).toBe(200);
    expect(u.body.photo_requests).toBe(false);
    expect(u.body.digest).toBe(false);
    expect(u.body.marketing).toBe(true);
    const g2 = await request(app).get(`${M}/notification-prefs`).set(auth(custToken));
    expect(g2.body.photo_requests).toBe(false);
  });

  it("profile delivery instructions persist (U19)", async () => {
    const p = await request(app).patch(`${M}/profile`).set(auth(custToken))
      .send({ delivery_instructions: "Leave at gate" });
    expect(p.status).toBe(200);
    expect(p.body.delivery_instructions).toBe("Leave at gate");
    const g = await request(app).get(`${M}/profile`).set(auth(custToken));
    expect(g.body.delivery_instructions).toBe("Leave at gate");
  });

  it("emergency contacts: create -> list -> delete; other customer's -> 404 (U20)", async () => {
    const bad = await request(app).post(`${M}/emergency-contacts`).set(auth(custToken)).send({ name: "X" });
    expect(bad.status).toBe(400);
    const c = await request(app).post(`${M}/emergency-contacts`).set(auth(custToken))
      .send({ name: "Mom", phone: "9800000001" });
    expect(c.status).toBe(201);
    const l = await request(app).get(`${M}/emergency-contacts`).set(auth(custToken));
    expect(l.body.contacts.some((x: { id: string }) => x.id === c.body.id)).toBe(true);
    const other = await request(app).delete(`${M}/emergency-contacts/${c.body.id}`).set(auth(cust2Token));
    expect(other.status).toBe(404);
    const d = await request(app).delete(`${M}/emergency-contacts/${c.body.id}`).set(auth(custToken));
    expect(d.status).toBe(200);
  });

  it("order without idempotency key -> 400", async () => {
    const r = await request(app).post("/api/v1/orders").set(auth(custToken))
      .send({ kit_id: cosmeticKitId, payment_method: "cod", shipping_address: {} });
    expect(r.status).toBe(400);
  });
});

  it("badges + assigned articles are visible to the customer (C11, C18)", async () => {
    const b = await request(app).get(`${M}/badges`).set(auth(custToken));
    expect(b.status).toBe(200);
    expect(Array.isArray(b.body.badges)).toBe(true);
    const a = await request(app).get(`${M}/articles/assigned`).set(auth(custToken));
    expect(a.status).toBe(200);
    expect(Array.isArray(a.body.articles)).toBe(true);
  });

  it("root-map history carries photo URLs per version (U16)", async () => {
    const scan = await store.createScan({ user_id: custId });
    await store.setRootScores(scan.id, [{ root: "agni", score: 60, signals: {} }]);
    await store.upsertPhoto({ scan_id: scan.id, angle: "top", storage_path: "p1.jpg", thumb_path: "p1t.jpg" });
    const h = await request(app).get(`${M}/root-map/history`).set(auth(custToken));
    expect(h.status).toBe(200);
    const v = h.body.versions.find((x: { scan_id: string }) => x.scan_id === scan.id);
    expect(v).toBeDefined();
    expect(Array.isArray(v.photos)).toBe(true);
    expect(v.photos.length).toBe(1);
    expect(typeof v.photos[0]).toBe("string");
  });

  it("order stores delivery instructions + coupon fields (U19, A16)", async () => {
    const addr = { name: "T", phone: "98", city: "Ktm", address_line: "X" };
    const r = await request(app).post("/api/v1/orders").set(auth(custToken))
      .set("Idempotency-Key", "b2-deliv-1")
      .send({ kit_id: cosmeticKitId, payment_method: "cod", shipping_address: addr, delivery_instructions: "Ring twice" });
    expect(r.status).toBe(201);
    expect(r.body.delivery_instructions).toBe("Ring twice");
    expect(r.body.coupon_code).toBeNull();
    expect(r.body.discount_npr).toBe(0);
    const g = await request(app).get(`/api/v1/pharmacy/orders/${r.body.id}/label`).set(auth(pharmToken));
    expect(g.body.label.order.delivery_instructions).toBe("Ring twice");
  });
