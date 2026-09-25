import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doctorApi, shopApi } from "../../api/client";
import { doctorB3Api } from "../../api/b3doctor";
import { doctorB4Api } from "../../api/b4doctor";
import type {
  B4CaseComment, B4CaseMessage, B4ConcernTag, B4PriorityEntry, B4SimilarCase,
} from "../../api/b4doctor";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, ErrorCard, Loading, Modal, NoticeBox, ScoreBar, apiErrorMessage, toast } from "../../components/ui";
import { Icon } from "../../components/icons";
import type { AnnotationShape, Case, Kit, PatientCase, PlanItemKind, RedFlag, RootKey, ScanDetail } from "../../api/types";

interface ComposerItem {
  kind: PlanItemKind;
  title: string;
  detail: string;
  kit_id?: string;
}

const NOTE_TEMPLATES = ["tplShedding", "tplScalp", "tplNutrition", "tplStress", "tplWatch"] as const;

type TFn = (k: string, vars?: Record<string, string | number>) => string;

/**
 * D5: root score trend — one SVG polyline per root across the patient's
 * scans (ordered by created_at), built only from real root_scores.
 */
function TrendChart({ cases, t }: { cases: PatientCase[]; t: TFn }) {
  const series = useMemo(() => {
    const sorted = [...cases]
      .filter((c) => c.root_scores && c.root_scores.length > 0)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (sorted.length < 2) return null;
    const roots = Array.from(new Set(sorted.flatMap((c) => c.root_scores.map((r) => r.root))));
    return { sorted, roots };
  }, [cases]);

  if (!series) return <p className="tiny muted">{t("p12.doctor.noTrend")}</p>;

  const W = 320;
  const H = 170;
  const P = 26;
  const X = (i: number) =>
    series.sorted.length === 1 ? W / 2 : P + (i / (series.sorted.length - 1)) * (W - 2 * P);
  const Y = (s: number) => H - P - ((Math.max(0, Math.min(100, s)) / 100) * (H - 2 * P));
  const COLORS = ["#1a7f37", "#8250df", "#b42318", "#0550ae", "#9a6700", "#0a7ea4"];
  const rootName = (r: string) => {
    const k = `jara.roots.${r}`;
    const s = t(k);
    return s === k ? r : s;
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 440 }} role="img" aria-label={t("p12.doctor.trend")}>
        <line x1={P} y1={P} x2={P} y2={H - P} stroke="var(--line)" />
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--line)" />
        {series.roots.map((root, ri) => {
          const pts = series.sorted
            .map((c, i) => {
              const rs = c.root_scores.find((r) => r.root === root);
              return rs ? { i, s: rs.score } : null;
            })
            .filter((x): x is { i: number; s: number } => x !== null);
          if (pts.length < 2) return null;
          return (
            <g key={root}>
              <polyline
                fill="none"
                stroke={COLORS[ri % COLORS.length]}
                strokeWidth={2.5}
                strokeLinejoin="round"
                points={pts.map((p) => `${X(p.i)},${Y(p.s)}`).join(" ")}
              />
              {pts.map((p) => (
                <circle key={p.i} cx={X(p.i)} cy={Y(p.s)} r={3.5} fill={COLORS[ri % COLORS.length]} />
              ))}
            </g>
          );
        })}
        {series.sorted.map((c, i) => (
          <text key={c.id} x={X(i)} y={H - 8} fontSize={9} textAnchor="middle" fill="var(--muted)">
            {c.created_at.slice(5, 10)}
          </text>
        ))}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {series.roots.map((root, ri) => (
          <span key={root} className="tiny" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 4, background: COLORS[ri % COLORS.length], borderRadius: 2 }} />
            {rootName(root)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * D4: freehand draw panel for one photo. The canvas overlays the photo;
 * pointer strokes are painted for feedback and returned as 0–1000
 * coordinates for the "path" annotation shape.
 */
function DrawPanel({
  photo,
  onSave,
  onCancel,
  t,
}: {
  photo: { thumb_url?: string | null; signed_url: string; angle: string };
  onSave: (points: { x: number; y: number }[]) => void;
  onCancel: () => void;
  t: TFn;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef<{ x: number; y: number }[]>([]);
  const drawing = useRef(false);
  const [canSave, setCanSave] = useState(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * 1000),
      y: Math.round(((e.clientY - r.top) / r.height) * 1000),
    };
  }
  function paint(from: { x: number; y: number } | null, to: { x: number; y: number }) {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const s = cv.width / 1000;
    ctx.strokeStyle = "#f5c518";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (from) ctx.moveTo(from.x * s, from.y * s);
    else ctx.moveTo(to.x * s, to.y * s);
    ctx.lineTo(to.x * s, to.y * s);
    ctx.stroke();
  }
  function clear() {
    const cv = canvasRef.current;
    if (cv) cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
    ptsRef.current = [];
    setCanSave(false);
  }

  return (
    <>
      <div style={{ position: "relative", width: 100, height: 100 }}>
        <img
          src={photo.thumb_url || photo.signed_url}
          alt={t(`lens.angles.${photo.angle}`)}
          style={{ position: "absolute", inset: 0, width: 100, height: 100, objectFit: "cover", borderRadius: 10 }}
        />
        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            borderRadius: 10,
            touchAction: "none",
            cursor: "crosshair",
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            const p = pos(e);
            ptsRef.current = [p];
            paint(null, p);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = pos(e);
            const prev = ptsRef.current[ptsRef.current.length - 1];
            ptsRef.current.push(p);
            paint(prev, p);
            if (ptsRef.current.length >= 2) setCanSave(true);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
      </div>
      <div className="btn-row" style={{ marginTop: 4, justifyContent: "center" }}>
        <button className="btn btn-s" style={{ width: "auto", margin: 0, padding: "4px 10px", minHeight: 32 }} onClick={clear}>
          {t("p12.doctor.drawClear")}
        </button>
        <button
          className="btn btn-s"
          style={{ width: "auto", margin: 0, padding: "4px 10px", minHeight: 32 }}
          disabled={!canSave}
          onClick={() => onSave(ptsRef.current)}
        >
          {t("p12.doctor.drawSave")}
        </button>
        <button className="linklike" onClick={onCancel}>{t("p12.common.cancel")}</button>
      </div>
    </>
  );
}

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

  // D4: freehand drawing on a photo (overlay canvas per photo).
  const [drawPhoto, setDrawPhoto] = useState<string | null>(null);

  // D3/D5: patient timeline + score trend, fetched from real case history.
  const [timeline, setTimeline] = useState<PatientCase[] | null>(null);

  // Plan composer state.
  const [items, setItems] = useState<ComposerItem[]>([{ kind: "habit", title: "", detail: "" }]);
  const [reviewNotes, setReviewNotes] = useState("");
  // Batch-2 (008): bookmarks (D13), snippets (D12), checklist (D14), photo requests (D16).
  const [bookmarked, setBookmarked] = useState(false);
  const [mySnippets, setMySnippets] = useState<{ id: string; title: string; body_en: string }[]>([]);
  const [checklist, setChecklist] = useState<{ id: string; items: { id: string; label_en: string; label_ne: string | null; done: boolean }[] } | null>(null);
  const [prAngles, setPrAngles] = useState("");
  const [prNote, setPrNote] = useState("");
  const [prSent, setPrSent] = useState(false);
  const [b2err, setB2err] = useState<string | null>(null);
  const [rescanDue, setRescanDue] = useState("");
  const [resolveIds, setResolveIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  // P-8: kits the doctor can prescribe (cosmetic kits only).
  const [kits, setKits] = useState<Kit[]>([]);
  // ---- Batch-3 (009) ----
  // D20 archive, D22 second opinion, D26 transfer, D21 compare, D27 print.
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [soOpen, setSoOpen] = useState(false);
  const [soReviewer, setSoReviewer] = useState("");
  const [soNote, setSoNote] = useState("");
  const [soBusy, setSoBusy] = useState(false);
  const [trOpen, setTrOpen] = useState(false);
  const [trDoctor, setTrDoctor] = useState("");
  const [trReason, setTrReason] = useState("");
  const [trBusy, setTrBusy] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  // ---- Batch-4 (010) ----
  // D45: review session timer (client-only elapsed chip).
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);
  // D30: SLA pause state (from the case detail payload).
  const [slaPausedAt, setSlaPausedAt] = useState<string | null>(null);
  // D28: share-summary modal.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  // D31: needs-info (photo requests).
  const [photoRequests, setPhotoRequests] = useState<{ id: string; angles: string; note: string | null; created_at: string }[] | null>(null);
  // D32: internal doctor comments.
  const [comments, setComments] = useState<B4CaseComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  // D33: concern tags.
  const [concerns, setConcerns] = useState<B4ConcernTag[]>([]);
  const [allowedTags, setAllowedTags] = useState<string[]>([]);
  const [concernPick, setConcernPick] = useState("");
  // D35: priority history.
  const [priHistory, setPriHistory] = useState<B4PriorityEntry[] | null>(null);
  // D36: one resolution note per resolved flag.
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});
  // D41: case Q&A (doctor side).
  const [messages, setMessages] = useState<B4CaseMessage[]>([]);
  const [msgBody, setMsgBody] = useState("");
  const [msgBusy, setMsgBusy] = useState(false);
  // D38: similar past cases.
  const [similar, setSimilar] = useState<B4SimilarCase[] | null>(null);
  const [b4err, setB4err] = useState<string | null>(null);

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
        setSlaPausedAt(c.sla_paused_at ?? null);
        doctorApi.listBookmarks().then((r) => setBookmarked(r.case_ids.includes(c.id))).catch(() => {});
        doctorApi.listSnippets().then((r) => setMySnippets(r.snippets)).catch(() => {});
        doctorApi.getChecklist(c.id).then((r) => setChecklist(r.checklist)).catch(() => {});
        // ---- Batch-4 (010): D31 photo requests, D32 comments, D33 concerns,
        // D35 priority history, D38 similar cases, D41 Q&A (all optional).
        doctorB4Api.needsInfo(c.id).then((r) => setPhotoRequests(r.photo_requests)).catch(() => setPhotoRequests([]));
        doctorB4Api.listComments(c.id).then((r) => setComments(r.comments)).catch(() => {});
        doctorB4Api.listConcerns(c.id).then((r) => { setConcerns(r.concerns); setAllowedTags(r.allowed_tags); }).catch(() => {});
        doctorB4Api.priorityHistory(c.id).then((r) => setPriHistory(r.history)).catch(() => setPriHistory([]));
        doctorB4Api.similarCases(c.id).then((r) => setSimilar(r.similar)).catch(() => setSimilar([]));
        doctorB4Api.listMessages(c.id).then((r) => setMessages(r.messages)).catch(() => {});
        // D3/D5: the patient's other cases feed the timeline + score trend.
        doctorApi
          .patientCases(c.user_id)
          .then((r) => setTimeline(r.cases))
          .catch(() => setTimeline([]));
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

  /** D4: save the freehand drawing as a "path" annotation (reuses the note input). */
  async function saveDrawing(photoId: string, points: { x: number; y: number }[]) {
    if (!id || points.length < 2) return;
    if (!annotNote.trim()) {
      setError(t("doctor.annotateNotePh"));
      return;
    }
    const shape: AnnotationShape = { kind: "path", points };
    try {
      await doctorApi.annotatePhoto(id, photoId, shape, annotNote.trim());
      setAnnotNote("");
      setDrawPhoto(null);
      toast(t("p12.doctor.drawSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

  function toggleResolve(flagId: string) {
    setResolveIds((v) => (v.includes(flagId) ? v.filter((x) => x !== flagId) : [...v, flagId]));
  }

  /** One-tap note templates: insert into the review notes, editable before approving. */
  // ---- Batch-2 (008) helpers ----
  async function toggleBookmark() {
    if (!theCase) return;
    try {
      if (bookmarked) { await doctorApi.unbookmarkCase(theCase.id); setBookmarked(false); }
      else { await doctorApi.bookmarkCase(theCase.id); setBookmarked(true); }
    } catch (e) { setB2err(apiErrorMessage(t, e)); }
  }
  function insertSnippetBody(body: string) {
    setReviewNotes((v) => (v ? v + "\n" : "") + body);
  }
  async function ensureChecklist() {
    if (!theCase || checklist) return;
    try { setChecklist((await doctorApi.createChecklist(theCase.id)).checklist); }
    catch (e) { setB2err(apiErrorMessage(t, e)); }
  }
  async function toggleCheckItem(itemId: string, done: boolean) {
    try {
      const updated = await doctorApi.setChecklistItemDone(itemId, done);
      setChecklist((cl) => cl && { ...cl, items: cl.items.map((i) => (i.id === updated.id ? updated : i)) });
    } catch (e) { setB2err(apiErrorMessage(t, e)); }
  }
  async function sendPhotoRequest() {
    if (!theCase || !prAngles.trim()) return;
    try {
      await doctorApi.createPhotoRequest(theCase.id, prAngles.trim(), prNote.trim() || undefined);
      setPrAngles(""); setPrNote(""); setPrSent(true);
      toast(t("p12b.doctor.photoRequestSent"));
    } catch (e) { setB2err(apiErrorMessage(t, e)); }
  }

  // ---- Batch-3 (009) handlers ----
  /** D20: archive this case (confirm first). */
  async function doArchive() {
    if (!theCase || archiveBusy) return;
    setArchiveBusy(true);
    try {
      const r = await doctorB3Api.archiveCase(theCase.id);
      setTheCase({ ...theCase, archived_at: r.case.archived_at } as Case);
      setArchiveConfirm(false);
      toast(t("p12c.doctor.archiveOk"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setArchiveBusy(false);
    }
  }
  /** D22: send a second-opinion request to another doctor. */
  async function sendSecondOpinion() {
    if (!theCase || !soReviewer.trim() || soBusy) return;
    setSoBusy(true);
    try {
      await doctorB3Api.requestSecondOpinion(theCase.id, soReviewer.trim(), soNote.trim() || undefined);
      setSoOpen(false);
      setSoReviewer("");
      setSoNote("");
      toast(t("p12c.doctor.soSent"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSoBusy(false);
    }
  }
  /** D26: transfer the case to another doctor (confirm first). */
  async function doTransfer() {
    if (!theCase || !trDoctor.trim() || trBusy) return;
    setTrBusy(true);
    try {
      const r = await doctorB3Api.transferCase(theCase.id, trDoctor.trim(), trReason.trim() || undefined);
      setTheCase({ ...theCase, assigned_doctor_id: r.case.assigned_doctor_id } as Case);
      setTrOpen(false);
      setTrDoctor("");
      setTrReason("");
      toast(t("p12c.doctor.trOk"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setTrBusy(false);
    }
  }
  /** D27: print-friendly export of this case. */
  function printCase() {
    window.print();
  }

  // ---- Batch-4 (010) handlers ----
  /** D28: share a plain-language summary with the patient. */
  async function sendShareSummary() {
    if (!theCase || !shareText.trim() || shareBusy) return;
    setShareBusy(true);
    try {
      await doctorB4Api.shareSummary(theCase.id, shareText.trim());
      setShareOpen(false);
      setShareText("");
      toast(t("p12d.doctor.shareOk"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setShareBusy(false);
    }
  }
  /** D30: pause / resume the SLA clock. */
  async function toggleSla() {
    if (!theCase) return;
    try {
      const r = slaPausedAt
        ? await doctorB4Api.resumeSla(theCase.id)
        : await doctorB4Api.pauseSla(theCase.id);
      setSlaPausedAt(r.sla_paused_at);
    } catch (e) {
      setB4err(apiErrorMessage(t, e));
    }
  }
  /** D32: add an internal doctor-only comment. */
  async function sendComment() {
    if (!theCase || !commentBody.trim() || commentBusy) return;
    setCommentBusy(true);
    try {
      const r = await doctorB4Api.addComment(theCase.id, commentBody.trim());
      setComments((v) => [...v, r.comment]);
      setCommentBody("");
    } catch (e) {
      setB4err(apiErrorMessage(t, e));
    } finally {
      setCommentBusy(false);
    }
  }
  /** D33: add a concern tag (server is idempotent). */
  async function addConcern() {
    if (!theCase || !concernPick) return;
    try {
      const r = await doctorB4Api.addConcern(theCase.id, concernPick);
      setConcerns((v) => (v.some((c) => c.id === r.concern.id) ? v : [...v, r.concern]));
      setConcernPick("");
      toast(t("p12d.doctor.concernAdded"));
    } catch (e) {
      setB4err(apiErrorMessage(t, e));
    }
  }
  /** D33: remove a concern tag. */
  async function removeConcern(tag: string) {
    if (!theCase) return;
    try {
      await doctorB4Api.removeConcern(theCase.id, tag);
      setConcerns((v) => v.filter((c) => c.tag !== tag));
      toast(t("p12d.doctor.concernRemoved"));
    } catch (e) {
      setB4err(apiErrorMessage(t, e));
    }
  }
  /** D41: reply in the case Q&A thread. */
  async function sendMessage() {
    if (!theCase || !msgBody.trim() || msgBusy) return;
    setMsgBusy(true);
    try {
      const m = await doctorB4Api.sendMessage(theCase.id, msgBody.trim());
      setMessages((v) => [...v, m]);
      setMsgBody("");
      toast(t("p12d.doctor.messageSent"));
    } catch (e) {
      setB4err(apiErrorMessage(t, e));
    } finally {
      setMsgBusy(false);
    }
  }

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
    // D36: every resolved flag must carry a non-empty resolution note.
    const flagNotes: Record<string, string> = {};
    for (const fid of resolveIds) {
      const note = (resolveNotes[fid] ?? "").trim();
      if (!note) {
        setError(t("p12d.doctor.resolveNoteMissing"));
        return;
      }
      flagNotes[fid] = note;
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
        resolved_flag_notes: resolveIds.length ? flagNotes : undefined,
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
          <button type="button" className={`chip${bookmarked ? " active" : ""}`} style={{ cursor: "pointer" }} onClick={toggleBookmark} aria-pressed={bookmarked}>
            {bookmarked ? "\u2605" : "\u2606"} {t("p12b.doctor.bookmark")}
          </button>
          {/* D45: review session timer (client-only elapsed chip) */}
          <span
            className="chip"
            title={t("p12d.doctor.timerTitle")}
            aria-label={`${t("p12d.doctor.timerTitle")}: ${String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:${String(elapsedSec % 60).padStart(2, "0")}`}
          >
            ⏱ {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:{String(elapsedSec % 60).padStart(2, "0")}
          </span>
          {theCase.priority === "red_flag" && <Chip tone="red">{t("doctor.redFlagPriority")}</Chip>}
          {slaPausedAt && <Chip tone="amber">{t("p12d.doctor.slaPausedBadge")}</Chip>}
        </div>
        <p className="tiny muted">{t("doctor.auditNote")}</p>
        {/* Batch-3 (009): D20 archive, D22 second opinion, D26 transfer, D27 print */}
        <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 6 }}>
          {(theCase as { archived_at?: string | null }).archived_at ? (
            <Chip tone="grey">{t("p12c.doctor.archivedBadge")}</Chip>
          ) : (
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setArchiveConfirm(true)}>
              {t("p12c.doctor.archiveBtn")}
            </button>
          )}
          <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setSoOpen(true)}>
            {t("p12c.doctor.soRequestBtn")}
          </button>
          <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setTrOpen(true)}>
            {t("p12c.doctor.trTitle")}
          </button>
          <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={printCase}>
            {t("p12c.doctor.exportPrint")}
          </button>
          {/* Batch-4 (010): D28 share summary, D30 SLA pause/resume */}
          <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setShareOpen(true)}>
            {t("p12d.doctor.shareBtn")}
          </button>
          <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={toggleSla}>
            {slaPausedAt ? t("p12d.doctor.slaResume") : t("p12d.doctor.slaPause")}
          </button>
        </div>
      </div>

      {unresolved.length > 0 && (
        <NoticeBox tone="flag" title={t("doctor.resolveFlags")}>
          {unresolved.map((f) => (
            <div key={f.id} style={{ margin: "8px 0" }}>
              <label className="rowflex">
                <input
                  type="checkbox"
                  checked={resolveIds.includes(f.id)}
                  onChange={() => toggleResolve(f.id)}
                  style={{ width: 28, height: 28, minHeight: 28 }}
                />
                <span><Chip tone="red">{t(`redflags.${f.flag_type}`)}</Chip></span>
              </label>
              {/* D36: one required resolution note per resolved flag */}
              {resolveIds.includes(f.id) && (
                <input
                  type="text"
                  placeholder={t("p12d.doctor.resolveNotePh")}
                  value={resolveNotes[f.id] ?? ""}
                  onChange={(e) => setResolveNotes((v) => ({ ...v, [f.id]: e.target.value }))}
                  aria-label={t("p12d.doctor.resolveNotePh")}
                  maxLength={2000}
                  style={{ marginTop: 4 }}
                />
              )}
            </div>
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

      {/* D3: patient timeline — the patient's other cases. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.doctor.timeline")}</h3>
        {!timeline && <p className="tiny muted">{t("common.loading")}</p>}
        {timeline && timeline.filter((c) => c.id !== theCase.id).length === 0 && (
          <p className="tiny muted">{t("p12.doctor.noTimeline")}</p>
        )}
        {timeline &&
          timeline
            .filter((c) => c.id !== theCase.id)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map((c) => (
              <div key={c.id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                <div className="rowflex">
                  <span className="tiny">{c.created_at.slice(0, 10)}</span>
                  <span className="chip">{c.status}</span>
                  {c.red_flag_count > 0 && (
                    <Chip tone="red">{t("p12.doctor.prRed")} × {c.red_flag_count}</Chip>
                  )}
                  <span className="spacer" />
                  <Link className="linklike" to={`/doctor/case/${c.id}`}>
                    {t("doctor.openCase")}
                  </Link>
                </div>
              </div>
            ))}
      </div>

      {/* D5: root score trend across the patient's scans. */}
      {timeline && timeline.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("p12.doctor.trend")}</h3>
          <TrendChart cases={timeline} t={t} />
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("doctor.photosTitle")}</h3>
        <p className="tiny muted">{t("doctor.annotateHint")}</p>
        <p className="tiny muted">{t("p12.doctor.drawHint")}</p>
        {/* D21: baseline-vs-latest compare mode (reuses existing photo URLs) */}
        <div className="rowflex" style={{ margin: "4px 0 8px" }}>
          <button
            className={`btn btn-s${compareMode ? " btn-p" : ""}`}
            style={{ width: "auto", margin: 0 }}
            onClick={() => setCompareMode((v) => !v)}
            aria-pressed={compareMode}
            disabled={scan.photos.length < 2}
          >
            {t("p12c.doctor.lightboxCompare")}
          </button>
          <span className="tiny muted">{t("p12c.doctor.lightboxHint")}</span>
        </div>
        {compareMode && scan.photos.length >= 2 && (() => {
          const sorted = [...scan.photos].sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          const baseline = sorted[0];
          const latest = sorted[sorted.length - 1];
          return (
            <div className="rowflex" style={{ alignItems: "flex-start", marginBottom: 10 }}>
              {[
                { p: baseline, label: baseline.created_at.slice(0, 10) },
                { p: latest, label: latest.created_at.slice(0, 10) },
              ].map(({ p, label }) => (
                <div key={p.id} style={{ flex: 1, textAlign: "center" }}>
                  <img
                    src={p.thumb_url || p.signed_url}
                    alt={`${t(`lens.angles.${p.angle}`)} — ${label}`}
                    style={{ width: "100%", maxWidth: 220, objectFit: "cover", borderRadius: 10 }}
                  />
                  <div className="tiny muted">
                    {t(`lens.angles.${p.angle}`)} · {label}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        <div className="rowflex" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          {scan.photos.map((p) => (
            <div key={p.id} style={{ textAlign: "center" }}>
              {drawPhoto === p.id ? (
                <DrawPanel photo={p} t={t} onSave={(pts) => saveDrawing(p.id, pts)} onCancel={() => setDrawPhoto(null)} />
              ) : (
                <>
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
                  <button
                    className="btn btn-s"
                    style={{ width: "auto", margin: "4px 0 0", padding: "4px 10px", minHeight: 32 }}
                    onClick={() => {
                      setDrawPhoto(p.id);
                      setAnnotPoint(null);
                    }}
                  >
                    {t("p12.doctor.drawTitle")}
                  </button>
                </>
              )}
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

      {b2err ? <ErrorCard message={b2err} /> : null}

      {/* D14: review checklist */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12b.doctor.checklist")}</h3>
        {!checklist && (
          <button className="btn btn-g" onClick={ensureChecklist}>{t("p12b.doctor.startChecklist")}</button>
        )}
        {checklist && checklist.items.map((i) => (
          <label className="rowflex" key={i.id} style={{ margin: "8px 0" }}>
            <input type="checkbox" checked={i.done} onChange={(e) => toggleCheckItem(i.id, e.target.checked)} style={{ width: 28, height: 28, minHeight: 28 }} />
            <span>{i.label_en}</span>
          </label>
        ))}
      </div>

      {/* D16: request more photos from the patient */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12b.doctor.photoRequest")}</h3>
        {prSent ? <p className="tiny" style={{ color: "var(--ok)" }}>{t("p12b.doctor.photoRequestSent")}</p> : null}
        <label className="fl" htmlFor="prangles">{t("p12b.doctor.angles")}</label>
        <input id="prangles" value={prAngles} onChange={(e) => setPrAngles(e.target.value)} placeholder={t("p12b.doctor.anglesPh")} maxLength={500} />
        <label className="fl" htmlFor="prnote">{t("p12b.doctor.noteOptional")}</label>
        <input id="prnote" value={prNote} onChange={(e) => setPrNote(e.target.value)} placeholder={t("p12b.doctor.notePh")} maxLength={500} />
        <button className="btn btn-g" disabled={!prAngles.trim()} onClick={sendPhotoRequest} style={{ marginTop: 8 }}>
          {t("p12b.doctor.sendPhotoRequest")}
        </button>
      </div>

      {b4err ? <ErrorCard message={b4err} /> : null}

      {/* D31: needs-info — the case's photo requests */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.needsInfoTitle")}</h3>
        {photoRequests === null && <p className="tiny muted">{t("common.loading")}</p>}
        {photoRequests && photoRequests.length === 0 && (
          <p className="tiny muted">{t("p12d.doctor.needsInfoEmpty")}</p>
        )}
        {photoRequests && photoRequests.map((pr) => (
          <div key={pr.id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
            <b className="tiny">{pr.angles}</b>
            {pr.note && <div className="tiny muted">{pr.note}</div>}
            <div className="tiny muted">{pr.created_at.slice(0, 10)}</div>
          </div>
        ))}
      </div>

      {/* D32: doctor-only internal comment thread */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.commentsTitle")}</h3>
        {comments.length === 0 && <p className="tiny muted">{t("p12d.doctor.commentsEmpty")}</p>}
        {comments.map((c) => (
          <div key={c.id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
            <p className="tiny" style={{ margin: 0 }}>{c.body}</p>
            <div className="tiny muted">{c.created_at.slice(0, 16).replace("T", " ")}</div>
          </div>
        ))}
        <div className="rowflex" style={{ marginTop: 8 }}>
          <input
            type="text"
            placeholder={t("p12d.doctor.commentPh")}
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            aria-label={t("p12d.doctor.commentPh")}
            maxLength={2000}
          />
          <button
            className="btn btn-s"
            style={{ width: "auto", margin: 0 }}
            disabled={commentBusy || !commentBody.trim()}
            onClick={sendComment}
          >
            {commentBusy ? t("common.loading") : t("p12d.doctor.commentSend")}
          </button>
        </div>
      </div>

      {/* D33: non-diagnostic concern tags */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.concernsTitle")}</h3>
        <p className="tiny muted">{t("p12d.doctor.concernsHint")}</p>
        <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 6 }}>
          {concerns.map((c) => (
            <span key={c.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t(`p12d.doctor.tag_${c.tag}`, { defaultValue: c.tag })}
              <button
                type="button"
                className="linklike"
                style={{ color: "var(--bad)" }}
                onClick={() => removeConcern(c.tag)}
                aria-label={c.tag}
              >
                <Icon.cross size={14} />
              </button>
            </span>
          ))}
        </div>
        <div className="rowflex" style={{ marginTop: 8 }}>
          <select
            value={concernPick}
            onChange={(e) => setConcernPick(e.target.value)}
            aria-label={t("p12d.doctor.concernsTitle")}
            style={{ width: "auto" }}
          >
            <option value="">—</option>
            {allowedTags.filter((tag) => !concerns.some((c) => c.tag === tag)).map((tag) => (
              <option key={tag} value={tag}>{t(`p12d.doctor.tag_${tag}`, { defaultValue: tag })}</option>
            ))}
          </select>
          <button
            className="btn btn-s"
            style={{ width: "auto", margin: 0 }}
            disabled={!concernPick}
            onClick={addConcern}
          >
            {t("p12d.doctor.concernAdd")}
          </button>
        </div>
      </div>

      {/* D41: case Q&A (doctor side) */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.messagesTitle")}</h3>
        {messages.length === 0 && <p className="tiny muted">{t("p12d.doctor.messagesEmpty")}</p>}
        {messages.map((m) => (
          <div key={m.id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
            <span className={`chip${m.author_role === "doctor" ? " active" : ""}`}>{m.author_role}</span>
            <p className="tiny" style={{ margin: "4px 0 0" }}>{m.body}</p>
            <div className="tiny muted">{m.created_at.slice(0, 16).replace("T", " ")}</div>
          </div>
        ))}
        <div className="rowflex" style={{ marginTop: 8 }}>
          <input
            type="text"
            placeholder={t("p12d.doctor.messagePh")}
            value={msgBody}
            onChange={(e) => setMsgBody(e.target.value)}
            aria-label={t("p12d.doctor.messagePh")}
            maxLength={2000}
          />
          <button
            className="btn btn-s"
            style={{ width: "auto", margin: 0 }}
            disabled={msgBusy || !msgBody.trim()}
            onClick={sendMessage}
          >
            {msgBusy ? t("common.loading") : t("p12d.doctor.messageSend")}
          </button>
        </div>
      </div>

      {/* D38: similar past cases (reference only) */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.similarTitle")}</h3>
        <p className="tiny muted">{t("p12d.doctor.similarHint")}</p>
        {similar === null && <p className="tiny muted">{t("common.loading")}</p>}
        {similar && similar.length === 0 && (
          <p className="tiny muted">{t("p12d.doctor.similarEmpty")}</p>
        )}
        {similar && similar.map((sc, i) => (
          <div key={sc.id} style={{ padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
            <div className="rowflex">
              <span className="tiny muted">{sc.created_at.slice(0, 10)}</span>
              <span className="chip">{sc.status}</span>
              <span className="tiny muted">{t("p12d.doctor.similarDistance", { n: sc.distance })}</span>
              <span className="spacer" />
              <Link className="linklike" to={`/doctor/case/${sc.id}`}>
                {t("doctor.openCase")}
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* D35: priority history */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.priorityHistoryTitle")}</h3>
        {priHistory === null && <p className="tiny muted">{t("common.loading")}</p>}
        {priHistory && priHistory.length === 0 && (
          <p className="tiny muted">{t("p12d.doctor.priorityHistoryEmpty")}</p>
        )}
        {priHistory && priHistory.map((h) => (
          <div key={String(h.id)} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
            <b className="tiny">{h.action}</b>
            <div className="tiny muted">{h.at.slice(0, 16).replace("T", " ")}</div>
            {h.detail && <div className="tiny muted kbd">{h.detail.slice(0, 120)}</div>}
          </div>
        ))}
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
          {mySnippets.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span className="tiny muted">{t("p12b.doctor.mySnippets")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                {mySnippets.map((s) => (
                  <button key={s.id} type="button" className="chip" style={{ cursor: "pointer", border: "1px solid var(--line)" }} onClick={() => insertSnippetBody(s.body_en)}>
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          )}
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

      {/* Batch-3 (009) modals */}
      {archiveConfirm && (
        <Modal onClose={() => setArchiveConfirm(false)}>
          <p>{t("p12c.doctor.archiveConfirm")}</p>
          <div className="rowflex">
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setArchiveConfirm(false)}>
              {t("p12c.doctor.archiveCancel")}
            </button>
            <button className="btn btn-p btn-s" style={{ width: "auto", margin: 0 }} disabled={archiveBusy} onClick={doArchive}>
              {archiveBusy ? t("common.loading") : t("p12c.doctor.archiveBtn")}
            </button>
          </div>
        </Modal>
      )}

      {soOpen && (
        <Modal onClose={() => setSoOpen(false)}>
          <h3 style={{ marginTop: 0 }}>{t("p12c.doctor.soRequestBtn")}</h3>
          <label className="fl" htmlFor="soreviewer">{t("p12c.doctor.soReviewerLabel")}</label>
          <input
            id="soreviewer"
            value={soReviewer}
            onChange={(e) => setSoReviewer(e.target.value)}
            placeholder={t("p12c.doctor.soReviewerPh")}
            aria-label={t("p12c.doctor.soReviewerLabel")}
          />
          <label className="fl" htmlFor="sonote">{t("p12c.doctor.soNoteLabel")}</label>
          <textarea
            id="sonote"
            rows={3}
            value={soNote}
            onChange={(e) => setSoNote(e.target.value)}
            placeholder={t("p12c.doctor.soNotePh")}
            maxLength={2000}
          />
          <div className="rowflex">
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setSoOpen(false)}>
              {t("p12c.doctor.archiveCancel")}
            </button>
            <button
              className="btn btn-p btn-s"
              style={{ width: "auto", margin: 0 }}
              disabled={soBusy || !soReviewer.trim()}
              onClick={sendSecondOpinion}
            >
              {soBusy ? t("common.loading") : t("p12c.doctor.soSend")}
            </button>
          </div>
        </Modal>
      )}

      {trOpen && (
        <Modal onClose={() => setTrOpen(false)}>
          <h3 style={{ marginTop: 0 }}>{t("p12c.doctor.trTitle")}</h3>
          <p className="tiny muted">{t("p12c.doctor.trConfirm")}</p>
          <label className="fl" htmlFor="trdoctor">{t("p12c.doctor.trToLabel")}</label>
          <input
            id="trdoctor"
            value={trDoctor}
            onChange={(e) => setTrDoctor(e.target.value)}
            placeholder={t("p12c.doctor.trToPh")}
            aria-label={t("p12c.doctor.trToLabel")}
          />
          <label className="fl" htmlFor="trreason">{t("p12c.doctor.trReasonLabel")}</label>
          <textarea
            id="trreason"
            rows={2}
            value={trReason}
            onChange={(e) => setTrReason(e.target.value)}
            placeholder={t("p12c.doctor.trReasonPh")}
            maxLength={2000}
          />
          <div className="rowflex">
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setTrOpen(false)}>
              {t("p12c.doctor.archiveCancel")}
            </button>
            <button
              className="btn btn-p btn-s"
              style={{ width: "auto", margin: 0 }}
              disabled={trBusy || !trDoctor.trim()}
              onClick={doTransfer}
            >
              {trBusy ? t("common.loading") : t("p12c.doctor.trTitle")}
            </button>
          </div>
        </Modal>
      )}
      {/* D28: share a plain-language summary with the patient */}
      {shareOpen && (
        <Modal onClose={() => setShareOpen(false)}>
          <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.shareTitle")}</h3>
          <label className="tiny" style={{ display: "block", marginBottom: 4 }}>
            {t("p12d.doctor.shareLabel")}
          </label>
          <textarea
            rows={5}
            value={shareText}
            onChange={(e) => setShareText(e.target.value)}
            placeholder={t("p12d.doctor.sharePh")}
            aria-label={t("p12d.doctor.shareLabel")}
            maxLength={4000}
          />
          <div className="rowflex" style={{ marginTop: 8 }}>
            <button className="btn btn-s" style={{ width: "auto", margin: 0 }} onClick={() => setShareOpen(false)}>
              {t("p12d.doctor.shareCancel")}
            </button>
            <span className="spacer" />
            <button
              className="btn"
              style={{ width: "auto", margin: 0 }}
              disabled={shareBusy || !shareText.trim()}
              onClick={sendShareSummary}
            >
              {shareBusy ? t("common.loading") : t("p12d.doctor.shareSend")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
