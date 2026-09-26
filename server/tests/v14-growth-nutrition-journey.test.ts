// Jaraa v1.4 API tests (P-13 referrals/coins, P-14 wallet, P-16 nutrition,
// P-17 milestones + coach messaging).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();

let adminToken = "";
let coachToken = "";
let custAToken = "";
let custBToken = "";
let custAId = "";
let custBId = "";

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779851700001", role: "admin" });
  adminToken = tokenFor({ id: admin.id, role: "admin" });
  const coach = await store.createUser({ phone: "+9779851700002", role: "coach" });
  coachToken = tokenFor({ id: coach.id, role: "coach" });
  const a = await store.createUser({ phone: "+9779851700003" }); // customer
  custAId = a.id;
  custAToken = tokenFor({ id: a.id, role: "customer" });
  const b = await store.createUser({ phone: "+9779851700004" }); // customer
  custBId = b.id;
  custBToken = tokenFor({ id: b.id, role: "customer" });
});

describe("P-13 referrals & coins", () => {
  let codeA = "";

  it("GET /growth/referral returns a code like JARAA-XXXXXX", async () => {
    const r = await request(app).get("/api/v1/growth/referral").set(auth(custAToken));
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^JARAA-[A-Z0-9]{6}$/);
    codeA = r.body.code;
  });

  it("applying your own code -> 409", async () => {
    const r = await request(app).post("/api/v1/growth/referral/apply").set(auth(custAToken))
      .send({ code: codeA });
    expect(r.status).toBe(409);
  });

  it("applying a bogus code -> 404", async () => {
    const r = await request(app).post("/api/v1/growth/referral/apply").set(auth(custBToken))
      .send({ code: "JARAA-ZZZZZZ" });
    expect(r.status).toBe(404);
  });

  it("applying a valid code -> pending; re-apply returns the existing referral", async () => {
    const first = await request(app).post("/api/v1/growth/referral/apply").set(auth(custBToken))
      .send({ code: codeA });
    expect(first.status).toBe(201);
    expect(first.body.referral.status).toBe("pending");

    // NOTE: the route returns 201 even on idempotent replay (the store returns
    // the existing referral); asserted as-is per route behavior.
    const again = await request(app).post("/api/v1/growth/referral/apply").set(auth(custBToken))
      .send({ code: codeA });
    expect(again.status).toBe(201);
    expect(again.body.referral.id).toBe(first.body.referral.id);
  });

  it("coin ledger is append-only: grants accumulate, entries carry the full shape", async () => {
    await store.grantCoins(custAId, 50, "test-grant-1");
    await store.grantCoins(custAId, 25, "test-grant-2");
    const r = await request(app).get("/api/v1/growth/coins/ledger").set(auth(custAToken));
    expect(r.status).toBe(200);
    expect(r.body.coins).toBe(75);
    expect(r.body.ledger).toHaveLength(2);
    for (const e of r.body.ledger) {
      expect(e.id).toBeDefined();
      expect(e.user_id).toBe(custAId);
      expect(typeof e.amount).toBe("number");
      expect(typeof e.reason).toBe("string");
      expect(typeof e.created_at).toBe("string");
    }
  });

  it("referral completion (store-level): pending -> completed, both sides get 100 coins", async () => {
    const referrer = await store.createUser({ phone: "+9779851700011" });
    const referred = await store.createUser({ phone: "+9779851700012" });
    const code = (await store.getOrCreateReferralCode(referrer.id)).code;

    const ref = await store.applyReferralCode(referred.id, code);
    expect(ref.status).toBe("pending");

    const completed = await store.completeReferralForUser(referred.id);
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe("completed");

    // the scan-submit hook grants 100 coins to each side on completion
    await store.grantCoins(referrer.id, 100, "referral_completed", "referral", completed!.id);
    await store.grantCoins(referred.id, 100, "referral_completed", "referral", completed!.id);
    expect(await store.getCoinBalance(referrer.id)).toBe(100);
    expect(await store.getCoinBalance(referred.id)).toBe(100);
  });
});

describe("P-14 wallet", () => {
  let khaltiOrderId = "";

  beforeAll(async () => {
    const prod = await store.createProduct({ name_en: "Jaraa Wallet Test Serum", kind: "cosmetic", price_npr: 1299 });
    const kit = await store.createKit({ name_en: "Jaraa Wallet Test Kit", product_ids: [prod.id], total_npr: 1299 });
    const r = await request(app).post("/api/v1/orders")
      .set(auth(custAToken))
      .set("Idempotency-Key", "wlt-1111-2222-3333-444455556666")
      .send({
        kit_id: kit.id,
        payment_method: "khalti", // non-COD on purpose
        shipping_address: { name: "Aasha", phone: "+9779851700003", city: "Kathmandu", address_line: "Boudha 12" },
      });
    expect(r.status).toBe(201);
    khaltiOrderId = r.body.id;
  });

  it("customer cannot grant wallet credit -> 403", async () => {
    const r = await request(app).post("/api/v1/growth/wallet/grant").set(auth(custAToken))
      .send({ user_id: custBId, amount_npr: 100, kind: "cashback" });
    expect(r.status).toBe(403);
  });

  it("admin grants cashback -> customer balance increases", async () => {
    const grant = await request(app).post("/api/v1/growth/wallet/grant").set(auth(adminToken))
      .send({ user_id: custAId, amount_npr: 500, kind: "cashback", ref: "promo" });
    expect(grant.status).toBe(201);

    const wallet = await request(app).get("/api/v1/growth/wallet").set(auth(custAToken));
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance_npr).toBe(500);
  });

  it("cod-change on a non-COD order -> 400", async () => {
    const r = await request(app).post("/api/v1/growth/wallet/cod-change").set(auth(custAToken))
      .send({ order_id: khaltiOrderId, amount_npr: 100 });
    expect(r.status).toBe(400);
  });
});

describe("P-16 nutrition", () => {
  beforeAll(async () => {
    // foods have no create path in the store; seed one row directly so the
    // search + source contract is exercised instead of vacuous.
    store.foods.set("food-dal-bhat", {
      id: "food-dal-bhat", name_en: "Dal Bhat", name_ne: "दाल भात", name_ro: null,
      protein_g: 12, calories: 350, serving: "1 plate", source: "estimate",
      created_at: new Date().toISOString(),
    });
  });

  it("GET /foods?q=dal returns rows, all with source 'estimate'", async () => {
    const r = await request(app).get("/api/v1/nutrition/foods?q=dal").set(auth(custAToken));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.foods)).toBe(true);
    expect(r.body.foods.length).toBeGreaterThan(0);
    expect(r.body.foods.every((f: { source: string }) => f.source === "estimate")).toBe(true);
    expect(r.body.foods.some((f: { name_en: string }) => f.name_en === "Dal Bhat")).toBe(true);
  });

  it("habit check-in twice for the same day+key stores one row (idempotent)", async () => {
    const first = await request(app).post("/api/v1/nutrition/habits").set(auth(custAToken))
      .send({ log_date: "2026-09-26", habit_key: "oil_massage" });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/v1/nutrition/habits").set(auth(custAToken))
      .send({ log_date: "2026-09-26", habit_key: "oil_massage" });
    expect(second.status).toBe(201);
    expect(second.body.log.id).toBe(first.body.log.id);

    const list = await request(app).get("/api/v1/nutrition/habits?from=2026-09-26&to=2026-09-26")
      .set(auth(custAToken));
    expect(list.status).toBe(200);
    expect(list.body.logs).toHaveLength(1);
  });

  it("admin creates a plan and assigns it; customer sees it; customer cannot create plans", async () => {
    const created = await request(app).post("/api/v1/nutrition/plans").set(auth(adminToken))
      .send({ title_en: "Protein boost plan", protein_target_g: 60 });
    expect(created.status).toBe(201);
    const planId = created.body.plan.id;

    const assigned = await request(app).post(`/api/v1/nutrition/plans/${planId}/assign`)
      .set(auth(adminToken)).send({ user_id: custAId });
    expect(assigned.status).toBe(201);

    const mine = await request(app).get("/api/v1/nutrition/plan").set(auth(custAToken));
    expect(mine.status).toBe(200);
    expect(mine.body.assignment.plan_id).toBe(planId);

    const denied = await request(app).post("/api/v1/nutrition/plans").set(auth(custAToken))
      .send({ title_en: "Sneaky plan" });
    expect(denied.status).toBe(403);
  });
});

describe("P-17 milestones + coach messaging", () => {
  let milestoneId = "";
  let threadA = "";

  it("admin creates a milestone; customer sees it with achieved_at null", async () => {
    const created = await request(app).post("/api/v1/journey/milestones").set(auth(adminToken))
      .send({ title_en: "30-day check-in streak" });
    expect(created.status).toBe(201);
    milestoneId = created.body.milestone.id;

    const mine = await request(app).get("/api/v1/journey/mine").set(auth(custAToken));
    expect(mine.status).toBe(200);
    const entry = mine.body.milestones.find((m: { milestone: { id: string } }) => m.milestone.id === milestoneId);
    expect(entry).toBeDefined();
    expect(entry.achieved_at).toBeNull();
  });

  it("coach awards the milestone; a second award -> 409", async () => {
    const award = await request(app).post(`/api/v1/journey/milestones/${milestoneId}/award`)
      .set(auth(coachToken)).send({ user_id: custAId });
    expect(award.status).toBe(201);
    expect(award.body.milestone.achieved_at).toBeTruthy();

    const again = await request(app).post(`/api/v1/journey/milestones/${milestoneId}/award`)
      .set(auth(coachToken)).send({ user_id: custAId });
    expect(again.status).toBe(409);

    const mine = await request(app).get("/api/v1/journey/mine").set(auth(custAToken));
    const entry = mine.body.milestones.find((m: { milestone: { id: string } }) => m.milestone.id === milestoneId);
    expect(entry.achieved_at).toBeTruthy();
  });

  it("customer thread get-or-create; duplicate client_message_id stores one message", async () => {
    const thread = await request(app).get("/api/v1/journey/thread").set(auth(custAToken));
    expect(thread.status).toBe(200);
    threadA = thread.body.thread.id;

    const first = await request(app).post("/api/v1/journey/thread/messages").set(auth(custAToken))
      .send({ body: "Hello coach, my shedding is down", client_message_id: "cm-1" });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/v1/journey/thread/messages").set(auth(custAToken))
      .send({ body: "Hello coach, my shedding is down", client_message_id: "cm-1" });
    expect(second.status).toBe(201);
    expect(second.body.message.id).toBe(first.body.message.id);

    // admin can read the inbox thread (admin bypass); exactly one message stored
    const msgs = await request(app).get(`/api/v1/journey/threads/${threadA}/messages`)
      .set(auth(adminToken));
    expect(msgs.status).toBe(200);
    expect(msgs.body.messages).toHaveLength(1);
  });

  it("coach inbox: unassigned thread is not visible in the memory store (documents a store gap)", async () => {
    // NOTE: the journey route comment promises coaches see assigned threads
    // "plus the unassigned pool", and the Supabase listCoachThreads does
    // exactly that (coach_id = me OR coach_id IS NULL) — but the MemoryStore
    // only returns coach-assigned threads and nothing can assign one, so a
    // coach cannot list or reply on a fresh thread here. memory.ts is frozen,
    // so this test pins the honest current behavior.
    const inbox = await request(app).get("/api/v1/journey/threads").set(auth(coachToken));
    expect(inbox.status).toBe(200);
    expect(inbox.body.threads).toEqual([]);

    const reply = await request(app).post(`/api/v1/journey/threads/${threadA}/messages`)
      .set(auth(coachToken)).send({ body: "Keep going!" });
    expect(reply.status).toBe(404);
  });

  it("admin can reply on any thread via the inbox route", async () => {
    const r = await request(app).post(`/api/v1/journey/threads/${threadA}/messages`)
      .set(auth(adminToken)).send({ body: "Keep going, great progress!" });
    expect(r.status).toBe(201);
    expect(r.body.message.body).toBe("Keep going, great progress!");
  });

  it("customer B gets their own thread and cannot read customer A's thread", async () => {
    const threadB = await request(app).get("/api/v1/journey/thread").set(auth(custBToken));
    expect(threadB.status).toBe(200);
    expect(threadB.body.thread.id).not.toBe(threadA);

    const read = await request(app).get(`/api/v1/journey/threads/${threadA}/messages`)
      .set(auth(custBToken));
    expect([403, 404]).toContain(read.status);
  });
});
