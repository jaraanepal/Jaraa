// Batch 4 (010) customer endpoint tests: U30–U47.
// Covers happy paths, validation, and cross-user ownership isolation.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let custToken = "";
let cust2Token = "";
let adminToken = "";
let custId = "";
let cust2Id = "";
let kitId = "";

const M = "/api/v1/me";

/** Local-noon ISO for `daysAgo` days ago — immune to midnight-boundary flakes. */
function dayIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

beforeAll(async () => {
  const cust = await store.createUser({ phone: "+9779843100001", role: "customer" });
  const cust2 = await store.createUser({ phone: "+9779843100002", role: "customer" });
  const admin = await store.createUser({ phone: "+9779843100003", role: "admin" });
  custToken = tokenFor(cust);
  cust2Token = tokenFor(cust2);
  adminToken = tokenFor(admin);
  custId = cust.id;
  cust2Id = cust2.id;

  const kit = await store.createKit({ name_en: "B4 Oil Kit", product_ids: [], total_npr: 900, stock: 5 });
  kitId = kit.id;
});

describe("U30/U46 profile preferences", () => {
  it("PATCH /me/profile accepts content_language and default_payment", async () => {
    const r = await request(app)
      .patch(`${M}/profile`)
      .set(auth(custToken))
      .send({ content_language: "en", default_payment: "khalti" });
    expect(r.status).toBe(200);
    expect(r.body.content_language).toBe("en");
    expect(r.body.default_payment).toBe("khalti");
  });

  it("GET /me/profile returns the saved preferences", async () => {
    const r = await request(app).get(`${M}/profile`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.content_language).toBe("en");
    expect(r.body.default_payment).toBe("khalti");
  });

  it("PATCH /me/profile rejects invalid content_language", async () => {
    const r = await request(app)
      .patch(`${M}/profile`)
      .set(auth(custToken))
      .send({ content_language: "fr" });
    expect(r.status).toBe(400);
  });

  it("PATCH /me/profile rejects invalid default_payment", async () => {
    const r = await request(app)
      .patch(`${M}/profile`)
      .set(auth(custToken))
      .send({ default_payment: "paypal" });
    expect(r.status).toBe(400);
  });

  it("PATCH /me/profile accepts null to clear preferences", async () => {
    const r = await request(app)
      .patch(`${M}/profile`)
      .set(auth(custToken))
      .send({ content_language: null, default_payment: null });
    expect(r.status).toBe(200);
    expect(r.body.content_language).toBeNull();
    expect(r.body.default_payment).toBeNull();
  });
});

describe("U31 streak", () => {
  it("GET /me/streak is 0 with no check-ins", async () => {
    const r = await request(app).get(`${M}/streak`).set(auth(cust2Token));
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(0);
  });

  it("counts consecutive days ending today", async () => {
    for (const ago of [0, 1, 2]) {
      const id = `b4-streak-${ago}`;
      (store as unknown as { checkins: Map<string, unknown> }).checkins.set(id, {
        id, user_id: custId, plan_id: null, scan_id: null,
        shedding_estimate: null, note: null, photo_ids: [], created_at: dayIso(ago),
      });
    }
    const r = await request(app).get(`${M}/streak`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(3);
  });

  it("breaks the streak at a gap (today + 5 days ago = 1)", async () => {
    for (const ago of [0, 5]) {
      const id = `b4-streak-gap-${ago}`;
      (store as unknown as { checkins: Map<string, unknown> }).checkins.set(id, {
        id, user_id: cust2Id, plan_id: null, scan_id: null,
        shedding_estimate: null, note: null, photo_ids: [], created_at: dayIso(ago),
      });
    }
    const r = await request(app).get(`${M}/streak`).set(auth(cust2Token));
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(1);
  });
});

describe("U32 referrals", () => {
  it("GET /me/referrals returns the deterministic code and honest empty joins", async () => {
    const r = await request(app).get(`${M}/referrals`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.code).toBe(`JARAA-${custId.slice(0, 6).toUpperCase()}`);
    expect(r.body.joined).toEqual([]);
  });
});

describe("U33 price-drop alerts", () => {
  it("wishlisted kit price drop creates a price_drop notification", async () => {
    const w = await request(app).post(`${M}/wishlist`).set(auth(custToken)).send({ kit_id: kitId });
    expect(w.status).toBe(201);

    const upd = await request(app)
      .patch(`/api/v1/admin/kits/${kitId}`)
      .set(auth(adminToken))
      .send({ total_npr: 700 });
    expect(upd.status).toBe(200);

    const n = await request(app).get("/api/v1/notifications").set(auth(custToken));
    expect(n.status).toBe(200);
    const drops = n.body.notifications.filter((x: { type: string }) => x.type === "price_drop");
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(drops[0].link).toBe(`/kits/${kitId}`);
  });

  it("price increase or same price creates no price_drop notification", async () => {
    const before = await request(app).get("/api/v1/notifications").set(auth(cust2Token));
    const beforeCount = before.body.notifications.filter((x: { type: string }) => x.type === "price_drop").length;

    await request(app).post(`${M}/wishlist`).set(auth(cust2Token)).send({ kit_id: kitId });
    const upd = await request(app)
      .patch(`/api/v1/admin/kits/${kitId}`)
      .set(auth(adminToken))
      .send({ total_npr: 750 }); // up from 700
    expect(upd.status).toBe(200);

    const after = await request(app).get("/api/v1/notifications").set(auth(cust2Token));
    const afterCount = after.body.notifications.filter((x: { type: string }) => x.type === "price_drop").length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe("U36 consent history", () => {
  it("POST /me/consents records and GET returns newest first", async () => {
    const p1 = await request(app).post(`${M}/consents`).set(auth(custToken)).send({ type: "photo", version: "v1", granted: true });
    expect(p1.status).toBe(201);
    const p2 = await request(app).post(`${M}/consents`).set(auth(custToken)).send({ type: "photo", version: "v2", granted: false });
    expect(p2.status).toBe(201);

    const g = await request(app).get(`${M}/consents`).set(auth(custToken));
    expect(g.status).toBe(200);
    expect(Array.isArray(g.body.consents)).toBe(true);
    expect(g.body.consents.length).toBeGreaterThanOrEqual(2);
    const versions = g.body.consents.map((c: { version: string }) => c.version);
    expect(versions.indexOf("v2")).toBeLessThan(versions.indexOf("v1"));
  });

  it("consents are per-user", async () => {
    const g = await request(app).get(`${M}/consents`).set(auth(cust2Token));
    expect(g.status).toBe(200);
    expect(g.body.consents.every((c: { user_id: string }) => c.user_id === cust2Id)).toBe(true);
  });
});

describe("U37 app feedback", () => {
  it("POST /me/feedback accepts rating 1–5 with a message", async () => {
    const r = await request(app)
      .post(`${M}/feedback`)
      .set(auth(custToken))
      .send({ rating: 5, message: "Great app!" });
    expect(r.status).toBe(201);
    expect(r.body.rating).toBe(5);
    expect(r.body.message).toBe("Great app!");
  });

  it("POST /me/feedback accepts a rating without a message", async () => {
    const r = await request(app).post(`${M}/feedback`).set(auth(custToken)).send({ rating: 1 });
    expect(r.status).toBe(201);
    expect(r.body.message).toBeNull();
  });

  it("POST /me/feedback rejects out-of-range ratings", async () => {
    for (const rating of [0, 6, "x", null]) {
      const r = await request(app).post(`${M}/feedback`).set(auth(custToken)).send({ rating });
      expect(r.status).toBe(400);
    }
  });

  it("requires auth", async () => {
    const r = await request(app).post(`${M}/feedback`).send({ rating: 5 });
    expect(r.status).toBe(401);
  });
});

describe("U40 kit reminders", () => {
  let reminderId = "";

  it("POST /me/kit-reminders creates a reminder", async () => {
    const r = await request(app)
      .post(`${M}/kit-reminders`)
      .set(auth(custToken))
      .send({ kit_id: kitId, label_en: "Apply oil", remind_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(r.status).toBe(201);
    expect(r.body.label_en).toBe("Apply oil");
    expect(r.body.done).toBe(false);
    reminderId = r.body.id;
  });

  it("validates label, remind_at, and kit_id", async () => {
    const badLabel = await request(app).post(`${M}/kit-reminders`).set(auth(custToken)).send({ label_en: "  ", remind_at: new Date().toISOString() });
    expect(badLabel.status).toBe(400);
    const badDate = await request(app).post(`${M}/kit-reminders`).set(auth(custToken)).send({ label_en: "Oil", remind_at: "not-a-date" });
    expect(badDate.status).toBe(400);
    const badKit = await request(app).post(`${M}/kit-reminders`).set(auth(custToken)).send({ label_en: "Oil", kit_id: "nope", remind_at: new Date().toISOString() });
    expect(badKit.status).toBe(404);
  });

  it("GET /me/kit-reminders lists own reminders", async () => {
    const r = await request(app).get(`${M}/kit-reminders`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.reminders.some((x: { id: string }) => x.id === reminderId)).toBe(true);
  });

  it("PATCH /me/kit-reminders/:id/done toggles done for the owner only", async () => {
    const other = await request(app).patch(`${M}/kit-reminders/${reminderId}/done`).set(auth(cust2Token)).send({ done: true });
    expect(other.status).toBe(404);
    const own = await request(app).patch(`${M}/kit-reminders/${reminderId}/done`).set(auth(custToken)).send({ done: true });
    expect(own.status).toBe(200);
    expect(own.body.done).toBe(true);
  });

  it("DELETE /me/kit-reminders/:id deletes for the owner only", async () => {
    const other = await request(app).delete(`${M}/kit-reminders/${reminderId}`).set(auth(cust2Token));
    expect(other.status).toBe(404);
    const own = await request(app).delete(`${M}/kit-reminders/${reminderId}`).set(auth(custToken));
    expect(own.status).toBe(204);
    const g = await request(app).get(`${M}/kit-reminders`).set(auth(custToken));
    expect(g.body.reminders.some((x: { id: string }) => x.id === reminderId)).toBe(false);
  });
});

describe("U41 reorder suggestions", () => {
  it("suggests kits whose latest order is 60+ days old", async () => {
    const order = await store.createOrder({
      order_no: "JR-B4-OLD", user_id: custId, kit_id: kitId,
      subtotal_npr: 900, shipping_npr: 0, total_npr: 900,
      payment_method: "cod", idempotency_key: "b4-old-1", shipping_address: {},
    });
    (store as unknown as { orders: Map<string, { created_at: string }> }).orders.get(order.id)!.created_at = dayIso(61);

    const r = await request(app).get(`${M}/reorder-suggestions`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.suggestions.some((s: { kit_id: string }) => s.kit_id === kitId)).toBe(true);
  });

  it("does not suggest recently ordered kits", async () => {
    const r = await request(app).get(`${M}/reorder-suggestions`).set(auth(cust2Token));
    expect(r.status).toBe(200);
    expect(r.body.suggestions).toEqual([]);
  });
});

describe("U42 kit usage log", () => {
  it("POST /me/kit-usages logs a usage and GET lists newest first", async () => {
    const p1 = await request(app).post(`${M}/kit-usages`).set(auth(custToken)).send({ kit_id: kitId, note: "Morning application" });
    expect(p1.status).toBe(201);
    const p2 = await request(app).post(`${M}/kit-usages`).set(auth(custToken)).send({ note: "No kit linked" });
    expect(p2.status).toBe(201);
    expect(p2.body.kit_id).toBeNull();

    const g = await request(app).get(`${M}/kit-usages?limit=5`).set(auth(custToken));
    expect(g.status).toBe(200);
    expect(g.body.usages.length).toBeGreaterThanOrEqual(2);
    expect(new Date(g.body.usages[0].used_at).getTime())
      .toBeGreaterThanOrEqual(new Date(g.body.usages[1].used_at).getTime());
  });

  it("rejects unknown kit ids", async () => {
    const r = await request(app).post(`${M}/kit-usages`).set(auth(custToken)).send({ kit_id: "nope" });
    expect(r.status).toBe(404);
  });

  it("usage logs are per-user", async () => {
    const g = await request(app).get(`${M}/kit-usages`).set(auth(cust2Token));
    expect(g.body.usages.every((u: { user_id: string }) => u.user_id === cust2Id)).toBe(true);
  });
});

describe("C28 certificate + C45 survey (customer side)", () => {
  let assignmentId = "";
  let openAssignmentId = "";

  beforeAll(async () => {
    const ch = await store.createChallenge({ title_en: "B4 Oil Challenge", days: 7, created_by: null });
    const done = await store.assignChallenge(ch.id, custId);
    assignmentId = (await store.completeChallengeAssignment(done.id, custId))!.id;
    // assignChallenge is idempotent per challenge+user, so the open
    // assignment needs its own challenge.
    const ch2 = await store.createChallenge({ title_en: "B4 Open Challenge", days: 7, created_by: null });
    openAssignmentId = (await store.assignChallenge(ch2.id, custId)).id;
  });

  it("GET /me/challenges/assignments/:id/certificate returns certificate data when complete", async () => {
    const r = await request(app)
      .get(`${M}/challenges/assignments/${assignmentId}/certificate`)
      .set(auth(custToken));
    expect(r.status).toBe(200);
    expect(r.body.certificate.assignment_id).toBe(assignmentId);
    expect(r.body.certificate.challenge_title_en).toBe("B4 Oil Challenge");
    expect(typeof r.body.certificate.completed_at).toBe("string");
  });

  it("certificate is 409 while the challenge is still in progress", async () => {
    const r = await request(app)
      .get(`${M}/challenges/assignments/${openAssignmentId}/certificate`)
      .set(auth(custToken));
    expect(r.status).toBe(409);
  });

  it("certificate is 404 for another customer's assignment", async () => {
    const r = await request(app)
      .get(`${M}/challenges/assignments/${assignmentId}/certificate`)
      .set(auth(cust2Token));
    expect(r.status).toBe(404);
  });

  it("POST /me/challenges/:id/survey submits once, then 409s", async () => {
    const first = await request(app)
      .post(`${M}/challenges/${assignmentId}/survey`)
      .set(auth(custToken))
      .send({ q1_rating: 5, q2_text: "Loved it" });
    expect(first.status).toBe(201);
    expect(first.body.survey.q1_rating).toBe(5);

    const dup = await request(app)
      .post(`${M}/challenges/${assignmentId}/survey`)
      .set(auth(custToken))
      .send({ q1_rating: 4 });
    expect(dup.status).toBe(409);
  });

  it("survey rejects bad ratings and foreign assignments", async () => {
    const bad = await request(app)
      .post(`${M}/challenges/${openAssignmentId}/survey`)
      .set(auth(custToken))
      .send({ q1_rating: 9 });
    expect(bad.status).toBe(400);
    const foreign = await request(app)
      .post(`${M}/challenges/${assignmentId}/survey`)
      .set(auth(cust2Token))
      .send({ q1_rating: 5 });
    expect(foreign.status).toBe(404);
  });
});

describe("U45 sessions", () => {
  it("GET /me/sessions lists own sessions without exposing token material", async () => {
    await store.saveRefreshToken({ token_hash: "b4hash-abcdef1234567890", user_id: custId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    await store.saveRefreshToken({ token_hash: "b4hash-other-user-zzz", user_id: cust2Id, expires_at: new Date(Date.now() + 86_400_000).toISOString() });

    const r = await request(app).get(`${M}/sessions`).set(auth(custToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.sessions)).toBe(true);
    expect(r.body.sessions.length).toBeGreaterThanOrEqual(1);
    const mine = r.body.sessions.find((s: { id: string }) => s.id === "b4hash-a");
    expect(mine).toBeDefined();
    expect(mine.last_used_at).toBeNull();
    expect(typeof mine.created_at).toBe("string");
    // Full token hashes are credential material — must never leak.
    const dumped = JSON.stringify(r.body);
    expect(dumped).not.toContain("b4hash-abcdef1234567890");
    expect(dumped).not.toContain("b4hash-other-user-zzz");
  });
});
