import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { meApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, ScoreBar, apiErrorMessage, toast } from "../components/ui";
import { Icon } from "../components/icons";
import type { ProgressBundle, RootKey } from "../api/types";

/** Daily shedding tracker: a habit log, never a medical metric. */
export default function Progress() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [prog, setProg] = useState<ProgressBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shedding, setShedding] = useState(50);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    meApi
      .getProgress()
      .then((p) => {
        setProg(p);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };

  useEffect(load, [t]);

  async function logCheckin() {
    setSaving(true);
    try {
      await meApi.createCheckin({ shedding_estimate: shedding, note: note.trim() || undefined });
      setNote("");
      toast(t("progress.logged"));
      load();
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  const history = prog?.root_score_history ?? [];

  return (
    <div className="screen">
      <h1>{t("progress.title")}</h1>
      {error && <ErrorCard message={error} onRetry={load} />}

      {history.length === 0 && !error && (
        <p className="muted">{t("progress.noHistory")}</p>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("progress.checkinTitle")}</h3>
        <p className="muted">{t("progress.checkinBody")}</p>
        <label className="fl" htmlFor="shed">{t("progress.checkinTitle")}</label>
        <input
          id="shed"
          type="range" min={0} max={100} value={shedding}
          onChange={(e) => setShedding(Number(e.target.value))}
          aria-label={t("progress.checkinTitle")}
        />
        <input
          type="text" value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("progress.checkinBody")}
          aria-label={t("progress.checkinBody")}
        />
        <button className="btn btn-p" disabled={saving} onClick={logCheckin}>
          {saving ? t("common.loading") : t("progress.logged")}
        </button>
      </div>

      {prog?.next_rescan_due_on && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("progress.rescanTitle")}</h3>
          <p className="muted">{t("progress.rescanBody")}</p>
          <p className="tiny">{t("progress.nextRescan", { date: prog.next_rescan_due_on.slice(0, 10) })}</p>
          <button className="btn btn-s" onClick={() => navigate("/")}>
            {t("progress.startRescan")}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("progress.compareTitle")}</h3>
          {history.slice(-3).map((h) => (
            <div key={h.version} style={{ margin: "12px 0" }}>
              <p><b>{t("progress.version", { v: h.version })}</b> <span className="tiny muted">{h.generated_at.slice(0, 10)}</span></p>
              {(Object.keys(h.roots) as RootKey[]).map((r) => (
                <div className="rowflex" key={r} style={{ margin: "4px 0" }}>
                  <span className="tiny">{t(`jara.roots.${r}`)}</span>
                  <span className="spacer" />
                  <ScoreBar score={h.roots[r]} />
                  <b className="tiny">{h.roots[r]}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {prog && prog.checkins.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("progress.checkinTitle")}</h3>
          {prog.checkins.slice(0, 8).map((c) => (
            <p key={c.id} className="tiny muted">
              {c.created_at.slice(0, 10)} — {c.shedding_estimate ?? "—"}/100{c.note ? ` — ${c.note}` : ""}
            </p>
          ))}
        </div>
      )}

      <div className="card center">
        <div style={{ color: "var(--green)" }}><Icon.camera size={32} /></div>
        <p className="tiny muted">{t("progress.checkinBody")}</p>
      </div>
    </div>
  );
}
