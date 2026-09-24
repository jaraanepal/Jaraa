import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import type { Order } from "../api/types";

export default function Orders() {
  const { t } = useLang();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [t]);

  if (loading) return <Loading />;

  return (
    <div className="screen">
      <h1>{t("orders.title")}</h1>
      {error && <ErrorCard message={error} />}
      {orders.length === 0 && !error && <p className="muted">{t("orders.empty")}</p>}
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
        </div>
      ))}
      <div className="center">
        <Link className="linklike" to="/kits">{t("orders.browseKits")}</Link>
      </div>
    </div>
  );
}
