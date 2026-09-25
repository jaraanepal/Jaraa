// Batch-3 admin client API contract tests: adminB3Api hits the right URLs
// with the right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminB3Api } from "../api/b3admin";

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
        text: async () => JSON.stringify({ ok: true }),
      };
    }),
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("A21 disputes API", () => {
  it("listDisputes hits GET /admin/disputes?status=", async () => {
    stubFetch();
    await adminB3Api.listDisputes("open");
    expect(calls[0].url).toContain("/admin/disputes?status=open");
    expect(calls[0].method).toBe("GET");
  });

  it("resolveDispute POSTs resolution + approved", async () => {
    stubFetch();
    await adminB3Api.resolveDispute("d1", { resolution: "Refunded.", approved: true });
    expect(calls[0].url).toContain("/admin/disputes/d1/resolve");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ resolution: "Refunded.", approved: true });
  });

  it("getDispute hits GET /admin/disputes/:id", async () => {
    stubFetch();
    await adminB3Api.getDispute("d9");
    expect(calls[0].url).toContain("/admin/disputes/d9");
    expect(calls[0].method).toBe("GET");
  });
});

describe("A22 payouts API", () => {
  it("payouts hits GET /admin/payouts?month=", async () => {
    stubFetch();
    await adminB3Api.payouts("2026-09");
    expect(calls[0].url).toContain("/admin/payouts?month=2026-09");
    expect(calls[0].method).toBe("GET");
  });
});

describe("A23 moderation API", () => {
  it("decideTip POSTs approved", async () => {
    stubFetch();
    await adminB3Api.decideTip("t1", false);
    expect(calls[0].url).toContain("/admin/moderation/t1/decide");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ approved: false });
  });

  it("moderationQueue hits GET /admin/moderation", async () => {
    stubFetch();
    await adminB3Api.moderationQueue();
    expect(calls[0].url).toContain("/admin/moderation");
    expect(calls[0].method).toBe("GET");
  });
});

describe("A24 plan templates API", () => {
  it("listPlanTemplates appends ?activeOnly=true when asked", async () => {
    stubFetch();
    await adminB3Api.listPlanTemplates(true);
    expect(calls[0].url).toContain("/admin/plan-templates?activeOnly=true");
    stubFetch();
    await adminB3Api.listPlanTemplates();
    expect(calls[0].url).toContain("/admin/plan-templates");
    expect(calls[0].url).not.toContain("activeOnly");
  });

  it("create + update + delete use the right verbs", async () => {
    stubFetch();
    await adminB3Api.createPlanTemplate({ title_en: "T", items: [{ kind: "wash" }] });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ title_en: "T" });
    stubFetch();
    await adminB3Api.updatePlanTemplate("p1", { is_active: false });
    expect(calls[0].url).toContain("/admin/plan-templates/p1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ is_active: false });
    stubFetch();
    await adminB3Api.deletePlanTemplate("p1");
    expect(calls[0].url).toContain("/admin/plan-templates/p1");
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("A25/A26 stats API", () => {
  it("scanQuality hits GET /admin/scan-quality", async () => {
    stubFetch();
    await adminB3Api.scanQuality();
    expect(calls[0].url).toContain("/admin/scan-quality");
  });

  it("kitLeaderboard hits GET /admin/kits/leaderboard", async () => {
    stubFetch();
    await adminB3Api.kitLeaderboard();
    expect(calls[0].url).toContain("/admin/kits/leaderboard");
  });
});

describe("A27 export schedules API", () => {
  it("create + update + delete use the right verbs", async () => {
    stubFetch();
    await adminB3Api.createExportSchedule({ frequency: "daily" });
    expect(calls[0].url).toContain("/admin/export-schedules");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ frequency: "daily" });
    stubFetch();
    await adminB3Api.updateExportSchedule("s1", { frequency: "weekly" });
    expect(calls[0].method).toBe("PATCH");
    stubFetch();
    await adminB3Api.deleteExportSchedule("s1");
    expect(calls[0].method).toBe("DELETE");
  });
});

describe("A28 staff checklist API", () => {
  it("saveStaffChecklist PATCHes the items", async () => {
    stubFetch();
    await adminB3Api.saveStaffChecklist("u1", [{ key: "docs_verified", done: true }]);
    expect(calls[0].url).toContain("/admin/staff/u1/checklist");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ items: [{ key: "docs_verified", done: true }] });
  });

  it("getStaffChecklist hits GET", async () => {
    stubFetch();
    await adminB3Api.getStaffChecklist("u1");
    expect(calls[0].url).toContain("/admin/staff/u1/checklist");
    expect(calls[0].method).toBe("GET");
  });
});
