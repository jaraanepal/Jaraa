// Admin P12 endpoints: broadcast, refunds, SLA monitor, staff verification,
// finance snapshot, support tickets, education articles, doctor availability.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let adminToken = "";
let adminId = "";
let doctorToken = "";
let custA = "";
let custB = "";
let kitId = "";

const addr = { name: "T", phone: "+9779841000001", city: "Ktm", address_line: "X" };

async function makeOrder(orderNo: string, userId: string, status: string, paymentMethod: string, total: number) {
  const o = await store.createOrder({
    order_no: orderNo, user_id: userId, kit_id: kitId,
    subtotal_npr: total - 100, shipping_npr: 100, total_npr: total,
    payment_method: paymentMethod, idempotency_key: `p12-${orderNo}`,
    shipping_address: addr,
  });
  return (await store.updateOrder(o.id, { status: status as never })) ?? o;
}

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779841000000", role: "admin" });
  adminId = admin.id;
  adminToken = tokenFor({ id: admin.id, role: "admin" });

  const doc = await store.createUser({ phone: "+9779841000002", role: "doctor" });
  doctorToken = tokenFor({ id: doc.id, role: "doctor" });

  const a = await store.createUser({ phone: "+9779841000011" });
  const b = await store.createUser({ phone: "+9779841000012" });
  custA = a.id; custB = b.id;

  const p = await store.createProduct({ name_en: "P12 Shampoo", kind: "cosmetic", price_npr: 800 });
  const k = await store.createKit({ name_en: "P12 Kit", product_ids: [p.id], total_npr: 800 });
  kitId = k.id;

  // finance fixtures
  await makeOrder("JR-P12-A", custA, "paid", "cod", 1000);
  await makeOrder("JR-P12-B", custA, "delivered", "cod", 2000);
  await makeOrder("JR-P12-C", custB, "cancelled", "cod", 500);
  await makeOrder("JR-P12-D", custB, "paid", "esewa", 1500);
});

describe("POST /admin/broadcast", () => {
  it("sends to all active users", async () => {
    const r = await request(app).post("/api/v1/admin/broadcast")
      .set(auth(adminToken))
      .send({ title_en: "Hello everyone", body_en: "A test broadcast" });
    expect(r.status).toBe(200);
    // 5 active users in store: admin, doctor, custA, custB (+1 admin? no) -> admin, doctor, custA, custB
    expect(r.body.sent).toBe(4);
    expect(r.body.failed).toBe(0);
    const n = await store.listNotifications(custA, { limit: 10, offset: 0 });
    expect(n.notifications.some((x) => x.type === "broadcast" && x.title_en === "Hello everyone")).toBe(true);
  });

  it("filters by role", async () => {
    const r = await request(app).post("/api/v1/admin/broadcast")
      .set(auth(adminToken))
      .send({ title_en: "Doctors only", role: "doctor" });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(1);
  });

  it("rejects empty title", async () => {
    const r = await request(app).post("/api/v1/admin/broadcast")
      .set(auth(adminToken))
      .send({ title_en: "" });
    expect(r.status).toBe(400);
  });

  it("rejects unknown role", async () => {
    const r = await request(app).post("/api/v1/admin/broadcast")
      .set(auth(adminToken))
      .send({ title_en: "Hi", role: "nobody" });
    expect(r.status).toBe(400);
  });
});

describe("refunds (A3)", () => {
  it("partial refund keeps order status", async () => {
    const o = await makeOrder("JR-P12-R1", custA, "paid", "esewa", 2000);
    const r = await request(app).post(`/api/v1/admin/orders/${o.order_no}/refund`)
      .set(auth(adminToken)).send({ amount_npr: 400, reason: "damaged item" });
    expect(r.status).toBe(201);
    expect(r.body.refund.amount_npr).toBe(400);
    expect(r.body.refund.order_id).toBe(o.id);
    expect(r.body.order.status).toBe("paid");
  });

  it("full refund flips order to refunded", async () => {
    const o = await makeOrder("JR-P12-R2", custB, "paid", "esewa", 1200);
    const r = await request(app).post(`/api/v1/admin/orders/${o.id}/refund`)
      .set(auth(adminToken)).send({ amount_npr: 1200 });
    expect(r.status).toBe(201);
    expect(r.body.order.status).toBe("refunded");
  });

  it("rejects amount above total (400)", async () => {
    const o = await makeOrder("JR-P12-R3", custA, "paid", "esewa", 900);
    const r = await request(app).post(`/api/v1/admin/orders/${o.id}/refund`)
      .set(auth(adminToken)).send({ amount_npr: 901 });
    expect(r.status).toBe(400);
  });

  it("rejects zero/negative amount (400)", async () => {
    const o = await makeOrder("JR-P12-R4", custA, "paid", "esewa", 900);
    const r = await request(app).post(`/api/v1/admin/orders/${o.id}/refund`)
      .set(auth(adminToken)).send({ amount_npr: 0 });
    expect(r.status).toBe(400);
  });

  it("404 for unknown order", async () => {
    const r = await request(app).post("/api/v1/admin/orders/nope/refund")
      .set(auth(adminToken)).send({ amount_npr: 10 });
    expect(r.status).toBe(404);
  });

  it("GET /admin/refunds lists refunds", async () => {
    const r = await request(app).get("/api/v1/admin/refunds").set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.refunds.length).toBeGreaterThanOrEqual(2);
    expect(r.body.refunds.reduce((s: number, x: { amount_npr: number }) => s + x.amount_npr, 0))
      .toBe(400 + 1200);
  });
});

describe("GET /admin/sla (A4)", () => {
  it("lists an overdue case with hours_overdue", async () => {
    const scan = await store.createScan({ user_id: custA });
    const past = new Date(Date.now() - 30 * 3.6e6).toISOString();
    const c = await store.createCase({ scan_id: scan.id, priority: 3, sla_due_at: past });
    const r = await request(app).get("/api/v1/admin/sla").set(auth(adminToken));
    expect(r.status).toBe(200);
    const found = r.body.cases.find((x: { id: string }) => x.id === c.id);
    expect(found).toBeTruthy();
    expect(found.user_id).toBe(custA);
    expect(found.hours_overdue).toBeGreaterThanOrEqual(29);
  });
});

describe("staff verification (A5)", () => {
  it("approve sets the user's role", async () => {
    const u = await store.createUser({ phone: "+9779841000099" });
    const v = await store.upsertStaffVerification(u.id, "coach");
    const r = await request(app).post(`/api/v1/admin/verifications/${v.id}/decide`)
      .set(auth(adminToken)).send({ approved: true, note: "docs verified" });
    expect(r.status).toBe(200);
    expect(r.body.verification.status).toBe("approved");
    const after = await store.getUserById(u.id);
    expect(after?.role).toBe("coach");
  });

  it("reject keeps the role", async () => {
    const u = await store.createUser({ phone: "+9779841000098" });
    const v = await store.upsertStaffVerification(u.id, "doctor");
    const r = await request(app).post(`/api/v1/admin/verifications/${v.id}/decide`)
      .set(auth(adminToken)).send({ approved: false });
    expect(r.status).toBe(200);
    expect(r.body.verification.status).toBe("rejected");
    expect((await store.getUserById(u.id))?.role).toBe("customer");
  });

  it("404 on second decide (no longer pending)", async () => {
    const u = await store.createUser({ phone: "+9779841000097" });
    const v = await store.upsertStaffVerification(u.id, "pharmacy");
    await request(app).post(`/api/v1/admin/verifications/${v.id}/decide`)
      .set(auth(adminToken)).send({ approved: true });
    const r = await request(app).post(`/api/v1/admin/verifications/${v.id}/decide`)
      .set(auth(adminToken)).send({ approved: true });
    expect(r.status).toBe(404);
  });

  it("GET /admin/verifications?status=pending enriches phone + name", async () => {
    await store.upsertProfile(custA, { name: "Test Customer" });
    const v = await store.upsertStaffVerification(custA, "doctor");
    const r = await request(app).get("/api/v1/admin/verifications?status=pending")
      .set(auth(adminToken));
    expect(r.status).toBe(200);
    const found = r.body.verifications.find((x: { id: string }) => x.id === v.id);
    expect(found).toBeTruthy();
    expect(found.phone).toBe("+9779841000011");
    expect(found.name).toBe("Test Customer");
  });

  it("rejects invalid status filter (400)", async () => {
    const r = await request(app).get("/api/v1/admin/verifications?status=bogus")
      .set(auth(adminToken));
    expect(r.status).toBe(400);
  });
});

describe("GET /admin/finance (A6)", () => {
  it("computes the snapshot sums", async () => {
    const r = await request(app).get("/api/v1/admin/finance").set(auth(adminToken));
    expect(r.status).toBe(200);
    const f = r.body.finance;
    // revenue: paid(1000)+delivered(2000)+paid(1500) + refund-test orders are extra — compute dynamically
    expect(f.order_count).toBeGreaterThanOrEqual(4);
    expect(f.refunds_npr).toBe(1600);
    // cod pending: JR-P12-A paid cod 1000
    expect(f.cod_pending_npr).toBeGreaterThanOrEqual(1000);
    // cod collected: JR-P12-B delivered cod 2000
    expect(f.cod_collected_npr).toBeGreaterThanOrEqual(2000);
    expect(f.by_status.paid).toBeGreaterThanOrEqual(2);
    expect(f.revenue_npr).toBeGreaterThanOrEqual(4500);
  });
});

describe("support tickets (A7)", () => {
  it("lists tickets, filters by status", async () => {
    const t = await store.createTicket({ user_id: custA, subject: "Hair falling", body: "Help please" });
    const r = await request(app).get("/api/v1/admin/tickets").set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.tickets.map((x: { id: string }) => x.id)).toContain(t.id);
    const open = await request(app).get("/api/v1/admin/tickets?status=open").set(auth(adminToken));
    expect(open.body.tickets.map((x: { id: string }) => x.id)).toContain(t.id);
  });

  it("gets ticket with replies, 404 for unknown", async () => {
    const t = await store.createTicket({ user_id: custB, subject: "Order late", body: "Where is it" });
    const r = await request(app).get(`/api/v1/admin/tickets/${t.id}`).set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.ticket.id).toBe(t.id);
    expect(r.body.replies.length).toBe(1); // the customer's first message
    const miss = await request(app).get("/api/v1/admin/tickets/nope").set(auth(adminToken));
    expect(miss.status).toBe(404);
  });

  it("admin reply creates a notification for the ticket owner", async () => {
    const t = await store.createTicket({ user_id: custB, subject: "Q", body: "Question" });
    const r = await request(app).post(`/api/v1/admin/tickets/${t.id}/reply`)
      .set(auth(adminToken)).send({ body: "Here is your answer." });
    expect(r.status).toBe(201);
    expect(r.body.reply.body).toBe("Here is your answer.");
    // give the fire-and-forget notification a tick
    await new Promise((ok) => setTimeout(ok, 50));
    const n = await store.listNotifications(custB, { limit: 20, offset: 0 });
    expect(n.notifications.some((x) => x.type === "ticket_reply" && x.link === "/notifications")).toBe(true);
  });

  it("rejects empty reply body (400)", async () => {
    const t = await store.createTicket({ user_id: custB, subject: "Q2", body: "Question" });
    const r = await request(app).post(`/api/v1/admin/tickets/${t.id}/reply`)
      .set(auth(adminToken)).send({ body: "   " });
    expect(r.status).toBe(400);
  });

  it("PATCH status closes a ticket", async () => {
    const t = await store.createTicket({ user_id: custA, subject: "S", body: "B" });
    const r = await request(app).patch(`/api/v1/admin/tickets/${t.id}`)
      .set(auth(adminToken)).send({ status: "closed" });
    expect(r.status).toBe(200);
    expect(r.body.ticket.status).toBe("closed");
    const bad = await request(app).patch(`/api/v1/admin/tickets/${t.id}`)
      .set(auth(adminToken)).send({ status: "archived" });
    expect(bad.status).toBe(400);
  });
});

describe("education articles (A8)", () => {
  it("CRUD round trip", async () => {
    const c = await request(app).post("/api/v1/admin/articles")
      .set(auth(adminToken))
      .send({ title_en: "Oiling 101", body_en: "How to oil hair.", is_published: true });
    expect(c.status).toBe(201);
    const id = c.body.article.id;

    const list = await request(app).get("/api/v1/admin/articles").set(auth(adminToken));
    expect(list.body.articles.map((a: { id: string }) => a.id)).toContain(id);

    const p = await request(app).patch(`/api/v1/admin/articles/${id}`)
      .set(auth(adminToken)).send({ title_en: "Oiling 102", is_published: false });
    expect(p.status).toBe(200);
    expect(p.body.article.title_en).toBe("Oiling 102");
    expect(p.body.article.is_published).toBe(false);

    const d = await request(app).delete(`/api/v1/admin/articles/${id}`).set(auth(adminToken));
    expect(d.status).toBe(204);
    const list2 = await request(app).get("/api/v1/admin/articles").set(auth(adminToken));
    expect(list2.body.articles.map((a: { id: string }) => a.id)).not.toContain(id);
  });

  it("rejects missing title (400) and 404s unknown patch", async () => {
    const r = await request(app).post("/api/v1/admin/articles")
      .set(auth(adminToken)).send({ body_en: "no title" });
    expect(r.status).toBe(400);
    const p = await request(app).patch("/api/v1/admin/articles/nope")
      .set(auth(adminToken)).send({ title_en: "x" });
    expect(p.status).toBe(404);
  });
});

describe("GET /admin/doctors/availability (D9)", () => {
  it("returns doctor availability rows", async () => {
    const r = await request(app).get("/api/v1/admin/doctors/availability").set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.doctors)).toBe(true);
  });
});

describe("RBAC", () => {
  it("doctor gets 403 on /admin/*", async () => {
    for (const [method, url] of [
      ["get", "/api/v1/admin/finance"],
      ["get", "/api/v1/admin/refunds"],
      ["get", "/api/v1/admin/sla"],
      ["post", "/api/v1/admin/broadcast"],
      ["get", "/api/v1/admin/verifications"],
      ["get", "/api/v1/admin/tickets"],
      ["get", "/api/v1/admin/articles"],
      ["get", "/api/v1/admin/doctors/availability"],
    ] as const) {
      const req = method === "get" ? request(app).get(url) : request(app).post(url).send({});
      const r = await req.set(auth(doctorToken));
      expect(r.status).toBe(403);
    }
  });
});
