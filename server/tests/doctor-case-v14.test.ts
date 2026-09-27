// v14 (Problem 3): GET /doctor/cases/:id is the doctor case page's single
// source of truth — it must sign photo URLs inline (GET /scans/:id is
// owner-only and 404s for doctors) and carry the scan answers.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let docToken = "";
let caseId = "";

beforeAll(async () => {
  const doc = await store.createUser({ phone: "+9779841000091", role: "doctor" });
  docToken = tokenFor({ id: doc.id, role: "doctor" });
  const cust = await store.createUser({ phone: "+9779841000092", role: "customer" });
  const scan = await store.createScan({ user_id: cust.id });
  await store.updateScan(scan.id, {
    answers: { sleep_hours: 5, itching: true },
  } as Partial<Parameters<typeof store.updateScan>[1]>);
  await store.upsertPhoto({
    scan_id: scan.id,
    angle: "crown",
    storage_path: "private/scans/s1/crown.jpg",
    thumb_path: "private/scans/s1/crown_thumb.jpg",
  });
  await store.setRootScores(scan.id, [{ root: "stress_sleep", score: 62, signals: {} }]);
  const kase = await store.createCase({
    scan_id: scan.id, priority: 50, sla_due_at: new Date(Date.now() + 86400000).toISOString(),
  });
  caseId = kase.id;
});

describe("v14 doctor case detail (Problem 3)", () => {
  it("GET /doctor/cases/:id signs photo URLs and carries answers/scores", async () => {
    const r = await request(app).get(`/api/v1/doctor/cases/${caseId}`).set(auth(docToken));
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(caseId);
    // photos carry signed URLs — no second /scans/:id call needed
    expect(r.body.photos).toHaveLength(1);
    expect(r.body.photos[0].signed_url).toMatch(/^memory:\/\/scan-photos\//);
    expect(r.body.photos[0].thumb_url).toMatch(/^memory:\/\/scan-photos\//);
    // scan context rides along
    expect(r.body.scan.answers).toEqual({ sleep_hours: 5, itching: true });
    expect(r.body.root_scores).toEqual(
      expect.arrayContaining([expect.objectContaining({ root: "stress_sleep", score: 62 })]),
    );
    expect(Array.isArray(r.body.timeline_events)).toBe(true);
    expect(Array.isArray(r.body.red_flags)).toBe(true);
  });

  it("GET /doctor/cases/:id for an unknown id is 404", async () => {
    const r = await request(app).get("/api/v1/doctor/cases/does-not-exist").set(auth(docToken));
    expect(r.status).toBe(404);
  });
});
