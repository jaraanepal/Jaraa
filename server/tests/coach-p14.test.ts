// Problem 4 (v14) coach workflow: assigned customers, follow-up scheduling/
// completion/history, nudge send end-to-end, bulk nudges, availability
// round-trip, and role gates.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let coachToken = "";
let otherCoachToken = "";
let custToken = "";
let customerId = "";
let followupId = "";

const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

beforeAll(async () => {
  const coach = await store.createUser({ phone: "+9779841200001", role: "coach" });
  coachToken = tokenFor({ id: coach.id, role: "coach" });
  const other = await store.createUser({ phone: "+9779841200002", role: "coach" });
  otherCoachToken = tokenFor({ id: other.id, role: "coach" });
  const cust = await store.createUser({ phone: "+9779841200003", role: "customer" });
  customerId = cust.id;
  await store.upsertProfile(customerId, { name: "Test Customer" });
  custToken = tokenFor({ id: cust.id, role: "customer" });
});

describe("coach workflow role gates", () => {
  it("customer -> 403 on GET /coach/customers", async () => {
    const r = await request(app).get("/api/v1/coach/customers").set(auth(custToken));
    expect(r.status).toBe(403);
  });
  it("customer -> 403 on GET /coach/followups", async () => {
    const r = await request(app).get("/api/v1/coach/followups").set(auth(custToken));
    expect(r.status).toBe(403);
  });
  it("customer -> 403 on POST assign", async () => {
    const r = await request(app).post(`/api/v1/coach/customers/${customerId}/assign`).set(auth(custToken)).send({});
    expect(r.status).toBe(403);
  });
  it("customer -> 403 on POST followup schedule", async () => {
    const r = await request(app).post(`/api/v1/coach/customers/${customerId}/followups`).set(auth(custToken)).send({ scheduled_for: future() });
    expect(r.status).toBe(403);
  });
  it("unauthenticated -> 401/403", async () => {
    const r = await request(app).get("/api/v1/coach/customers");
    expect([401, 403]).toContain(r.status);
  });
});

describe("assigned customers", () => {
  it("coach starts with no assigned customers", async () => {
    const r = await request(app).get("/api/v1/coach/customers").set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(r.body.customers).toEqual([]);
  });
  it("assigning a non-customer -> 404", async () => {
    const other = await store.createUser({ phone: "+9779841200009", role: "coach" });
    const r = await request(app).post(`/api/v1/coach/customers/${other.id}/assign`).set(auth(coachToken)).send({});
    expect(r.status).toBe(404);
  });
  it("assign -> listed with plan/checkin/followup fields", async () => {
    const a = await request(app).post(`/api/v1/coach/customers/${customerId}/assign`).set(auth(coachToken)).send({});
    expect(a.status).toBe(201);
    expect(a.body.assignment.customer_id).toBe(customerId);

    await store.addCheckin({ user_id: customerId, shedding_estimate: 40 });

    const r = await request(app).get("/api/v1/coach/customers").set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(r.body.customers).toHaveLength(1);
    const row = r.body.customers[0];
    expect(row.id).toBe(customerId);
    expect(row.name).toBe("Test Customer");
    expect(row.phone).toBe("+9779841200003");
    expect(row.plan_status).toBeNull();
    expect(row.last_checkin_at).not.toBeNull();
    expect(row.next_followup_at).toBeNull();
    expect(row.assigned_at).not.toBeNull();
  });
  it("other coach sees none of this coach's customers", async () => {
    const r = await request(app).get("/api/v1/coach/customers").set(auth(otherCoachToken));
    expect(r.status).toBe(200);
    expect(r.body.customers).toEqual([]);
  });
  it("?q= filters by name and phone", async () => {
    const byName = await request(app).get("/api/v1/coach/customers?q=test%20cust").set(auth(coachToken));
    expect(byName.body.customers).toHaveLength(1);
    const byPhone = await request(app).get("/api/v1/coach/customers?q=841200003").set(auth(coachToken));
    expect(byPhone.body.customers).toHaveLength(1);
    const miss = await request(app).get("/api/v1/coach/customers?q=zzz-no-match").set(auth(coachToken));
    expect(miss.body.customers).toHaveLength(0);
  });
  it("unassign -> removed from list", async () => {
    const d = await request(app).delete(`/api/v1/coach/customers/${customerId}/assign`).set(auth(coachToken));
    expect(d.status).toBe(204);
    const r = await request(app).get("/api/v1/coach/customers").set(auth(coachToken));
    expect(r.body.customers).toEqual([]);
    // re-assign for the follow-up tests below
    await request(app).post(`/api/v1/coach/customers/${customerId}/assign`).set(auth(coachToken)).send({});
  });
});

describe("follow-ups", () => {
  it("past date -> 400", async () => {
    const r = await request(app).post(`/api/v1/coach/customers/${customerId}/followups`)
      .set(auth(coachToken)).send({ scheduled_for: past(), note: "x" });
    expect(r.status).toBe(400);
  });
  it("other coach cannot schedule for this customer -> 403", async () => {
    const r = await request(app).post(`/api/v1/coach/customers/${customerId}/followups`)
      .set(auth(otherCoachToken)).send({ scheduled_for: future(), note: "x" });
    expect(r.status).toBe(403);
  });
  it("schedule -> per-customer history + next_followup_at + coach list", async () => {
    const s = await request(app).post(`/api/v1/coach/customers/${customerId}/followups`)
      .set(auth(coachToken)).send({ scheduled_for: future(), note: "check evening routine" });
    expect(s.status).toBe(201);
    followupId = s.body.followup.id;
    expect(s.body.followup.status).toBe("pending");
    expect(s.body.followup.note).toBe("check evening routine");

    const h = await request(app).get(`/api/v1/coach/customers/${customerId}/followups`).set(auth(coachToken));
    expect(h.status).toBe(200);
    expect(h.body.followups).toHaveLength(1);

    const c = await request(app).get("/api/v1/coach/customers").set(auth(coachToken));
    expect(c.body.customers[0].next_followup_at).not.toBeNull();

    const all = await request(app).get("/api/v1/coach/followups").set(auth(coachToken));
    expect(all.status).toBe(200);
    expect(all.body.followups).toHaveLength(1);
    expect(all.body.followups[0].customer_name).toBe("Test Customer");
  });
  it("invalid status filter -> 400", async () => {
    const r = await request(app).get("/api/v1/coach/followups?status=bogus").set(auth(coachToken));
    expect(r.status).toBe(400);
  });
  it("complete -> status completed, visible in completed filter + history", async () => {
    const c = await request(app).patch(`/api/v1/coach/followups/${followupId}/complete`).set(auth(coachToken));
    expect(c.status).toBe(200);
    expect(c.body.followup.status).toBe("completed");
    expect(c.body.followup.completed_at).not.toBeNull();

    const done = await request(app).get("/api/v1/coach/followups?status=completed").set(auth(coachToken));
    expect(done.body.followups).toHaveLength(1);
    const pend = await request(app).get("/api/v1/coach/followups?status=pending").set(auth(coachToken));
    expect(pend.body.followups).toHaveLength(0);

    // completing again is idempotent (still 200, still completed)
    const again = await request(app).patch(`/api/v1/coach/followups/${followupId}/complete`).set(auth(coachToken));
    expect(again.status).toBe(200);
    expect(again.body.followup.status).toBe("completed");

    // after completion, no pending next follow-up
    const cu = await request(app).get("/api/v1/coach/customers").set(auth(coachToken));
    expect(cu.body.customers[0].next_followup_at).toBeNull();
  });
  it("other coach cannot complete this coach's follow-up -> 404", async () => {
    const r = await request(app).patch(`/api/v1/coach/followups/${followupId}/complete`).set(auth(otherCoachToken));
    expect(r.status).toBe(404);
  });
  it("unknown follow-up -> 404", async () => {
    const r = await request(app).patch("/api/v1/coach/followups/00000000-0000-0000-0000-000000000000/complete").set(auth(coachToken));
    expect(r.status).toBe(404);
  });
});

describe("nudge delivery end-to-end", () => {
  it("schedule + send-now delivers a customer notification and marks sent", async () => {
    const created = await request(app).post("/api/v1/coach/nudges/scheduled").set(auth(coachToken)).send({
      user_id: customerId,
      message_en: "Keep the evening oil routine going!",
      send_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(created.status).toBe(201);
    const id = created.body.nudge.id;

    const sent = await request(app).post(`/api/v1/coach/nudges/scheduled/${id}/send`).set(auth(coachToken));
    expect(sent.status).toBe(200);
    expect(sent.body.nudge.sent_at).not.toBeNull();

    const inbox = await store.listNotifications(customerId, { limit: 10, offset: 0 });
    const nudge = inbox.notifications.find((n) => n.type === "coach_nudge");
    expect(nudge).toBeDefined();
    expect(nudge!.body_en).toContain("evening oil routine");

    // double-send is a 409 conflict
    const again = await request(app).post(`/api/v1/coach/nudges/scheduled/${id}/send`).set(auth(coachToken));
    expect(again.status).toBe(409);
  });
  it("bulk nudge creates one scheduled row per customer", async () => {
    const second = await store.createUser({ phone: "+9779841200004", role: "customer" });
    const r = await request(app).post("/api/v1/coach/nudges/bulk").set(auth(coachToken)).send({
      customer_ids: [customerId, second.id],
      body_en: "Weekly check-in reminder",
      send_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(r.status).toBe(201);
    expect(r.body.sent).toBe(2);
    expect(r.body.nudges).toHaveLength(2);

    const empty = await request(app).post("/api/v1/coach/nudges/bulk").set(auth(coachToken)).send({
      customer_ids: [], body_en: "x", send_at: future(),
    });
    expect(empty.status).toBe(400);
  });
});

describe("coach availability (C26) still works", () => {
  it("GET -> null, PUT -> round trip", async () => {
    const g1 = await request(app).get("/api/v1/coach/availability").set(auth(otherCoachToken));
    expect(g1.status).toBe(200);
    expect(g1.body.availability).toBeNull();

    const p = await request(app).put("/api/v1/coach/availability").set(auth(otherCoachToken))
      .send({ status: "on_leave", note: "festival week" });
    expect(p.status).toBe(200);
    expect(p.body.availability.status).toBe("on_leave");
    expect(p.body.availability.note).toBe("festival week");

    const g2 = await request(app).get("/api/v1/coach/availability").set(auth(otherCoachToken));
    expect(g2.body.availability.status).toBe("on_leave");

    const bad = await request(app).put("/api/v1/coach/availability").set(auth(otherCoachToken)).send({ status: "away" });
    expect(bad.status).toBe(400);
  });
});
