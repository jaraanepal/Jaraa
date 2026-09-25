// P-6 notifications + P-8 prescribed kits: endpoint and hook coverage.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
let customerToken = "";
let doctorToken = "";

beforeAll(async () => {
  const customer = await store.createUser({ phone: "+9779800000001", role: "customer" });
  const doctor = await store.createUser({ phone: "+9779800000002", role: "doctor" });
  customerToken = tokenFor(customer);
  doctorToken = tokenFor(doctor);
});

describe("notifications (P-6)", () => {
  it("inbox starts empty with zero unread", async () => {
    const r = await request(app).get("/api/v1/notifications").set(auth(customerToken));
    expect(r.status).toBe(200);
    expect(r.body.notifications).toEqual([]);
    expect(r.body.unread_count).toBe(0);
  });

  it("lists notifications newest-first and marks one read", async () => {
    const user = await store.getUserByPhone("+9779800000001");
    await store.createNotification({
      user_id: user!.id, type: "plan_approved", link: "/plan",
      title_en: "Plan ready", title_ne: "योजना तयार",
      body_en: "Your plan is ready.", body_ne: null,
    });
    const list = await request(app).get("/api/v1/notifications").set(auth(customerToken));
    expect(list.status).toBe(200);
    expect(list.body.notifications).toHaveLength(1);
    expect(list.body.unread_count).toBe(1);
    expect(list.body.notifications[0].title_en).toBe("Plan ready");

    const id = list.body.notifications[0].id as string;
    const read = await request(app).patch(`/api/v1/notifications/${id}/read`).set(auth(customerToken));
    expect(read.status).toBe(200);
    expect(read.body.notification.read_at).toBeTruthy();

    const after = await request(app).get("/api/v1/notifications").set(auth(customerToken));
    expect(after.body.unread_count).toBe(0);
  });

  it("rejects unauthenticated access and other users' notifications", async () => {
    const anon = await request(app).get("/api/v1/notifications");
    expect(anon.status).toBe(401);
    // doctor cannot read the customer's notification
    const user = await store.getUserByPhone("+9779800000001");
    const n = await store.createNotification({
      user_id: user!.id, type: "case_submitted", title_en: "Submitted",
    });
    const other = await request(app).patch(`/api/v1/notifications/${n.id}/read`).set(auth(doctorToken));
    expect(other.status).toBe(400);
  });
});

describe("prescribed kits (P-8)", () => {
  it("composePlan accepts kit_id for an active kit and returns it", async () => {
    // seed an active kit directly in the store
    const kit = await (store as unknown as {
      kits: Map<string, unknown>;
    }).kits;
    void kit;
    // use the shop admin path instead: create via store if available
    const created = await (store as unknown as {
      createKit?: (k: Record<string, unknown>) => Promise<{ id: string }>;
    }).createKit?.({
      name_en: "Test Kit", total_npr: 999, is_active: true,
    });
    // memory store may not expose createKit; fall back to direct insert
    let kitId: string;
    if (created) {
      kitId = created.id;
    } else {
      const { randomUUID } = await import("node:crypto");
      kitId = randomUUID();
      (store as unknown as { kits: Map<string, Record<string, unknown>> }).kits.set(kitId, {
        id: kitId, name_en: "Test Kit", name: "Test Kit", total_npr: 999, is_active: true,
      });
    }

    const scan = await store.createScan({ user_id: (await store.getUserByPhone("+9779800000001"))!.id });
    const kase = await store.createCase({
      scan_id: scan.id, priority: 0, sla_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const r = await request(app)
      .post(`/api/v1/doctor/cases/${kase.id}/plan`)
      .set(auth(doctorToken))
      .send({
        items: [{ kind: "product", title_en: "Use this kit", title_ne: "यो किट प्रयोग गर्नुहोस्", kit_id: kitId, sort_order: 0 }],
      });
    expect(r.status).toBe(201);
    expect(r.body.items[0].kit_id).toBe(kitId);
  });

  it("composePlan rejects an unknown kit_id", async () => {
    const scan = await store.createScan({ user_id: (await store.getUserByPhone("+9779800000001"))!.id });
    const kase = await store.createCase({
      scan_id: scan.id, priority: 0, sla_due_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const r = await request(app)
      .post(`/api/v1/doctor/cases/${kase.id}/plan`)
      .set(auth(doctorToken))
      .send({
        items: [{ kind: "product", title_en: "Bad kit", title_ne: "खराब", kit_id: "00000000-0000-0000-0000-000000000000", sort_order: 0 }],
      });
    expect(r.status).toBe(400);
  });
});
