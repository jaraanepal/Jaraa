// Batch-4 coach features (C28–C45).
//
// Covers: authz on every new /coach route, streak-freeze 1/month (409),
// challenge-survey duplicate (409), tip PII rejection (400), feedback
// aggregate exposing only {avg, count}, and /me/* ownership checks.
//
// Habit-only coaching — no medical/diagnostic assertions anywhere.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";

const { app, store } = testDeps();
const C = "/api/v1/coach";
const ME = "/api/v1/me";

let n = 0;
const phone = (prefix: string) => `+97798${prefix}${String(++n).padStart(6, "0")}`;

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function makeUsers() {
  const coach = await store.createUser({ phone: phone("71"), role: "coach" });
  const coach2 = await store.createUser({ phone: phone("72"), role: "coach" });
  const cust = await store.createUser({ phone: phone("81"), role: "customer" });
  const cust2 = await store.createUser({ phone: phone("82"), role: "customer" });
  return {
    coach, coach2, cust, cust2,
    coachTok: tokenFor(coach), coach2Tok: tokenFor(coach2),
    custTok: tokenFor(cust), cust2Tok: tokenFor(cust2),
  };
}

describe("batch 4: coach endpoints", () => {
  it("rejects unauthenticated access and non-coach roles", async () => {
    const { custTok } = await makeUsers();

    await request(app).get(`${C}/feedback`).expect(401);
    await request(app).get(`${C}/weekly-report`).expect(401);
    await request(app).post(`${C}/tips`).expect(401);

    for (const path of [
      `${C}/feedback`,
      `${C}/weekly-report`,
      `${C}/nudges/stats`,
      `${C}/inactive`,
      `${C}/tips`,
    ]) {
      const res = await request(app).get(path).set(auth(custTok));
      expect(res.status, `GET ${path} as customer`).toBe(403);
    }
  });

  it("C29: feedback aggregate returns only {avg, count} — never individual rows", async () => {
    const { coach, coachTok, custTok, cust2Tok } = await makeUsers();

    await request(app).post(`${ME}/coach-feedback`).set(auth(custTok))
      .send({ coach_id: coach.id, rating: 5, note: "really helped" }).expect(201);
    await request(app).post(`${ME}/coach-feedback`).set(auth(cust2Tok))
      .send({ coach_id: coach.id, rating: 3 }).expect(201);

    const res = await request(app).get(`${C}/feedback`).set(auth(coachTok)).expect(200);
    expect(res.body.feedback).toEqual({ avg: 4, count: 2 });
    expect(JSON.stringify(res.body)).not.toContain("really helped");
    expect(JSON.stringify(res.body)).not.toContain("coach_id");
  });

  it("C30: only one streak freeze per calendar month (409 on the second)", async () => {
    const { coachTok, cust } = await makeUsers();
    const today = new Date().toISOString().slice(0, 10);
    const later = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    await request(app).post(`${C}/customers/${cust.id}/streak-freeze`).set(auth(coachTok))
      .send({ frozen_date: today }).expect(201);
    await request(app).post(`${C}/customers/${cust.id}/streak-freeze`).set(auth(coachTok))
      .send({ frozen_date: later }).expect(409);

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    await request(app).post(`${C}/customers/${cust.id}/streak-freeze`).set(auth(coachTok))
      .send({ frozen_date: nextMonth.toISOString().slice(0, 10) }).expect(201);
  });

  it("C32: customer tags are idempotent on add and removable", async () => {
    const { coachTok, cust } = await makeUsers();

    await request(app).post(`${C}/customers/${cust.id}/tags`).set(auth(coachTok))
      .send({ tag: "Busy Mom" }).expect(201);
    await request(app).post(`${C}/customers/${cust.id}/tags`).set(auth(coachTok))
      .send({ tag: "  BUSY mom " }).expect(201); // same tag, trimmed/lowered

    const listed = await request(app).get(`${C}/customers/${cust.id}/tags`).set(auth(coachTok)).expect(200);
    expect(listed.body.tags).toHaveLength(1);
    expect(listed.body.tags[0].tag).toBe("busy mom");

    await request(app).delete(`${C}/customers/${cust.id}/tags`).set(auth(coachTok))
      .send({ tag: "busy mom" }).expect(200);
    const after = await request(app).get(`${C}/customers/${cust.id}/tags`).set(auth(coachTok)).expect(200);
    expect(after.body.tags).toHaveLength(0);
  });

  it("C33: bulk nudge validates and caps; optional title is kept in message_en", async () => {
    const { coach, coachTok, cust, cust2 } = await makeUsers();
    const sendAt = new Date(Date.now() + 3600000).toISOString();

    await request(app).post(`${C}/nudges/bulk`).set(auth(coachTok))
      .send({ customer_ids: [], body_en: "hi", send_at: sendAt }).expect(400);

    const res = await request(app).post(`${C}/nudges/bulk`).set(auth(coachTok))
      .send({
        customer_ids: [cust.id, cust2.id],
        title_en: "My title",
        body_en: "My body",
        send_at: sendAt,
      }).expect(201);
    expect(res.body.sent).toBe(2);

    const nudges = await store.listScheduledNudges(coach.id);
    expect(nudges[0].message_en).toContain("My title");
    expect(nudges[0].message_en).toContain("My body");

    const tooMany = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    await request(app).post(`${C}/nudges/bulk`).set(auth(coachTok))
      .send({ customer_ids: tooMany, body_en: "hi", send_at: sendAt }).expect(400);
  });

  it("C34: handover note create + history", async () => {
    const { coachTok, cust } = await makeUsers();

    await request(app).post(`${C}/customers/${cust.id}/handover`).set(auth(coachTok))
      .send({ note: "Prefers Nepali nudges in the morning." }).expect(201);

    const res = await request(app).get(`${C}/customers/${cust.id}/handovers`).set(auth(coachTok)).expect(200);
    expect(res.body.handovers).toHaveLength(1);
    expect(res.body.handovers[0].note).toContain("Nepali");
  });

  it("C35: inactive list shows customers with no check-in for 14+ days", async () => {
    const { coachTok, cust } = await makeUsers();

    // Simulate an old signup with no check-ins.
    (store as unknown as { users: Map<string, { created_at: string }> }).users.get(cust.id)!.created_at = daysAgoIso(20);

    const res = await request(app).get(`${C}/inactive`).set(auth(coachTok)).expect(200);
    const found = res.body.inactive.find((c: { user_id: string }) => c.user_id === cust.id);
    expect(found).toBeDefined();
    expect(found.days_missed).toBeGreaterThanOrEqual(14);
  });

  it("C37: weekly report counts own activity", async () => {
    const { coach, coachTok, cust } = await makeUsers();

    await store.addCoachNote(coach.id, cust.id, "week note");
    await store.scheduleNudge({
      coach_id: coach.id, user_id: cust.id,
      message_en: "hi", message_ne: null,
      send_at: new Date(Date.now() + 3600000).toISOString(),
    });
    await store.createEscalation(cust.id, coach.id, "flag");

    const res = await request(app).get(`${C}/weekly-report`).set(auth(coachTok)).expect(200);
    expect(res.body.report.notes).toBe(1);
    expect(res.body.report.nudges).toBe(1);
    expect(res.body.report.escalations).toBe(1);
    expect(res.body.report.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("C38: milestones timeline merges badges and goal completions", async () => {
    const { coach, coachTok, cust } = await makeUsers();

    await store.awardBadge(cust.id, "streak-7", null);
    const goal = await store.createCustomerGoal(coach.id, cust.id, { title_en: "Drink 2L" });
    await store.completeCustomerGoal(goal.id, coach.id);

    const res = await request(app).get(`${C}/customers/${cust.id}/milestones`).set(auth(coachTok)).expect(200);
    const kinds = res.body.milestones.map((m: { kind: string }) => m.kind).sort();
    expect(kinds).toEqual(["badge", "goal"]);
  });

  it("C41: journey stages follow the documented rule", async () => {
    const { coachTok } = await makeUsers();

    const fresh = await store.createUser({ phone: phone("83"), role: "customer" });
    let res = await request(app).get(`${C}/customers/${fresh.id}/journey`).set(auth(coachTok)).expect(200);
    expect(res.body.stage).toBe("new");

    await store.addCheckin({ user_id: fresh.id, note: "ok" });
    res = await request(app).get(`${C}/customers/${fresh.id}/journey`).set(auth(coachTok)).expect(200);
    expect(res.body.stage).toBe("active");

    // Returning: a 30-day-old check-in, then one today.
    const ret = await store.createUser({ phone: phone("84"), role: "customer" });
    const old = await store.addCheckin({ user_id: ret.id, note: "old" });
    (store as unknown as { checkins: Map<string, { created_at: string }> }).checkins.get(old.id)!.created_at = daysAgoIso(30);
    await store.addCheckin({ user_id: ret.id, note: "back" });
    res = await request(app).get(`${C}/customers/${ret.id}/journey`).set(auth(coachTok)).expect(200);
    expect(res.body.stage).toBe("returning");

    // Dormant: last check-in 25 days ago.
    const dor = await store.createUser({ phone: phone("85"), role: "customer" });
    const dci = await store.addCheckin({ user_id: dor.id, note: "stale" });
    (store as unknown as { checkins: Map<string, { created_at: string }> }).checkins.get(dci.id)!.created_at = daysAgoIso(25);
    res = await request(app).get(`${C}/customers/${dor.id}/journey`).set(auth(coachTok)).expect(200);
    expect(res.body.stage).toBe("dormant");
  });

  it("C42: outcome can only be recorded on a resolved escalation", async () => {
    const { coach, coachTok, cust } = await makeUsers();

    const esc = await store.createEscalation(cust.id, coach.id, "needs doctor");
    await request(app).patch(`${C}/escalations/${esc.id}/outcome`).set(auth(coachTok))
      .send({ outcome: "referred" }).expect(409);

    await store.updateEscalationStatus(esc.id, "resolved");
    await request(app).patch(`${C}/escalations/${esc.id}/outcome`).set(auth(coachTok))
      .send({ outcome: "Doctor advised rest." }).expect(200);

    const listed = await request(app).get(`${C}/escalations?status=resolved`).set(auth(coachTok)).expect(200);
    const back = listed.body.escalations.find((e: { id: string }) => e.id === esc.id);
    expect(back.outcome).toBe("Doctor advised rest.");
  });

  it("C43: tips reject email/phone PII; only the author can delete", async () => {
    const { coach2, coachTok, custTok } = await makeUsers();

    for (const body of ["call 9812345678 today", "mail me at doc@example.com"]) {
      await request(app).post(`${C}/tips`).set(auth(coachTok))
        .send({ title: "t", body }).expect(400);
    }
    // Customers cannot create tips either.
    await request(app).post(`${C}/tips`).set(auth(custTok))
      .send({ title: "t", body: "clean body" }).expect(403);

    const ok = await request(app).post(`${C}/tips`).set(auth(coachTok))
      .send({ title: "Morning sun", body: "A short walk helps the routine stick." }).expect(201);
    expect(ok.body.tip.title).toBe("Morning sun");

    const listed = await request(app).get(`${C}/tips`).set(auth(coachTok)).expect(200);
    expect(listed.body.tips.some((x: { id: string }) => x.id === ok.body.tip.id)).toBe(true);

    const others = await store.createCoachTip({ coach_id: coach2.id, title: "x", body: "y" });
    await request(app).delete(`${C}/tips/${others.id}`).set(auth(coachTok)).expect(404);

    await request(app).delete(`${C}/tips/${ok.body.tip.id}`).set(auth(coachTok)).expect(200);
  });

  it("C31: nudge stats are honest totals with no open-rate invention", async () => {
    const { coach, coachTok, cust } = await makeUsers();

    await store.scheduleNudge({
      coach_id: coach.id, user_id: cust.id,
      message_en: "pending one", message_ne: null,
      send_at: new Date(Date.now() + 3600000).toISOString(),
    });

    const res = await request(app).get(`${C}/nudges/stats`).set(auth(coachTok)).expect(200);
    expect(res.body.stats.total).toBe(1);
    expect(res.body.stats.pending).toBe(1);
    expect(res.body.stats.sent).toBe(0);
    expect(res.body.stats.open_rate).toBeNull();
  });

  it("C45 + C28: survey duplicate 409, assignment ownership, survey results, certificate", async () => {
    const { coach, coachTok, coach2Tok, cust, custTok, cust2Tok } = await makeUsers();

    const ch = await request(app).post(`${C}/challenges`).set(auth(coachTok))
      .send({ title_en: "7-day water", description_en: "drink", days: 7 }).expect(201);

    const assigned = await store.assignChallenge(ch.body.challenge.id, cust.id);
    await store.completeChallengeAssignment(assigned.id, cust.id);

    // Certificate: owner-only, requires completion.
    await request(app).get(`${C}/challenges/assignments/${assigned.id}/certificate`)
      .set(auth(coach2Tok)).expect(403);
    const cert = await request(app).get(`${C}/challenges/assignments/${assigned.id}/certificate`)
      .set(auth(coachTok)).expect(200);
    expect(cert.body.certificate.completed_at).toBeTruthy();
    expect(cert.body.certificate.challenge_title_en).toBe("7-day water");

    // Survey: customer-owned, duplicate 409.
    await request(app).post(`${ME}/challenges/${assigned.id}/survey`).set(auth(cust2Tok))
      .send({ q1_rating: 4 }).expect(404);
    await request(app).post(`${ME}/challenges/${assigned.id}/survey`).set(auth(custTok))
      .send({ q1_rating: 5, q2_text: "great!" }).expect(201);
    await request(app).post(`${ME}/challenges/${assigned.id}/survey`).set(auth(custTok))
      .send({ q1_rating: 2 }).expect(409);

    // Survey results: challenge owner only.
    await request(app).get(`${C}/challenges/${ch.body.challenge.id}/surveys`)
      .set(auth(coach2Tok)).expect(403);
    const surveys = await request(app).get(`${C}/challenges/${ch.body.challenge.id}/surveys`)
      .set(auth(coachTok)).expect(200);
    expect(surveys.body.surveys).toHaveLength(1);
    expect(surveys.body.surveys[0].q1_rating).toBe(5);
  });

  it("C28: certificate returns 409 when the assignment is not completed", async () => {
    const { coachTok, coach, cust } = await makeUsers();

    const ch = await request(app).post(`${C}/challenges`).set(auth(coachTok))
      .send({ title_en: "unfinished", days: 7 }).expect(201);
    const assigned = await store.assignChallenge(ch.body.challenge.id, cust.id);

    await request(app).get(`${C}/challenges/assignments/${assigned.id}/certificate`)
      .set(auth(coachTok)).expect(409);
  });

  it("C39: reading an article assignment is customer-owned", async () => {
    const { custTok, cust2Tok, cust } = await makeUsers();

    const article = await store.createArticle({
      title_en: "Hair basics", body_en: "content", created_by: null,
    });
    const assignment = await store.assignArticle(article.id, cust.id, null);

    await request(app).patch(`${ME}/article-assignments/${assignment.id}/read`)
      .set(auth(cust2Tok)).expect(404);
    const res = await request(app).patch(`${ME}/article-assignments/${assignment.id}/read`)
      .set(auth(custTok)).expect(200);
    expect(res.body.assignment.read_at).toBeTruthy();
  });
});
