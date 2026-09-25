// Batch-3 coach endpoints (C19–C27): role gates, recurrence validation,
// leaderboard opt-in filtering, availability round-trip, onboarding save/get.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let coachToken = "";
let custToken = "";
let optInId = "";
let optOutId = "";

beforeAll(async () => {
  const coach = await store.createUser({ phone: "+9779841100001", role: "coach" });
  coachToken = tokenFor({ id: coach.id, role: "coach" });
  const optIn = await store.createUser({ phone: "+9779841100002", role: "customer" });
  optInId = optIn.id;
  await store.setLeaderboardOptIn(optInId, true);
  await store.addCheckin({ user_id: optInId, shedding_estimate: 100 });
  const optOut = await store.createUser({ phone: "+9779841100003", role: "customer" });
  optOutId = optOut.id;
  await store.addCheckin({ user_id: optOutId, shedding_estimate: 50 });
  const plain = await store.createUser({ phone: "+9779841100004", role: "customer" });
  custToken = tokenFor({ id: plain.id, role: "customer" });
});

describe("coach batch-3 role gates", () => {
  it("customer -> 403 on leaderboard (C19)", async () => {
    const r = await request(app).get("/api/v1/coach/leaderboard").set(auth(custToken));
    expect(r.status).toBe(403);
  });
  it("customer -> 403 on escalations/sla (C20)", async () => {
    const r = await request(app).get("/api/v1/coach/escalations/sla").set(auth(custToken));
    expect(r.status).toBe(403);
  });
  it("customer -> 403 on recurring nudge create (C21)", async () => {
    const r = await request(app).post("/api/v1/coach/nudges/recurring").set(auth(custToken))
      .send({ user_id: optInId, message_en: "x", send_at: new Date(Date.now() + 3600_000).toISOString(), recurrence: "daily" });
    expect(r.status).toBe(403);
  });
  it("customer -> 403 on missed-checkins (C25)", async () => {
    const r = await request(app).get("/api/v1/coach/missed-checkins").set(auth(custToken));
    expect(r.status).toBe(403);
  });
  it("customer -> 403 on availability (C26)", async () => {
    const r = await request(app).get("/api/v1/coach/availability").set(auth(custToken));
    expect(r.status).toBe(403);
  });
  it("unauthenticated -> 401", async () => {
    const r = await request(app).get("/api/v1/coach/leaderboard");
    expect([401, 403]).toContain(r.status);
  });
});

describe("C19 streak leaderboard", () => {
  it("returns only opted-in customers, anonymized display", async () => {
    const r = await request(app).get("/api/v1/coach/leaderboard").set(auth(coachToken));
    expect(r.status).toBe(200);
    const ids = r.body.leaderboard.map((x: { user_id: string }) => x.user_id);
    expect(ids).toContain(optInId);
    expect(ids).not.toContain(optOutId);
    const row = r.body.leaderboard.find((x: { user_id: string }) => x.user_id === optInId);
    expect(row.display).toMatch(/^Customer #[0-9A-F]{4}$/);
    expect(row.streak).toBeGreaterThanOrEqual(1);
  });
  it("limit must be a positive int", async () => {
    const r = await request(app).get("/api/v1/coach/leaderboard?limit=nope").set(auth(coachToken));
    expect(r.status).toBe(400);
  });
});

describe("C20 escalation SLA", () => {
  it("returns honest nulls (no ack/resolve timestamps in schema)", async () => {
    await store.createEscalation(optInId, coachToken, "test escalation");
    const r = await request(app).get("/api/v1/coach/escalations/sla").set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(r.body.sla.length).toBeGreaterThanOrEqual(1);
    for (const row of r.body.sla) {
      expect(row.hours_to_ack).toBeNull();
      expect(row.hours_to_resolve).toBeNull();
    }
  });
});

describe("C21 recurring nudges", () => {
  const future = () => new Date(Date.now() + 3600_000).toISOString();
  it("rejects an invalid recurrence value", async () => {
    const r = await request(app).post("/api/v1/coach/nudges/recurring").set(auth(coachToken))
      .send({ user_id: optInId, message_en: "Daily reminder", send_at: future(), recurrence: "monthly" });
    expect(r.status).toBe(400);
  });
  it("rejects a missing recurrence value", async () => {
    const r = await request(app).post("/api/v1/coach/nudges/recurring").set(auth(coachToken))
      .send({ user_id: optInId, message_en: "Daily reminder", send_at: future() });
    expect(r.status).toBe(400);
  });
  it("creates a daily recurring nudge (201) with the recurrence on the row", async () => {
    const r = await request(app).post("/api/v1/coach/nudges/recurring").set(auth(coachToken))
      .send({ user_id: optInId, message_en: "Daily reminder", message_ne: "दैनिक सम्झना", send_at: future(), recurrence: "daily" });
    expect(r.status).toBe(201);
    expect(r.body.nudge.recurrence).toBe("daily");
    expect(r.body.nudge.user_id).toBe(optInId);
  });
  it("rejects past send_at", async () => {
    const r = await request(app).post("/api/v1/coach/nudges/recurring").set(auth(coachToken))
      .send({ user_id: optInId, message_en: "x", send_at: new Date(Date.now() - 1000).toISOString(), recurrence: "weekly" });
    expect(r.status).toBe(400);
  });
});

describe("C22 satisfaction trend", () => {
  it("buckets ratings by week with avg + count", async () => {
    await store.addSatisfactionRating(optInId, coachToken, 5, "great");
    await store.addSatisfactionRating(optInId, coachToken, 3);
    const r = await request(app).get("/api/v1/coach/satisfaction/trend").set(auth(coachToken));
    expect(r.status).toBe(200);
    const total = r.body.trend.reduce((n: number, b: { count: number }) => n + b.count, 0);
    expect(total).toBe(2);
    expect(r.body.trend[0]).toHaveProperty("bucket");
    expect(r.body.trend[0]).toHaveProperty("avg");
  });
});

describe("C23 progress compare", () => {
  it("returns baseline + current shedding estimates", async () => {
    const r = await request(app).get(`/api/v1/coach/customers/${optInId}/progress-compare`).set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("baseline");
    expect(r.body).toHaveProperty("current");
  });
  it("unknown customer -> 404", async () => {
    const r = await request(app).get("/api/v1/coach/customers/nope/progress-compare").set(auth(coachToken));
    expect(r.status).toBe(404);
  });
});

describe("C24 onboarding checklist", () => {
  it("GET returns null before save", async () => {
    const r = await request(app).get(`/api/v1/coach/customers/${optInId}/onboarding`).set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(r.body.checklist).toBeNull();
  });
  it("PATCH saves then GET returns the same steps", async () => {
    const steps = [
      { key: "profile_complete", done: true },
      { key: "first_scan", done: false },
    ];
    const p = await request(app).patch(`/api/v1/coach/customers/${optInId}/onboarding`).set(auth(coachToken))
      .send({ steps });
    expect(p.status).toBe(200);
    expect(p.body.checklist.steps).toEqual(steps);
    const g = await request(app).get(`/api/v1/coach/customers/${optInId}/onboarding`).set(auth(coachToken));
    expect(g.status).toBe(200);
    expect(g.body.checklist.steps).toEqual(steps);
  });
  it("PATCH with non-array steps -> 400", async () => {
    const r = await request(app).patch(`/api/v1/coach/customers/${optInId}/onboarding`).set(auth(coachToken))
      .send({ steps: "nope" });
    expect(r.status).toBe(400);
  });
});

describe("C25 missed check-ins", () => {
  it("returns a list; fresh accounts are not flagged", async () => {
    const r = await request(app).get("/api/v1/coach/missed-checkins").set(auth(coachToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.missed)).toBe(true);
    const ids = r.body.missed.map((m: { user_id: string }) => m.user_id);
    expect(ids).not.toContain(optInId);
  });
  it("days must be a positive int", async () => {
    const r = await request(app).get("/api/v1/coach/missed-checkins?days=0").set(auth(coachToken));
    expect(r.status).toBe(400);
  });
});

describe("C26 coach availability", () => {
  it("round-trips: null -> on_leave -> available", async () => {
    const g1 = await request(app).get("/api/v1/coach/availability").set(auth(coachToken));
    expect(g1.status).toBe(200);
    expect(g1.body.availability).toBeNull();

    const p1 = await request(app).put("/api/v1/coach/availability").set(auth(coachToken))
      .send({ status: "on_leave", note: "Off this week" });
    expect(p1.status).toBe(200);
    expect(p1.body.availability.status).toBe("on_leave");
    expect(p1.body.availability.note).toBe("Off this week");

    const g2 = await request(app).get("/api/v1/coach/availability").set(auth(coachToken));
    expect(g2.body.availability.status).toBe("on_leave");

    const p2 = await request(app).put("/api/v1/coach/availability").set(auth(coachToken))
      .send({ status: "available" });
    expect(p2.body.availability.status).toBe("available");
    expect(p2.body.availability.note).toBeNull();
  });
  it("rejects an invalid status", async () => {
    const r = await request(app).put("/api/v1/coach/availability").set(auth(coachToken))
      .send({ status: "busy" });
    expect(r.status).toBe(400);
  });
});

describe("C27 adherence detail", () => {
  it("returns checkin-dimension rows (honest proxy, not habit-level)", async () => {
    const r = await request(app).get(`/api/v1/coach/customers/${optInId}/adherence-detail`).set(auth(coachToken));
    expect(r.status).toBe(200);
    const habits = r.body.detail.map((d: { habit: string }) => d.habit);
    expect(habits).toContain("daily_checkin");
    for (const d of r.body.detail) {
      expect(d).toHaveProperty("done");
      expect(d).toHaveProperty("total");
    }
  });
  it("unknown customer -> 404", async () => {
    const r = await request(app).get("/api/v1/coach/customers/nope/adherence-detail").set(auth(coachToken));
    expect(r.status).toBe(404);
  });
});
