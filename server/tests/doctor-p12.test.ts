// P-12 dashboard endpoints: patient timeline/search, follow-ups, bulk priority, availability.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let docToken = "";
let doc2Token = "";
let custToken = "";
let custId = "";
let caseId = "";
let followUpId = "";

beforeAll(async () => {
  const doc = await store.createUser({ phone: "+9779841000002", role: "doctor" });
  docToken = tokenFor({ id: doc.id, role: "doctor" });
  const doc2 = await store.createUser({ phone: "+9779841000004", role: "doctor" });
  doc2Token = tokenFor({ id: doc2.id, role: "doctor" });
  const cust = await store.createUser({ phone: "+9779841000003", role: "customer" });
  custId = cust.id;
  custToken = tokenFor({ id: cust.id, role: "customer" });
  await store.upsertProfile(cust.id, { name: "Test Patient" });
  const scan = await store.createScan({ user_id: cust.id });
  await store.setRootScores(scan.id, [{ root: "agni", score: 70, signals: {} }]);
  const kase = await store.createCase({
    scan_id: scan.id, priority: 50, sla_due_at: new Date(Date.now() + 86400000).toISOString(),
  });
  caseId = kase.id;
});

describe("doctor dashboard endpoints (P-12)", () => {
  it("GET /doctor/patients/:userId/cases returns timeline with scores + flag count", async () => {
    const r = await request(app).get(`/api/v1/doctor/patients/${custId}/cases`).set(auth(docToken));
    expect(r.status).toBe(200);
    expect(r.body.cases).toHaveLength(1);
    const c = r.body.cases[0];
    expect(c.id).toBe(caseId);
    expect(c.priority).toBe(50);
    expect(c.root_scores).toEqual([{ root: "agni", score: 70 }]);
    expect(c.red_flag_count).toBe(0);
  });

  it("GET /doctor/patients/:userId/cases for unknown user returns empty", async () => {
    const r = await request(app).get("/api/v1/doctor/patients/nonexistent/cases").set(auth(docToken));
    expect(r.status).toBe(200);
    expect(r.body.cases).toEqual([]);
  });

  it("GET /doctor/patients/search finds the patient by phone", async () => {
    const r = await request(app).get("/api/v1/doctor/patients/search?q=9841000003").set(auth(docToken));
    expect(r.status).toBe(200);
    const hit = r.body.patients.find((p: { id: string }) => p.id === custId);
    expect(hit).toBeTruthy();
    expect(hit.name).toBe("Test Patient");
    expect(hit.phone).toBe("+9779841000003");
  });

  it("GET /doctor/patients/search without q -> 400, short q -> 400", async () => {
    const r1 = await request(app).get("/api/v1/doctor/patients/search").set(auth(docToken));
    expect(r1.status).toBe(400);
    const r2 = await request(app).get("/api/v1/doctor/patients/search?q=a").set(auth(docToken));
    expect(r2.status).toBe(400);
  });

  it("POST /doctor/follow-ups schedules a follow-up (201)", async () => {
    const r = await request(app).post("/api/v1/doctor/follow-ups").set(auth(docToken))
      .send({ case_id: caseId, due_on: "2030-01-15", note: "recheck shedding" });
    expect(r.status).toBe(201);
    expect(r.body.case_id).toBe(caseId);
    expect(r.body.due_on).toBe("2030-01-15");
    expect(r.body.note).toBe("recheck shedding");
    expect(r.body.done_at).toBeNull();
    followUpId = r.body.id;
  });

  it("POST /doctor/follow-ups rejects past date and bad format (400)", async () => {
    const past = await request(app).post("/api/v1/doctor/follow-ups").set(auth(docToken))
      .send({ case_id: caseId, due_on: "2020-01-01" });
    expect(past.status).toBe(400);
    const bad = await request(app).post("/api/v1/doctor/follow-ups").set(auth(docToken))
      .send({ case_id: caseId, due_on: "tomorrow" });
    expect(bad.status).toBe(400);
  });

  it("POST /doctor/follow-ups on missing case -> 404, missing case_id -> 400", async () => {
    const gone = await request(app).post("/api/v1/doctor/follow-ups").set(auth(docToken))
      .send({ case_id: "nope", due_on: "2030-01-15" });
    expect(gone.status).toBe(404);
    const noid = await request(app).post("/api/v1/doctor/follow-ups").set(auth(docToken))
      .send({ due_on: "2030-01-15" });
    expect(noid.status).toBe(400);
  });

  it("GET /doctor/follow-ups lists own follow-ups", async () => {
    const r = await request(app).get("/api/v1/doctor/follow-ups").set(auth(docToken));
    expect(r.status).toBe(200);
    expect(r.body.follow_ups.map((f: { id: string }) => f.id)).toContain(followUpId);
  });

  it("GET /doctor/follow-ups?due_only=1 excludes future follow-ups", async () => {
    const r = await request(app).get("/api/v1/doctor/follow-ups?due_only=1").set(auth(docToken));
    expect(r.status).toBe(200);
    expect(r.body.follow_ups.map((f: { id: string }) => f.id)).not.toContain(followUpId);
  });

  it("PATCH /doctor/follow-ups/:id/done marks it done", async () => {
    const r = await request(app).patch(`/api/v1/doctor/follow-ups/${followUpId}/done`).set(auth(docToken));
    expect(r.status).toBe(200);
    expect(r.body.done_at).not.toBeNull();
  });

  it("PATCH /doctor/follow-ups/:id/done on someone else's follow-up -> 404", async () => {
    const f = await store.createFollowUp({ case_id: caseId, doctor_id: "other-doc-id", due_on: "2030-02-01" });
    const r = await request(app).patch(`/api/v1/doctor/follow-ups/${f.id}/done`).set(auth(docToken));
    expect(r.status).toBe(404);
    const gone = await request(app).patch("/api/v1/doctor/follow-ups/nope/done").set(auth(docToken));
    expect(gone.status).toBe(404);
  });

  it("PATCH /doctor/cases/bulk-priority updates priority", async () => {
    const r = await request(app).patch("/api/v1/doctor/cases/bulk-priority").set(auth(docToken))
      .send({ ids: [caseId], priority: 100 });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(1);
    const kase = await store.getCase(caseId);
    expect(kase?.priority).toBe(100);
  });

  it("PATCH /doctor/cases/bulk-priority rejects bad priority and empty ids (400)", async () => {
    const bad = await request(app).patch("/api/v1/doctor/cases/bulk-priority").set(auth(docToken))
      .send({ ids: [caseId], priority: 75 });
    expect(bad.status).toBe(400);
    const empty = await request(app).patch("/api/v1/doctor/cases/bulk-priority").set(auth(docToken))
      .send({ ids: [], priority: 50 });
    expect(empty.status).toBe(400);
  });

  it("GET /doctor/availability starts null, PUT sets it, GET returns it", async () => {
    const before = await request(app).get("/api/v1/doctor/availability").set(auth(docToken));
    expect(before.status).toBe(200);
    expect(before.body.availability).toBeNull();
    const put = await request(app).put("/api/v1/doctor/availability").set(auth(docToken))
      .send({ status: "on_leave", note: "offsite" });
    expect(put.status).toBe(200);
    expect(put.body.status).toBe("on_leave");
    expect(put.body.note).toBe("offsite");
    const after = await request(app).get("/api/v1/doctor/availability").set(auth(docToken));
    expect(after.body.availability.status).toBe("on_leave");
  });

  it("PUT /doctor/availability rejects bad status (400)", async () => {
    const r = await request(app).put("/api/v1/doctor/availability").set(auth(docToken))
      .send({ status: "vacation" });
    expect(r.status).toBe(400);
  });

  it("customer role gets 403 on all P-12 routes", async () => {
    const routes = [
      request(app).get(`/api/v1/doctor/patients/${custId}/cases`),
      request(app).get("/api/v1/doctor/patients/search?q=9841"),
      request(app).post("/api/v1/doctor/follow-ups").send({ case_id: caseId, due_on: "2030-01-15" }),
      request(app).get("/api/v1/doctor/follow-ups"),
      request(app).patch(`/api/v1/doctor/follow-ups/${followUpId}/done`),
      request(app).patch("/api/v1/doctor/cases/bulk-priority").send({ ids: [caseId], priority: 50 }),
      request(app).get("/api/v1/doctor/availability"),
      request(app).put("/api/v1/doctor/availability").send({ status: "available" }),
    ];
    for (const req of routes) {
      const r = await req.set(auth(custToken));
      expect(r.status).toBe(403);
    }
  });

  it("second doctor's follow-ups are isolated from the first doctor", async () => {
    const r = await request(app).get("/api/v1/doctor/follow-ups").set(auth(doc2Token));
    expect(r.status).toBe(200);
    expect(r.body.follow_ups).toEqual([]);
  });
});
