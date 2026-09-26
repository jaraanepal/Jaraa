// Jaraa v1.4 API tests (P-9 AI education assistant + safety guardrails,
// P-12 community Q&A with mandatory medical disclaimers).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";
import { detectRedFlag, applyGuardrails } from "../src/lib/aiGuardrails";

const { app, store } = testDeps();

let adminToken = "";
let doctorToken = "";
let custAToken = "";
let custAId = "";

beforeAll(async () => {
  const admin = await store.createUser({ phone: "+9779851600001", role: "admin" });
  adminToken = tokenFor({ id: admin.id, role: "admin" });
  const doc = await store.createUser({ phone: "+9779851600002", role: "doctor" });
  doctorToken = tokenFor({ id: doc.id, role: "doctor" });
  const a = await store.createUser({ phone: "+9779851600003" }); // customer
  custAId = a.id;
  custAToken = tokenFor({ id: a.id, role: "customer" });
});

describe("P-9 aiGuardrails unit", () => {
  it('detectRedFlag("I want to kill myself") is true', () => {
    expect(detectRedFlag("I want to kill myself")).toBe(true);
  });
  it('detectRedFlag("tell me about hair oil") is false', () => {
    expect(detectRedFlag("tell me about hair oil")).toBe(false);
  });
  it("applyGuardrails blocks diagnostic language", () => {
    const out = applyGuardrails("It sounds like you might have alopecia");
    expect(out.safe).toBe(false);
    expect(out.text).not.toContain("alopecia");
    expect(out.text).toContain("dermatologist");
  });
  it("applyGuardrails passes general education text through", () => {
    const out = applyGuardrails("General info about protein");
    expect(out.safe).toBe(true);
    expect(out.text).toBe("General info about protein");
  });
});

describe("P-9 POST /ai/chat", () => {
  it("without GEMINI_API_KEY -> 503 ai_not_configured", async () => {
    const r = await request(app).post("/api/v1/ai/chat").set(auth(custAToken))
      .send({ message: "Tell me about hair oil" });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("ai_not_configured");
  });

  it("red-flag message -> 200 handoff with disclosures + a care-team ticket", async () => {
    const r = await request(app).post("/api/v1/ai/chat").set(auth(custAToken))
      .send({ message: "I want to kill myself" });
    expect(r.status).toBe(200);
    expect(r.body.handoff).toBe(true);
    expect(r.body.red_flagged).toBe(true);
    expect(typeof r.body.disclosure_en).toBe("string");
    expect(r.body.disclosure_en.length).toBeGreaterThan(0);
    expect(typeof r.body.disclosure_ne).toBe("string");
    expect(r.body.disclosure_ne.length).toBeGreaterThan(0);

    const tickets = await store.listTickets({});
    const handoff = tickets.find((t) => t.subject === "AI red-flag handoff" && t.user_id === custAId);
    expect(handoff).toBeDefined();
  });
});

describe("P-12 community Q&A", () => {
  let questionId = "";
  let answerId = "";

  const expectDisclaimers = (r: { body: Record<string, unknown> }) => {
    expect(typeof r.body.disclaimer_en).toBe("string");
    expect((r.body.disclaimer_en as string).length).toBeGreaterThan(0);
    expect(typeof r.body.disclaimer_ne).toBe("string");
    expect((r.body.disclaimer_ne as string).length).toBeGreaterThan(0);
  };

  it("customer asks a question -> 201 with disclaimers", async () => {
    const r = await request(app).post("/api/v1/community/questions").set(auth(custAToken))
      .send({
        title: "Is daily oiling good for hair fall?",
        body: "I lose a lot of hair when I oil daily. Should I reduce the frequency or change the oil?",
      });
    expect(r.status).toBe(201);
    expectDisclaimers(r);
    expect(r.body.data.question.id).toBeDefined();
    questionId = r.body.data.question.id;
  });

  it("a customer cannot answer -> 403", async () => {
    const r = await request(app).post(`/api/v1/community/questions/${questionId}/answers`)
      .set(auth(custAToken)).send({ body: "I think you should try my home remedy that worked for me." });
    expect(r.status).toBe(403);
  });

  it("a doctor answers -> 201 with disclaimers", async () => {
    const r = await request(app).post(`/api/v1/community/questions/${questionId}/answers`)
      .set(auth(doctorToken))
      .send({ body: "Daily oiling is generally fine, but vigorous rubbing can break hair. Use gentle fingertip massage instead." });
    expect(r.status).toBe(201);
    expectDisclaimers(r);
    answerId = r.body.data.answer.id;
  });

  it("doctor agrees, idempotent on repeat -> 200 both times", async () => {
    const first = await request(app).post(`/api/v1/community/answers/${answerId}/agree`)
      .set(auth(doctorToken));
    expect(first.status).toBe(200);
    expectDisclaimers(first);
    expect(first.body.data.agreed).toBe(true);

    const second = await request(app).post(`/api/v1/community/answers/${answerId}/agree`)
      .set(auth(doctorToken));
    expect(second.status).toBe(200);
    expect(second.body.data.agreed).toBe(true);
  });

  it("customer marks the answer helpful -> 200 with disclaimers", async () => {
    const r = await request(app).post(`/api/v1/community/answers/${answerId}/helpful`)
      .set(auth(custAToken)).send({ helpful: true });
    expect(r.status).toBe(200);
    expectDisclaimers(r);
  });

  it("question list and detail carry disclaimers", async () => {
    const list = await request(app).get("/api/v1/community/questions").set(auth(custAToken));
    expect(list.status).toBe(200);
    expectDisclaimers(list);

    const detail = await request(app).get(`/api/v1/community/questions/${questionId}`)
      .set(auth(custAToken));
    expect(detail.status).toBe(200);
    expectDisclaimers(detail);
    expect(detail.body.data.answers.length).toBeGreaterThanOrEqual(1);
  });

  it("flag -> 201 with disclaimers; admin sees it in /flags", async () => {
    const flag = await request(app).post("/api/v1/community/flag").set(auth(custAToken))
      .send({ question_id: questionId, reason: "contains unverified medical claims" });
    expect(flag.status).toBe(201);
    expectDisclaimers(flag);

    const queue = await request(app).get("/api/v1/community/flags").set(auth(adminToken));
    expect(queue.status).toBe(200);
    expectDisclaimers(queue);
    expect(queue.body.data.flags.some((f: { question_id: string | null }) => f.question_id === questionId)).toBe(true);
  });

  it("admin hides the question -> non-admin GET becomes 404", async () => {
    const hide = await request(app).patch(`/api/v1/community/questions/${questionId}/status`)
      .set(auth(adminToken)).send({ status: "hidden" });
    expect(hide.status).toBe(200);
    expectDisclaimers(hide);
    expect(hide.body.data.question.status).toBe("hidden");

    const gone = await request(app).get(`/api/v1/community/questions/${questionId}`)
      .set(auth(custAToken));
    expect(gone.status).toBe(404);

    const list = await request(app).get("/api/v1/community/questions").set(auth(custAToken));
    expect(list.status).toBe(200);
    expect(list.body.data.questions.some((q: { id: string }) => q.id === questionId)).toBe(false);

    // admin can still see it
    const adminView = await request(app).get(`/api/v1/community/questions/${questionId}`)
      .set(auth(adminToken));
    expect(adminView.status).toBe(200);
  });
});
