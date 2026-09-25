import { useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * D9: the doctor's own availability — show current status, set
 * available / on leave with an optional note.
 */
export default function DoctorAvailability() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    doctorApi.getAvailability().then((r) => r.availability),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;
  const [status, setStatus] = useState<"available" | "on_leave">("available");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      await doctorApi.setAvailability(status, note.trim() || undefined);
      toast(t("p12.doctor.availabilitySaved"));
      retry();
    } catch (e) {
      setSaveError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>{t("p12.doctor.availability")}</h1>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (
        <>
          <div className="card">
            <div className="rowflex">
              <span style={{ color: "var(--green)" }}><Icon.check size={26} /></span>
              <div style={{ flex: 1 }}>
                <div className="tiny muted">{t("p12.doctor.currentStatus")}</div>
                {data ? (
                  <b>{data.status === "available" ? t("p12.doctor.available") : t("p12.doctor.onLeave")}</b>
                ) : (
                  <b className="muted">—</b>
                )}
                {data?.note && <div className="tiny muted">{data.note}</div>}
                {data && <div className="tiny muted">{data.updated_at.slice(0, 10)}</div>}
              </div>
              {data && (
                <Chip tone={data.status === "available" ? undefined : "amber"}>
                  {data.status === "available" ? t("p12.doctor.available") : t("p12.doctor.onLeave")}
                </Chip>
              )}
            </div>
          </div>

          <div className="card">
            <div className="tabrow" style={{ margin: "0 0 8px" }}>
              <button
                className={`tab${status === "available" ? " on" : ""}`}
                onClick={() => setStatus("available")}
              >
                {t("p12.doctor.available")}
              </button>
              <button
                className={`tab${status === "on_leave" ? " on" : ""}`}
                onClick={() => setStatus("on_leave")}
              >
                {t("p12.doctor.onLeave")}
              </button>
            </div>
            {saveError && <ErrorCard message={saveError} />}
            <label className="fl" htmlFor="av-note">{t("p12.doctor.notePh")}</label>
            <input
              id="av-note"
              type="text"
              placeholder={t("p12.doctor.notePh")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn btn-p" disabled={busy} onClick={save}>
              {busy ? t("common.loading") : t("p12.common.save")}
            </button>
          </div>
        </>
      )}

      <Link className="linklike" to="/doctor">← {t("doctor.backToQueue")}</Link>
    </div>
  );
}
