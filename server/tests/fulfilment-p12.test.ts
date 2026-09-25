// P12 fulfilment + coach console + customer self-service endpoints.
// Covers: pharmacy stock/courier/checks/return/damage/handover, coach
// challenges/notes/escalations/nudges/satisfaction/articles/checkins,
// customer tickets/challenges/wishlist, and RBAC gating.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let pharmacyToken = "";
let coachToken = "";
let adminToken = "";
let custToken = "";
let cust2Token = "";
let custId = "";
let cust2Id = "";
let doctorId = "";
let kitId = "";
let orderNo1 = "";
let orderNo2 = "";

beforeAll(async () => {
  const pharmacy = await store.createUser({ phone: "+9779841000101", role: "pharmacy" });
  const coach = await store.createUser({ phone: "+9779841000102", role: "coach" });
  const admin = await store.createUser({ phone: "+9779841000103", role: "admin" });
  const cust = await store.createUser({ phone: "+9779841000104", role: "customer" });
  const cust2 = await store.createUser({ phone: "+9779841000105", role: "customer" });
  const doctor = await store.createUser({ phone: "+9779841000106", role: "doctor" });
  pharmacyToken = tokenFor(pharmacy);
  coachToken = tokenFor(coach);
  adminToken = tokenFor(admin);
  custToken = tokenFor(cust);
  cust2Token = tokenFor(cust2);
  custId = cust.id;
  cust2Id = cust2.id;
  doctorId = doctor.id;

  const product = await store.createProduct({ name_en: "P12 Oil", kind: "cosmetic", price_npr: 500 });
  const kit = await store.createKit({ name_en: "P12 Kit", product_ids: [product.id], total_npr: 500, stock: 10 });
  kitId = kit.id;

  const o1 = await store.createOrder({
    order_no: "JR-T12-1", user_id: custId, kit_id: kitId,
    subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
    payment_method: "cod", idempotency_key: "t12-k1", shipping_address: {},
  });
  const o2 = await store.createOrder({
    order_no: "JR-T12-2", user_id: custId, kit_id: kitId,
    subtotal_npr: 500, shipping_npr: 0, total_npr: 500,
    payment_method: "cod", idempotency_key: "t12-k2", shipping_address: {},
  });
  orderNo1 = o1.order_no;
  orderNo2 = o2.order_no;
});

describe("pharmacy fulfilment (P2/P4-P8)", () => {
  it("PATCH /pharmacy/kits/:id/stock adjusts stock up and down", async () => {
    const down = await request(app).patch(`/api/v1/pharmacy/kits/${kitId}/stock`)
      .set(auth(pharmacyToken)).send({ delta: -3 });
    expect(down.status).toBe(200);
    expect(down.body.kit.stock).toBe(7);

    const up = await request(app).patch(`/api/v1/pharmacy/kits/${kitId}/stock`)
      .set(auth(pharmacyToken)).send({ delta: 5 });
    expect(up.status).toBe(200);
    expect(up.body.kit.stock).toBe(12);
  });

  it("PATCH stock rejects bad deltas (400) and unknown kit (404)", async () => {
    for (const delta of [0, 1001, -1001, 1.5, "x"]) {
      const r = await request(app).patch(`/api/v1/pharmacy/kits/${kitId}/stock`)
        .set(auth(pharmacyToken)).send({ delta });
      expect(r.status).toBe(400);
    }
    const r = await request(app).patch("/api/v1/pharmacy/kits/does-not-exist/stock")
      .set(auth(pharmacyToken)).send({ delta: 1 });
    expect(r.status).toBe(404);
  });

  it("PATCH /pharmacy/orders/:id/courier sets courier + tracking (by order_no)", async () => {
    const r = await request(app).patch(`/api/v1/pharmacy/orders/${orderNo1}/courier`)
      .set(auth(pharmacyToken)).send({ courier_name: "Pathao", tracking_id: "TRK-1" });
    expect(r.status).toBe(200);
    expect(r.body.order.id).toBe(orderNo1);
    // P4 contract: courier fields + updated_at are readable back (not write-only).
    expect(r.body.order.courier_name).toBe("Pathao");
    expect(r.body.order.tracking_id).toBe("TRK-1");
    expect(typeof r.body.order.updated_at).toBe("string");
    const row = await store.getOrderByNo(orderNo1);
    expect(row?.courier_name).toBe("Pathao");
    expect(row?.tracking_id).toBe("TRK-1");
  });

  it("PATCH courier rejects overlong fields", async () => {
    const r = await request(app).patch(`/api/v1/pharmacy/orders/${orderNo1}/courier`)
      .set(auth(pharmacyToken)).send({ courier_name: "x".repeat(81) });
    expect(r.status).toBe(400);
  });

  it("POST/GET /pharmacy/orders/:id/checks round-trip", async () => {
    const post = await request(app).post(`/api/v1/pharmacy/orders/${orderNo1}/checks`)
      .set(auth(pharmacyToken)).send({ check_type: "phone" });
    expect(post.status).toBe(201);
    expect(post.body.check.check_type).toBe("phone");

    const bad = await request(app).post(`/api/v1/pharmacy/orders/${orderNo1}/checks`)
      .set(auth(pharmacyToken)).send({ check_type: "email" });
    expect(bad.status).toBe(400);

    const list = await request(app).get(`/api/v1/pharmacy/orders/${orderNo1}/checks`)
      .set(auth(pharmacyToken));
    expect(list.status).toBe(200);
    expect(list.body.checks).toHaveLength(1);
    expect(list.body.checks[0].check_type).toBe("phone");
  });

  it("POST /pharmacy/orders/:id/return cancels the order and restocks the kit", async () => {
    const before = (await store.getKit(kitId))!.stock;
    const r = await request(app).post(`/api/v1/pharmacy/orders/${orderNo2}/return`)
      .set(auth(pharmacyToken)).send({ reason: "Customer refused delivery" });
    expect(r.status).toBe(200);
    expect(r.body.order.status).toBe("cancelled");
    expect((await store.getKit(kitId))!.stock).toBe(before + 1);

    const missing = await request(app).post(`/api/v1/pharmacy/orders/${orderNo2}/return`)
      .set(auth(pharmacyToken)).send({});
    expect(missing.status).toBe(400);
  });

  it("POST/GET damage round-trip", async () => {
    const d = await request(app).post(`/api/v1/pharmacy/orders/${orderNo1}/damage`)
      .set(auth(pharmacyToken)).send({ description: "Box corner crushed" });
    expect(d.status).toBe(201);

    const dl = await request(app).get(`/api/v1/pharmacy/orders/${orderNo1}/damage`)
      .set(auth(pharmacyToken));
    expect(dl.status).toBe(200);
    expect(dl.body.reports).toHaveLength(1);
    expect(dl.body.reports[0].description).toBe("Box corner crushed");

    const bad = await request(app).post(`/api/v1/pharmacy/orders/${orderNo1}/damage`)
      .set(auth(pharmacyToken)).send({});
    expect(bad.status).toBe(400);
  });

  it("POST/GET handover round-trip", async () => {
    const h = await request(app).post(`/api/v1/pharmacy/orders/${orderNo1}/handover`)
      .set(auth(pharmacyToken)).send({ note: "Left at reception desk" });
    expect(h.status).toBe(201);

    const hl = await request(app).get(`/api/v1/pharmacy/orders/${orderNo1}/handover`)
      .set(auth(pharmacyToken));
    expect(hl.status).toBe(200);
    expect(hl.body.notes).toHaveLength(1);
    expect(hl.body.notes[0].note).toBe("Left at reception desk");

    const bad = await request(app).post(`/api/v1/pharmacy/orders/${orderNo1}/handover`)
      .set(auth(pharmacyToken)).send({});
    expect(bad.status).toBe(400);
  });

  it("customer gets 403 on pharmacy routes; admin can use them", async () => {
    const r1 = await request(app).get("/api/v1/pharmacy/orders").set(auth(custToken));
    expect(r1.status).toBe(403);
    const r2 = await request(app).patch(`/api/v1/pharmacy/kits/${kitId}/stock`)
      .set(auth(custToken)).send({ delta: 1 });
    expect(r2.status).toBe(403);
    const r3 = await request(app).post(`/api/v1/pharmacy/orders/${orderNo1}/checks`)
      .set(auth(custToken)).send({ check_type: "name" });
    expect(r3.status).toBe(403);

    const admin = await request(app).get("/api/v1/pharmacy/orders").set(auth(adminToken));
    expect(admin.status).toBe(200);
  });

  it("coach gets 403 on pharmacy routes", async () => {
    const r = await request(app).get("/api/v1/pharmacy/orders").set(auth(coachToken));
    expect(r.status).toBe(403);
  });
});

describe("coach console (C1/C4-C9)", () => {
  it("GET /coach/customers/:id/checkins returns the customer's checkins", async () => {
    await store.addCheckin({ user_id: custId, shedding_estimate: 50, note: "ok", photo_ids: [] });
    const r = await request(app).get(`/api/v1/coach/customers/${custId}/checkins`)
      .set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(r.body.checkins.length).toBeGreaterThanOrEqual(1);
    expect(r.body.checkins[0].user_id).toBe(custId);
  });

  it("challenge create -> assign -> customer completes; other customer 404", async () => {
    const c = await request(app).post("/api/v1/coach/challenges")
      .set(auth(coachToken)).send({ title_en: "7-day scalp care", days: 7 });
    expect(c.status).toBe(201);
    const challengeId = c.body.challenge.id;

    const a = await request(app).post(`/api/v1/coach/challenges/${challengeId}/assign`)
      .set(auth(coachToken)).send({ user_id: custId });
    expect(a.status).toBe(201);
    const assignmentId = a.body.assignment.id;

    const notifs = await store.listNotifications(custId, { limit: 10, offset: 0 });
    expect(notifs.notifications.some((n) => n.type === "challenge_assigned")).toBe(true);

    const list = await request(app).get("/api/v1/coach/challenges").set(auth(coachToken));
    expect(list.body.challenges.map((x: { id: string }) => x.id)).toContain(challengeId);

    const mine = await request(app).get("/api/v1/me/challenges").set(auth(custToken));
    expect(mine.status).toBe(200);
    expect(mine.body.assignments.map((x: { id: string }) => x.id)).toContain(assignmentId);

    const done = await request(app).post(`/api/v1/me/challenges/${assignmentId}/complete`)
      .set(auth(custToken));
    expect(done.status).toBe(200);
    expect(done.body.assignment.completed_at).toBeTruthy();

    const other = await request(app).post(`/api/v1/me/challenges/${assignmentId}/complete`)
      .set(auth(cust2Token));
    expect(other.status).toBe(404);
  });

  it("rejects bad challenge payloads", async () => {
    const r1 = await request(app).post("/api/v1/coach/challenges")
      .set(auth(coachToken)).send({ title_en: "x", days: 5 });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post("/api/v1/coach/challenges")
      .set(auth(coachToken)).send({ days: 7 });
    expect(r2.status).toBe(400);
  });

  it("coach notes round-trip", async () => {
    const p = await request(app).post(`/api/v1/coach/customers/${custId}/notes`)
      .set(auth(coachToken)).send({ note: "Shedding improving" });
    expect(p.status).toBe(201);

    const g = await request(app).get(`/api/v1/coach/customers/${custId}/notes`)
      .set(auth(coachToken));
    expect(g.status).toBe(200);
    expect(g.body.notes).toHaveLength(1);
    expect(g.body.notes[0].note).toBe("Shedding improving");

    const bad = await request(app).post(`/api/v1/coach/customers/${custId}/notes`)
      .set(auth(coachToken)).send({});
    expect(bad.status).toBe(400);
  });

  it("escalation notifies all doctors and appears in the escalation list", async () => {
    const r = await request(app).post(`/api/v1/coach/customers/${custId}/escalate`)
      .set(auth(coachToken)).send({ reason: "Severe shedding, needs dermatologist review" });
    expect(r.status).toBe(201);

    const notifs = await store.listNotifications(doctorId, { limit: 10, offset: 0 });
    expect(notifs.notifications.some((n) => n.type === "escalation")).toBe(true);

    const list = await request(app).get("/api/v1/coach/escalations").set(auth(coachToken));
    expect(list.status).toBe(200);
    expect(list.body.escalations.map((e: { id: string }) => e.id)).toContain(r.body.escalation.id);

    const filtered = await request(app).get("/api/v1/coach/escalations?status=open")
      .set(auth(coachToken));
    expect(filtered.status).toBe(200);

    const badStatus = await request(app).get("/api/v1/coach/escalations?status=bogus")
      .set(auth(coachToken));
    expect(badStatus.status).toBe(400);
  });

  it("nudge schedule -> send -> delete lifecycle", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const s = await request(app).post("/api/v1/coach/nudges/scheduled")
      .set(auth(coachToken)).send({ user_id: custId, message_en: "Time for your evening routine", send_at: future });
    expect(s.status).toBe(201);
    const nudgeId = s.body.nudge.id;

    const past = await request(app).post("/api/v1/coach/nudges/scheduled")
      .set(auth(coachToken)).send({ user_id: custId, message_en: "x", send_at: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(400);

    const list = await request(app).get("/api/v1/coach/nudges/scheduled").set(auth(coachToken));
    expect(list.status).toBe(200);
    expect(list.body.nudges.map((n: { id: string }) => n.id)).toContain(nudgeId);

    const send = await request(app).post(`/api/v1/coach/nudges/scheduled/${nudgeId}/send`)
      .set(auth(coachToken));
    expect(send.status).toBe(200);
    expect(send.body.nudge.sent_at).toBeTruthy();

    const notifs = await store.listNotifications(custId, { limit: 20, offset: 0 });
    expect(notifs.notifications.some((n) => n.type === "coach_nudge")).toBe(true);

    const resend = await request(app).post(`/api/v1/coach/nudges/scheduled/${nudgeId}/send`)
      .set(auth(coachToken));
    expect(resend.status).toBe(409);

    const s2 = await request(app).post("/api/v1/coach/nudges/scheduled")
      .set(auth(coachToken)).send({ user_id: custId, message_en: "delete me", send_at: future });
    const del = await request(app).delete(`/api/v1/coach/nudges/scheduled/${s2.body.nudge.id}`)
      .set(auth(coachToken));
    expect(del.status).toBe(204);
    const del2 = await request(app).delete(`/api/v1/coach/nudges/scheduled/${s2.body.nudge.id}`)
      .set(auth(coachToken));
    expect(del2.status).toBe(404);
  });

  it("satisfaction round-trip", async () => {
    const p = await request(app).post(`/api/v1/coach/customers/${custId}/satisfaction`)
      .set(auth(coachToken)).send({ rating: 5, comment: "Great coach" });
    expect(p.status).toBe(201);
    expect(p.body.rating.rating).toBe(5);

    const bad = await request(app).post(`/api/v1/coach/customers/${custId}/satisfaction`)
      .set(auth(coachToken)).send({ rating: 6 });
    expect(bad.status).toBe(400);

    const g = await request(app).get(`/api/v1/coach/customers/${custId}/satisfaction`)
      .set(auth(coachToken));
    expect(g.status).toBe(200);
    expect(g.body.ratings).toHaveLength(1);
  });

  it("GET /coach/articles returns published articles", async () => {
    const r = await request(app).get("/api/v1/coach/articles").set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.articles)).toBe(true);
  });

  it("customer gets 403 on the coach console", async () => {
    const r1 = await request(app).get("/api/v1/coach/challenges").set(auth(custToken));
    expect(r1.status).toBe(403);
    const r2 = await request(app).get("/api/v1/coach/articles").set(auth(custToken));
    expect(r2.status).toBe(403);
    const r3 = await request(app).post("/api/v1/coach/challenges")
      .set(auth(custToken)).send({ title_en: "x", days: 7 });
    expect(r3.status).toBe(403);
  });

  it("admin can use the coach console", async () => {
    const r = await request(app).get("/api/v1/coach/challenges").set(auth(adminToken));
    expect(r.status).toBe(200);
  });
});

describe("customer self-service (A7/C4/U6)", () => {
  it("ticket create -> reply round-trip; other customer gets 404", async () => {
    const c = await request(app).post("/api/v1/me/tickets")
      .set(auth(custToken)).send({ subject: "Damaged box", body: "My kit arrived damaged." });
    expect(c.status).toBe(201);
    const ticketId = c.body.ticket.id;

    const list = await request(app).get("/api/v1/me/tickets").set(auth(custToken));
    expect(list.status).toBe(200);
    expect(list.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);

    const get = await request(app).get(`/api/v1/me/tickets/${ticketId}`).set(auth(custToken));
    expect(get.status).toBe(200);
    // createTicket seeds the ticket body as the first customer reply (data-layer behavior)
    expect(get.body.replies).toHaveLength(1);

    const rep = await request(app).post(`/api/v1/me/tickets/${ticketId}/reply`)
      .set(auth(custToken)).send({ body: "Adding a note for the agent." });
    expect(rep.status).toBe(201);

    const get2 = await request(app).get(`/api/v1/me/tickets/${ticketId}`).set(auth(custToken));
    expect(get2.body.replies).toHaveLength(2);
    expect(get2.body.replies[1].author_role).toBe("customer");

    const other = await request(app).get(`/api/v1/me/tickets/${ticketId}`).set(auth(cust2Token));
    expect(other.status).toBe(404);
    const otherReply = await request(app).post(`/api/v1/me/tickets/${ticketId}/reply`)
      .set(auth(cust2Token)).send({ body: "hijack" });
    expect(otherReply.status).toBe(404);
  });

  it("rejects bad ticket payloads", async () => {
    const r1 = await request(app).post("/api/v1/me/tickets")
      .set(auth(custToken)).send({ subject: "", body: "x" });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post("/api/v1/me/tickets")
      .set(auth(custToken)).send({ subject: "s" });
    expect(r2.status).toBe(400);
  });

  it("wishlist add -> list -> remove", async () => {
    const a = await request(app).post("/api/v1/me/wishlist")
      .set(auth(custToken)).send({ kit_id: kitId });
    expect(a.status).toBe(201);

    const bad = await request(app).post("/api/v1/me/wishlist")
      .set(auth(custToken)).send({ kit_id: "does-not-exist" });
    expect(bad.status).toBe(404);

    const list = await request(app).get("/api/v1/me/wishlist").set(auth(custToken));
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { kit_id: string }) => i.kit_id)).toContain(kitId);

    const del = await request(app).delete(`/api/v1/me/wishlist/${kitId}`).set(auth(custToken));
    expect(del.status).toBe(204);

    const list2 = await request(app).get("/api/v1/me/wishlist").set(auth(custToken));
    expect(list2.body.items).toHaveLength(0);

    const del2 = await request(app).delete(`/api/v1/me/wishlist/${kitId}`).set(auth(custToken));
    expect(del2.status).toBe(404);
  });
});

describe("pharmacy kit list (P1)", () => {
  it("GET /pharmacy/kits returns kits with stock for pharmacy and admin, 403 for customer", async () => {
    const r = await request(app).get("/api/v1/pharmacy/kits").set(auth(pharmacyToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.kits)).toBe(true);
    const kit = r.body.kits.find((k: { id: string }) => k.id === kitId);
    expect(kit).toBeDefined();
    expect(typeof kit.stock).toBe("number");
    expect(typeof kit.name).toBe("string");

    const admin = await request(app).get("/api/v1/pharmacy/kits").set(auth(adminToken));
    expect(admin.status).toBe(200);

    const cust = await request(app).get("/api/v1/pharmacy/kits").set(auth(custToken));
    expect(cust.status).toBe(403);
  });
});
