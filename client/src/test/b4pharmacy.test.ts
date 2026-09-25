// Batch-4 (010) pharmacy client API contract tests: new endpoints hit the right
// URLs with the right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { pharmacyB4Api } from "../api/b4pharmacy";

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
        text: async () => JSON.stringify({}),
      };
    }),
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("pharmacyB4Api — re-verify + bulk status (P28/P29)", () => {
  it("reverifyChecks POSTs to /checks/reverify", async () => {
    stubFetch();
    await pharmacyB4Api.reverifyChecks("o1");
    expect(calls[0].url).toContain("/pharmacy/orders/o1/checks/reverify");
    expect(calls[0].method).toBe("POST");
  });

  it("bulkUpdateStatus posts ids + status", async () => {
    stubFetch();
    await pharmacyB4Api.bulkUpdateStatus(["o1", "o2"], "packed");
    expect(calls[0].url).toContain("/pharmacy/orders/bulk-status");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ ids: ["o1", "o2"], status: "packed" });
  });
});

describe("pharmacyB4Api — attempts + manifest (P31/P32)", () => {
  it("listAttempts hits GET /attempts", async () => {
    stubFetch();
    await pharmacyB4Api.listAttempts("o1");
    expect(calls[0].url).toContain("/pharmacy/orders/o1/attempts");
    expect(calls[0].method).toBe("GET");
  });

  it("createAttempt posts status + note", async () => {
    stubFetch();
    await pharmacyB4Api.createAttempt("o1", { status: "failed", note: "nobody home" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ status: "failed", note: "nobody home" });
  });

  it("getManifest passes courier + date as query params", async () => {
    stubFetch();
    await pharmacyB4Api.getManifest("Pathao", "2026-09-25");
    expect(calls[0].url).toContain("/pharmacy/manifest");
    expect(calls[0].url).toContain("courier=Pathao");
    expect(calls[0].url).toContain("date=2026-09-25");
    expect(calls[0].method).toBe("GET");
  });
});

describe("pharmacyB4Api — stock count + rush + expiry (P33/P34/P36)", () => {
  it("countStock posts counted_qty", async () => {
    stubFetch();
    await pharmacyB4Api.countStock("k1", 12);
    expect(calls[0].url).toContain("/pharmacy/kits/k1/count");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ counted_qty: 12 });
  });

  it("setRush PATCHes the rush flag", async () => {
    stubFetch();
    await pharmacyB4Api.setRush("o1", true);
    expect(calls[0].url).toContain("/pharmacy/orders/o1/rush");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ rush: true });
  });

  it("getExpiringBatches passes the days window", async () => {
    stubFetch();
    await pharmacyB4Api.getExpiringBatches(30);
    expect(calls[0].url).toContain("/pharmacy/batches/expiring");
    expect(calls[0].url).toContain("days=30");
  });
});

describe("pharmacyB4Api — substitutions + proof + announcements (P38/P39/P40)", () => {
  it("createSubstitution posts from/to/reason", async () => {
    stubFetch();
    await pharmacyB4Api.createSubstitution("o1", { from_kit_id: "k1", to_kit_id: "k2", reason: "OOS" });
    expect(calls[0].url).toContain("/pharmacy/orders/o1/substitutions");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ from_kit_id: "k1", to_kit_id: "k2", reason: "OOS" });
  });

  it("uploadProof posts multipart FormData with the photo", async () => {
    stubFetch();
    await pharmacyB4Api.uploadProof("o1", new Blob(["x"], { type: "image/jpeg" }), "left at door");
    expect(calls[0].url).toContain("/pharmacy/orders/o1/proof");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toBeInstanceOf(FormData);
  });

  it("getAnnouncements hits GET /pharmacy/announcements", async () => {
    stubFetch();
    await pharmacyB4Api.getAnnouncements();
    expect(calls[0].url).toContain("/pharmacy/announcements");
    expect(calls[0].method).toBe("GET");
  });
});

describe("pharmacyB4Api — search + refunds + holidays + claims (P42–P45)", () => {
  it("searchOrders passes q", async () => {
    stubFetch();
    await pharmacyB4Api.searchOrders("9841");
    expect(calls[0].url).toContain("/pharmacy/orders/search");
    expect(calls[0].url).toContain("q=9841");
  });

  it("createRefundRequest posts the reason", async () => {
    stubFetch();
    await pharmacyB4Api.createRefundRequest("o1", "damaged in transit");
    expect(calls[0].url).toContain("/pharmacy/orders/o1/refund-request");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ reason: "damaged in transit" });
  });

  it("decideRefundRequest PATCHes approved", async () => {
    stubFetch();
    await pharmacyB4Api.decideRefundRequest("r1", true);
    expect(calls[0].url).toContain("/pharmacy/refund-requests/r1/decide");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ approved: true });
  });

  it("createHoliday posts date + label; deleteHoliday DELETEs", async () => {
    stubFetch();
    await pharmacyB4Api.createHoliday({ date: "2026-10-20", label: "Dashain" });
    expect(calls[0].url).toContain("/pharmacy/holidays");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ date: "2026-10-20", label: "Dashain" });

    stubFetch();
    await pharmacyB4Api.deleteHoliday("h1");
    expect(calls[0].url).toContain("/pharmacy/holidays/h1");
    expect(calls[0].method).toBe("DELETE");
  });

  it("createCourierClaim posts the claim; setCourierClaimStatus PATCHes", async () => {
    stubFetch();
    await pharmacyB4Api.createCourierClaim({ courier_name: "Pathao", amount_npr: 500, reason: "box crushed" });
    expect(calls[0].url).toContain("/pharmacy/courier-claims");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ courier_name: "Pathao", amount_npr: 500 });

    stubFetch();
    await pharmacyB4Api.setCourierClaimStatus("c1", "settled");
    expect(calls[0].url).toContain("/pharmacy/courier-claims/c1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ status: "settled" });
  });
});
