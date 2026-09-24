import { useLang } from "../i18n/LanguageContext";
import { Icon } from "./icons";
import { orderTimeline } from "../lib/orders";
import type { OrderStatus } from "../api/types";

/**
 * Customer order status timeline: placed -> packed -> shipped -> delivered.
 * Cancelled/refunded orders show a terminal note instead of steps.
 */
export function OrderTimeline({ status }: { status: OrderStatus }) {
  const { t } = useLang();
  const tl = orderTimeline(status);

  if (tl.terminal) {
    return (
      <p className="tiny muted" style={{ margin: "10px 0 0" }}>
        {t(tl.terminal === "cancelled" ? "ordersTimeline.cancelledNote" : "ordersTimeline.refundedNote")}
      </p>
    );
  }

  return (
    <div className="tl" role="img" aria-label={`${t("ordersTimeline.title")}: ${t(`orders.status.${status}`)}`}>
      {tl.steps.map((s) => (
        <div className={`tl-step ${s.state}`} key={s.key}>
          <span className="tl-dot">{s.state === "done" ? <Icon.check size={12} /> : null}</span>
          <span className="tl-label">{t(`ordersTimeline.${s.key}`)}</span>
        </div>
      ))}
    </div>
  );
}
