import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/** Full audit log page (a summary also lives on the dashboard). */
export default function AdminAudit() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminApi.listAudit({ limit: 100 }).then((r) => r.entries),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  return (
    <div className="screen">
      <h1>{t("admin.auditTitle")}</h1>
      <p className="muted tiny">{t("adminAudit.sub")}</p>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && data && data.length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("adminAudit.empty")} />
      )}

      {data &&
        data.map((a) => (
          <p key={a.id} className="tiny">
            {a.at.slice(0, 16).replace("T", " ")} — <b>{a.action}</b> — {a.entity}/{a.entity_id.slice(0, 8)} —{" "}
            {a.actor_id.slice(0, 8)}
          </p>
        ))}
    </div>
  );
}
