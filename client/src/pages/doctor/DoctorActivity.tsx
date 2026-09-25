import { Link } from "react-router-dom";
import { doctorB3Api } from "../../api/b3doctor";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * D19 — "My review history": the doctor's own audit trail, newest first.
 * Each row shows the action, a link to the case, and the timestamp.
 */
export function DoctorActivity() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    doctorB3Api.listAudit(50).then((r) => r.audit),
  );

  return (
    <div>
      <p className="muted tiny">{t("p12c.doctor.auditSub")}</p>
      {loading && <Loading />}
      {error ? <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} /> : null}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("p12c.doctor.auditEmpty")} />
      )}
      {(data ?? []).map((e) => (
        <div className="card" key={String(e.id)} style={{ padding: "8px 12px" }}>
          <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4 }}>
            <span className="chip">{e.action}</span>
            {e.entity_id && e.entity === "case" ? (
              <Link className="linklike tiny" to={`/doctor/case/${e.entity_id}`}>
                {t("p12c.doctor.auditCase")} {e.entity_id.slice(0, 8)}
              </Link>
            ) : (
              <span className="tiny muted">
                {t("p12c.doctor.auditCase")} {e.entity_id ? e.entity_id.slice(0, 8) : "—"}
              </span>
            )}
            <span className="spacer" />
            <span className="tiny muted">
              {t("p12c.doctor.auditTime")}: {new Date(e.at).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
