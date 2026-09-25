// Admin Batch-4 endpoints (A30–A47): dashboard configs, courier/returns/refund
// analytics, verification expiry, ticket SLA, flag history, bulk user status,
// email logs, deletion requests, referrals, challenge analytics, coach and
// pharmacy performance, announcement scheduling, admin notices, consent
// versions, ops digest. Plus the A37 central email-log hook.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";
import { sendEmail } from "../src/lib/brevo";

const { app, store } = testDeps();
let adminToken = "";
let adminId = "";
let doctorToken = "";
let customerToken = "";
let custId = "";

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779843100000", role: "admin" });
  adminId = admin.id;
  adminToken = tokenFor({ id: admin.id, role: "admin" });

  const doc = await store.createUser({ phone: "+9779843100002", role: "doctor" });
  doctorToken = tokenFor({ id: doc.id, role: "doctor" });

  const c = await store.createUser({ phone: "+9779843100003" });
  custId = c.id;
  customerToken = tokenFor({ id: c.id, role: "customer" });
});

const admin = (q: request.Test) => q.set(auth(adminToken));
const A = "/api/v1/admin";

describe("RBAC — batch-4 admin endpoints", () => {
  it("non-admins get 403 everywhere", async () => {
    const reqs = [
      request(app).get(`${A}/dashboard-config/admin`),
      request(app).put(`${A}/dashboard-config/admin`).send({ config: {} }),
      request(app).get(`${A}/couriers/performance`),
      request(app).get(`${A}/returns/analytics`),
      request(app).get(`${A}/verifications/expiring`),
      request(app).patch(`${A}/verifications/x/expiry`).send({ expires_at: null }),
      request(app).get(`${A}/tickets/sla`),
      request(app).get(`${A}/flags/history`),
      request(app).post(`${A}/users/bulk-status`).send({ ids: [], disabled: true }),
      request(app).get(`${A}/email-logs`),
      request(app).get(`${A}/deletion-requests`),
      request(app).get(`${A}/referrals`),
      request(app).get(`${A}/challenges/analytics`),
      request(app).get(`${A}/coaches/performance`),
      request(app).get(`${A}/pharmacy/performance`),
      request(app).post(`${A}/announcements/x/schedule`).send({ publish_at: null }),
      request(app).get(`${A}/notices`),
      request(app).post(`${A}/notices`).send({ title_en: "x" }),
      request(app).post(`${A}/notices/x/read`),
      request(app).get(`${A}/consents/versions`),
      request(app).post(`${A}/consents/versions`).send({}),
      request(app).post(`${A}/consents/versions/x/activate`),
      request(app).get(`${A}/refunds/analytics`),
      request(app).get(`${A}/digest`),
    ];
    for (const q of reqs) {
      const r1 = await q.set(auth(doctorToken));
      expect(r1.status).toBe(403);
    }
    for (const q of reqs) {
      const r2 = await q.set(auth(customerToken));
      expect(r2.status).toBe(403);
    }
  });
});

describe("A30 dashboard configs", () => {
  it("validates role and config", async () => {
    const badRole = await admin(request(app).get(`${A}/dashboard-config/bogus`));
    expect(badRole.status).toBe(400);
    const badPut = await admin(request(app).put(`${A}/dashboard-config/admin`).send({ config: [1, 2] }));
    expect(badPut.status).toBe(400);
  });
  it("roundtrip: PUT then GET", async () => {
    const put = await admin(request(app).put(`${A}/dashboard-config/doctor`).send({ config: { hiddenCards: ["sla"] } }));
    expect(put.status).toBe(200);
    expect(put.body.config.config).toEqual({ hiddenCards: ["sla"] });
    const get = await admin(request(app).get(`${A}/dashboard-config/doctor`));
    expect(get.status).toBe(200);
    expect(get.body.config.config).toEqual({ hiddenCards: ["sla"] });
    const missing = await admin(request(app).get(`${A}/dashboard-config/coach`));
    expect(missing.status).toBe(200);
    expect(missing.body.config).toBeNull();
  });
});

describe("A33 verification expiry", () => {
  it("validates days and expires_at", async () => {
    const badDays = await admin(request(app).get(`${A}/verifications/expiring?days=abc`));
    expect(badDays.status).toBe(400);
    const badExp = await admin(request(app).patch(`${A}/verifications/x/expiry`).send({ expires_at: "not-a-date" }));
    expect(badExp.status).toBe(400);
    const missing = await admin(request(app).patch(`${A}/verifications/nope/expiry`).send({ expires_at: null }));
    expect(missing.status).toBe(404);
  });
  it("lists expiring verifications and sets expiry", async () => {
    const v = await store.upsertStaffVerification(custId, "doctor");
    const future = new Date(Date.now() + 10 * 86400_000).toISOString();
    const set = await admin(request(app).patch(`${A}/verifications/${v.id}/expiry`).send({ expires_at: future }));
    expect(set.status).toBe(200);
    const list = await admin(request(app).get(`${A}/verifications/expiring?days=30`));
    expect(list.status).toBe(200);
    expect(list.body.verifications.map((x: { id: string }) => x.id)).toContain(v.id);
    const narrow = await admin(request(app).get(`${A}/verifications/expiring?days=5`));
    expect(narrow.body.verifications.map((x: { id: string }) => x.id)).not.toContain(v.id);
    const clear = await admin(request(app).patch(`${A}/verifications/${v.id}/expiry`).send({ expires_at: null }));
    expect(clear.status).toBe(200);
  });
});

describe("A34 ticket SLA", () => {
  it("returns honest nulls when untracked", async () => {
    const r = await admin(request(app).get(`${A}/tickets/sla`));
    expect(r.status).toBe(200);
    expect(r.body.sla).toMatchObject({ open: 0, avgFirstResponseMin: null, avgResolveMin: null });
  });
});

describe("A35 flag history", () => {
  it("records flag toggles in the audit trail", async () => {
    const flip = await admin(request(app).put(`${A}/flags/teleconsult_booking`).send({ is_enabled: true }));
    expect(flip.status).toBe(200);
    const h = await admin(request(app).get(`${A}/flags/history`));
    expect(h.status).toBe(200);
    const actions = h.body.history.map((e: { action: string }) => e.action);
    expect(actions).toContain("flag.toggle");
    expect(h.body.history.every((e: { entity: string }) => e.entity === "flag")).toBe(true);
  });
});

describe("A36 bulk user status", () => {
  it("validates input", async () => {
    expect((await admin(request(app).post(`${A}/users/bulk-status`).send({ ids: [], disabled: true }))).status).toBe(400);
    expect((await admin(request(app).post(`${A}/users/bulk-status`).send({ ids: [custId], disabled: "yes" }))).status).toBe(400);
  });
  it("refuses to disable the last active admin", async () => {
    const other = await store.createUser({ phone: "+9779843100009" });
    const solo = await admin(request(app).post(`${A}/users/bulk-status`).send({ ids: [adminId], disabled: true }));
    expect(solo.status).toBe(409);
    const all = await admin(request(app).post(`${A}/users/bulk-status`).send({ ids: [adminId, other.id], disabled: true }));
    expect(all.status).toBe(409);
    // the admin must still be active
    const u = await store.getUserById(adminId);
    expect(u?.is_active).toBe(true);
  });
  it("bulk suspends and re-activates non-admins", async () => {
    const c1 = await store.createUser({ phone: "+9779843100011" });
    const c2 = await store.createUser({ phone: "+9779843100012" });
    const off = await admin(request(app).post(`${A}/users/bulk-status`).send({ ids: [c1.id, c2.id], disabled: true }));
    expect(off.status).toBe(200);
    expect(off.body.updated).toBe(2);
    expect((await store.getUserById(c1.id))?.is_active).toBe(false);
    // already-suspended rows are not counted again
    const again = await admin(request(app).post(`${A}/users/bulk-status`).send({ ids: [c1.id], disabled: true }));
    expect(again.body.updated).toBe(0);
    const on = await admin(request(app).post(`${A}/users/bulk-status`).send({ ids: [c1.id], disabled: false }));
    expect(on.body.updated).toBe(1);
    expect((await store.getUserById(c1.id))?.is_active).toBe(true);
  });
});

describe("A37 email log + central hook", () => {
  it("logs skipped Brevo sends via the central sendEmail path", async () => {
    // No BREVO_API_KEY in test env — sendEmail takes the skipped path and the
    // app.ts hook must log it as failed.
    const r = await sendEmail("a37test@example.com", "subj", "<p>hi</p>", { template: "a37-probe" });
    expect(r.skipped).toBe(true);
    // the logger is fire-and-forget — give it a tick
    await new Promise((res) => setTimeout(res, 50));
    const logs = await admin(request(app).get(`${A}/email-logs?limit=50`));
    expect(logs.status).toBe(200);
    const found = logs.body.logs.find((l: { template: string; to_email: string }) => l.template === "a37-probe");
    expect(found).toBeTruthy();
    expect(found.status).toBe("failed");
    expect(found.to_email).toBe("a37test@example.com");
    expect(found.error).toBeTruthy();
  });
  it("caps the limit", async () => {
    const r = await admin(request(app).get(`${A}/email-logs?limit=1`));
    expect(r.status).toBe(200);
    expect(r.body.logs.length).toBeLessThanOrEqual(1);
  });
});

describe("A38 deletion requests", () => {
  it("lists the privacy queue", async () => {
    await store.createDeletionRequest({ user_id: custId, scheduled_for: new Date(Date.now() + 86400_000).toISOString(), note: "test" });
    const r = await admin(request(app).get(`${A}/deletion-requests`));
    expect(r.status).toBe(200);
    expect(r.body.requests.map((x: { user_id: string }) => x.user_id)).toContain(custId);
  });
});

describe("A39/A40/A41/A42 analytics shapes", () => {
  it("referrals return honest zeros", async () => {
    const r = await admin(request(app).get(`${A}/referrals`));
    expect(r.status).toBe(200);
    expect(r.body.stats).toEqual({ codes: 0, joined: 0 });
  });
  it("challenge analytics shape", async () => {
    const r = await admin(request(app).get(`${A}/challenges/analytics`));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.challenges)).toBe(true);
  });
  it("coach performance shape", async () => {
    const r = await admin(request(app).get(`${A}/coaches/performance`));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.coaches)).toBe(true);
  });
  it("pharmacy performance shape with honest nulls", async () => {
    const r = await admin(request(app).get(`${A}/pharmacy/performance`));
    expect(r.status).toBe(200);
    expect(r.body.performance).toMatchObject({ handled: 0, avgPackMin: null, avgShipMin: null });
    expect(r.body.note).toBeTruthy();
  });
  it("courier performance shape", async () => {
    const r = await admin(request(app).get(`${A}/couriers/performance`));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.couriers)).toBe(true);
    expect(r.body.note).toBeTruthy();
  });
});

describe("A32/A46 refund analytics", () => {
  it("groups refunds by reason with rate", async () => {
    const r1 = await admin(request(app).get(`${A}/returns/analytics`));
    expect(r1.status).toBe(200);
    expect(Array.isArray(r1.body.by_reason)).toBe(true);
    const r2 = await admin(request(app).get(`${A}/refunds/analytics`));
    expect(r2.status).toBe(200);
    expect(typeof r2.body.total_refunds).toBe("number");
  });
});

describe("A43 announcement scheduling", () => {
  it("validates and schedules", async () => {
    const a = await admin(request(app).post(`${A}/announcements`).send({ title_en: "A43 probe" }));
    expect(a.status).toBe(201);
    const id = a.body.id as string;
    const bad = await admin(request(app).post(`${A}/announcements/${id}/schedule`).send({ publish_at: "junk" }));
    expect(bad.status).toBe(400);
    const missing = await admin(request(app).post(`${A}/announcements/nope/schedule`).send({ publish_at: null }));
    expect(missing.status).toBe(404);
    const future = new Date(Date.now() + 86400_000).toISOString();
    const ok = await admin(request(app).post(`${A}/announcements/${id}/schedule`).send({ publish_at: future }));
    expect(ok.status).toBe(200);
    expect((ok.body.announcement.publish_at as string).slice(0, 10)).toBe(future.slice(0, 10));
    const clear = await admin(request(app).post(`${A}/announcements/${id}/schedule`).send({ publish_at: null }));
    expect(clear.status).toBe(200);
    expect(clear.body.announcement.publish_at).toBeNull();
  });
});

describe("A44 admin notices", () => {
  it("validates title", async () => {
    const bad = await admin(request(app).post(`${A}/notices`).send({ title_en: "  " }));
    expect(bad.status).toBe(400);
  });
  it("create -> list with read flags -> mark read", async () => {
    const c = await admin(request(app).post(`${A}/notices`).send({ title_en: "A44 probe", body_en: "hello admins" }));
    expect(c.status).toBe(201);
    const id = c.body.notice.id as string;
    const list1 = await admin(request(app).get(`${A}/notices`));
    const row1 = list1.body.notices.find((n: { id: string }) => n.id === id);
    expect(row1.read).toBe(false);
    const read = await admin(request(app).post(`${A}/notices/${id}/read`));
    expect(read.status).toBe(200);
    const list2 = await admin(request(app).get(`${A}/notices`));
    const row2 = list2.body.notices.find((n: { id: string }) => n.id === id);
    expect(row2.read).toBe(true);
  });
});

describe("A45 consent versions", () => {
  it("validates input", async () => {
    expect((await admin(request(app).post(`${A}/consents/versions`).send({ kind: "bogus", version: 1, text_en: "t" }))).status).toBe(400);
    expect((await admin(request(app).post(`${A}/consents/versions`).send({ kind: "signup", version: 0, text_en: "t" }))).status).toBe(400);
    expect((await admin(request(app).post(`${A}/consents/versions`).send({ kind: "signup", version: 1, text_en: " " }))).status).toBe(400);
  });
  it("activate deactivates other versions of the same kind", async () => {
    const v1 = (await admin(request(app).post(`${A}/consents/versions`).send({ kind: "signup", version: 1, text_en: "v1 text" }))).body.version;
    const v2 = (await admin(request(app).post(`${A}/consents/versions`).send({ kind: "signup", version: 2, text_en: "v2 text" }))).body.version;
    const act1 = await admin(request(app).post(`${A}/consents/versions/${v1.id}/activate`));
    expect(act1.status).toBe(200);
    expect(act1.body.version.active).toBe(true);
    const act2 = await admin(request(app).post(`${A}/consents/versions/${v2.id}/activate`));
    expect(act2.status).toBe(200);
    const list = await admin(request(app).get(`${A}/consents/versions?kind=signup`));
    const states = new Map(list.body.versions.map((v: { id: string; active: boolean }) => [v.id, v.active]));
    expect(states.get(v2.id)).toBe(true);
    expect(states.get(v1.id)).toBe(false);
    // activating an unknown version 404s
    expect((await admin(request(app).post(`${A}/consents/versions/nope/activate`))).status).toBe(404);
    // a different kind is untouched
    const pv = (await admin(request(app).post(`${A}/consents/versions`).send({ kind: "scan", version: 1, text_en: "scan v1", active: true }))).body.version;
    expect(pv.active).toBe(true);
    const listScan = await admin(request(app).get(`${A}/consents/versions?kind=scan`));
    expect(listScan.body.versions.every((v: { active: boolean }) => v.active)).toBe(true);
  });
});

describe("A47 ops digest", () => {
  it("returns the four counters", async () => {
    const r = await admin(request(app).get(`${A}/digest`));
    expect(r.status).toBe(200);
    const d = r.body.digest;
    for (const k of ["ordersToday", "slaBreaches", "openTickets", "pendingRefunds"]) {
      expect(typeof d[k]).toBe("number");
    }
  });
});
