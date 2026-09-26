// Jaraa v1.4 API tests (P-7 family sharing, P-8 offline sync idempotency).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let ownerToken = "";
let memberToken = "";
let strangerToken = "";
let ownerId = "";
let memberId = "";

beforeAll(async () => {
  const owner = await store.createUser({ phone: "+9779851500001" }); // customer
  ownerId = owner.id;
  ownerToken = tokenFor({ id: owner.id, role: "customer" });
  const member = await store.createUser({ phone: "+9779851500002" }); // customer
  memberId = member.id;
  memberToken = tokenFor({ id: member.id, role: "customer" });
  const stranger = await store.createUser({ phone: "+9779851500003" }); // customer
  strangerToken = tokenFor({ id: stranger.id, role: "customer" });
});

describe("P-7 family members", () => {
  let memberIdRow = "";
  let inviteToken = "";

  it("owner creates a member -> 201 with a one-time invite_token", async () => {
    const r = await request(app).post("/api/v1/family/members").set(auth(ownerToken))
      .send({ name: "Aama", relation: "mother" });
    expect(r.status).toBe(201);
    expect(r.body.member).toBeDefined();
    expect(typeof r.body.member.invite_token).toBe("string");
    expect(r.body.member.invite_token.length).toBeGreaterThan(0);
    memberIdRow = r.body.member.id;
    inviteToken = r.body.member.invite_token;
  });

  it("owner cannot read scans before the invite is accepted -> 403", async () => {
    const r = await request(app).get(`/api/v1/family/members/${memberIdRow}/scans`)
      .set(auth(ownerToken));
    expect(r.status).toBe(403);
  });

  it("member accepts the invite via token -> 200", async () => {
    const r = await request(app).post("/api/v1/family/accept").set(auth(memberToken))
      .send({ token: inviteToken });
    expect(r.status).toBe(200);
    expect(r.body.member.member_user_id).toBe(memberId);
  });

  it("owner still 403 until the member consents to data sharing", async () => {
    const r = await request(app).get(`/api/v1/family/members/${memberIdRow}/scans`)
      .set(auth(ownerToken));
    expect(r.status).toBe(403);
  });

  it("member flips data sharing on -> 200; owner can now read scans", async () => {
    const flip = await request(app).patch(`/api/v1/family/members/${memberIdRow}/share`)
      .set(auth(memberToken)).send({ shared: true });
    expect(flip.status).toBe(200);
    expect(flip.body.member.data_shared).toBe(true);

    const scans = await request(app).get(`/api/v1/family/members/${memberIdRow}/scans`)
      .set(auth(ownerToken));
    expect(scans.status).toBe(200);
    expect(Array.isArray(scans.body.scans)).toBe(true);
  });

  it("a stranger cannot change the member's sharing -> 403", async () => {
    const r = await request(app).patch(`/api/v1/family/members/${memberIdRow}/share`)
      .set(auth(strangerToken)).send({ shared: false });
    expect(r.status).toBe(403);
  });

  it("owner removes the member -> 200; scans then 404", async () => {
    const del = await request(app).delete(`/api/v1/family/members/${memberIdRow}`)
      .set(auth(ownerToken));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    const scans = await request(app).get(`/api/v1/family/members/${memberIdRow}/scans`)
      .set(auth(ownerToken));
    expect(scans.status).toBe(404);
  });
});

describe("P-8 offline sync", () => {
  const KEY = "sync-1111-2222-3333-444455556666";

  it("replay with the same Idempotency-Key returns the identical body + X-Idempotent-Replay, one checkin stored", async () => {
    const first = await request(app).post("/api/v1/sync/checkins").set(auth(ownerToken))
      .set("Idempotency-Key", KEY).send({ note: "week 1 shedding" });
    expect(first.status).toBe(201);
    expect(first.body.checkin).toBeDefined();

    const replay = await request(app).post("/api/v1/sync/checkins").set(auth(ownerToken))
      .set("Idempotency-Key", KEY).send({ note: "week 1 shedding" });
    expect(replay.status).toBe(200);
    expect(replay.headers["x-idempotent-replay"]).toBe("true");
    expect(replay.body).toEqual(first.body);

    const stored = await store.listCheckins(ownerId);
    expect(stored).toHaveLength(1);
  });

  it("a different key creates a new checkin", async () => {
    const r = await request(app).post("/api/v1/sync/checkins").set(auth(ownerToken))
      .set("Idempotency-Key", "sync-9999-8888-7777-666655554444").send({ note: "week 2" });
    expect(r.status).toBe(201);
    const stored = await store.listCheckins(ownerId);
    expect(stored).toHaveLength(2);
  });

  it("GET /delta returns server_time + changes object", async () => {
    const r = await request(app).get("/api/v1/sync/delta?since=2000-01-01T00:00:00.000Z")
      .set(auth(ownerToken));
    expect(r.status).toBe(200);
    expect(typeof r.body.server_time).toBe("string");
    expect(r.body.changes).toBeDefined();
    expect(Array.isArray(r.body.changes.orders)).toBe(true);
    expect(Array.isArray(r.body.changes.notifications)).toBe(true);
    expect(Array.isArray(r.body.changes.checkins)).toBe(true);
    expect(r.body.changes.checkins.length).toBeGreaterThanOrEqual(2);
  });
});
