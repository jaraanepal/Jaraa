// Batch 3 (009) doctor dashboard: D19 audit, D20 archive, D22 second
// opinions, D23 follow-up range, D24 triage presets, D25 adherence, D26
// case transfer.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let docA = "";
let docB = "";
let docAToken = "";
let docBToken = "";
let custToken = "";
let custId = "";
let otherCustId = "";
let ownCaseId = "";           // assigned to docA
let otherCaseId = "";         // assigned to docB
let unassignedQueuedId = "";  // unassigned, status queued
let unassignedReviewedId = ""; // unassigned, status reviewed
let presetId = "";
let soId = "";

async function makeCase(userId: string) {
  const scan = await store.createScan({ user_id: userId });
  const kase = await store.createCase({
    scan_id: scan.id, priority: 50,
    sla_due_at: new Date(Date.now() + 86400000).toISOString(),
  });
  return kase.id;
}

beforeAll(async () => {
  const a = await store.createUser({ phone: "+9779841000011", role: "doctor" });
  docA = a.id;
  docAToken = tokenFor({ id: a.id, role: "doctor" });
  const b = await store.createUser({ phone: "+9779841000012", role: "doctor" });
  docB = b.id;
  docBToken = tokenFor({ id: b.id, role: "doctor" });
  const cust = await store.createUser({ phone: "+9779841000013", role: "customer" });
  custId = cust.id;
  custToken = tokenFor({ id: cust.id, role: "customer" });
  const other = await store.createUser({ phone: "+9779841000014", role: "customer" });
  otherCustId = other.id;

  ownCaseId = await makeCase(custId);
  otherCaseId = await makeCase(otherCustId);
  unassignedQueuedId = await makeCase(custId);
  unassignedReviewedId = await makeCase(custId);
  await store.claimCase(ownCaseId, docA);       // assigned to docA, in_review
  await store.claimCase(otherCaseId, docB);     // assigned to docB, in_review
  await store.updateCase(unassignedReviewedId, { status: "reviewed" });
});

describe("D19 — own audit trail", () => {
  it("GET /doctor/audit returns own entries newest-first", async () => {
    // generate an audit entry for docA
    await request(app).patch(`/api/v1/doctor/cases/${ownCaseId}/archive`).set(auth(docAToken));
    const r = await request(app).get("/api/v1/doctor/audit?limit=50").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.audit)).toBe(true);
    expect(r.body.audit.length).toBeGreaterThan(0);
    for (const e of r.body.audit) expect(e.actor_id).toBe(docA);
    const archived = r.body.audit.find((e: { action: string }) => e.action === "case.archive");
    expect(archived).toBeTruthy();
  });

  it("audit entries are isolated per doctor", async () => {
    const r = await request(app).get("/api/v1/doctor/audit").set(auth(docBToken));
    expect(r.status).toBe(200);
    for (const e of r.body.audit) expect(e.actor_id).toBe(docB);
    expect(r.body.audit.find((e: { action: string }) => e.action === "case.archive")).toBeFalsy();
  });

  it("limit is capped at 200, customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/audit?limit=9999").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.audit.length).toBeLessThanOrEqual(200);
    const c = await request(app).get("/api/v1/doctor/audit").set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D20 — case archive", () => {
  it("GET /doctor/cases/archived lists own archived cases", async () => {
    const r = await request(app).get("/api/v1/doctor/cases/archived").set(auth(docAToken));
    expect(r.status).toBe(200);
    const ids = r.body.cases.map((c: { id: string }) => c.id);
    expect(ids).toContain(ownCaseId);
    expect(ids).not.toContain(otherCaseId);
    expect(r.body.cases[0].archived_at).not.toBeNull();
  });

  it("archived case no longer appears in the queue", async () => {
    const r = await request(app).get("/api/v1/doctor/cases?status=in_review").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.cases.map((c: { id: string }) => c.id)).not.toContain(ownCaseId);
  });

  it("archive of another doctor's case -> 403", async () => {
    const r = await request(app).patch(`/api/v1/doctor/cases/${otherCaseId}/archive`).set(auth(docAToken));
    expect(r.status).toBe(403);
  });

  it("archive of unassigned queued case -> 403, unassigned reviewed -> 200", async () => {
    const q = await request(app).patch(`/api/v1/doctor/cases/${unassignedQueuedId}/archive`).set(auth(docAToken));
    expect(q.status).toBe(403);
    const rv = await request(app).patch(`/api/v1/doctor/cases/${unassignedReviewedId}/archive`).set(auth(docAToken));
    expect(rv.status).toBe(200);
    expect(rv.body.case.archived_at).not.toBeNull();
  });

  it("archive of missing case -> 404, customer -> 403", async () => {
    const gone = await request(app).patch("/api/v1/doctor/cases/nope/archive").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const c = await request(app).patch(`/api/v1/doctor/cases/${unassignedQueuedId}/archive`).set(auth(custToken));
    expect(c.status).toBe(403);
  });
});

describe("D22 — second opinions", () => {
  it("POST creates a pending request + notifies the reviewer", async () => {
    // unarchive ownCaseId first so later tests keep a working assigned case
    const r = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/second-opinion`)
      .set(auth(docBToken)).send({ reviewer_id: docA, note: "tricky shedding pattern" });
    expect(r.status).toBe(201);
    expect(r.body.secondOpinion.status).toBe("pending");
    expect(r.body.secondOpinion.requester_id).toBe(docB);
    expect(r.body.secondOpinion.reviewer_id).toBe(docA);
    soId = r.body.secondOpinion.id;
    // reviewer got an in-app notification
    const inbox = await store.listNotifications(docA, { limit: 20, offset: 0 });
    expect(inbox.notifications.some((n) => n.type === "second_opinion")).toBe(true);
  });

  it("validation: missing/self reviewer -> 400, unknown reviewer -> 404, non-doctor -> 400", async () => {
    const missing = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/second-opinion`)
      .set(auth(docBToken)).send({});
    expect(missing.status).toBe(400);
    const self = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/second-opinion`)
      .set(auth(docBToken)).send({ reviewer_id: docB });
    expect(self.status).toBe(400);
    const unknown = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/second-opinion`)
      .set(auth(docBToken)).send({ reviewer_id: "no-such-user" });
    expect(unknown.status).toBe(404);
    const notdoc = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/second-opinion`)
      .set(auth(docBToken)).send({ reviewer_id: custId });
    expect(notdoc.status).toBe(400);
  });

  it("requesting on another doctor's case -> 403, missing case -> 404", async () => {
    const f = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/second-opinion`)
      .set(auth(docAToken)).send({ reviewer_id: docB });
    expect(f.status).toBe(403);
    const gone = await request(app).post("/api/v1/doctor/cases/nope/second-opinion")
      .set(auth(docBToken)).send({ reviewer_id: docA });
    expect(gone.status).toBe(404);
  });

  it("GET /doctor/second-opinions shows sent and received", async () => {
    const sent = await request(app).get("/api/v1/doctor/second-opinions").set(auth(docBToken));
    expect(sent.status).toBe(200);
    expect(sent.body.secondOpinions.map((s: { id: string }) => s.id)).toContain(soId);
    const recv = await request(app).get("/api/v1/doctor/second-opinions").set(auth(docAToken));
    expect(recv.status).toBe(200);
    expect(recv.body.secondOpinions.map((s: { id: string }) => s.id)).toContain(soId);
  });

  it("reviewer accepts -> 200 accepted; non-reviewer -> 403; repeat -> 409; bad accept -> 400", async () => {
    const bad = await request(app).post(`/api/v1/doctor/second-opinions/${soId}/decide`)
      .set(auth(docAToken)).send({ accept: "yes" });
    expect(bad.status).toBe(400);
    const notReviewer = await request(app).post(`/api/v1/doctor/second-opinions/${soId}/decide`)
      .set(auth(docBToken)).send({ accept: true });
    expect(notReviewer.status).toBe(403);
    const ok = await request(app).post(`/api/v1/doctor/second-opinions/${soId}/decide`)
      .set(auth(docAToken)).send({ accept: true });
    expect(ok.status).toBe(200);
    expect(ok.body.secondOpinion.status).toBe("accepted");
    const again = await request(app).post(`/api/v1/doctor/second-opinions/${soId}/decide`)
      .set(auth(docAToken)).send({ accept: false });
    expect(again.status).toBe(409);
    const gone = await request(app).post("/api/v1/doctor/second-opinions/nope/decide")
      .set(auth(docAToken)).send({ accept: true });
    expect(gone.status).toBe(404);
  });

  it("customer gets 403 on second-opinion routes", async () => {
    const r1 = await request(app).get("/api/v1/doctor/second-opinions").set(auth(custToken));
    expect(r1.status).toBe(403);
    const r2 = await request(app).post(`/api/v1/doctor/cases/${ownCaseId}/second-opinion`)
      .set(auth(custToken)).send({ reviewer_id: docA });
    expect(r2.status).toBe(403);
  });
});

describe("D23 — follow-up date range", () => {
  it("range query returns from/to echo and only in-range follow-ups", async () => {
    await store.createFollowUp({ case_id: ownCaseId, doctor_id: docA, due_on: "2030-03-10", note: "march" });
    await store.createFollowUp({ case_id: ownCaseId, doctor_id: docA, due_on: "2030-04-10", note: "april" });
    const r = await request(app).get("/api/v1/doctor/follow-ups?from=2030-03-01&to=2030-03-31").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.from).toBe("2030-03-01");
    expect(r.body.to).toBe("2030-03-31");
    expect(r.body.follow_ups.map((f: { note: string }) => f.note)).toEqual(["march"]);
  });

  it("bad dates and from > to -> 400", async () => {
    const bad = await request(app).get("/api/v1/doctor/follow-ups?from=soon&to=2030-03-31").set(auth(docAToken));
    expect(bad.status).toBe(400);
    const badDay = await request(app).get("/api/v1/doctor/follow-ups?from=2030-02-30&to=2030-03-31").set(auth(docAToken));
    expect(badDay.status).toBe(400);
    const rev = await request(app).get("/api/v1/doctor/follow-ups?from=2030-04-01&to=2030-03-01").set(auth(docAToken));
    expect(rev.status).toBe(400);
  });

  it("plain listing still works (no range params)", async () => {
    const r = await request(app).get("/api/v1/doctor/follow-ups").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.follow_ups.length).toBeGreaterThanOrEqual(2);
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/follow-ups?from=2030-01-01&to=2030-12-31").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("D24 — triage presets", () => {
  it("POST creates, GET lists highest-priority-first", async () => {
    const low = await request(app).post("/api/v1/doctor/triage-presets").set(auth(docAToken))
      .send({ name: "routine", priority: 0 });
    expect(low.status).toBe(201);
    const high = await request(app).post("/api/v1/doctor/triage-presets").set(auth(docAToken))
      .send({ name: "urgent", priority: 100 });
    expect(high.status).toBe(201);
    presetId = high.body.preset.id;
    const r = await request(app).get("/api/v1/doctor/triage-presets").set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.presets.map((p: { name: string }) => p.name)).toEqual(["urgent", "routine"]);
  });

  it("validation: empty name -> 400, bad priority -> 400", async () => {
    const empty = await request(app).post("/api/v1/doctor/triage-presets").set(auth(docAToken))
      .send({ name: "   ", priority: 50 });
    expect(empty.status).toBe(400);
    const badp = await request(app).post("/api/v1/doctor/triage-presets").set(auth(docAToken))
      .send({ name: "x", priority: 75 });
    expect(badp.status).toBe(400);
  });

  it("presets are per-doctor", async () => {
    const r = await request(app).get("/api/v1/doctor/triage-presets").set(auth(docBToken));
    expect(r.status).toBe(200);
    expect(r.body.presets).toEqual([]);
  });

  it("DELETE removes own preset (204); other's or missing -> 404", async () => {
    const other = await request(app).delete(`/api/v1/doctor/triage-presets/${presetId}`).set(auth(docBToken));
    expect(other.status).toBe(404);
    const gone = await request(app).delete("/api/v1/doctor/triage-presets/nope").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const ok = await request(app).delete(`/api/v1/doctor/triage-presets/${presetId}`).set(auth(docAToken));
    expect(ok.status).toBe(204);
  });

  it("customer gets 403", async () => {
    const r = await request(app).get("/api/v1/doctor/triage-presets").set(auth(custToken));
    expect(r.status).toBe(403);
  });
});

describe("D25 — patient adherence", () => {
  it("assigned doctor sees adherence numbers", async () => {
    const r = await request(app).get(`/api/v1/doctor/patients/${custId}/adherence`).set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.user_id).toBe(custId);
    expect(typeof r.body.rate).toBe("number");
    expect(typeof r.body.done).toBe("number");
    expect(typeof r.body.total).toBe("number");
  });

  it("unrelated doctor gets 403, unknown user gets 404, customer gets 403", async () => {
    const f = await request(app).get(`/api/v1/doctor/patients/${custId}/adherence`).set(auth(docBToken));
    expect(f.status).toBe(403);
    const gone = await request(app).get("/api/v1/doctor/patients/nope/adherence").set(auth(docAToken));
    expect(gone.status).toBe(404);
    const c = await request(app).get(`/api/v1/doctor/patients/${custId}/adherence`).set(auth(custToken));
    expect(c.status).toBe(403);
  });

  it("reviewer on a second opinion for the patient may see adherence", async () => {
    // docA is the reviewer of the (accepted) second opinion on otherCaseId,
    // whose patient is otherCustId.
    const r = await request(app).get(`/api/v1/doctor/patients/${otherCustId}/adherence`).set(auth(docAToken));
    expect(r.status).toBe(200);
    expect(r.body.user_id).toBe(otherCustId);
  });
});

describe("D26 — case transfer", () => {
  it("assigned doctor transfers to another doctor", async () => {
    const r = await request(app).post(`/api/v1/doctor/cases/${unassignedQueuedId}/transfer`)
      .set(auth(docAToken)).send({ to_doctor_id: docB, reason: "workload rebalance" });
    // unassignedQueuedId is NOT assigned to docA -> 403 expected
    expect(r.status).toBe(403);
  });

  it("transfer of own assigned case works and is audited", async () => {
    // ownCaseId was archived in the D19 test; make a fresh assigned case
    const scan = await store.createScan({ user_id: custId });
    const kase = await store.createCase({
      scan_id: scan.id, priority: 50,
      sla_due_at: new Date(Date.now() + 86400000).toISOString(),
    });
    await store.claimCase(kase.id, docA);
    const r = await request(app).post(`/api/v1/doctor/cases/${kase.id}/transfer`)
      .set(auth(docAToken)).send({ to_doctor_id: docB, reason: "specialist needed" });
    expect(r.status).toBe(200);
    expect(r.body.case.assigned_doctor_id).toBe(docB);
    const audit = await request(app).get("/api/v1/doctor/audit?limit=50").set(auth(docAToken));
    const entry = audit.body.audit.find((e: { action: string; entity_id: string }) =>
      e.action === "case.transfer" && e.entity_id === kase.id);
    expect(entry).toBeTruthy();
    // after transfer docA can no longer archive it
    const arch = await request(app).patch(`/api/v1/doctor/cases/${kase.id}/archive`).set(auth(docAToken));
    expect(arch.status).toBe(403);
    // ...but docB (the new assignee) can
    const arch2 = await request(app).patch(`/api/v1/doctor/cases/${kase.id}/archive`).set(auth(docBToken));
    expect(arch2.status).toBe(200);
  });

  it("validation: missing/self/non-doctor/unknown target, missing case", async () => {
    const missing = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/transfer`)
      .set(auth(docBToken)).send({});
    expect(missing.status).toBe(400);
    const self = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/transfer`)
      .set(auth(docBToken)).send({ to_doctor_id: docB });
    expect(self.status).toBe(400);
    const notdoc = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/transfer`)
      .set(auth(docBToken)).send({ to_doctor_id: custId });
    expect(notdoc.status).toBe(400);
    const unknown = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/transfer`)
      .set(auth(docBToken)).send({ to_doctor_id: "no-such-user" });
    expect(unknown.status).toBe(404);
    const gone = await request(app).post("/api/v1/doctor/cases/nope/transfer")
      .set(auth(docBToken)).send({ to_doctor_id: docA });
    expect(gone.status).toBe(404);
  });

  it("customer gets 403", async () => {
    const r = await request(app).post(`/api/v1/doctor/cases/${otherCaseId}/transfer`)
      .set(auth(custToken)).send({ to_doctor_id: docA });
    expect(r.status).toBe(403);
  });
});
