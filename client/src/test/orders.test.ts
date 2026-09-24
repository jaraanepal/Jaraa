import { describe, expect, it } from "vitest";
import { orderTimeline } from "../lib/orders";
import type { OrderStatus } from "../api/types";

describe("orderTimeline", () => {
  it("maps pending_payment and paid to the placed step", () => {
    for (const s of ["pending_payment", "paid"] as OrderStatus[]) {
      const tl = orderTimeline(s);
      expect(tl.terminal).toBeNull();
      expect(tl.steps.map((x) => x.key)).toEqual(["placed", "packed", "shipped", "delivered"]);
      expect(tl.steps[0].state).toBe("current");
      expect(tl.steps.slice(1).map((x) => x.state)).toEqual(["todo", "todo", "todo"]);
    }
  });

  it("marks earlier steps done and later steps todo", () => {
    const tl = orderTimeline("shipped");
    expect(tl.steps.map((x) => x.state)).toEqual(["done", "done", "current", "todo"]);
  });

  it("marks every step done for delivered", () => {
    const tl = orderTimeline("delivered");
    expect(tl.steps.every((x) => x.state === "done")).toBe(true);
  });

  it("treats cancelled and refunded as terminal with no steps", () => {
    expect(orderTimeline("cancelled")).toEqual({ terminal: "cancelled", steps: [] });
    expect(orderTimeline("refunded")).toEqual({ terminal: "refunded", steps: [] });
  });

  it("covers every OrderStatus", () => {
    const all: OrderStatus[] = ["pending_payment", "paid", "packed", "shipped", "delivered", "cancelled", "refunded"];
    for (const s of all) {
      const tl = orderTimeline(s);
      expect(tl.steps.length === 0 || tl.steps.length === 4).toBe(true);
    }
  });
});
