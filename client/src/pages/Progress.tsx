import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { meApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, ScoreBar, apiErrorMessage, toast } from "../components/ui";
import { Icon } from "../components/icons";
import AdherenceRing from "../components/AdherenceRing";
import { AdherenceChart, CaseQaSection } from "../components/b3customer";
import { PrintReportButton } from "../components/b4customer";
import { customerB4Api } from "../api/b4customer";
import type { Badge, Checkin, EducationArticle, ProgressBundle, RootKey, RootMap } from "../api/types";

const DAY_MS = 86_400_000;

/**
 * U10/U3 helpers: adherence = % of the last 14 days containing a
 * check-in; streak = consecutive check-in days ending today/yesterday.
 */
export function checkinDays(checkins: Checkin[]): Set<string> {
  const days = new Set<string>();
  for (const c of checkins) {
    const d = new Date(Date.parse(c.created_at));
    days.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return days;
}

export function adherence14(checkins: Checkin[]): number {
  const days = checkinDays(checkins);
  let hit = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() - i * DAY_MS);
    if (days.has(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)) hit++;
  }
  return (hit / 14) * 100;
}

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
  // Batch-2 (008): symptom diary (U13), sleep log (U15), before/after compare (U16).
  const [symptoms, setSymptoms] = useState<{ id: string; entry_date: string; note: string }[]>([]);
  const [symNote, setSymNote] = useState("");
  const [sleeps, setSleeps] = useState<{ id: string; log_date: string; bedtime: string | null; wake_time: string | null; quality: number | null }[]>([]);
  const [bedtime, setBedtime] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [quality, setQuality] = useState("3");
  const [cmpBefore, setCmpBefore] = useState<number>(0);
  const [cmpAfter, setCmpAfter] = useState<number>(-1);
  // U16: draggable divider position (0–100) for the before/after photo slider.
  const [divider, setDivider] = useState(50);
  const [dragging, setDragging] = useState(false);
  // U16: root-map history (with scan photos) powers the before/after slider.
  const [rmHistory, setRmHistory] = useState<RootMap[]>([]);
  // C11/C18: badges my coach awarded + articles my coach shared.
  const [myBadges, setMyBadges] = useState<Badge[]>([]);
  const [myArticles, setMyArticles] = useState<Array<EducationArticle & { assigned_at: string }>>([]);
  // U43 (batch 4): server streak for the printable report.
  const [streakDays, setStreakDays] = useState(0);

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
  useEffect(() => {
    meApi.listSymptoms().then((r) => setSymptoms(r.entries)).catch(() => {});
    meApi.listSleep().then((r) => setSleeps(r.logs)).catch(() => {});
    meApi.getRootMapHistory().then((r) => setRmHistory(r.versions ?? [])).catch(() => {});
    meApi.getMyBadges().then((r) => setMyBadges(r.badges ?? [])).catch(() => {});
    meApi.getAssignedArticles().then((r) => setMyArticles(r.articles ?? [])).catch(() => {});
    customerB4Api.getStreak().then((r) => setStreakDays(r.days)).catch(() => {});
  }, []);

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

  async function saveSymptom() {
    if (!symNote.trim()) return;
    try {
      const e = await meApi.saveSymptom(new Date().toISOString().slice(0, 10), symNote.trim());
      setSymptoms((v) => [e, ...v.filter((x) => x.entry_date !== e.entry_date)]);
      setSymNote("");
      toast(t("p12b.customer.saved"));
    } catch (e) { setError(apiErrorMessage(t, e)); }
  }
  async function saveSleep() {
    try {
      const s = await meApi.saveSleep({
        log_date: new Date().toISOString().slice(0, 10),
        bedtime: bedtime || undefined, wake_time: wakeTime || undefined,
        quality: parseInt(quality, 10) || undefined,
      });
      setSleeps((v) => [s, ...v.filter((x) => x.log_date !== s.log_date)]);
      toast(t("p12b.customer.saved"));
    } catch (e) { setError(apiErrorMessage(t, e)); }
  }

  async function removeSymptom(id: string) {
    try {
      await meApi.deleteSymptom(id);
      setSymptoms((v) => v.filter((s) => s.id !== id));
    } catch (e) { setError(apiErrorMessage(t, e)); }
  }
  async function removeSleep(id: string) {
    try {
      await meApi.deleteSleep(id);
      setSleeps((v) => v.filter((s) => s.id !== id));
    } catch (e) { setError(apiErrorMessage(t, e)); }
  }

  if (loading) return <Loading />;

  const history = prog?.root_score_history ?? [];
  const checkins = prog?.checkins ?? [];
  // U10: 14-day check-in adherence shown as a ring.
  const adherence = adherence14(checkins);
  // U3: check-in timeline (chronological). Photo thumbnails are NOT shown:
  // checkins carry only photo_ids and no customer scan-photo endpoint exists
  // to resolve them, so we never render images we can't fetch.
  const timeline = [...checkins].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="screen">
      <h1>{t("progress.title")}</h1>
      {error && <ErrorCard message={error} onRetry={load} />}

      {/* U10: plan-adherence ring (last 14 days of check-ins) */}
      {checkins.length > 0 && (
        <div className="card">
          <AdherenceRing percent={adherence} />
        </div>
      )}

      {/* U24: 12-week adherence history chart */}
      <AdherenceChart />

      {/* U43: printable adherence report (batch 4) */}
      <div className="card">
        <div className="rowflex">
          <div>
            <b>{t("p12d.customer.reportTitle")}</b>
            <br />
            <span className="tiny muted">{t("p12d.customer.reportDisclaimer")}</span>
          </div>
          <span className="spacer" />
          <PrintReportButton
            data={{
              adherencePct: adherence,
              streakDays,
              checkins: timeline.slice(0, 30).map((c) => ({
                created_at: c.created_at,
                shedding_estimate: c.shedding_estimate,
                note: c.note,
              })),
              rootHistory: history.map((h) => ({ version: h.version, generated_at: h.generated_at })),
            }}
          />
        </div>
      </div>

      {/* U21: case Q&A threads (my cases, with status) */}
      <CaseQaSection />

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

      {/* U3: check-in timeline — dates + shedding estimates. Photos are
          not rendered: checkin photo_ids have no resolvable URL endpoint,
          so the UI says exactly that instead of faking images. */}
      {prog && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("p12.customer.photoTimeline")}</h3>
          {timeline.length === 0 && <p className="muted tiny">{t("p12.customer.noPhotos")}</p>}
          {timeline.length > 0 && (
            <p className="tiny muted">{t("p12.customer.noPhotos")}</p>
          )}
          {timeline.slice(0, 12).map((c) => (
            <p key={c.id} className="tiny" style={{ margin: "8px 0" }}>
              <b>{c.created_at.slice(0, 10)}</b>
              {c.shedding_estimate != null && (
                <span className="muted"> — {c.shedding_estimate}/100</span>
              )}
              {c.note && (
                <span className="muted"> — {c.note}</span>
              )}
            </p>
          ))}
        </div>
      )}

      {/* U16: true before/after photo slider across root-score versions. */}
      {rmHistory.length >= 2 && (() => {
        const hist = [...rmHistory].sort((a, b) => a.version - b.version);
        const bi = Math.min(cmpBefore, hist.length - 1);
        const ai = Math.min(cmpAfter < 0 ? hist.length - 1 : cmpAfter, hist.length - 1);
        const beforePhoto = hist[bi]?.photos?.[0];
        const afterPhoto = hist[ai]?.photos?.[0];
        const slide = (clientX: number, el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          setDivider(Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100)));
        };
        return (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("p12b.customer.compare")}</h3>
          <div className="rowflex">
            <label className="tiny muted" htmlFor="cmpb">{t("p12b.customer.before")}</label>
            <select id="cmpb" value={bi} onChange={(e) => { setCmpBefore(Number(e.target.value)); setDivider(50); }}>
              {hist.map((h, i) => <option key={h.version} value={i}>{t("progress.version", { v: h.version })} · {h.generated_at.slice(0, 10)}</option>)}
            </select>
            <label className="tiny muted" htmlFor="cmpa">{t("p12b.customer.after")}</label>
            <select id="cmpa" value={ai} onChange={(e) => { setCmpAfter(Number(e.target.value)); setDivider(50); }}>
              {hist.map((h, i) => <option key={h.version} value={i}>{t("progress.version", { v: h.version })} · {h.generated_at.slice(0, 10)}</option>)}
            </select>
          </div>
          {beforePhoto && afterPhoto ? (
            <div
              role="slider" aria-label={t("p12b.customer.compareSlider")} aria-valuenow={Math.round(divider)} aria-valuemin={0} aria-valuemax={100}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setDivider((v) => Math.max(4, v - 4));
                if (e.key === "ArrowRight") setDivider((v) => Math.min(96, v + 4));
              }}
              onPointerDown={(e) => { setDragging(true); slide(e.clientX, e.currentTarget); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
              onPointerMove={(e) => { if (dragging) slide(e.clientX, e.currentTarget); }}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
              style={{ position: "relative", overflow: "hidden", borderRadius: 12, marginTop: 12, touchAction: "none", cursor: "ew-resize", userSelect: "none" }}
            >
              <img src={afterPhoto} alt={t("p12b.customer.after")} style={{ display: "block", width: "100%", aspectRatio: "4 / 3", objectFit: "cover", pointerEvents: "none" }} draggable={false} />
              <img src={beforePhoto} alt={t("p12b.customer.before")} draggable={false}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", clipPath: `inset(0 ${100 - divider}% 0 0)` }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${divider}%`, width: 2, background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,.5)", pointerEvents: "none" }} />
              <span className="chip" style={{ position: "absolute", top: 8, left: 8, pointerEvents: "none" }}>{t("p12b.customer.before")}</span>
              <span className="chip" style={{ position: "absolute", top: 8, right: 8, pointerEvents: "none" }}>{t("p12b.customer.after")}</span>
            </div>
          ) : (
            <p className="muted tiny" style={{ marginTop: 12 }}>{t("p12b.customer.compareNoPhotos")}</p>
          )}
          {(Object.keys(hist[bi]?.roots ?? {}) as RootKey[]).map((r) => {
            const b = hist[bi]?.roots[r]?.score ?? 0;
            const a = hist[ai]?.roots[r]?.score ?? 0;
            const d = a - b;
            return (
              <div className="rowflex" key={r} style={{ margin: "6px 0" }}>
                <span className="tiny">{t(`jara.roots.${r}`)}</span>
                <span className="spacer" />
                <span className="tiny muted">{b} → {a}</span>
                <b className="tiny" style={{ color: d > 0 ? "var(--green)" : d < 0 ? "var(--bad)" : undefined }}>
                  {d > 0 ? `+${d}` : d}
                </b>
              </div>
            );
          })}
        </div>
        );
      })()}

      {/* U13: symptom diary — free text, never AI-scored */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12b.customer.symptoms")}</h3>
        <div className="formrow">
          <textarea value={symNote} onChange={(e) => setSymNote(e.target.value)} placeholder={t("p12b.customer.symptomPh")} rows={2} maxLength={2000} />
          <button className="btn btn-p" disabled={!symNote.trim()} onClick={saveSymptom}>{t("p12b.customer.saveToday")}</button>
        </div>
        {symptoms.slice(0, 10).map((s) => (
          <div className="rowflex" key={s.id} style={{ margin: "8px 0" }}>
            <p className="tiny" style={{ margin: 0 }}>
              <b>{s.entry_date}</b> <span className="muted">— {s.note}</span>
            </p>
            <span className="spacer" />
            <button className="btn btn-g btn-s" onClick={() => removeSymptom(s.id)} aria-label={t("common.delete")}>×</button>
          </div>
        ))}
      </div>

      {/* U15: sleep log */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12b.customer.sleep")}</h3>
        <div className="formrow inline">
          <label className="tiny muted" htmlFor="bed">{t("p12b.customer.bedtime")}</label>
          <input id="bed" type="time" value={bedtime} onChange={(e) => setBedtime(e.target.value)} />
          <label className="tiny muted" htmlFor="wake">{t("p12b.customer.wakeTime")}</label>
          <input id="wake" type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
          <label className="tiny muted" htmlFor="qual">{t("p12b.customer.quality")}</label>
          <select id="qual" value={quality} onChange={(e) => setQuality(e.target.value)}>
            {[1, 2, 3, 4, 5].map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <button className="btn" onClick={saveSleep}>{t("p12b.customer.saveToday")}</button>
        </div>
        {sleeps.slice(0, 7).map((s) => (
          <div className="rowflex" key={s.id} style={{ margin: "8px 0" }}>
            <p className="tiny" style={{ margin: 0 }}>
              <b>{s.log_date}</b>
              <span className="muted"> — {s.bedtime ?? "–"} → {s.wake_time ?? "–"}{s.quality != null ? ` · ${s.quality}/5` : ""}</span>
            </p>
            <span className="spacer" />
            <button className="btn btn-g btn-s" onClick={() => removeSleep(s.id)} aria-label={t("common.delete")}>×</button>
          </div>
        ))}
      </div>

      {/* C11: badges my coach awarded */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12b.customer.myBadges")}</h3>
        {myBadges.length === 0 && <p className="muted tiny">{t("p12b.customer.noBadges")}</p>}
        <div className="rowflex" style={{ flexWrap: "wrap", gap: 8 }}>
          {myBadges.map((b) => (
            <span key={b.id} className="chip" title={b.created_at.slice(0, 10)}>🏅 {b.badge}</span>
          ))}
        </div>
      </div>

      {/* C18: articles my coach shared */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12b.customer.coachArticles")}</h3>
        {myArticles.length === 0 && <p className="muted tiny">{t("p12b.customer.noCoachArticles")}</p>}
        {myArticles.map((a) => (
          <details key={a.id} style={{ margin: "8px 0" }}>
            <summary className="tiny"><b>{a.title_en}</b> <span className="muted">· {a.assigned_at.slice(0, 10)}</span></summary>
            <p className="tiny" style={{ whiteSpace: "pre-wrap" }}>{a.body_en}</p>
          </details>
        ))}
      </div>

      <div className="card center">
        <div style={{ color: "var(--green)" }}><Icon.camera size={32} /></div>
        <p className="tiny muted">{t("progress.checkinBody")}</p>
      </div>
    </div>
  );
}
