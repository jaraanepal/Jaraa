import { describe, expect, it } from "vitest";
import { nextFulfilmentStep } from "../lib/pharmacySteps";
import type { Order } from "../api/types";

const base = { payment_method: "cod" } as Pick<Order, "status" | "payment_method">;

describe("nextFulfilmentStep", () => {
  it("lets a COD order awaiting payment be packed (cash is collected on delivery)", () => {
    expect(nextFulfilmentStep({ ...base, status: "pending_payment" })).toEqual({
      to: "packed",
      labelKey: "pharmacy.markPacked",
    });
  });

  it("does not let unpaid online orders advance", () => {
    expect(
      nextFulfilmentStep({ status: "pending_payment", payment_method: "esewa" }),
    ).toBeUndefined();
    expect(
      nextFulfilmentStep({ status: "pending_payment", payment_method: "khalti" }),
    ).toBeUndefined();
  });

  it("advances the normal pipeline one step", () => {
    expect(nextFulfilmentStep({ ...base, status: "paid" })?.to).toBe("packed");
    expect(nextFulfilmentStep({ ...base, status: "packed" })?.to).toBe("shipped");
    expect(nextFulfilmentStep({ ...base, status: "shipped" })?.to).toBe("delivered");
  });

  it("has no step for terminal statuses", () => {
    expect(nextFulfilmentStep({ ...base, status: "delivered" })).toBeUndefined();
  });
});
