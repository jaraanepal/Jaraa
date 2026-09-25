import { Link } from "react-router-dom";
import { doctorB3Api } from "../../api/b3doctor";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * D20 — "Archived cases": read-only reference list of cases this doctor
 * archived, newest archived first. Archived cases stay out of the queue.
 */
export function DoctorArchived() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    doctorB3Api.listArchivedCases().then((r) => r.cases),
  );

  return (
    <div>
      <p className="muted tiny">{t("p12c.doctor.archivedSub")}</p>
      {loading && <Loading />}
      {error ? <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} /> : null}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.check size={32} />} title={t("p12c.doctor.archivedEmpty")} />
      )}
      {(data ?? []).map((c) => (
        <div className="card" key={c.id} style={{ padding: "8px 12px" }}>
          <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4 }}>
            <b className="kbd">{c.scan_id.slice(0, 8)}</b>
            <Chip tone="grey">{t("p12c.doctor.archivedBadge")}</Chip>
            <span className="chip">{c.status}</span>
            {c.priority === "red_flag" && <Chip tone="red">{t("doctor.redFlagPriority")}</Chip>}
            <span className="spacer" />
            <span className="tiny muted">
              {c.archived_at ? new Date(c.archived_at).toLocaleDateString() : ""}
            </span>
            <Link className="linklike" to={`/doctor/case/${c.id}`}>
              {t("doctor.openCase")}
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
