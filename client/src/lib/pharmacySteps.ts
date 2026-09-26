import type { Order, OrderStatus } from "../api/types";

/** Next actionable fulfilment status per current status. */
export const NEXT_FULFILMENT_STEP: Partial<
  Record<OrderStatus, { to: OrderStatus; labelKey: string }>
> = {
  paid: { to: "packed", labelKey: "pharmacy.markPacked" },
  packed: { to: "shipped", labelKey: "pharmacy.markShipped" },
  shipped: { to: "delivered", labelKey: "pharmacy.markDelivered" },
};

/**
 * Next fulfilment step for an order, or undefined when nothing is actionable.
 *
 * COD orders collect cash on delivery, so a COD order still awaiting payment is
 * packable just like a paid one. Online (eSewa/Khalti) orders must wait for the
 * payment webhook before they become actionable — packing an unpaid online
 * order would be wrong.
 */
export function nextFulfilmentStep(
  o: Pick<Order, "status" | "payment_method">,
): { to: OrderStatus; labelKey: string } | undefined {
  const effective: OrderStatus =
    o.status === "pending_payment" && o.payment_method === "cod" ? "paid" : o.status;
  return NEXT_FULFILMENT_STEP[effective];
}
