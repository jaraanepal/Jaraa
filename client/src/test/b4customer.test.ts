// Batch-4 (010) customer API contract tests: customerB4Api hits the right
// URLs with the right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { customerB4Api } from "../api/b4customer";

const calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch() {
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
        text: async () => JSON.stringify({ ok: true, days: 0, reminders: [], usages: [], sessions: [], suggestions: [], consents: [] }),
      };
    }),
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("b4 customer API (U30–U47 + C28/C45)", () => {
  it("savePreferences PATCHes /me/profile with the preference fields (U30/U46)", async () => {
    stubFetch();
    await customerB4Api.savePreferences({ content_language: "en", default_payment: "khalti" });
    expect(calls[0].url).toContain("/me/profile");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toEqual({ content_language: "en", default_payment: "khalti" });
  });

  it("getStreak hits GET /me/streak (U31)", async () => {
    stubFetch();
    await customerB4Api.getStreak();
    expect(calls[0].url).toContain("/me/streak");
    expect(calls[0].method).toBe("GET");
  });

  it("getReferrals hits GET /me/referrals (U32)", async () => {
    stubFetch();
    await customerB4Api.getReferrals();
    expect(calls[0].url).toContain("/me/referrals");
    expect(calls[0].method).toBe("GET");
  });

  it("listConsents hits GET /me/consents (U36)", async () => {
    stubFetch();
    await customerB4Api.listConsents();
    expect(calls[0].url).toContain("/me/consents");
    expect(calls[0].method).toBe("GET");
  });

  it("postFeedback posts rating + message (U37)", async () => {
    stubFetch();
    await customerB4Api.postFeedback(5, "Great app");
    expect(calls[0].url).toContain("/me/feedback");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ rating: 5, message: "Great app" });
  });

  it("postFeedback sends null message when omitted (U37)", async () => {
    stubFetch();
    await customerB4Api.postFeedback(3);
    expect(calls[0].body).toMatchObject({ rating: 3, message: null });
  });

  it("listKitReminders hits GET /me/kit-reminders (U40)", async () => {
    stubFetch();
    await customerB4Api.listKitReminders();
    expect(calls[0].url).toContain("/me/kit-reminders");
    expect(calls[0].method).toBe("GET");
  });

  it("createKitReminder posts label + remind_at (U40)", async () => {
    stubFetch();
    await customerB4Api.createKitReminder({ label_en: "Apply oil", remind_at: "2026-09-26T12:00:00.000Z" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ label_en: "Apply oil", remind_at: "2026-09-26T12:00:00.000Z", kit_id: null });
  });

  it("setKitReminderDone PATCHes the done flag (U40)", async () => {
    stubFetch();
    await customerB4Api.setKitReminderDone("r-1", true);
    expect(calls[0].url).toContain("/me/kit-reminders/r-1/done");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toEqual({ done: true });
  });

  it("deleteKitReminder DELETEs the reminder (U40)", async () => {
    stubFetch();
    await customerB4Api.deleteKitReminder("r-1");
    expect(calls[0].url).toContain("/me/kit-reminders/r-1");
    expect(calls[0].method).toBe("DELETE");
  });

  it("getReorderSuggestions hits GET /me/reorder-suggestions (U41)", async () => {
    stubFetch();
    await customerB4Api.getReorderSuggestions();
    expect(calls[0].url).toContain("/me/reorder-suggestions");
    expect(calls[0].method).toBe("GET");
  });

  it("logKitUsage posts the note (U42)", async () => {
    stubFetch();
    await customerB4Api.logKitUsage({ note: "Evening oil" });
    expect(calls[0].url).toContain("/me/kit-usages");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ note: "Evening oil", kit_id: null });
  });

  it("listKitUsages passes a clamped limit (U42)", async () => {
    stubFetch();
    await customerB4Api.listKitUsages(500);
    expect(calls[0].url).toContain("/me/kit-usages?limit=100");
  });

  it("listSessions hits GET /me/sessions (U45)", async () => {
    stubFetch();
    await customerB4Api.listSessions();
    expect(calls[0].url).toContain("/me/sessions");
    expect(calls[0].method).toBe("GET");
  });

  it("getCertificate hits the customer certificate route (C28)", async () => {
    stubFetch();
    await customerB4Api.getCertificate("a-1");
    expect(calls[0].url).toContain("/me/challenges/assignments/a-1/certificate");
    expect(calls[0].method).toBe("GET");
  });

  it("submitChallengeSurvey posts rating + text (C45)", async () => {
    stubFetch();
    await customerB4Api.submitChallengeSurvey("a-1", 4, "Good");
    expect(calls[0].url).toContain("/me/challenges/a-1/survey");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ q1_rating: 4, q2_text: "Good" });
  });
});
