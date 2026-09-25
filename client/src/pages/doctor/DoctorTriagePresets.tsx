import { useState } from "react";
import { doctorB3Api } from "../../api/b3doctor";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, Modal, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

const PRIORITIES = [0, 50, 100] as const;

/**
 * D24 — "Triage presets": one-tap priority presets, saved for reuse.
 * Inline add form on top, rows with name + priority + delete (confirm).
 */
export function DoctorTriagePresets() {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [priority, setPriority] = useState<0 | 50 | 100>(50);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { data, error, loading, retry } = useAsync(() =>
    doctorB3Api.listTriagePresets().then((r) => r.presets),
  );

  async function add() {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    try {
      await doctorB3Api.createTriagePreset(n, priority);
      setName("");
      toast(t("p12c.doctor.tpSaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setConfirmId(null);
    try {
      await doctorB3Api.deleteTriagePreset(id);
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  const inputStyle: React.CSSProperties = { width: "auto", minHeight: 40 };

  return (
    <div>
      <p className="muted tiny">{t("p12c.doctor.tpSub")}</p>
      <div className="card">
        <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 6 }}>
          <input
            type="text"
            placeholder={t("p12c.doctor.tpNamePh")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            aria-label={t("p12c.doctor.tpNamePh")}
            style={inputStyle}
          />
          <label className="tiny muted">
            {t("p12c.doctor.tpPriorityLabel")}{" "}
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) as 0 | 50 | 100)}
              style={inputStyle}
              aria-label={t("p12c.doctor.tpPriorityLabel")}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p === 0 ? t("p12.doctor.prNormal") : p === 50 ? t("p12.doctor.prHigh") : t("p12.doctor.prRed")}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-p btn-s"
            style={{ width: "auto", margin: 0 }}
            disabled={saving || !name.trim()}
            onClick={add}
          >
            {t("p12c.doctor.tpAdd")}
          </button>
        </div>
      </div>

      {loading && <Loading />}
      {error ? <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} /> : null}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.check size={32} />} title={t("p12c.doctor.tpEmpty")} />
      )}
      {(data ?? []).map((p) => (
        <div className="card" key={p.id} style={{ padding: "8px 12px" }}>
          <div className="rowflex">
            <b className="tiny">{p.name}</b>
            <span className="chip">
              {p.priority === 0 ? t("p12.doctor.prNormal") : p.priority === 50 ? t("p12.doctor.prHigh") : t("p12.doctor.prRed")}
            </span>
            <span className="spacer" />
            <button className="linklike" style={{ color: "var(--bad)" }} onClick={() => setConfirmId(p.id)}>
              {t("p12c.doctor.tpDelete")}
            </button>
          </div>
        </div>
      ))}

      {confirmId && (
        <Modal onClose={() => setConfirmId(null)}>
          <p>{t("p12c.doctor.tpDeleteConfirm")}</p>
          <div className="rowflex">
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setConfirmId(null)}>
              {t("p12c.doctor.archiveCancel")}
            </button>
            <button
              className="btn btn-p btn-s"
              style={{ width: "auto", margin: 0 }}
              onClick={() => remove(confirmId)}
            >
              {t("p12c.doctor.tpDelete")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
