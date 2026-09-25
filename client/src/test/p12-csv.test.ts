import { describe, expect, it } from "vitest";
import { ordersToCsv } from "../lib/ordersCsv";

describe("ordersToCsv (A9 admin CSV export)", () => {
  it("emits the header row first", () => {
    const csv = ordersToCsv([]);
    expect(csv).toBe(`"order_id","status","total_npr","payment_method","created_at"`);
  });

  it("serializes order fields in order", () => {
    const csv = ordersToCsv([
      { id: "JR-1", status: "delivered", total_npr: 2500, payment_method: "cod", created_at: "2026-09-20T10:00:00Z" },
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(`"JR-1","delivered","2500","cod","2026-09-20T10:00:00Z"`);
  });

  it("escapes embedded quotes and commas safely", () => {
    const csv = ordersToCsv([
      { id: 'JR-"2"', status: "paid", total_npr: 999, payment_method: null, created_at: "2026-09-21T00:00:00Z" },
    ]);
    expect(csv.split("\n")[1]).toBe(`"JR-""2""","paid","999","","2026-09-21T00:00:00Z"`);
  });
});
