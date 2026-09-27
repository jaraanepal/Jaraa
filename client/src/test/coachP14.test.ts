/**
 * Problem 4 (v14) coachP14Api contract tests: every helper hits the right
 * path with the right HTTP method and payload (fetch is stubbed; no network).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coachP14Api } from "../pages/coach/coachP14";

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
      const u = String(url);
      const json = (body: unknown, status = 200) => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      });
      if (method === "DELETE") return json(undefined, 204);
      if (u.includes("/coach/nudges/scheduled") && method === "POST" && !u.includes("/send")) {
        return json({ nudge: { id: "n1", sent_at: null } });
      }
      return json({ ok: true });
    }),
  );
}

beforeEach(() => {
  stubFetch();
});

function methodOf(c: Call): string {
  return ((c.init.method as string) ?? "GET").toUpperCase();
}

function bodyOf(c: Call): Record<string, unknown> {
  return JSON.parse(c.init.body as string) as Record<string, unknown>;
}

const A = "/api/v1";

describe("coachP14Api (v14 coach workflow)", () => {
  it("listCustomers GETs /coach/customers", async () => {
    await coachP14Api.listCustomers();
    const c = calls[calls.length - 1];
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/customers`);
  });

  it("listCustomers passes ?q=", async () => {
    await coachP14Api.listCustomers("ram");
    expect(calls[calls.length - 1].url).toBe(`${A}/coach/customers?q=ram`);
  });

  it("assignCustomer POSTs /coach/customers/:id/assign", async () => {
    await coachP14Api.assignCustomer("c1");
    const c = calls[calls.length - 1];
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe(`${A}/coach/customers/c1/assign`);
    expect(bodyOf(c)).toEqual({});
  });

  it("assignCustomer forwards coach_id when given (admin path)", async () => {
    await coachP14Api.assignCustomer("c1", "coach9");
    expect(bodyOf(calls[calls.length - 1])).toEqual({ coach_id: "coach9" });
  });

  it("unassignCustomer DELETEs /coach/customers/:id/assign", async () => {
    await coachP14Api.unassignCustomer("c1");
    const c = calls[calls.length - 1];
    expect(methodOf(c)).toBe("DELETE");
    expect(c.url).toBe(`${A}/coach/customers/c1/assign`);
  });

  it("listCustomerChallenges GETs /coach/customers/:id/challenges", async () => {
    await coachP14Api.listCustomerChallenges("c1");
    const c = calls[calls.length - 1];
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/customers/c1/challenges`);
  });

  it("listCustomerFollowups GETs /coach/customers/:id/followups", async () => {
    await coachP14Api.listCustomerFollowups("c1");
    const c = calls[calls.length - 1];
    expect(methodOf(c)).toBe("GET");
    expect(c.url).toBe(`${A}/coach/customers/c1/followups`);
  });

  it("scheduleFollowup POSTs date + note", async () => {
    await coachP14Api.scheduleFollowup("c1", { scheduled_for: "2030-01-01T10:00:00Z", note: "check routine" });
    const c = calls[calls.length - 1];
    expect(methodOf(c)).toBe("POST");
    expect(c.url).toBe(`${A}/coach/customers/c1/followups`);
    expect(bodyOf(c)).toEqual({ scheduled_for: "2030-01-01T10:00:00Z", note: "check routine" });
  });

  it("listFollowups GETs /coach/followups with optional ?status=", async () => {
    await coachP14Api.listFollowups();
    expect(calls[calls.length - 1].url).toBe(`${A}/coach/followups`);
    await coachP14Api.listFollowups("completed");
    expect(calls[calls.length - 1].url).toBe(`${A}/coach/followups?status=completed`);
  });

  it("completeFollowup PATCHes /coach/followups/:id/complete", async () => {
    await coachP14Api.completeFollowup("f1");
    const c = calls[calls.length - 1];
    expect(methodOf(c)).toBe("PATCH");
    expect(c.url).toBe(`${A}/coach/followups/f1/complete`);
  });

  it("sendNudgeNow schedules then immediately sends", async () => {
    await coachP14Api.sendNudgeNow("c1", "Keep going!");
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(methodOf(first)).toBe("POST");
    expect(first.url).toBe(`${A}/coach/nudges/scheduled`);
    const b = bodyOf(first);
    expect(b.user_id).toBe("c1");
    expect(b.message_en).toBe("Keep going!");
    expect(typeof b.send_at).toBe("string");
    expect(methodOf(second)).toBe("POST");
    expect(second.url).toBe(`${A}/coach/nudges/scheduled/n1/send`);
  });
});
