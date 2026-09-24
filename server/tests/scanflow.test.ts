// End-to-end scan flow: pins -> photos -> answers -> root map -> submit,
// plus the doctor review loop and audit writes.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { testDeps, otpLogin, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let customerToken = "";
let doctorToken = "";

async function jpeg() {
  return sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 210, g: 190, b: 170 } },
  }).jpeg().toBuffer();
}

async function completeScan(token: string, opts?: { patchy?: boolean }) {
  const s = await request(app).post("/api/v1/scans").set(auth(token));
  expect(s.status).toBe(201);
  const id = s.body.id as string;
  const pinRes = await request(app).post(`/api/v1/scans/${id}/timeline-events`).set(auth(token)).send({
    event_type: "shedding_onset",
    occurred_on: "2026-06-01",
    followup_answers: opts?.patchy
      ? { sudden_or_gradual: "sudden", patchy: true }
      : { sudden_or_gradual: "gradual" },
  });
  await request(app).patch(`/api/v1/scans/${id}/stage`).set(auth(token)).send({ stage: "lens" });
  await request(app).post("/api/v1/me/consents").set(auth(token)).send({ type: "photo", version: "photo-v3", granted: true });
  await request(app).post("/api/v1/me/consents").set(auth(token)).send({ type: "data", version: "data-v1", granted: true });
  for (const angle of ["hairline", "crown", "parting"]) {
    const up = await request(app).post(`/api/v1/scans/${id}/photos`).set(auth(token))
      .field("angle", angle).attach("photo", await jpeg(), "test.jpg");
    expect(up.status).toBe(201);
  }
  await request(app).patch(`/api/v1/scans/${id}/stage`).set(auth(token)).send({ stage: "jara" });
  await request(app).post(`/api/v1/scans/${id}/answers`).set(auth(token))
    .send({ answers: { sleep_hours: 7, diet: "veg", stress_level: 2 } });
  const rm = await request(app).patch(`/api/v1/scans/${id}/stage`).set(auth(token)).send({ stage: "root_map" });
  expect(rm.status).toBe(200);
  return { id, pinStatus: pinRes.status };
}

beforeAll(async () => {
  const c = await otpLogin(app, "9841234501");
  customerToken = c.token;
  const doctor = await store.createUser({ phone: "+9779800000001", role: "doctor" });
  doctorToken = tokenFor(doctor);
});

describe("photo upload gates", () => {
  it("upload without a photo consent -> 403 consent_required", async () => {
    const { token } = await otpLogin(app, "9841234502");
    const s = await request(app).post("/api/v1/scans").set(auth(token));
    await request(app).patch(`/api/v1/scans/${s.body.id}/stage`).set(auth(token)).send({ stage: "lens" });
    const up = await request(app).post(`/api/v1/scans/${s.body.id}/photos`).set(auth(token))
      .field("angle", "hairline").attach("photo", await jpeg(), "t.jpg");
    expect(up.status).toBe(403);
    expect(up.body.code).toBe("consent_required");
  });

  it("upload with consent -> 201 with signed urls; delete -> 204", async () => {
    const { token } = await otpLogin(app, "9841234503");
    const s = await request(app).post("/api/v1/scans").set(auth(token));
    const id = s.body.id;
    await request(app).patch(`/api/v1/scans/${id}/stage`).set(auth(token)).send({ stage: "lens" });
    await request(app).post("/api/v1/me/consents").set(auth(token)).send({ type: "photo", version: "photo-v3", granted: true });
    const up = await request(app).post(`/api/v1/scans/${id}/photos`).set(auth(token))
      .field("angle", "hairline").attach("photo", await jpeg(), "t.jpg");
    expect(up.status).toBe(201);
    expect(up.body.thumb_url).toBeTruthy();
    expect(up.body.signed_url).toBeTruthy();
    const del = await request(app).delete(`/api/v1/scans/${id}/photos/${up.body.id}`).set(auth(token));
    expect(del.status).toBe(204);
  });

  it("chunked resumable upload assembles and stores", async () => {
    const { token } = await otpLogin(app, "9841234504");
    const s = await request(app).post("/api/v1/scans").set(auth(token));
    const id = s.body.id;
    await request(app).patch(`/api/v1/scans/${id}/stage`).set(auth(token)).send({ stage: "lens" });
    await request(app).post("/api/v1/me/consents").set(auth(token)).send({ type: "photo", version: "photo-v3", granted: true });
    const buf = await jpeg();
    const mid = Math.ceil(buf.length / 2);
    const parts = [buf.subarray(0, mid), buf.subarray(mid)];
    const uploadId = "upl-test-1";
    const c1 = await request(app).post(`/api/v1/scans/${id}/photos/upload-chunk`).set(auth(token))
      .send({ uploadId, index: 0, total: 2, chunk: parts[0].toString("base64") });
    expect(c1.body.complete).toBe(false);
    const c2 = await request(app).post(`/api/v1/scans/${id}/photos/upload-chunk`).set(auth(token))
      .send({ uploadId, index: 1, total: 2, chunk: parts[1].toString("base64") });
    expect(c2.body.complete).toBe(true);
    const done = await request(app).post(`/api/v1/scans/${id}/photos/upload-complete`).set(auth(token))
      .send({ uploadId, angle: "crown" });
    expect(done.status).toBe(201);
  });
});

describe("submit preconditions", () => {
  it("incomplete scan -> 422 with a missing list", async () => {
    const { token } = await otpLogin(app, "9841234505");
    const s = await request(app).post("/api/v1/scans").set(auth(token));
    const sub = await request(app).post(`/api/v1/scans/${s.body.id}/submit`).set(auth(token));
    expect(sub.status).toBe(422);
    expect(sub.body.code).toBe("scan_incomplete");
    expect(sub.body.details.missing).toContain("stage1: at least one timeline pin");
  });

  it("red-flag pin -> 409 on the pin; submit -> 409 red_flag_unresolved", async () => {
    const { token } = await otpLogin(app, "9841234506");
    const { id, pinStatus } = await completeScan(token, { patchy: true });
    expect(pinStatus).toBe(409); // flag raised at pin time
    const sub = await request(app).post(`/api/v1/scans/${id}/submit`).set(auth(token));
    expect(sub.status).toBe(409);
    expect(sub.body.code).toBe("red_flag_unresolved");
    expect(sub.body.details.unresolved_flags[0].flag_type).toBe("RF1");
  });

  it("clean scan submits -> 201 queued case; root-map renders", async () => {
    const { token } = await otpLogin(app, "9841234507");
    const { id } = await completeScan(token);
    const rm = await request(app).get(`/api/v1/scans/${id}/root-map`).set(auth(token));
    expect(rm.status).toBe(200);
    expect(rm.body.svg.roots).toHaveLength(6);
    expect(rm.body.footer_note).toContain("dermatologist makes the decisions");
    const sub = await request(app).post(`/api/v1/scans/${id}/submit`).set(auth(token));
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe("queued");
    expect(sub.body.priority).toBe("normal");
  });
});

describe("doctor review loop", () => {
  it("queue -> claim -> annotate -> plan -> approve -> customer sees plan", async () => {
    const { token } = await otpLogin(app, "9841234508");
    const { id: scanId } = await completeScan(token);
    const sub = await request(app).post(`/api/v1/scans/${scanId}/submit`).set(auth(token));
    const caseId = sub.body.id as string;

    const queue = await request(app).get("/api/v1/doctor/cases").set(auth(doctorToken));
    expect(queue.status).toBe(200);
    expect(queue.body.cases.some((c: { id: string }) => c.id === caseId)).toBe(true);

    const claim = await request(app).post(`/api/v1/doctor/cases/${caseId}/claim`).set(auth(doctorToken));
    expect(claim.status).toBe(200);
    expect(claim.body.status).toBe("in_review");

    const photos = (await store.listPhotos(scanId));
    const ann = await request(app).post(`/api/v1/doctor/cases/${caseId}/annotations`).set(auth(doctorToken))
      .send({ photo_id: photos[0].id, shape: { kind: "circle", cx: 512, cy: 380, r: 90 }, note: "test note" });
    expect(ann.status).toBe(201);

    // prescription product in a plan while flag OFF -> 422
    const rx = await store.createProduct({ name_en: "Rx Minoxidil", kind: "prescription", price_npr: 1500 });
    const badPlan = await request(app).post(`/api/v1/doctor/cases/${caseId}/plan`).set(auth(doctorToken)).send({
      review_notes: "test", rescan_due_on: "2026-11-19",
      items: [{ kind: "product", title_ne: "x", title_en: "Rx", product_id: rx.id, sort_order: 1 }],
    });
    expect(badPlan.status).toBe(422);
    expect(badPlan.body.code).toBe("feature_disabled");

    const plan = await request(app).post(`/api/v1/doctor/cases/${caseId}/plan`).set(auth(doctorToken)).send({
      review_notes: "Telogen effluvium pattern. Cosmetic care focus.",
      rescan_due_on: "2026-11-19",
      items: [{ kind: "habit", title_ne: "तेल मालिस", title_en: "Oil massage", detail: "Twice a week", sort_order: 1 }],
    });
    expect(plan.status).toBe(201);
    expect(plan.body.status).toBe("draft");

    const approve = await request(app).post(`/api/v1/doctor/plans/${plan.body.id}/approve`).set(auth(doctorToken));
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    const mine = await request(app).get("/api/v1/me/plan").set(auth(token));
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);

    // audit: case reads are logged
    const entries = await store.listAudit({ entity: "case", limit: 50 });
    expect(entries.some((e) => e.action === "case.view" && e.entity_id === caseId)).toBe(true);
    const planEntries = await store.listAudit({ entity: "plan", limit: 50 });
    expect(planEntries.some((e) => e.action === "plan.approve")).toBe(true);
  });

  it("second doctor cannot claim an already-claimed case", async () => {
    const { token } = await otpLogin(app, "9841234509");
    const { id: scanId } = await completeScan(token);
    const sub = await request(app).post(`/api/v1/scans/${scanId}/submit`).set(auth(token));
    await request(app).post(`/api/v1/doctor/cases/${sub.body.id}/claim`).set(auth(doctorToken));
    const doctor2 = await store.createUser({ phone: "+9779800000002", role: "doctor" });
    const c2 = await request(app).post(`/api/v1/doctor/cases/${sub.body.id}/claim`).set(auth(tokenFor(doctor2)));
    expect(c2.status).toBe(409);
    expect(c2.body.code).toBe("conflict");
  });
});
