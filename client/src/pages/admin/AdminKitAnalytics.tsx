import { useEffect, useMemo, useState } from "react";
import { adminKitsApi, shopApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * A11: per-kit order counts + revenue.
 *
 * Data source: the same fulfilment order feed AdminOrders uses
 * (shopApi.pharmacyOrders(), which the admin role can read), aggregated
 * client-side by kit_id. Kit names come from adminKitsApi.list() when the
 * server supports it; when it 404s on older servers the page degrades to
 * showing the kit_id prefix instead of inventing names.
 */
export default function AdminKitAnalytics() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    shopApi.pharmacyOrders().then((r) => r.orders),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;
  const [kitNames, setKitNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    adminKitsApi
      .list({ limit: 100 })
      .then((r) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const k of r.kits) map[k.id] = k.name_en;
        setKitNames(map);
      })
      .catch(() => {
        /* older servers 404 — degrade to kit_id display, never fake names */
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    const agg = new Map<string, { count: number; revenue: number }>();
    for (const o of data ?? []) {
      const cur = agg.get(o.kit_id) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += o.total_npr;
      agg.set(o.kit_id, cur);
    }
    return [...agg.entries()]
      .map(([kitId, v]) => ({ kitId, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [data]);

  const totalOrders = rows.reduce((s, r) => s + r.count, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="screen">
      <h1>{t("p12.admin.kitAnalytics")}</h1>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (
        <>
          <div className="statgrid">
            <StatCard label={t("p12.admin.kitOrders")} value={String(totalOrders)} icon={<Icon.box size={26} />} />
            <StatCard label={t("p12.admin.kitRevenue")} value={`NPR ${totalRevenue}`} icon={<Icon.chart size={26} />} />
          </div>

          {rows.length === 0 && (
            <EmptyState icon={<Icon.box size={32} />} title={t("p12.admin.noKitData")} />
          )}

          {rows.map((r) => (
            <div className="card" key={r.kitId}>
              <div className="rowflex">
                <div style={{ flex: 1 }}>
                  <b>{kitNames[r.kitId] ?? <span className="kbd">{r.kitId.slice(0, 8)}</span>}</b>
                  {!kitNames[r.kitId] && <div className="tiny muted kbd">{r.kitId}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tiny muted">{t("p12.admin.kitOrders")}</div>
                  <b>{r.count}</b>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tiny muted">{t("p12.admin.kitRevenue")}</div>
                  <b>NPR {r.revenue}</b>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
