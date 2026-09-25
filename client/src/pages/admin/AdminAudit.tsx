import { useState } from "react";
import { adminApi, getAccessToken } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";

/**
 * Full audit log page (a summary also lives on the dashboard).
 * A29: CSV export with filters — downloads via a Blob URL.
 */
export default function AdminAudit() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminApi.listAudit({ limit: 100 }).then((r) => r.entries),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entity, setEntity] = useState("");
  const [actor, setActor] = useState("");
  const [exporting, setExporting] = useState(false);

  /** A29: download the audit CSV for the current filters. */
  async function downloadAuditCsv() {
    setExporting(true);
    try {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      if (entity.trim()) q.set("entity", entity.trim());
      if (actor.trim()) q.set("actor_id", actor.trim());
      const qs = q.toString();
      const res = await fetch(`${BASE}/api/v1/admin/audit/export.csv${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jaraa-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="screen">
      <h1>{t("admin.auditTitle")}</h1>
      <p className="muted tiny">{t("adminAudit.sub")}</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12c.admin.auditExport.title")}</h3>
        <div className="filterrow">
          <label className="fl" htmlFor="audit-from">{t("p12c.admin.auditExport.from")}</label>
          <input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="fl" htmlFor="audit-to">{t("p12c.admin.auditExport.to")}</label>
          <input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="filterrow">
          <label className="fl" htmlFor="audit-entity">{t("p12c.admin.auditExport.entity")}</label>
          <input id="audit-entity" type="text" value={entity} onChange={(e) => setEntity(e.target.value)} />
          <label className="fl" htmlFor="audit-actor">{t("p12c.admin.auditExport.actor")}</label>
          <input id="audit-actor" type="text" value={actor} onChange={(e) => setActor(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-p" disabled={exporting} onClick={downloadAuditCsv}>
            {exporting ? t("common.loading") : t("p12c.admin.auditExport.downloadCsv")}
          </button>
        </div>
      </div>

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
