/**
 * Batch-4 (010) doctorB4Api contract tests: every function hits the right
 * path with the right HTTP method (fetch is stubbed; no network).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { doctorB4Api, downloadOwnCasesCsv } from "../api/b4doctor";

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

describe("doctorB4Api (batch-4 doctor endpoints)", () => {
  it("shareSummary POSTs the summary to /doctor/cases/:id/share-summary", async () => {
    await doctorB4Api.shareSummary("case-1", "your hair needs rest");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/share-summary");
    expect(bodyOf(c)).toEqual({ summary: "your hair needs rest", summary_ne: null });
  });

  it("listPeers hits GET /doctor/peers", async () => {
    await doctorB4Api.listPeers();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/peers");
  });

  it("pauseSla hits POST /doctor/cases/:id/sla-pause", async () => {
    await doctorB4Api.pauseSla("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/sla-pause");
  });

  it("resumeSla hits POST /doctor/cases/:id/sla-resume", async () => {
    await doctorB4Api.resumeSla("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/sla-resume");
  });

  it("needsInfo hits GET /doctor/cases/:id/needs-info", async () => {
    await doctorB4Api.needsInfo("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/needs-info");
  });

  it("listComments hits GET /doctor/cases/:id/comments", async () => {
    await doctorB4Api.listComments("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/comments");
  });

  it("addComment POSTs the body to /doctor/cases/:id/comments", async () => {
    await doctorB4Api.addComment("case-1", "internal note");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/comments");
    expect(bodyOf(c)).toEqual({ body: "internal note" });
  });

  it("listConcerns hits GET /doctor/cases/:id/concerns", async () => {
    await doctorB4Api.listConcerns("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/concerns");
  });

  it("addConcern POSTs the tag with URL-encoded case id", async () => {
    await doctorB4Api.addConcern("case/1", "follow_up_needed");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case%2F1/concerns");
    expect(bodyOf(c)).toEqual({ tag: "follow_up_needed" });
  });

  it("removeConcern DELETEs with the tag in the body", async () => {
    await doctorB4Api.removeConcern("case-1", "follow_up_needed");
    const c = lastCall();
    expect(methodOf(c)).toBe("DELETE");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/concerns");
    expect(bodyOf(c)).toEqual({ tag: "follow_up_needed" });
  });

  it("priorityHistory hits GET /doctor/cases/:id/priority-history", async () => {
    await doctorB4Api.priorityHistory("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/priority-history");
  });

  it("digest hits GET /doctor/digest", async () => {
    await doctorB4Api.digest();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/digest");
  });

  it("similarCases hits GET /doctor/cases/:id/similar", async () => {
    await doctorB4Api.similarCases("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/similar");
  });

  it("listQueueFilters hits GET /doctor/queue-filters", async () => {
    await doctorB4Api.listQueueFilters();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/queue-filters");
  });

  it("createQueueFilter POSTs name + payload", async () => {
    await doctorB4Api.createQueueFilter("red flags only", { sort: "priority", red_flag_only: true });
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/queue-filters");
    expect(bodyOf(c)).toEqual({ name: "red flags only", filters: { sort: "priority", red_flag_only: true } });
  });

  it("deleteQueueFilter DELETEs the filter id", async () => {
    await doctorB4Api.deleteQueueFilter("filter-9");
    const c = lastCall();
    expect(methodOf(c)).toBe("DELETE");
    expect(c.url).toBe("/api/v1/doctor/queue-filters/filter-9");
  });

  it("listMessages hits GET /doctor/cases/:id/messages", async () => {
    await doctorB4Api.listMessages("case-1");
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/messages");
  });

  it("sendMessage POSTs the reply body", async () => {
    await doctorB4Api.sendMessage("case-1", "please resend a clear photo");
    const c = lastCall();
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe("/api/v1/doctor/cases/case-1/messages");
    expect(bodyOf(c)).toEqual({ body: "please resend a clear photo" });
  });

  it("listArticles hits GET /doctor/articles", async () => {
    await doctorB4Api.listArticles();
    const c = lastCall();
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe("/api/v1/doctor/articles");
  });
});

describe("downloadOwnCasesCsv (D43)", () => {
  it("fetches the CSV endpoint and triggers a download", async () => {
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" });
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push({ url, init: {} });
        return { ok: true, status: 200, blob: async () => blob };
      }),
    );
    const createUrl = vi.fn(() => "blob:mock");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });

    const clicked: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, ...rest: unknown[]) => {
      const el = realCreate(tag, ...(rest as []));
      if (tag === "a") {
        el.click = () => {
          clicked.push(el as HTMLAnchorElement);
        };
      }
      return el;
    }) as typeof document.createElement);

    await downloadOwnCasesCsv();

    const c = lastCall();
    expect(c.url).toBe("/api/v1/doctor/cases/export.csv");
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("my-reviewed-cases.csv");
    expect(revokeUrl).toHaveBeenCalledWith("blob:mock");
  });

  it("throws when the export request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 })),
    );
    await expect(downloadOwnCasesCsv()).rejects.toThrow("Export failed (403)");
  });
});
