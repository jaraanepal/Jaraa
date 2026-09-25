import { describe, expect, it } from "vitest";
import { adherence14, checkinDays } from "../pages/Progress";
import type { Checkin } from "../api/types";

const DAY_MS = 86400000;

function checkinAt(msAgo: number): Checkin {
  return {
    id: `c-${msAgo}`,
    user_id: "u1",
    plan_id: null,
    shedding_estimate: null,
    note: null,
    photo_ids: [],
    created_at: new Date(Date.now() - msAgo).toISOString(),
  };
}

describe("adherence14 / checkinDays (C2 coach adherence, U2/U10 habits)", () => {
  it("empty check-ins → 0% adherence", () => {
    expect(adherence14([])).toBe(0);
    expect(checkinDays([]).size).toBe(0);
  });

  it("one check-in today → 1/14 adherence", () => {
    expect(adherence14([checkinAt(0)])).toBeCloseTo((1 / 14) * 100, 6);
  });

  it("14 consecutive days → 100%", () => {
    const list = Array.from({ length: 14 }, (_, i) => checkinAt(i * DAY_MS));
    expect(checkinDays(list).size).toBe(14);
    expect(adherence14(list)).toBeCloseTo(100, 6);
  });

  it("check-ins older than 14 days do not count", () => {
    const list = [checkinAt(20 * DAY_MS), checkinAt(30 * DAY_MS)];
    expect(adherence14(list)).toBe(0);
  });

  it("multiple check-ins on one day count once", () => {
    const list = [checkinAt(0), checkinAt(60_000), checkinAt(120_000)];
    expect(checkinDays(list).size).toBe(1);
    expect(adherence14(list)).toBeCloseTo((1 / 14) * 100, 6);
  });
});
