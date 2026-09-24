// RBAC isolation: customers can't touch each other's data; role gates hold.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, otpLogin, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let tokenA = "";
let tokenB = "";
let scanA = "";
let doctorToken = "";
let pharmacyToken = "";

beforeAll(async () => {
  const a = await otpLogin(app, "9841234801");
  const b = await otpLogin(app, "9841234802");
  tokenA = a.token; tokenB = b.token;
  const s = await request(app).post("/api/v1/scans").set(auth(tokenA)).send();
  scanA = s.body.id;
  await request(app).post(`/api/v1/scans/${scanA}/timeline-events`).set(auth(tokenA)).send({
    event_type: "shedding_onset", occurred_on: "2026-05-01", followup_answers: {},
  });
  doctorToken = tokenFor(await store.createUser({ phone: "+9779800000020", role: "doctor" }));
  pharmacyToken = tokenFor(await store.createUser({ phone: "+9779800000021", role: "pharmacy" }));
});

describe("customer isolation", () => {
  it("customer B cannot read customer A's scan (404, not 403 — no leak)", async () => {
    const r = await request(app).get(`/api/v1/scans/${scanA}`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it("customer B cannot advance A's scan", async () => {
    const r = await request(app).patch(`/api/v1/scans/${scanA}/stage`).set(auth(tokenB)).send({ stage: "lens" });
    expect(r.status).toBe(404);
  });

  it("anonymous cannot read a scan either", async () => {
    const r = await request(app).get(`/api/v1/scans/${scanA}`);
    expect(r.status).toBe(404);
  });

  it("B sees only their own plan state (not_ready, not A's data)", async () => {
    const r = await request(app).get("/api/v1/me/plan").set(auth(tokenB));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("not_ready");
  });
});

describe("role gates", () => {
  it("customer on doctor queue -> 403", async () => {
    const r = await request(app).get("/api/v1/doctor/cases").set(auth(tokenA));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("forbidden");
  });

  it("doctor on admin flags -> 403", async () => {
    const r = await request(app).get("/api/v1/admin/flags").set(auth(doctorToken));
    expect(r.status).toBe(403);
  });

  it("pharmacy on admin users -> 403; pharmacy fulfilment queue -> 200", async () => {
    const u = await request(app).get("/api/v1/admin/users").set(auth(pharmacyToken));
    expect(u.status).toBe(403);
    const q = await request(app).get("/api/v1/pharmacy/orders").set(auth(pharmacyToken));
    expect(q.status).toBe(200);
  });

  it("customer on pharmacy queue -> 403", async () => {
    const r = await request(app).get("/api/v1/pharmacy/orders").set(auth(tokenA));
    expect(r.status).toBe(403);
  });

  it("doctor can read the queue (200)", async () => {
    const r = await request(app).get("/api/v1/doctor/cases").set(auth(doctorToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.cases)).toBe(true);
  });
});

describe("guest scans", () => {
  it("guest creates a draft; reads only with the guest token; lens is gated", async () => {
    const s = await request(app).post("/api/v1/scans").send();
    expect(s.status).toBe(201);
    expect(s.body.user_id).toBeNull();
    const gt = s.body.guest_token as string;
    expect(gt).toBeTruthy();

    const noTok = await request(app).get(`/api/v1/scans/${s.body.id}`);
    expect(noTok.status).toBe(404);

    const withTok = await request(app).get(`/api/v1/scans/${s.body.id}`).set("x-guest-token", gt);
    expect(withTok.status).toBe(200);

    const lens = await request(app).patch(`/api/v1/scans/${s.body.id}/stage`).set("x-guest-token", gt).send({ stage: "lens" });
    expect(lens.status).toBe(403);
    expect(lens.body.code).toBe("guest_forbidden");
  });

  it("guest scan is claimed at OTP verify", async () => {
    const s = await request(app).post("/api/v1/scans").send();
    const r1 = await request(app).post("/api/v1/auth/otp/request").send({ phone: "9841234803" });
    const r2 = await request(app).post("/api/v1/auth/otp/verify").send({
      phone: "9841234803", code: r1.body.dev_code, claim_guest_scan_id: s.body.id,
    });
    expect(r2.status).toBe(200);
    const scan = await store.getScan(s.body.id);
    expect(scan?.user_id).toBe(r2.body.user.id);
  });
});
