import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doctorApi, shopApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, ErrorCard, Loading, NoticeBox, ScoreBar, apiErrorMessage, toast } from "../../components/ui";
import { Icon } from "../../components/icons";
import type { AnnotationShape, Case, Kit, PlanItemKind, RedFlag, RootKey, ScanDetail } from "../../api/types";

interface ComposerItem {
  kind: PlanItemKind;
  title: string;
  detail: string;
  kit_id?: string;
}

const NOTE_TEMPLATES = ["tplShedding", "tplScalp", "tplNutrition", "tplStress", "tplWatch"] as const;

export default function DoctorCase() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLang();
  const [scan, setScan] = useState<ScanDetail | null>(null);
  const [theCase, setTheCase] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Annotation state: tap a photo to drop a circle marker.
  const [annotPhoto, setAnnotPhoto] = useState<string | null>(null);
  const [annotPoint, setAnnotPoint] = useState<{ x: number; y: number } | null>(null);
  const [annotNote, setAnnotNote] = useState("");

  // Plan composer state.
  const [items, setItems] = useState<ComposerItem[]>([{ kind: "habit", title: "", detail: "" }]);
  const [reviewNotes, setReviewNotes] = useState("");
  const [rescanDue, setRescanDue] = useState("");
  const [resolveIds, setResolveIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  // P-8: kits the doctor can prescribe (cosmetic kits only).
  const [kits, setKits] = useState<Kit[]>([]);

  useEffect(() => {
    shopApi.listKits(true).then((r) => setKits(r.kits)).catch(() => { /* optional */ });
  }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        // Fetch the case directly by id — the old approach (find it in the
        // first page of queued + in_review) broke for reviewed/needs_info
        // cases and for queues longer than one page, showing "Not found."
        const c = await doctorApi.getCase(id);
        setTheCase(c);
        setScan(await doctorApi.getCaseScan(c.scan_id));
        setLoading(false);
      } catch (e) {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      }
    })();
  }, [id, t]);

  const unresolved: RedFlag[] = useMemo(
    () => scan?.red_flags.filter((f) => !f.resolved_at) ?? [],
    [scan],
  );

  function tapPhoto(photoId: string, e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setAnnotPhoto(photoId);
    setAnnotPoint({
      x: Math.round(((e.clientX - r.left) / r.width) * 1000),
      y: Math.round(((e.clientY - r.top) / r.height) * 1000),
    });
  }

  async function saveAnnotation() {
    if (!id || !annotPhoto || !annotPoint || !annotNote.trim()) return;
    const shape: AnnotationShape = { kind: "circle", cx: annotPoint.x, cy: annotPoint.y, r: 60 };
    try {
      await doctorApi.annotatePhoto(id, annotPhoto, shape, annotNote.trim());
      setAnnotNote("");
      setAnnotPoint(null);
      toast(t("doctor.annotateSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

  function toggleResolve(flagId: string) {
    setResolveIds((v) => (v.includes(flagId) ? v.filter((x) => x !== flagId) : [...v, flagId]));
  }

  /** One-tap note templates: insert into the review notes, editable before approving. */
  function insertTemplate(key: (typeof NOTE_TEMPLATES)[number]) {
    const text = t(`doctor.${key}Text`);
    setReviewNotes((v) => (v.trim() ? `${v.trimEnd()}\n\n${text}` : text));
  }

  async function composeAndApprove() {
    if (!id) return;
    if (unresolved.some((f) => !resolveIds.includes(f.id))) {
      setError(t("doctor.approveBlockedFlags"));
      return;
    }
    const valid = items.filter((i) => i.title.trim());
    if (!valid.length) {
      setError(t("doctor.planActionPh"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const plan = await doctorApi.composePlan(id, {
        items: valid.map((i, n) => ({
          kind: i.kind,
          title_ne: i.title.trim(),
          title_en: i.title.trim(),
          detail: i.detail.trim() || undefined,
          kit_id: i.kit_id || undefined,
          sort_order: n,
        })),
        review_notes: reviewNotes.trim() || undefined,
        rescan_due_on: rescanDue || undefined,
        resolved_flag_ids: resolveIds.length ? resolveIds : undefined,
      });
      toast(t("doctor.planSaved"));
      await doctorApi.approvePlan(plan.id);
      setApproved(true);
      toast(t("doctor.approvedNote"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (!scan || !theCase) return <ErrorCard message={error ?? t("errors.not_found")} />;

  return (
    <div className="screen">
      <h1>{t("doctor.queueTitle")}</h1>
      {error && <ErrorCard message={error} />}
      {approved && (
        <NoticeBox tone="ok" title={t("doctor.approvedNote")}><p>{t("doctor.stReviewed")}</p></NoticeBox>
      )}

      <div className="card">
        <div className="rowflex">
          <div>
            <b className="kbd">{theCase.scan_id.slice(0, 8)}</b>
            <br />
            <span className="tiny muted">{t("doctor.status")}: {t(`doctor.st${theCase.status === "in_review" ? "InReview" : theCase.status === "needs_info" ? "NeedsInfo" : theCase.status === "reviewed" ? "Reviewed" : "New"}`)}</span>
          </div>
          <span className="spacer" />
          {theCase.priority === "red_flag" && <Chip tone="red">{t("doctor.redFlagPriority")}</Chip>}
        </div>
        <p className="tiny muted">{t("doctor.auditNote")}</p>
      </div>

      {unresolved.length > 0 && (
        <NoticeBox tone="flag" title={t("doctor.resolveFlags")}>
          {unresolved.map((f) => (
            <label className="rowflex" key={f.id} style={{ margin: "8px 0" }}>
              <input
                type="checkbox"
                checked={resolveIds.includes(f.id)}
                onChange={() => toggleResolve(f.id)}
                style={{ width: 28, height: 28, minHeight: 28 }}
              />
              <span><Chip tone="red">{t(`redflags.${f.flag_type}`)}</Chip></span>
            </label>
          ))}
        </NoticeBox>
      )}

      {scan.root_scores && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("doctor.scoresTitle")}</h3>
          {(Object.keys(scan.root_scores) as RootKey[]).map((r) => (
            <div className="rowflex" key={r} style={{ margin: "6px 0" }}>
              <span className="tiny">{t(`jara.roots.${r}`)}</span>
              <span className="spacer" />
              <ScoreBar score={scan.root_scores![r].score} />
              <b className="tiny">{scan.root_scores![r].score}</b>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("doctor.photosTitle")}</h3>
        <p className="tiny muted">{t("doctor.annotateHint")}</p>
        <div className="rowflex" style={{ alignItems: "flex-start" }}>
          {scan.photos.map((p) => (
            <div key={p.id} style={{ textAlign: "center" }}>
              <div style={{ position: "relative", width: 100, height: 100 }} onClick={(e) => tapPhoto(p.id, e)}>
                <img
                  src={p.thumb_url || p.signed_url}
                  alt={t(`lens.angles.${p.angle}`)}
                  style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 10, cursor: "crosshair" }}
                />
                {annotPhoto === p.id && annotPoint && (
                  <span
                    style={{
                      position: "absolute",
                      left: `${annotPoint.x / 10}%`,
                      top: `${annotPoint.y / 10}%`,
                      width: 18, height: 18, marginLeft: -9, marginTop: -9,
                      border: "3px solid var(--gold)", borderRadius: "50%",
                    }}
                  />
                )}
              </div>
              <div className="tiny muted">{t(`lens.angles.${p.angle}`)}</div>
            </div>
          ))}
        </div>
        {annotPoint && (
          <div className="rowflex" style={{ marginTop: 10 }}>
            <input
              type="text"
              placeholder={t("doctor.annotateNotePh")}
              value={annotNote}
              onChange={(e) => setAnnotNote(e.target.value)}
              aria-label={t("doctor.annotate")}
            />
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={saveAnnotation}>
              {t("doctor.annotateSaved")}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("doctor.storyTitle")}</h3>
        {scan.timeline_events.map((ev) => (
          <p key={ev.id} className="tiny">
            <b>{t(`kahani.pins.${ev.event_type}`)}</b> — {ev.occurred_on}
          </p>
        ))}
        {scan.timeline_events.length === 0 && <p className="tiny muted">—</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("doctor.composerTitle")}</h3>
        {items.map((item, n) => (
          <div key={n} style={{ margin: "10px 0", padding: 10, border: "1px solid var(--line)", borderRadius: 10 }}>
            <div className="rowflex">
              <select
                value={item.kind}
                onChange={(e) => setItems((v) => v.map((x, i) => (i === n ? { ...x, kind: e.target.value as PlanItemKind } : x)))}
                aria-label={t(`plan.itemKinds.${item.kind}`)}
                style={{ width: "auto" }}
              >
                {(["habit", "product", "consult", "referral"] as PlanItemKind[]).map((k) => (
                  <option key={k} value={k}>{t(`plan.itemKinds.${k}`)}</option>
                ))}
              </select>
              <span className="spacer" />
              {items.length > 1 && (
                <button className="linklike" style={{ color: "var(--bad)" }} onClick={() => setItems((v) => v.filter((_, i) => i !== n))}>
                  <Icon.cross size={16} />
                </button>
              )}
            </div>
            <input
              type="text"
              placeholder={t("doctor.planActionPh")}
              value={item.title}
              onChange={(e) => setItems((v) => v.map((x, i) => (i === n ? { ...x, title: e.target.value } : x)))}
              aria-label={t("doctor.planActionPh")}
            />
            {item.kind === "product" && (
              <>
                <label className="fl" htmlFor={`kit-${n}`}>{t("doctor.attachKit")}</label>
                <select
                  id={`kit-${n}`}
                  value={item.kit_id ?? ""}
                  onChange={(e) => setItems((v) => v.map((x, i) => (i === n ? { ...x, kit_id: e.target.value || undefined } : x)))}
                >
                  <option value="">{t("doctor.noKit")}</option>
                  {kits.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} — NPR {k.total_npr}
                    </option>
                  ))}
                </select>
                <p className="tiny muted" style={{ margin: "4px 0 0" }}>{t("doctor.attachKitHint")}</p>
              </>
            )}
          </div>
        ))}
        <button
          className="btn btn-g"
          onClick={() => setItems((v) => [...v, { kind: "habit", title: "", detail: "" }])}
        >
          + {t(`plan.itemKinds.habit`)}
        </button>
        <label className="fl" htmlFor="revnotes">{t("plan.reviewNotes")}</label>
        <div style={{ margin: "2px 0 8px" }}>
          <span className="tiny muted">{t("doctor.templates")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
            {NOTE_TEMPLATES.map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                style={{ cursor: "pointer", border: "1px solid var(--line)" }}
                onClick={() => insertTemplate(k)}
              >
                {t(`doctor.${k}Label`)}
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>{t("doctor.templatesHint")}</p>
        </div>
        <textarea id="revnotes" rows={3} placeholder={t("doctor.reviewNotesPh")} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
        <label className="fl" htmlFor="rescan">{t("doctor.rescanDate")}</label>
        <input id="rescan" type="date" value={rescanDue} onChange={(e) => setRescanDue(e.target.value)} />
        <button className="btn btn-p" disabled={busy || approved} onClick={composeAndApprove}>
          {busy ? t("common.loading") : t("doctor.approve")}
        </button>
      </div>

      <Link className="linklike" to="/doctor">← {t("doctor.backToQueue")}</Link>
      <span className="sr-only">{lang}</span>
    </div>
  );
}
