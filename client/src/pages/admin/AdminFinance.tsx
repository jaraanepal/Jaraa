import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { ErrorCard, Loading, StatCard, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * A6: finance snapshot — revenue, order count, COD pending/collected,
 * refunds, plus a per-status breakdown. All values come from the
 * server; never invented.
 */
export default function AdminFinance() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminApi.getFinance().then((r) => r.finance),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  return (
    <div className="screen">
      <h1>{t("p12.admin.finance")}</h1>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && data && (
        <>
          <div className="statgrid">
            <StatCard label={t("p12.admin.revenue")} value={`NPR ${data.revenue_npr}`} icon={<Icon.chart size={26} />} />
            <StatCard label={t("p12.admin.orderCount")} value={String(data.order_count)} icon={<Icon.box size={26} />} />
            <StatCard label={t("p12.admin.codPending")} value={`NPR ${data.cod_pending_npr}`} icon={<Icon.clock size={26} />} />
            <StatCard label={t("p12.admin.codCollected")} value={`NPR ${data.cod_collected_npr}`} icon={<Icon.check size={26} />} />
            <StatCard label={t("p12.admin.refundsTotal")} value={`NPR ${data.refunds_npr}`} icon={<Icon.truck size={26} />} />
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t("p12.admin.orderCount")}</h3>
            {Object.entries(data.by_status).map(([s, n]) => (
              <div className="rowflex" key={s} style={{ padding: "4px 0" }}>
                <span className="tiny">{s}</span>
                <span className="spacer" />
                <b className="tiny">{n}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
