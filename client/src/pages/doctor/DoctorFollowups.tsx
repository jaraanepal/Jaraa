import { useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * D6: doctor follow-up reminders — list own follow-ups with a due-only
 * toggle, schedule new ones against a queued case, mark done.
 */
export default function DoctorFollowups() {
  const { t } = useLang();
  const [dueOnly, setDueOnly] = useState(true);
  const { data, error, loading, retry } = useAsync(
    () => doctorApi.listFollowUps(dueOnly).then((r) => r.follow_ups),
    [dueOnly],
  );
  const listError = error ? apiErrorMessage(t, error) : null;

  // Schedule form.
  const cases = useAsync(() => doctorApi.listCases("queued", 50).then((r) => r.cases));
  const [caseId, setCaseId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function schedule() {
    if (!caseId || !dueOn) return;
    setBusy(true);
    setFormError(null);
    try {
      await doctorApi.createFollowUp({
        case_id: caseId,
        due_on: dueOn,
        note: note.trim() || undefined,
      });
      toast(t("p12.doctor.followupSaved"));
      setCaseId("");
      setDueOn("");
      setNote("");
      retry();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function markDone(id: string) {
    try {
      await doctorApi.completeFollowUp(id);
      toast(t("p12.doctor.followupDone"));
      retry();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    }
  }

  const queuedCases = cases.data ?? [];

  return (
    <div className="screen">
      <h1>{t("p12.doctor.followups")}</h1>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.doctor.schedule")}</h3>
        {formError && <ErrorCard message={formError} />}
        <label className="fl" htmlFor="fu-case">{t("p12.doctor.caseLabel")}</label>
        <select
          id="fu-case"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          disabled={cases.loading}
        >
          <option value="">{cases.loading ? t("common.loading") : "—"}</option>
          {queuedCases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.scan_id.slice(0, 8)} · {c.created_at.slice(0, 10)}
            </option>
          ))}
        </select>
        <div className="rowflex" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="fl" htmlFor="fu-due">{t("p12.doctor.dueOn")}</label>
            <input id="fu-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label className="fl" htmlFor="fu-note">{t("p12.doctor.notePh")}</label>
            <input id="fu-note" type="text" placeholder={t("p12.doctor.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-p" disabled={busy || !caseId || !dueOn} onClick={schedule}>
          {busy ? t("common.loading") : t("p12.doctor.schedule")}
        </button>
      </div>

      <label className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "8px 0" }}>
        <input
          type="checkbox"
          checked={dueOnly}
          onChange={(e) => setDueOnly(e.target.checked)}
          style={{ width: 24, height: 24, minHeight: 24 }}
        />
        {t("p12.doctor.followupsDue")}
      </label>

      {loading && <Loading />}
      {listError && <ErrorCard message={listError} onRetry={retry} />}

      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.clock size={32} />} title={t("p12.doctor.noFollowups")} />
      )}

      {(data ?? []).map((f) => (
        <div className="card" key={f.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <b>{f.due_on}</b>
              {f.note && <div className="tiny" style={{ marginTop: 2 }}>{f.note}</div>}
              <div className="tiny muted" style={{ marginTop: 2 }}>
                <Link className="linklike" to={`/doctor/case/${f.case_id}`}>
                  {t("p12.doctor.caseLabel")} · <span className="kbd">{f.case_id.slice(0, 8)}</span>
                </Link>
              </div>
            </div>
            {f.done_at ? (
              <Chip>{f.done_at.slice(0, 10)}</Chip>
            ) : (
              <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => markDone(f.id)}>
                {t("p12.doctor.markDone")}
              </button>
            )}
          </div>
        </div>
      ))}

      <Link className="linklike" to="/doctor">← {t("doctor.backToQueue")}</Link>
    </div>
  );
}
