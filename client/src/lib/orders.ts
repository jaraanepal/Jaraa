/**
 * Customer order timeline: placed -> packed -> shipped -> delivered.
 * Pure, unit-tested. `pending_payment` and `paid` both map to the
 * "placed" step (payment confirmed); cancelled/refunded are terminal.
 */
import type { OrderStatus } from "../api/types";

export type TimelineState = "done" | "current" | "todo";

export interface TimelineStep {
  /** i18n key suffix under ordersTimeline.* */
  key: "placed" | "packed" | "shipped" | "delivered";
  state: TimelineState;
}

export interface OrderTimeline {
  terminal: "cancelled" | "refunded" | null;
  steps: TimelineStep[];
}

const STEP_KEYS: Array<TimelineStep["key"]> = ["placed", "packed", "shipped", "delivered"];

/** Index of the current step for a non-terminal status. */
const CURRENT_INDEX: Record<Exclude<OrderStatus, "cancelled" | "refunded">, number> = {
  pending_payment: 0,
  paid: 0,
  packed: 1,
  shipped: 2,
  delivered: 3,
};

export function orderTimeline(status: OrderStatus): OrderTimeline {
  if (status === "cancelled" || status === "refunded") {
    return { terminal: status, steps: [] };
  }
  const cur = CURRENT_INDEX[status];
  return {
    terminal: null,
    steps: STEP_KEYS.map((key, i) => ({
      key,
      // Delivered is complete: every step done, nothing "current".
      state: status === "delivered" ? "done" : i < cur ? "done" : i === cur ? "current" : "todo",
    })),
  };
}
