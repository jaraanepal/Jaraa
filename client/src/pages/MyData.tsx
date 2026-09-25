import { useState } from "react";
import { meApi, shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, NoticeBox, apiErrorMessage, toast } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";
import type { DataDeletionResponse } from "../api/types";

/**
 * U8 — My data: download everything the app holds on the customer as
 * one JSON file, or request deletion (destructive — double confirm).
 * No invented data: the export is exactly what the API returns.
 */
export default function MyData() {
  const { t } = useLang();
  const [deleting, setDeleting] = useState(false);
  const [deletion, setDeletion] = useState<DataDeletionResponse | null>(null);
  const { data, error, loading } = useAsync(
    () =>
      Promise.all([meApi.getProfile(), meApi.getProgress(), shopApi.listMyOrders()]).then(
        ([profile, progress, orders]) => ({ profile, progress, orders: orders.orders }),
      ),
    [],
  );

  async function exportData() {
    if (!data) return;
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jaraa-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(t("p12.customer.exportDone"));
    } catch {
      toast(t("p12.customer.exportData"));
    }
  }

  async function requestDeletion() {
    if (!window.confirm(t("p12.customer.deleteData"))) return;
    if (!window.confirm(t("p12.customer.deleteData"))) return; // destructive — ask twice
    setDeleting(true);
    try {
      const r = await meApi.requestDataDeletion();
      setDeletion(r);
      toast(t("p12.customer.deleteRequested"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="screen">
        <h1>{t("p12.customer.myData")}</h1>
        <ErrorCard message={apiErrorMessage(t, error)} />
      </div>
    );
  }

  return (
    <div className="screen">
      <h1>{t("p12.customer.myData")}</h1>

      <div className="card center">
        <span style={{ color: "var(--green)" }}><Icon.doc size={40} /></span>
        <p className="tiny muted">{t("p12.customer.exportData")}</p>
        <button className="btn btn-p" onClick={exportData}>
          {t("p12.customer.exportData")}
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, color: "var(--bad)" }}>{t("p12.customer.deleteData")}</h3>
        <button className="btn" style={{ background: "var(--bad)", color: "#fff" }} disabled={deleting} onClick={requestDeletion}>
          {deleting ? t("p12.common.loading") : t("p12.customer.deleteData")}
        </button>
      </div>

      {deletion && (
        <NoticeBox tone="notice" title={t("p12.customer.deleteRequested")}>
          <p className="tiny" style={{ margin: 0 }}>
            {deletion.request_id}
            <br />
            {deletion.scheduled_for.slice(0, 10)}
            <br />
            {deletion.note}
          </p>
        </NoticeBox>
      )}
    </div>
  );
}
