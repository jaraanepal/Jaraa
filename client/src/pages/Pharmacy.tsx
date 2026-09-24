import { useEffect, useMemo, useState } from "react";
import { shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, NoticeBox, StatCard, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import type { Order, OrderStatus } from "../api/types";

const PIPELINE: OrderStatus[] = ["pending_payment", "paid", "packed", "shipped", "delivered"];
/** Next actionable status per current status (pharmacy fulfilment advance). */
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; labelKey: string }>> = {
  paid: { to: "packed", labelKey: "pharmacy.markPacked" },
  packed: { to: "shipped", labelKey: "pharmacy.markShipped" },
  shipped: { to: "delivered", labelKey: "pharmacy.markDelivered" },
};

/**
 * Fulfilment queue for the pharmacy / fulfilment role.
 * Cosmetic kit orders only — prescription commerce stays hidden while the
 * prescription_commerce flag is OFF (enforced server-side).
 */
export default function Pharmacy() {
  const { t } = useLang();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    shopApi
      .pharmacyOrders()
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

  const advance = async (o: Order) => {
    const step = NEXT[o.status];
    if (!step || updating) return;
    setUpdating(o.id);
    setNotice(null);
    try {
      const updated = await shopApi.updatePharmacyOrder(o.id, step.to);
      setOrders((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
      setNotice(t("pharmacy.updated"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setUpdating(null);
    }
  };

  // Queue = orders that still need action; delivered/cancelled/refunded
  // are recent history. Empty states say "nothing yet" — never invented rows.
  const actionable = useMemo(
    () => orders.filter((o) => ["pending_payment", "paid", "packed", "shipped"].includes(o.status)),
    [orders],
  );
  const history = useMemo(
    () =>
      orders
        .filter((o) => ["delivered", "cancelled", "refunded"].includes(o.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5),
    [orders],
  );

  if (loading) return <Loading />;

  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayNew = orders.filter((o) => o.created_at.slice(0, 10) === today).length;

  return (
    <div className="screen">
      <h1>{t("pharmacy.title")}</h1>
      <p className="muted tiny">{t("pharmacy.sub")}</p>
      {error && <ErrorCard message={error} />}
      {notice && (
        <NoticeBox tone="ok" title="">
          <p className="tiny">{notice}</p>
        </NoticeBox>
      )}

      {!error && (
        <div className="statgrid">
          <StatCard label={t("pharmacy.statAwaiting")} value={String(count("paid"))} icon={<Icon.box size={26} />} />
          <StatCard label={t("pharmacy.statInTransit")} value={String(count("shipped"))} icon={<Icon.truck size={26} />} />
          <StatCard label={t("pharmacy.statDelivered")} value={String(count("delivered"))} icon={<Icon.check size={26} />} />
          <StatCard label={t("pharmacy.statToday")} value={String(todayNew)} icon={<Icon.clock size={26} />} />
        </div>
      )}

      <h3>{t("pharmacy.queueTitle")}</h3>
      {actionable.length === 0 && !error && (
        <EmptyState icon={<Icon.truck size={32} />} title={t("pharmacy.empty")} />
      )}

      {actionable.map((o) => {
        const idx = PIPELINE.indexOf(o.status);
        const step = NEXT[o.status];
        return (
          <div className="card" key={o.id}>
            <div className="rowflex">
              <span style={{ color: "var(--green)" }}><Icon.truck size={24} /></span>
              <div>
                <b className="kbd">{o.id}</b>
                <br />
                <span className="tiny muted">
                  {t("pharmacy.customer")}: {o.shipping_address ? `${o.shipping_address.name} • ${o.shipping_address.city}` : "—"}
                  {"  "}• {t("pharmacy.kit")}: {String(o.kit_id).slice(0, 8)}
                  {"  "}• NPR {o.total_npr} ({o.payment_method.toUpperCase()})
                </span>
              </div>
              <span className="spacer" />
              <span className="chip">{t(`orders.status.${o.status}`)}</span>
            </div>
            <div className="stepper" aria-hidden="true" style={{ margin: "10px 0 0" }}>
              {PIPELINE.map((s, i) => (
                <span
                  key={s}
                  className={idx >= 0 && i < idx ? "done" : s === o.status ? "cur" : ""}
                  title={t(`orders.status.${s}`)}
                />
              ))}
            </div>
            {step && (
              <button
                className="btn primary"
                style={{ marginTop: 12, minHeight: 44 }}
                disabled={updating === o.id}
                onClick={() => advance(o)}
              >
                {updating === o.id ? "…" : t(step.labelKey)}
              </button>
            )}
          </div>
        );
      })}

      {history.length > 0 && (
        <>
          <h3>{t("pharmacy.historyTitle")}</h3>
          {history.map((o) => (
            <div className="card" key={o.id}>
              <div className="rowflex">
                <div>
                  <b className="kbd">{o.id.slice(0, 8)}</b>
                  <br />
                  <span className="tiny muted">
                    {o.created_at.slice(0, 10)} · {o.payment_method.toUpperCase()} · NPR {o.total_npr}
                  </span>
                </div>
                <span className="spacer" />
                <span className="chip">{t(`orders.status.${o.status}`)}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
