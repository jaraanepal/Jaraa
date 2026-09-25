// Batch-2 client API contract tests: new endpoints hit the right URLs with the
// right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { meApi, shopApi, coachApi } from "../api/client";

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
        text: async () => JSON.stringify({ ok: true, badges: [], articles: [], versions: [] }),
      };
    }),
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("batch-2 customer API", () => {
  it("getMyBadges hits GET /me/badges (C11)", async () => {
    stubFetch();
    await meApi.getMyBadges();
    expect(calls[0].url).toContain("/me/badges");
    expect(calls[0].method).toBe("GET");
  });

  it("getAssignedArticles hits GET /me/articles/assigned (C18)", async () => {
    stubFetch();
    await meApi.getAssignedArticles();
    expect(calls[0].url).toContain("/me/articles/assigned");
  });

  it("setWater posts glasses for the day (U14)", async () => {
    stubFetch();
    await meApi.setWater("2026-09-25", 6);
    expect(calls[0].url).toContain("/me/water");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ log_date: "2026-09-25", glasses: 6 });
  });

  it("notification prefs PUT sends the toggles (U17)", async () => {
    stubFetch();
    await meApi.setNotificationPrefs({ photo_requests: false, digest: true } as never);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toMatchObject({ photo_requests: false, digest: true });
  });
});

describe("batch-2 shop/pharmacy API", () => {
  it("createOrder includes coupon_code + delivery_instructions", async () => {
    stubFetch();
    await shopApi.createOrder({
      kit_id: "k1", payment_method: "cod",
      shipping_address: { name: "T", phone: "9", city: "K", address_line: "X" },
      coupon_code: "SAVE10", delivery_instructions: "Ring twice",
    }, "test-key-1");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ coupon_code: "SAVE10", delivery_instructions: "Ring twice" });
  });

  it("updateKitBatch PATCHes the batch (P17)", async () => {
    stubFetch();
    await shopApi.updateBatch("b1", { qty: 5 });
    expect(calls[0].url).toContain("/pharmacy/batches/b1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ qty: 5 });
  });
});

describe("batch-2 coach API", () => {
  it("updateHabitTemplate PATCHes the template (C14)", async () => {
    stubFetch();
    await coachApi.updateHabitTemplate("h1", { title_en: "Evening oil" });
    expect(calls[0].url).toContain("/coach/habit-templates/h1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ title_en: "Evening oil" });
  });

  it("updateNoteTemplate PATCHes the template (C16)", async () => {
    stubFetch();
    await coachApi.updateNoteTemplate("n1", { body_en: "New body" });
    expect(calls[0].url).toContain("/coach/note-templates/n1");
    expect(calls[0].method).toBe("PATCH");
  });
});
