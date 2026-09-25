// Batch-4 admin client API contract tests: adminB4Api hits the right URLs
// with the right methods/payloads (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminB4Api } from "../api/b4admin";

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

describe("A30 dashboard configs", () => {
  it("getDashboardConfig hits GET /admin/dashboard-config/:role", async () => {
    stubFetch();
    await adminB4Api.getDashboardConfig("doctor");
    expect(calls[0].url).toContain("/admin/dashboard-config/doctor");
    expect(calls[0].method).toBe("GET");
  });
  it("setDashboardConfig PUTs the config object", async () => {
    stubFetch();
    await adminB4Api.setDashboardConfig("admin", { hiddenCards: ["audit"] });
    expect(calls[0].url).toContain("/admin/dashboard-config/admin");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toMatchObject({ config: { hiddenCards: ["audit"] } });
  });
});

describe("A31/A32/A46 analytics", () => {
  it("courierPerformance hits GET /admin/couriers/performance", async () => {
    stubFetch();
    await adminB4Api.courierPerformance();
    expect(calls[0].url).toContain("/admin/couriers/performance");
    expect(calls[0].method).toBe("GET");
  });
  it("returnsAnalytics hits GET /admin/returns/analytics", async () => {
    stubFetch();
    await adminB4Api.returnsAnalytics();
    expect(calls[0].url).toContain("/admin/returns/analytics");
    expect(calls[0].method).toBe("GET");
  });
  it("refundsAnalytics hits GET /admin/refunds/analytics", async () => {
    stubFetch();
    await adminB4Api.refundsAnalytics();
    expect(calls[0].url).toContain("/admin/refunds/analytics");
    expect(calls[0].method).toBe("GET");
  });
});

describe("A33 verification expiry", () => {
  it("expiringVerifications passes days", async () => {
    stubFetch();
    await adminB4Api.expiringVerifications(14);
    expect(calls[0].url).toContain("/admin/verifications/expiring?days=14");
    expect(calls[0].method).toBe("GET");
  });
  it("setVerificationExpiry PATCHes expires_at", async () => {
    stubFetch();
    await adminB4Api.setVerificationExpiry("v1", "2026-12-01T00:00:00.000Z");
    expect(calls[0].url).toContain("/admin/verifications/v1/expiry");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ expires_at: "2026-12-01T00:00:00.000Z" });
  });
});

describe("A34/A35/A36", () => {
  it("ticketSla hits GET /admin/tickets/sla", async () => {
    stubFetch();
    await adminB4Api.ticketSla();
    expect(calls[0].url).toContain("/admin/tickets/sla");
  });
  it("flagHistory passes limit", async () => {
    stubFetch();
    await adminB4Api.flagHistory(50);
    expect(calls[0].url).toContain("/admin/flags/history?limit=50");
  });
  it("bulkSetUserStatus POSTs ids + disabled", async () => {
    stubFetch();
    await adminB4Api.bulkSetUserStatus(["u1", "u2"], true);
    expect(calls[0].url).toContain("/admin/users/bulk-status");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ ids: ["u1", "u2"], disabled: true });
  });
});

describe("A37/A38/A39/A40/A41/A42", () => {
  it("emailLogs passes limit", async () => {
    stubFetch();
    await adminB4Api.emailLogs(25);
    expect(calls[0].url).toContain("/admin/email-logs?limit=25");
  });
  it("deletionRequests hits GET /admin/deletion-requests", async () => {
    stubFetch();
    await adminB4Api.deletionRequests();
    expect(calls[0].url).toContain("/admin/deletion-requests");
  });
  it("referralStats hits GET /admin/referrals", async () => {
    stubFetch();
    await adminB4Api.referralStats();
    expect(calls[0].url).toContain("/admin/referrals");
  });
  it("challengeAnalytics hits GET /admin/challenges/analytics", async () => {
    stubFetch();
    await adminB4Api.challengeAnalytics();
    expect(calls[0].url).toContain("/admin/challenges/analytics");
  });
  it("coachPerformance hits GET /admin/coaches/performance", async () => {
    stubFetch();
    await adminB4Api.coachPerformance();
    expect(calls[0].url).toContain("/admin/coaches/performance");
  });
  it("pharmacyPerformance hits GET /admin/pharmacy/performance", async () => {
    stubFetch();
    await adminB4Api.pharmacyPerformance();
    expect(calls[0].url).toContain("/admin/pharmacy/performance");
  });
});

describe("A43/A44/A45/A47", () => {
  it("scheduleAnnouncement POSTs publish_at", async () => {
    stubFetch();
    await adminB4Api.scheduleAnnouncement("a1", "2026-10-01T08:00:00.000Z");
    expect(calls[0].url).toContain("/admin/announcements/a1/schedule");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ publish_at: "2026-10-01T08:00:00.000Z" });
  });
  it("adminNotices / createAdminNotice / markAdminNoticeRead", async () => {
    stubFetch();
    await adminB4Api.adminNotices();
    expect(calls[0].url).toContain("/admin/notices");
    stubFetch();
    await adminB4Api.createAdminNotice({ title_en: "Hi" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ title_en: "Hi" });
    stubFetch();
    await adminB4Api.markAdminNoticeRead("n1");
    expect(calls[0].url).toContain("/admin/notices/n1/read");
    expect(calls[0].method).toBe("POST");
  });
  it("consentVersions passes kind; create + activate", async () => {
    stubFetch();
    await adminB4Api.consentVersions("signup");
    expect(calls[0].url).toContain("/admin/consents/versions?kind=signup");
    stubFetch();
    await adminB4Api.createConsentVersion({ kind: "signup", version: 3, text_en: "t" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({ kind: "signup", version: 3 });
    stubFetch();
    await adminB4Api.activateConsentVersion("c9");
    expect(calls[0].url).toContain("/admin/consents/versions/c9/activate");
    expect(calls[0].method).toBe("POST");
  });
  it("opsDigest hits GET /admin/digest", async () => {
    stubFetch();
    await adminB4Api.opsDigest();
    expect(calls[0].url).toContain("/admin/digest");
    expect(calls[0].method).toBe("GET");
  });
});
