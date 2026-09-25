import { useEffect, useState } from "react";
import { adminB3Api, type PayoutRow } from "../../api/b3admin";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage } from "../../components/ui";
import { Icon } from "../../components/icons";

/**
 * A22 — doctor payout report. Month picker + reviewed-case counts.
 * Counts are derived from approved plans (audit `plan.approve`); there is no
 * per-case fee column, so this is the report — payout math stays offline.
 */
export default function AdminPayouts() {
  const { t } = useLang();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<PayoutRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    adminB3Api
      .payouts(month)
      .then((r) => {
        setRows(r.payouts);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };
  useEffect(load, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen">
      <h1>{t("p12c.admin.payouts.title")}</h1>
      <p className="muted tiny">{t("p12c.admin.payouts.note")}</p>

      <div className="filterrow">
        <label className="fl" htmlFor="payout-month">{t("p12c.admin.payouts.month")}</label>
        <input
          id="payout-month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ maxWidth: 200 }}
        />
      </div>

      {error && <ErrorCard message={error} onRetry={load} />}
      {loading && <Loading />}

      {!loading && !error && rows && rows.length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("p12c.admin.payouts.empty")} />
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <div className="card">
          <table className="tiny" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{t("p12c.admin.payouts.doctor")}</th>
                <th style={{ textAlign: "right" }}>{t("p12c.admin.payouts.reviewedCases")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.doctor_id}>
                  <td>{r.name ?? r.doctor_id.slice(0, 8)}</td>
                  <td style={{ textAlign: "right" }}><b>{r.reviewed}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
