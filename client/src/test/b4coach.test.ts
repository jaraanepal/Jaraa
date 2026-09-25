/**
 * Batch-4 (010) coachB4Api + customerB4Api contract tests: every function hits
 * the right path with the right HTTP method and payload (fetch is stubbed;
 * no network).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coachB4Api, customerB4Api } from "../api/b4coach";

interface Call {
  url: string;
  init: RequestInit;
}

const calls: Call[] = [];

function stubFetch() {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "DELETE") {
        return { status: 204, ok: true, text: async () => "" };
      }
      return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true }) };
    }),
  );
}

beforeEach(() => {
  stubFetch();
});

function lastCall(): Call {
  const c = calls[calls.length - 1];
  if (!c) throw new Error("fetch was not called");
  return c;
}

function methodOf(c: Call): string {
  return ((c.init.method as string) ?? "GET").toUpperCase();
}

function bodyOf(c: Call): Record<string, unknown> {
  return JSON.parse(c.init.body as string) as Record<string, unknown>;
}

const A = "/api/v1";

describe("coachB4Api (batch-4 coach endpoints)", () => {
  it("certificate GETs /coach/challenges/assignments/:id/certificate", async () => {
    await coachB4Api.certificate("asg-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/challenges/assignments/asg-1/certificate`);
  });

  it("feedbackAggregate GETs /coach/feedback", async () => {
    await coachB4Api.feedbackAggregate();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/feedback`);
  });

  it("createStreakFreeze POSTs {frozen_date} to /coach/customers/:id/streak-freeze", async () => {
    await coachB4Api.createStreakFreeze("cust-1", "2026-09-25");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe(`${A}/coach/customers/cust-1/streak-freeze`);
    expect(bodyOf(c)).toEqual({ frozen_date: "2026-09-25" });
  });

  it("nudgeStats GETs /coach/nudges/stats", async () => {
    await coachB4Api.nudgeStats();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/nudges/stats`);
  });

  it("listTags / addTag / removeTag hit /coach/customers/:id/tags", async () => {
    await coachB4Api.listTags("cust-1");
    expect(methodOf(lastCall())).toBe("GET");
    expect(lastCall().url).toBe(`${A}/coach/customers/cust-1/tags`);

    await coachB4Api.addTag("cust-1", "busy mom");
    expect(methodOf(lastCall())).toBe("POST");
    expect(bodyOf(lastCall())).toEqual({ tag: "busy mom" });

    await coachB4Api.removeTag("cust-1", "busy mom");
    expect(methodOf(lastCall())).toBe("DELETE");
    expect(bodyOf(lastCall())).toEqual({ tag: "busy mom" });
  });

  it("bulkNudge POSTs the full payload to /coach/nudges/bulk", async () => {
    const payload = {
      customer_ids: ["a", "b"],
      title_en: "Hydrate",
      body_en: "Drink water",
      body_ne: "पानी पिउनुहोस्",
      send_at: "2026-09-26T08:00:00.000Z",
    };
    await coachB4Api.bulkNudge(payload);
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe(`${A}/coach/nudges/bulk`);
    expect(bodyOf(c)).toEqual(payload);
  });

  it("createHandover / listHandovers hit the handover routes", async () => {
    await coachB4Api.createHandover("cust-1", { note: "prefers morning" });
    expect(methodOf(lastCall())).toBe("POST");
    expect(lastCall().url).toBe(`${A}/coach/customers/cust-1/handover`);
    expect(bodyOf(lastCall())).toEqual({ note: "prefers morning" });

    await coachB4Api.listHandovers("cust-1");
    expect(methodOf(lastCall())).toBe("GET");
    expect(lastCall().url).toBe(`${A}/coach/customers/cust-1/handovers`);
  });

  it("inactive GETs /coach/inactive", async () => {
    await coachB4Api.inactive();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/inactive`);
  });

  it("weeklyReport GETs /coach/weekly-report", async () => {
    await coachB4Api.weeklyReport();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/weekly-report`);
  });

  it("milestones / journey GET the per-customer routes", async () => {
    await coachB4Api.milestones("cust-1");
    expect(lastCall().url).toBe(`${A}/coach/customers/cust-1/milestones`);

    await coachB4Api.journey("cust-1");
    expect(lastCall().url).toBe(`${A}/coach/customers/cust-1/journey`);
  });

  it("setEscalationOutcome PATCHes {outcome} to /coach/escalations/:id/outcome", async () => {
    await coachB4Api.setEscalationOutcome("esc-1", "Doctor advised rest.");
    const c = lastCall();
    expect(methodOf(c)).toBe("PATCH");
    expect(c.url).toBe(`${A}/coach/escalations/esc-1/outcome`);
    expect(bodyOf(c)).toEqual({ outcome: "Doctor advised rest." });
  });

  it("listTips / createTip / deleteTip hit /coach/tips", async () => {
    await coachB4Api.listTips();
    expect(methodOf(lastCall())).toBe("GET");
    expect(lastCall().url).toBe(`${A}/coach/tips`);

    await coachB4Api.createTip({ title: "Morning sun", body: "A short walk helps." });
    expect(methodOf(lastCall())).toBe("POST");
    expect(bodyOf(lastCall())).toEqual({ title: "Morning sun", body: "A short walk helps." });

    await coachB4Api.deleteTip("tip-1");
    expect(methodOf(lastCall())).toBe("DELETE");
    expect(lastCall().url).toBe(`${A}/coach/tips/tip-1`);
  });

  it("challengeSurveys GETs /coach/challenges/:id/surveys", async () => {
    await coachB4Api.challengeSurveys("ch-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/challenges/ch-1/surveys`);
  });

  it("URL-encodes customer ids in paths", async () => {
    await coachB4Api.listTags("cust 1/x");
    expect(lastCall().url).toBe(`${A}/coach/customers/${encodeURIComponent("cust 1/x")}/tags`);
  });
});

describe("customerB4Api (batch-4 customer endpoints)", () => {
  it("submitCoachFeedback POSTs to /me/coach-feedback", async () => {
    await customerB4Api.submitCoachFeedback({ coach_id: "c1", rating: 5, note: "helpful" });
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe(`${A}/me/coach-feedback`);
    expect(bodyOf(c)).toEqual({ coach_id: "c1", rating: 5, note: "helpful" });
  });

  it("markArticleRead PATCHes /me/article-assignments/:id/read", async () => {
    await customerB4Api.markArticleRead("aa-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("PATCH");
    expect(c.url).toBe(`${A}/me/article-assignments/aa-1/read`);
  });

  it("submitChallengeSurvey POSTs to /me/challenges/:id/survey", async () => {
    await customerB4Api.submitChallengeSurvey("asg-1", { q1_rating: 4, q2_text: "fine" });
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe(`${A}/me/challenges/asg-1/survey`);
    expect(bodyOf(c)).toEqual({ q1_rating: 4, q2_text: "fine" });
  });
});
