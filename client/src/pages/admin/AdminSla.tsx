import { Link } from "react-router-dom";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * A4: SLA monitor — cases past their review deadline, across all doctors.
 */
export default function AdminSla() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminApi.listOverdueCases().then((r) => r.cases),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const cases = data ?? [];

  return (
    <div className="screen">
      <h1>{t("p12.admin.sla")}</h1>
      <p className="muted tiny">{t("p12.admin.slaHint")}</p>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && cases.length === 0 && (
        <EmptyState icon={<Icon.check size={32} />} title={t("p12.admin.noOverdue")} />
      )}

      {cases.map((c) => (
        <div className="card" key={c.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <Link className="linklike kbd" to={`/doctor/case/${c.id}`}>
                <b className="kbd">{c.scan_id.slice(0, 8)}</b>
              </Link>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                {c.user_id ? c.user_id.slice(0, 8) : "—"} · {c.created_at.slice(0, 10)}
              </div>
              <div className="tiny" style={{ color: "var(--bad)", fontWeight: 700, marginTop: 2 }}>
                {t("p12.admin.hoursOverdue", { n: Math.round(c.hours_overdue) })}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <Chip tone={c.priority === "red_flag" ? "red" : c.priority === "high" ? "amber" : undefined}>
                {c.priority}
              </Chip>
              <div className="tiny muted" style={{ marginTop: 4 }}>{c.status}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
