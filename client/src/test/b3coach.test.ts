// Batch-3 coach API contract tests (C19–C27): endpoints hit the right URLs
// with the right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { coachB3Api } from "../api/b3coach";

const calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch(responseBody: unknown = {}) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      let body: unknown = null;
      try { body = init.body ? JSON.parse(String(init.body)) : null; } catch { body = init.body; }
      calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body });
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify(responseBody),
      };
    }),
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("coach batch-3 API (C19–C27)", () => {
  it("leaderboard hits GET /coach/leaderboard?limit= (C19)", async () => {
    stubFetch({ leaderboard: [] });
    await coachB3Api.leaderboard(5);
    expect(calls[0].url).toContain("/coach/leaderboard?limit=5");
    expect(calls[0].method).toBe("GET");
  });

  it("escalationSla hits GET /coach/escalations/sla (C20)", async () => {
    stubFetch({ sla: [] });
    const r = await coachB3Api.escalationSla();
    expect(calls[0].url).toContain("/coach/escalations/sla");
    expect(r.sla).toEqual([]);
  });

  it("createRecurringNudge POSTs daily|weekly payload (C21)", async () => {
    stubFetch({ nudge: { recurrence: "weekly" } });
    await coachB3Api.createRecurringNudge({
      user_id: "u1", message_en: "hi", send_at: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: "weekly",
    });
    expect(calls[0].url).toContain("/coach/nudges/recurring");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ user_id: "u1", message_en: "hi", recurrence: "weekly" });
  });

  it("satisfactionTrend hits GET /coach/satisfaction/trend (C22)", async () => {
    stubFetch({ trend: [] });
    await coachB3Api.satisfactionTrend();
    expect(calls[0].url).toContain("/coach/satisfaction/trend");
  });

  it("progressCompare hits GET /coach/customers/:id/progress-compare (C23)", async () => {
    stubFetch({ baseline: null, current: null });
    const r = await coachB3Api.progressCompare("abc");
    expect(calls[0].url).toContain("/coach/customers/abc/progress-compare");
    expect(r.baseline).toBeNull();
  });

  it("getOnboarding hits GET /coach/customers/:id/onboarding (C24)", async () => {
    stubFetch({ checklist: null });
    await coachB3Api.getOnboarding("abc");
    expect(calls[0].url).toContain("/coach/customers/abc/onboarding");
  });

  it("saveOnboarding PATCHes the steps array (C24)", async () => {
    stubFetch({ checklist: { steps: [{ key: "a", done: true }] } });
    const steps = [{ key: "a", done: true }, { key: "b", done: false }];
    const r = await coachB3Api.saveOnboarding("abc", steps);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toEqual({ steps });
    expect(r.checklist.steps).toHaveLength(1);
  });

  it("missedCheckins hits GET /coach/missed-checkins?days= (C25)", async () => {
    stubFetch({ missed: [] });
    await coachB3Api.missedCheckins(7);
    expect(calls[0].url).toContain("/coach/missed-checkins?days=7");
  });

  it("getAvailability hits GET /coach/availability (C26)", async () => {
    stubFetch({ availability: null });
    const r = await coachB3Api.getAvailability();
    expect(calls[0].url).toContain("/coach/availability");
    expect(r.availability).toBeNull();
  });

  it("setAvailability PUTs status + note (C26)", async () => {
    stubFetch({ availability: { status: "on_leave" } });
    await coachB3Api.setAvailability("on_leave", "Back Monday");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({ status: "on_leave", note: "Back Monday" });
  });

  it("adherenceDetail hits GET /coach/customers/:id/adherence-detail (C27)", async () => {
    stubFetch({ detail: [] });
    await coachB3Api.adherenceDetail("abc");
    expect(calls[0].url).toContain("/coach/customers/abc/adherence-detail");
  });
});
