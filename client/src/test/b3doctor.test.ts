/**
 * Batch-3 (009) doctorB3Api contract tests: every function hits the right
 * path with the right HTTP method (fetch is stubbed; no network).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { doctorB3Api } from "../api/b3doctor";

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

describe("doctorB3Api (batch-3 doctor endpoints)", () => {
  it("listAudit hits GET /doctor/audit with the limit", async () => {
    await doctorB3Api.listAudit(25);
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/audit?limit=25");
  });

  it("archiveCase hits PATCH /doctor/cases/:id/archive", async () => {
    await doctorB3Api.archiveCase("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("PATCH");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/archive");
  });

  it("listArchivedCases hits GET /doctor/cases/archived", async () => {
    await doctorB3Api.listArchivedCases();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/cases/archived");
  });

  it("requestSecondOpinion POSTs reviewer_id + note", async () => {
    await doctorB3Api.requestSecondOpinion("case-1", "doc-9", "please review");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/second-opinion");
    expect(bodyOf(c)).toEqual({ reviewer_id: "doc-9", note: "please review" });
  });

  it("listSecondOpinions hits GET /doctor/second-opinions", async () => {
    await doctorB3Api.listSecondOpinions();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/second-opinions");
  });

  it("decideSecondOpinion POSTs { accept } to /decide", async () => {
    await doctorB3Api.decideSecondOpinion("so-1", true);
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/second-opinions/so-1/decide");
    expect(bodyOf(c)).toEqual({ accept: true });
  });

  it("listFollowUpsRange builds the from/to query", async () => {
    await doctorB3Api.listFollowUpsRange("2026-01-01", "2026-01-31");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/follow-ups?from=2026-01-01&to=2026-01-31");
  });

  it("listTriagePresets hits GET /doctor/triage-presets", async () => {
    await doctorB3Api.listTriagePresets();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/triage-presets");
  });

  it("createTriagePreset POSTs name + priority", async () => {
    await doctorB3Api.createTriagePreset("urgent", 100);
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/triage-presets");
    expect(bodyOf(c)).toEqual({ name: "urgent", priority: 100 });
  });

  it("deleteTriagePreset hits DELETE /doctor/triage-presets/:id", async () => {
    const r = await doctorB3Api.deleteTriagePreset("tp-1");
    expect(r).toBeUndefined(); // 204 -> undefined
    const c = lastCall();
    expect(methodOf(c)).toBe("DELETE");
    expect(c.url).toBe("/api/v1/doctor/triage-presets/tp-1");
  });

  it("getPatientAdherence hits GET /doctor/patients/:userId/adherence", async () => {
    await doctorB3Api.getPatientAdherence("user-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/patients/user-1/adherence");
  });

  it("transferCase POSTs to_doctor_id + reason", async () => {
    await doctorB3Api.transferCase("case-1", "doc-9", "workload");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/transfer");
    expect(bodyOf(c)).toEqual({ to_doctor_id: "doc-9", reason: "workload" });
  });

  it("ids are URL-encoded", async () => {
    await doctorB3Api.archiveCase("case/1?x");
    expect(lastCall().url).toBe("/api/v1/doctor/cases/case%2F1%3Fx/archive");
  });
});
