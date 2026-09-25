// Batch-3 pharmacy client API contract tests: new endpoints hit the right URLs
// with the right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { pharmacyB3Api } from "../api/b3pharmacy";

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

describe("pharmacyB3Api — quarantine (P19)", () => {
  it("listQuarantine hits GET /pharmacy/quarantine with optional status filter", async () => {
    stubFetch();
    await pharmacyB3Api.listQuarantine();
    expect(calls[0].url).toContain("/pharmacy/quarantine");
    expect(calls[0].method).toBe("GET");

    stubFetch();
    await pharmacyB3Api.listQuarantine("released");
    expect(calls[0].url).toContain("status=released");
  });

  it("createQuarantine posts the entry (P19)", async () => {
    stubFetch();
    await pharmacyB3Api.createQuarantine({ kit_id: "k1", qty: 2, reason: "torn box" });
    expect(calls[0].url).toContain("/pharmacy/quarantine");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ kit_id: "k1", qty: 2, reason: "torn box" });
  });

  it("setQuarantineStatus PATCHes the status (P19)", async () => {
    stubFetch();
    await pharmacyB3Api.setQuarantineStatus("q1", "written_off");
    expect(calls[0].url).toContain("/pharmacy/quarantine/q1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ status: "written_off" });
  });
});

describe("pharmacyB3Api — shift, couriers, returns (P20–P22)", () => {
  it("getShiftSummary hits GET /pharmacy/shift-summary with the date (P20)", async () => {
    stubFetch();
    await pharmacyB3Api.getShiftSummary("2026-09-25");
    expect(calls[0].url).toContain("/pharmacy/shift-summary");
    expect(calls[0].url).toContain("date=2026-09-25");
  });

  it("getCourierPerformance hits GET /pharmacy/couriers/performance (P21)", async () => {
    stubFetch();
    await pharmacyB3Api.getCourierPerformance();
    expect(calls[0].url).toContain("/pharmacy/couriers/performance");
  });

  it("getReturnAnalytics hits GET /pharmacy/returns/analytics (P22)", async () => {
    stubFetch();
    await pharmacyB3Api.getReturnAnalytics();
    expect(calls[0].url).toContain("/pharmacy/returns/analytics");
  });
});

describe("pharmacyB3Api — pack timer (P23)", () => {
  it("packStart / packComplete POST to the order timer endpoints", async () => {
    stubFetch();
    await pharmacyB3Api.packStart("JR-1");
    expect(calls[0].url).toContain("/pharmacy/orders/JR-1/pack-start");
    expect(calls[0].method).toBe("POST");

    stubFetch();
    await pharmacyB3Api.packComplete("JR-1");
    expect(calls[0].url).toContain("/pharmacy/orders/JR-1/pack-complete");
    expect(calls[0].method).toBe("POST");
  });
});

describe("pharmacyB3Api — packaging CRUD (P24)", () => {
  it("list/create/update/delete hit the right URLs and methods", async () => {
    stubFetch();
    await pharmacyB3Api.listPackaging();
    expect(calls[0].url).toContain("/pharmacy/packaging");
    expect(calls[0].method).toBe("GET");

    stubFetch();
    await pharmacyB3Api.createPackaging({ name: "Mailer box", qty: 50, unit: "pcs", low_threshold: 10 });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ name: "Mailer box", qty: 50, low_threshold: 10 });

    stubFetch();
    await pharmacyB3Api.updatePackaging("m1", { qty: 45 });
    expect(calls[0].url).toContain("/pharmacy/packaging/m1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ qty: 45 });

    stubFetch();
    await pharmacyB3Api.deletePackaging("m1");
    expect(calls[0].url).toContain("/pharmacy/packaging/m1");
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("pharmacyB3Api — COD reconciliation (P25)", () => {
  it("getCodReconciliation hits GET /pharmacy/cod-reconciliation with the date", async () => {
    stubFetch();
    await pharmacyB3Api.getCodReconciliation("2026-09-25");
    expect(calls[0].url).toContain("/pharmacy/cod-reconciliation");
    expect(calls[0].url).toContain("date=2026-09-25");
    expect(calls[0].method).toBe("GET");
  });
});

describe("pharmacyB3Api — threshold (P26) and notes (P27)", () => {
  it("setKitThreshold PATCHes the threshold (P26)", async () => {
    stubFetch();
    await pharmacyB3Api.setKitThreshold("k1", 3);
    expect(calls[0].url).toContain("/pharmacy/kits/k1/threshold");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ threshold: 3 });
  });

  it("listOrderNotes / addOrderNote hit the notes endpoints (P27)", async () => {
    stubFetch();
    await pharmacyB3Api.listOrderNotes("JR-1");
    expect(calls[0].url).toContain("/pharmacy/orders/JR-1/notes");
    expect(calls[0].method).toBe("GET");

    stubFetch();
    await pharmacyB3Api.addOrderNote("JR-1", "call before noon");
    expect(calls[0].url).toContain("/pharmacy/orders/JR-1/notes");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ note: "call before noon" });
  });
});
