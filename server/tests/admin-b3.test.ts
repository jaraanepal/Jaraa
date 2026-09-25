// Admin Batch-3 endpoints (A21–A29): disputes, payouts, moderation,
// plan templates, scan quality, kit leaderboard, export schedules,
// staff checklist, audit CSV export.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let adminToken = "";
let adminId = "";
let doctorToken = "";
let customerToken = "";
let custId = "";

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779843000000", role: "admin" });
  adminId = admin.id;
  adminToken = tokenFor({ id: admin.id, role: "admin" });

  const doc = await store.createUser({ phone: "+9779843000002", role: "doctor" });
  doctorToken = tokenFor({ id: doc.id, role: "doctor" });

  const c = await store.createUser({ phone: "+9779843000003" });
  custId = c.id;
  customerToken = tokenFor({ id: c.id, role: "customer" });
});

describe("RBAC — batch-3 admin endpoints", () => {
  it("doctor gets 403 everywhere", async () => {
    const reqs = [
      request(app).get("/api/v1/admin/disputes"),
      request(app).post("/api/v1/admin/disputes").send({}),
      request(app).get("/api/v1/admin/disputes/x"),
      request(app).post("/api/v1/admin/disputes/x/resolve").send({}),
      request(app).get("/api/v1/admin/payouts?month=2026-09"),
      request(app).get("/api/v1/admin/moderation"),
      request(app).post("/api/v1/admin/moderation/x/decide").send({}),
      request(app).get("/api/v1/admin/plan-templates"),
      request(app).post("/api/v1/admin/plan-templates").send({}),
      request(app).patch("/api/v1/admin/plan-templates/x").send({}),
      request(app).delete("/api/v1/admin/plan-templates/x"),
      request(app).get("/api/v1/admin/scan-quality"),
      request(app).get("/api/v1/admin/kits/leaderboard"),
      request(app).get("/api/v1/admin/export-schedules"),
      request(app).post("/api/v1/admin/export-schedules").send({}),
      request(app).get("/api/v1/admin/staff/x/checklist"),
      request(app).patch("/api/v1/admin/staff/x/checklist").send({}),
      request(app).get("/api/v1/admin/audit/export.csv"),
    ];
    for (const q of reqs) {
      const r = await q.set(auth(doctorToken));
      expect(r.status).toBe(403);
    }
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/admin/disputes").set(auth(customerToken));
    expect(r.status).toBe(403);
    const csv = await request(app).get("/api/v1/admin/audit/export.csv").set(auth(customerToken));
    expect(csv.status).toBe(403);
  });
});

describe("disputes (A21)", () => {
  it("full cycle: file -> list -> get -> resolve", async () => {
    const c = await request(app).post("/api/v1/admin/disputes")
      .set(auth(adminToken))
      .send({ order_id: "ord-1", user_id: custId, subject: "Wrong kit", body: "Got the wrong kit." });
    expect(c.status).toBe(201);
    expect(c.body.dispute.status).toBe("open");
    const id = c.body.dispute.id;

    const list = await request(app).get("/api/v1/admin/disputes").set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.disputes.map((d: { id: string }) => d.id)).toContain(id);

    const open = await request(app).get("/api/v1/admin/disputes?status=open").set(auth(adminToken));
    expect(open.body.disputes.map((d: { id: string }) => d.id)).toContain(id);

    const get = await request(app).get(`/api/v1/admin/disputes/${id}`).set(auth(adminToken));
    expect(get.status).toBe(200);
    expect(get.body.dispute.subject).toBe("Wrong kit");

    const res = await request(app).post(`/api/v1/admin/disputes/${id}/resolve`)
      .set(auth(adminToken)).send({ resolution: "Refunded in full.", approved: true });
    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe("resolved");
    expect(res.body.dispute.resolved_at).toBeTruthy();
    expect(res.body.dispute.resolution).toBe("Refunded in full.");

    const resolved = await request(app).get("/api/v1/admin/disputes?status=resolved").set(auth(adminToken));
    expect(resolved.body.disputes.map((d: { id: string }) => d.id)).toContain(id);
  });

  it("reject path sets status rejected", async () => {
    const c = await request(app).post("/api/v1/admin/disputes")
      .set(auth(adminToken))
      .send({ order_id: "ord-2", user_id: custId, subject: "Late", body: "Order is late." });
    const r = await request(app).post(`/api/v1/admin/disputes/${c.body.dispute.id}/resolve`)
      .set(auth(adminToken)).send({ resolution: "Delivered on time per tracking.", approved: false });
    expect(r.status).toBe(200);
    expect(r.body.dispute.status).toBe("rejected");
  });

  it("validates filing fields", async () => {
    expect((await request(app).post("/api/v1/admin/disputes").set(auth(adminToken)).send({})).status).toBe(400);
    const r = await request(app).post("/api/v1/admin/disputes")
      .set(auth(adminToken)).send({ order_id: "o", user_id: "u", subject: "", body: "b" });
    expect(r.status).toBe(400);
  });

  it("validates status filter + resolve payload, 404s unknown", async () => {
    expect((await request(app).get("/api/v1/admin/disputes?status=bogus").set(auth(adminToken))).status).toBe(400);
    expect((await request(app).get("/api/v1/admin/disputes/nope").set(auth(adminToken))).status).toBe(404);
    const c = await request(app).post("/api/v1/admin/disputes")
      .set(auth(adminToken))
      .send({ order_id: "o", user_id: "u", subject: "s", body: "b" });
    const bad = await request(app).post(`/api/v1/admin/disputes/${c.body.dispute.id}/resolve`)
      .set(auth(adminToken)).send({ resolution: "", approved: true });
    expect(bad.status).toBe(400);
    const noApprove = await request(app).post(`/api/v1/admin/disputes/${c.body.dispute.id}/resolve`)
      .set(auth(adminToken)).send({ resolution: "fine" });
    expect(noApprove.status).toBe(400);
    expect((await request(app).post("/api/v1/admin/disputes/nope/resolve")
      .set(auth(adminToken)).send({ resolution: "x", approved: true })).status).toBe(404);
  });
});

describe("payouts (A22)", () => {
  it("requires a valid month and returns counts", async () => {
    expect((await request(app).get("/api/v1/admin/payouts").set(auth(adminToken))).status).toBe(400);
    expect((await request(app).get("/api/v1/admin/payouts?month=sept").set(auth(adminToken))).status).toBe(400);
    expect((await request(app).get("/api/v1/admin/payouts?month=2026-13").set(auth(adminToken))).status).toBe(400);
    const r = await request(app).get("/api/v1/admin/payouts?month=2026-09").set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.payouts)).toBe(true);
    // out-of-range month returns []
    const far = await request(app).get("/api/v1/admin/payouts?month=1999-01").set(auth(adminToken));
    expect(far.body.payouts).toEqual([]);
  });
});

describe("moderation (A23)", () => {
  it("approve and reject flow", async () => {
    const t1 = await store.createCommunityTip(custId, "Good oil", "Coconut oil helps.");
    const t2 = await store.createCommunityTip(custId, "Bad tip", "Bad advice.");

    const q = await request(app).get("/api/v1/admin/moderation").set(auth(adminToken));
    expect(q.status).toBe(200);
    expect(q.body.tips.map((x: { id: string }) => x.id)).toContain(t1.id);

    const ok = await request(app).post(`/api/v1/admin/moderation/${t1.id}/decide`)
      .set(auth(adminToken)).send({ approved: true });
    expect(ok.status).toBe(200);
    expect(ok.body.tip.status).toBe("approved");
    expect(ok.body.tip.moderated_by).toBe(adminId);

    const no = await request(app).post(`/api/v1/admin/moderation/${t2.id}/decide`)
      .set(auth(adminToken)).send({ approved: false });
    expect(no.status).toBe(200);
    expect(no.body.tip.status).toBe("rejected");

    // decided tips leave the queue
    const q2 = await request(app).get("/api/v1/admin/moderation").set(auth(adminToken));
    expect(q2.body.tips.map((x: { id: string }) => x.id)).not.toContain(t1.id);
  });

  it("validates the decision and 404s unknown", async () => {
    const t = await store.createCommunityTip(custId, "X", "Y");
    expect((await request(app).post(`/api/v1/admin/moderation/${t.id}/decide`)
      .set(auth(adminToken)).send({ approved: "yes" })).status).toBe(400);
    expect((await request(app).post("/api/v1/admin/moderation/nope/decide")
      .set(auth(adminToken)).send({ approved: true })).status).toBe(404);
  });
});

describe("plan templates (A24)", () => {
  it("full CRUD cycle", async () => {
    const c = await request(app).post("/api/v1/admin/plan-templates")
      .set(auth(adminToken))
      .send({ title_en: "Oily scalp", items: [{ kind: "wash", sort_order: 1 }] });
    expect(c.status).toBe(201);
    const id = c.body.template.id;
    expect(c.body.template.title_en).toBe("Oily scalp");

    const list = await request(app).get("/api/v1/admin/plan-templates").set(auth(adminToken));
    expect(list.body.templates.map((x: { id: string }) => x.id)).toContain(id);

    const p = await request(app).patch(`/api/v1/admin/plan-templates/${id}`)
      .set(auth(adminToken)).send({ is_active: false });
    expect(p.status).toBe(200);
    expect(p.body.template.is_active).toBe(false);

    const active = await request(app).get("/api/v1/admin/plan-templates?activeOnly=true").set(auth(adminToken));
    expect(active.body.templates.map((x: { id: string }) => x.id)).not.toContain(id);
    const all = await request(app).get("/api/v1/admin/plan-templates?activeOnly=false").set(auth(adminToken));
    expect(all.body.templates.map((x: { id: string }) => x.id)).toContain(id);

    const d = await request(app).delete(`/api/v1/admin/plan-templates/${id}`).set(auth(adminToken));
    expect(d.status).toBe(200);
    expect(d.body.deleted).toBe(true);
    const after = await request(app).get("/api/v1/admin/plan-templates").set(auth(adminToken));
    expect(after.body.templates.map((x: { id: string }) => x.id)).not.toContain(id);
  });

  it("validates title + items, 404s unknown", async () => {
    expect((await request(app).post("/api/v1/admin/plan-templates")
      .set(auth(adminToken)).send({ title_en: "" })).status).toBe(400);
    expect((await request(app).post("/api/v1/admin/plan-templates")
      .set(auth(adminToken)).send({ title_en: "T", items: "nope" })).status).toBe(400);
    expect((await request(app).post("/api/v1/admin/plan-templates")
      .set(auth(adminToken)).send({ title_en: "T", items: [{ sort_order: 1 }] })).status).toBe(400);
    expect((await request(app).patch("/api/v1/admin/plan-templates/nope")
      .set(auth(adminToken)).send({ title_en: "T" })).status).toBe(404);
    expect((await request(app).delete("/api/v1/admin/plan-templates/nope")
      .set(auth(adminToken))).status).toBe(404);
  });
});

describe("scan quality (A25)", () => {
  it("returns per-angle aggregates", async () => {
    const r = await request(app).get("/api/v1/admin/scan-quality").set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.stats)).toBe(true);
  });
});

describe("kit leaderboard (A26)", () => {
  it("counts orders + revenue, excludes cancelled", async () => {
    const p = await store.createProduct({ name_en: "LB Shampoo", kind: "cosmetic", price_npr: 800 });
    const k = await store.createKit({ name_en: "LB Kit", product_ids: [p.id], total_npr: 900 });
    const addr = { name: "T", phone: "+9779841000001", city: "Ktm", address_line: "X" };
    for (const [no, status] of [["JR-LB-1", "paid"], ["JR-LB-2", "delivered"], ["JR-LB-3", "cancelled"]] as const) {
      const o = await store.createOrder({
        order_no: no, user_id: custId, kit_id: k.id,
        subtotal_npr: 800, shipping_npr: 100, total_npr: 900,
        payment_method: "cod", idempotency_key: `b3-${no}`, shipping_address: addr,
      });
      await store.updateOrder(o.id, { status: status as never });
    }
    const r = await request(app).get("/api/v1/admin/kits/leaderboard").set(auth(adminToken));
    expect(r.status).toBe(200);
    const row = r.body.leaderboard.find((x: { kit_id: string }) => x.kit_id === k.id);
    expect(row).toBeTruthy();
    expect(row.orders).toBe(2); // cancelled excluded
    expect(row.revenue_npr).toBe(1800);
  });
});

describe("export schedules (A27)", () => {
  it("full CRUD cycle", async () => {
    const c = await request(app).post("/api/v1/admin/export-schedules")
      .set(auth(adminToken)).send({ frequency: "daily" });
    expect(c.status).toBe(201);
    expect(c.body.schedule.frequency).toBe("daily");
    expect(c.body.schedule.kind).toBe("orders");
    const id = c.body.schedule.id;

    const list = await request(app).get("/api/v1/admin/export-schedules").set(auth(adminToken));
    expect(list.body.schedules.map((x: { id: string }) => x.id)).toContain(id);

    const p = await request(app).patch(`/api/v1/admin/export-schedules/${id}`)
      .set(auth(adminToken)).send({ frequency: "weekly", is_active: false });
    expect(p.status).toBe(200);
    expect(p.body.schedule.frequency).toBe("weekly");
    expect(p.body.schedule.is_active).toBe(false);

    const d = await request(app).delete(`/api/v1/admin/export-schedules/${id}`).set(auth(adminToken));
    expect(d.body.deleted).toBe(true);
    const after = await request(app).get("/api/v1/admin/export-schedules").set(auth(adminToken));
    expect(after.body.schedules.map((x: { id: string }) => x.id)).not.toContain(id);
  });

  it("validates frequency + kind, 404s unknown", async () => {
    expect((await request(app).post("/api/v1/admin/export-schedules")
      .set(auth(adminToken)).send({ frequency: "hourly" })).status).toBe(400);
    expect((await request(app).post("/api/v1/admin/export-schedules")
      .set(auth(adminToken)).send({ frequency: "daily", kind: "users" })).status).toBe(400);
    expect((await request(app).patch("/api/v1/admin/export-schedules/nope")
      .set(auth(adminToken)).send({ frequency: "daily" })).status).toBe(404);
    expect((await request(app).delete("/api/v1/admin/export-schedules/nope")
      .set(auth(adminToken))).status).toBe(404);
  });
});

describe("staff checklist (A28)", () => {
  it("404s for unknown user, saves + reads", async () => {
    expect((await request(app).get("/api/v1/admin/staff/nope/checklist").set(auth(adminToken))).status).toBe(404);
    const doc = await store.createUser({ phone: "+9779843000007", role: "doctor" });

    const empty = await request(app).get(`/api/v1/admin/staff/${doc.id}/checklist`).set(auth(adminToken));
    expect(empty.status).toBe(200);
    expect(empty.body.checklist).toBeNull();

    const s = await request(app).patch(`/api/v1/admin/staff/${doc.id}/checklist`)
      .set(auth(adminToken)).send({ items: [{ key: "docs_verified", done: true }, { key: "training_done", done: false }] });
    expect(s.status).toBe(200);
    expect(s.body.checklist.items).toHaveLength(2);

    const back = await request(app).get(`/api/v1/admin/staff/${doc.id}/checklist`).set(auth(adminToken));
    expect(back.body.checklist.items.find((i: { key: string }) => i.key === "docs_verified").done).toBe(true);

    // create-or-replace
    const s2 = await request(app).patch(`/api/v1/admin/staff/${doc.id}/checklist`)
      .set(auth(adminToken)).send({ items: [{ key: "docs_verified", done: true }] });
    expect(s2.body.checklist.items).toHaveLength(1);
  });

  it("validates the items payload", async () => {
    const doc = await store.createUser({ phone: "+9779843000008", role: "coach" });
    expect((await request(app).patch(`/api/v1/admin/staff/${doc.id}/checklist`)
      .set(auth(adminToken)).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/v1/admin/staff/${doc.id}/checklist`)
      .set(auth(adminToken)).send({ items: [{ done: true }] })).status).toBe(400);
  });
});

describe("audit CSV export (A29)", () => {
  it("downloads text/csv with header + rows", async () => {
    const r = await request(app).get("/api/v1/admin/audit/export.csv").set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.text.startsWith("id,actor_id,action,entity,entity_id,at,ip")).toBe(true);
    // audit events from this test file (e.g. dispute.create) are present
    expect(r.text).toContain("dispute.create");
  });

  it("accepts filters", async () => {
    const r = await request(app)
      .get("/api/v1/admin/audit/export.csv?entity=dispute")
      .set(auth(adminToken));
    expect(r.status).toBe(200);
    const lines = r.text.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
  });
});
