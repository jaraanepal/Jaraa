import { shopApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { orderTimeline } from "../../lib/orders";

/**
 * Admin orders overview: every order in the fulfilment system with
 * counts per status. Read-only here — advancement happens in Pharmacy.
 */
export default function AdminOrders() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    shopApi.pharmacyOrders().then((r) => r.orders),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const byStatus = (data ?? []).reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = (data ?? []).filter((o) => o.created_at.slice(0, 10) === today).length;

  return (
    <div className="screen">
      <h1>{t("adminOrders.title")}</h1>
      <p className="muted tiny">{t("adminOrders.sub")}</p>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (
        <>
          <div className="statgrid">
            <StatCard label={t("adminOrders.total")} value={String(data?.length ?? 0)} icon={<Icon.truck size={26} />} />
            <StatCard label={t("adminDash.ordersToday")} value={String(todayCount)} icon={<Icon.clock size={26} />} />
            <StatCard label={t("orders.status.paid")} value={String(byStatus.paid ?? 0)} icon={<Icon.box size={26} />} />
            <StatCard label={t("orders.status.delivered")} value={String(byStatus.delivered ?? 0)} icon={<Icon.check size={26} />} />
          </div>

          {(data ?? []).length === 0 && (
            <EmptyState icon={<Icon.truck size={32} />} title={t("adminOrders.empty")} />
          )}

          {(data ?? []).map((o) => {
            const tl = orderTimeline(o.status);
            return (
              <div className="card" key={o.id}>
                <div className="rowflex">
                  <div>
                    <b className="kbd">{o.id.slice(0, 8)}</b>
                    <br />
                    <span className="tiny muted">
                      {o.created_at.slice(0, 10)} · {o.payment_method.toUpperCase()} · NPR {o.total_npr}
                      {o.shipping_address ? ` · ${o.shipping_address.name}, ${o.shipping_address.city}` : ""}
                    </span>
                  </div>
                  <span className="spacer" />
                  <span className="chip">{t(`orders.status.${o.status}`)}</span>
                </div>
                {tl.steps.length > 0 && (
                  <div className="tl" aria-hidden="true">
                    {tl.steps.map((s) => (
                      <div className={`tl-step ${s.state}`} key={s.key}>
                        <span className="tl-dot">{s.state === "done" ? <Icon.check size={12} /> : null}</span>
                        <span className="tl-label">{t(`ordersTimeline.${s.key}`)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
