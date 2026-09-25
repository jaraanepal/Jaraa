// Batch 3 (009) customer endpoint tests: U21–U29 + leaderboard opt-in.
// Covers happy paths, validation, and cross-user ownership isolation.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let custToken = "";
let cust2Token = "";
let custId = "";
let cust2Id = "";
let caseId = "";
let orderId = "";

const M = "/api/v1/me";

beforeAll(async () => {
  const cust = await store.createUser({ phone: "+9779842100001", role: "customer" });
  const cust2 = await store.createUser({ phone: "+9779842100002", role: "customer" });
  custToken = tokenFor(cust);
  cust2Token = tokenFor(cust2);
  custId = cust.id;
  cust2Id = cust2.id;

  // cust's case (case → scan → user ownership chain).
  const scan = await store.createScan({ user_id: cust.id });
  const kase = await store.createCase({
    scan_id: scan.id, priority: 50,
    sla_due_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  caseId = kase.id;

  // cust's order (for U27 + U25 loyalty).
  const kit = await store.createKit({ name_en: "B3 Oil Kit", product_ids: [], total_npr: 750, stock: 5 });
  const order = await store.createOrder({
    order_no: "JR-B3-1", user_id: custId, kit_id: kit.id,
    subtotal_npr: 750, shipping_npr: 0, total_npr: 750,
    payment_method: "cod", idempotency_key: "b3-k1", shipping_address: {},
  });
  orderId = order.id;
});

describe("U21 case Q&A", () => {
  it("POST /me/cases/:id/messages posts as the customer role", async () => {
    const r = await request(app)
      .post(`${M}/cases/${caseId}/messages`)
      .set(auth(custToken))
      .send({ body: "Is it normal to shed more this week?" });
    expect(r.status).toBe(201);
    expect(r.body.author_role).toBe("customer");
    expect(r.body.author_id).toBe(custId);
    expect(r.body.body).toContain("shed more");
  });

  it("GET /me/cases/:id/messages returns the thread oldest first", async () => {
    const r = await request(app).get(`${M}/cases/${caseId}/messages`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.messages)).toBe(true);
    expect(r.body.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("user B cannot read user A's case thread (404)", async () => {
    const r = await request(app).get(`${M}/cases/${caseId}/messages`).set(auth(cust2Token));
    expect(r.status).toBe(404);
  });

  it("user B cannot message user A's case (404)", async () => {
    const r = await request(app)
      .post(`${M}/cases/${caseId}/messages`)
      .set(auth(cust2Token))
      .send({ body: "Hello" });
    expect(r.status).toBe(404);
  });

  it("rejects an empty body (400)", async () => {
    const r = await request(app)
      .post(`${M}/cases/${caseId}/messages`)
      .set(auth(custToken))
      .send({ body: "   " });
    expect(r.status).toBe(400);
  });

  it("GET /me/cases lists only my cases", async () => {
    const mine = await request(app).get(`${M}/cases`).set(auth(custToken));
    expect(mine.status).toBe(200);
    expect(mine.body.cases.some((c: { id: string }) => c.id === caseId)).toBe(true);
    const theirs = await request(app).get(`${M}/cases`).set(auth(cust2Token));
    expect(theirs.status).toBe(200);
    expect(theirs.body.cases).toHaveLength(0);
  });
});

describe("U22 review requests", () => {
  it("POST creates a pending request with a reason", async () => {
    const r = await request(app)
      .post(`${M}/review-requests`)
      .set(auth(custToken))
      .send({ case_id: caseId, reason: "Plan feels off" });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("pending");
    expect(r.body.case_id).toBe(caseId);
  });

  it("POST works without a case (general follow-up)", async () => {
    const r = await request(app)
      .post(`${M}/review-requests`)
      .set(auth(custToken))
      .send({});
    expect(r.status).toBe(201);
    expect(r.body.case_id).toBeNull();
  });

  it("POST with someone else's case_id is 404", async () => {
    const r = await request(app)
      .post(`${M}/review-requests`)
      .set(auth(cust2Token))
      .send({ case_id: caseId, reason: "x" });
    expect(r.status).toBe(404);
  });

  it("GET lists my own requests", async () => {
    const r = await request(app).get(`${M}/review-requests`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.requests.length).toBeGreaterThanOrEqual(2);
    const r2 = await request(app).get(`${M}/review-requests`).set(auth(cust2Token));
    expect(r2.body.requests).toHaveLength(0);
  });
});

describe("U23 community tips", () => {
  it("POST creates a pending tip, invisible in the public list", async () => {
    const created = await request(app)
      .post(`${M}/community-tips`)
      .set(auth(custToken))
      .send({ title: "My morning habit", body: "I oil twice a week." });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");

    const list = await request(app).get(`${M}/community-tips`).set(auth(custToken));
    expect(list.status).toBe(200);
    expect(list.body.tips.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
  });

  it("an approved tip becomes visible to customers", async () => {
    const created = await request(app)
      .post(`${M}/community-tips`)
      .set(auth(custToken))
      .send({ title: "Visible tip", body: "Brush gently." });
    // Admin moderation (A23) approves it.
    await store.decideCommunityTip(created.body.id, true, "admin-1");
    const list = await request(app).get(`${M}/community-tips`).set(auth(cust2Token));
    expect(list.status).toBe(200);
    expect(list.body.tips.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
  });

  it("rejects empty title/body (400)", async () => {
    const r = await request(app)
      .post(`${M}/community-tips`)
      .set(auth(custToken))
      .send({ title: "", body: "x" });
    expect(r.status).toBe(400);
  });
});

describe("U24 adherence history", () => {
  it("returns 12 weeks, oldest → newest, with a positive rate this week", async () => {
    await store.addCheckin({ user_id: custId, shedding_estimate: 30 });
    const r = await request(app).get(`${M}/adherence/history`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.history).toHaveLength(12);
    const weeks = r.body.history.map((h: { week: string }) => h.week);
    expect([...weeks].sort()).toEqual(weeks); // oldest → newest
    const thisWeek = r.body.history[r.body.history.length - 1];
    expect(thisWeek.rate).toBeGreaterThan(0);
    expect(thisWeek.rate).toBeLessThanOrEqual(1);
  });
});

describe("U25 loyalty wallet", () => {
  it("derives earn from delivered orders (750 → 7 pts) plus ledger entries", async () => {
    // Before delivery: no earn.
    const before = await request(app).get(`${M}/loyalty`).set(auth(custToken));
    expect(before.body.balance).toBe(0);

    await store.updateOrder(orderId, { status: "delivered" });
    const earned = await request(app).get(`${M}/loyalty`).set(auth(custToken));
    expect(earned.status).toBe(200);
    expect(earned.body.balance).toBe(7); // floor(750 / 100)

    await store.addLoyaltyEntry(custId, -2, "refund clawback", orderId);
    const adjusted = await request(app).get(`${M}/loyalty`).set(auth(custToken));
    expect(adjusted.body.balance).toBe(5);
    expect(adjusted.body.history).toHaveLength(1);
    expect(adjusted.body.history[0].points).toBe(-2);
  });

  it("another customer has a zero balance", async () => {
    const r = await request(app).get(`${M}/loyalty`).set(auth(cust2Token));
    expect(r.body.balance).toBe(0);
    expect(r.body.history).toHaveLength(0);
  });
});

describe("U27 order issue reporter", () => {
  it("POST creates a dispute for my own order", async () => {
    const r = await request(app)
      .post(`${M}/orders/${orderId}/issue`)
      .set(auth(custToken))
      .send({ subject: "Damaged box", body: "The kit arrived crushed." });
    expect(r.status).toBe(201);
    expect(r.body.order_id).toBe(orderId);
    expect(r.body.user_id).toBe(custId);
    expect(r.body.subject).toBe("Damaged box");
  });

  it("user B cannot report on user A's order (404)", async () => {
    const r = await request(app)
      .post(`${M}/orders/${orderId}/issue`)
      .set(auth(cust2Token))
      .send({ subject: "x", body: "y" });
    expect(r.status).toBe(404);
  });

  it("rejects empty subject (400)", async () => {
    const r = await request(app)
      .post(`${M}/orders/${orderId}/issue`)
      .set(auth(custToken))
      .send({ subject: "", body: "y" });
    expect(r.status).toBe(400);
  });
});

describe("U29 routine library", () => {
  it("GET returns only published routines", async () => {
    const r = await request(app).get(`${M}/routines`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.routines)).toBe(true);
    for (const item of r.body.routines) {
      expect(item.is_published).toBe(true);
    }
  });
});

describe("leaderboard opt-in (C19)", () => {
  it("defaults to false, round-trips true then false", async () => {
    const initial = await request(app).get(`${M}/leaderboard-opt-in`).set(auth(custToken));
    expect(initial.status).toBe(200);
    expect(initial.body.opt_in).toBe(false);

    const on = await request(app)
      .put(`${M}/leaderboard-opt-in`)
      .set(auth(custToken))
      .send({ opt_in: true });
    expect(on.status).toBe(200);
    expect(on.body.opt_in).toBe(true);

    const reread = await request(app).get(`${M}/leaderboard-opt-in`).set(auth(custToken));
    expect(reread.body.opt_in).toBe(true);

    await request(app).put(`${M}/leaderboard-opt-in`).set(auth(custToken)).send({ opt_in: false });
    const off = await request(app).get(`${M}/leaderboard-opt-in`).set(auth(custToken));
    expect(off.body.opt_in).toBe(false);
  });

  it("rejects a non-boolean opt_in (400)", async () => {
    const r = await request(app)
      .put(`${M}/leaderboard-opt-in`)
      .set(auth(custToken))
      .send({ opt_in: "yes" });
    expect(r.status).toBe(400);
  });
});
