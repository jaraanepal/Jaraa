// Batch-3 (009) customer API contract tests: customerB3Api hits the right
// URLs with the right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { customerB3Api } from "../api/b3customer";

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
        text: async () => JSON.stringify({ ok: true, messages: [], tips: [], history: [] }),
      };
    }),
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("b3 customer API (U21–U29)", () => {
  it("listMyCases hits GET /me/cases (U21)", async () => {
    stubFetch();
    await customerB3Api.listMyCases();
    expect(calls[0].url).toContain("/me/cases");
    expect(calls[0].method).toBe("GET");
  });

  it("listCaseMessages hits GET /me/cases/:id/messages (U21)", async () => {
    stubFetch();
    await customerB3Api.listCaseMessages("case-1");
    expect(calls[0].url).toContain("/me/cases/case-1/messages");
    expect(calls[0].method).toBe("GET");
  });

  it("postCaseMessage posts only the body — never a client role (U21)", async () => {
    stubFetch();
    await customerB3Api.postCaseMessage("case-1", "My question");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ body: "My question" });
    expect(calls[0].body).not.toHaveProperty("author_role");
  });

  it("createReviewRequest posts case_id + reason (U22)", async () => {
    stubFetch();
    await customerB3Api.createReviewRequest("case-1", "Follow up please");
    expect(calls[0].url).toContain("/me/review-requests");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ case_id: "case-1", reason: "Follow up please" });
  });

  it("listReviewRequests hits GET /me/review-requests (U22)", async () => {
    stubFetch();
    await customerB3Api.listReviewRequests();
    expect(calls[0].url).toContain("/me/review-requests");
    expect(calls[0].method).toBe("GET");
  });

  it("createCommunityTip posts title + body (U23)", async () => {
    stubFetch();
    await customerB3Api.createCommunityTip("My tip", "Oil twice a week.");
    expect(calls[0].url).toContain("/me/community-tips");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ title: "My tip", body: "Oil twice a week." });
  });

  it("adherenceHistory hits GET /me/adherence/history (U24)", async () => {
    stubFetch();
    await customerB3Api.adherenceHistory();
    expect(calls[0].url).toContain("/me/adherence/history");
    expect(calls[0].method).toBe("GET");
  });

  it("getLoyalty hits GET /me/loyalty (U25)", async () => {
    stubFetch();
    await customerB3Api.getLoyalty();
    expect(calls[0].url).toContain("/me/loyalty");
    expect(calls[0].method).toBe("GET");
  });

  it("reportOrderIssue posts subject + body to /me/orders/:id/issue (U27)", async () => {
    stubFetch();
    await customerB3Api.reportOrderIssue("order-1", "Damaged box", "Arrived crushed.");
    expect(calls[0].url).toContain("/me/orders/order-1/issue");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ subject: "Damaged box", body: "Arrived crushed." });
  });

  it("listRoutines hits GET /me/routines (U29)", async () => {
    stubFetch();
    await customerB3Api.listRoutines();
    expect(calls[0].url).toContain("/me/routines");
    expect(calls[0].method).toBe("GET");
  });

  it("leaderboard opt-in round-trips via GET/PUT (C19)", async () => {
    stubFetch();
    await customerB3Api.getLeaderboardOptIn();
    expect(calls[0].url).toContain("/me/leaderboard-opt-in");
    expect(calls[0].method).toBe("GET");

    stubFetch();
    await customerB3Api.setLeaderboardOptIn(true);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({ opt_in: true });
  });

  it("toGiftPayload maps gift form state to order payload fields (U26)", () => {
    const p = customerB3Api.toGiftPayload({
      recipient_name: "Sita", recipient_phone: "9841234567", message: "Get well soon",
    });
    expect(p).toEqual({
      gift_recipient_name: "Sita",
      gift_recipient_phone: "9841234567",
      gift_message: "Get well soon",
    });
  });
});
