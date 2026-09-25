import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../components/ui";
import { OrderTimeline } from "../components/OrderTimeline";
import { OrderIssueButton } from "../components/b3customer";
import { TrackingInfo } from "../components/b4customer";
import { Icon } from "../components/icons";
import type { Order } from "../api/types";

const PAY_METHODS = ["esewa", "khalti", "cod"] as const;
type PayMethod = (typeof PAY_METHODS)[number];

export default function Orders() {
  const { t } = useLang();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);

  const load = () => {
    shopApi
      .listMyOrders()
      .then((r) => {
        setOrders(r.orders);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };
  useEffect(load, [t]);

  // U11: one-tap reorder of a delivered kit with the original payment
  // method and address. Only offered when the address survived on the
  // order; the idempotency key guards double-taps.
  async function reorder(o: Order) {
    const addr = o.shipping_address;
    if (!addr || reordering) return;
    const pay: PayMethod = (PAY_METHODS as readonly string[]).includes(o.payment_method)
      ? (o.payment_method as PayMethod)
      : "cod";
    setReordering(o.id);
    try {
      await shopApi.createOrder(
        {
          kit_id: o.kit_id,
          payment_method: pay,
          shipping_address: {
            name: addr.name,
            phone: addr.phone,
            city: addr.city,
            address_line: addr.address_line,
          },
        },
        `reorder-${o.id}-${Date.now()}`,
      );
      toast(t("p12.customer.reorderDone"));
      load();
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setReordering(null);
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="screen">
      <h1>{t("orders.title")}</h1>
      {error && <ErrorCard message={error} />}
      {orders.length === 0 && !error && (
        <EmptyState icon={<Icon.box size={32} />} title={t("orders.empty")} action={
          <Link className="btn btn-p" to="/kits" style={{ textDecoration: "none" }}>{t("orders.browseKits")}</Link>
        } />
      )}
      {orders.map((o) => (
        <div className="card" key={o.id}>
          <div className="rowflex">
            <span style={{ color: "var(--green)" }}><Icon.box size={24} /></span>
            <div>
              <b className="kbd">{o.id.slice(0, 8)}</b>
              <br />
              <span className="tiny muted">
                {t("orderok.payment")} {o.payment_method.toUpperCase()} • {t("orderok.amount")} NPR {o.total_npr}
              </span>
              <br />
              <span className="tiny muted">{o.created_at.slice(0, 10)}</span>
            </div>
            <span className="spacer" />
            <span className="chip">{t(`orders.status.${o.status}`)}</span>
          </div>
          <OrderTimeline status={o.status} />
          {/* U34: courier + tracking id (batch 4) */}
          <TrackingInfo order={o} />
          {/* U27: report an order issue (support dispute) */}
          <div style={{ marginTop: 10 }}>
            <OrderIssueButton orderId={o.id} />
          </div>
          {/* U11: one-tap reorder — delivered orders only, address required */}
          {o.status === "delivered" && o.shipping_address && (
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-p btn-s"
                disabled={reordering === o.id}
                onClick={() => void reorder(o)}
              >
                {reordering === o.id ? t("p12.common.loading") : t("p12.customer.reorder")}
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="center">
        {orders.length > 0 && <Link className="linklike" to="/kits">{t("orders.browseKits")}</Link>}
      </div>
    </div>
  );
}
