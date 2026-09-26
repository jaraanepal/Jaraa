import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { scansApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, ErrorCard, Loading, NoticeBox, apiErrorMessage, toast } from "../../components/ui";
import { scoreColor, scoreWordKey } from "../../lib/rootmap";
import type { Photo, RootKey, RootMap, ScanDetail } from "../../api/types";
import {
  buildProblemCards, buildStoryEvents, buildVerdict, monthName, NOT_DIAGNOSIS,
  type ProblemCard, type Script, type StoryEvent,
} from "../../lib/hairstory";

/* P-2: the Root Map tree diagram is replaced by "Your Hair Story" —
   a personalized result in this order:
   1. plain-language verdict
   2. 2–3 deterministic problem cards from the user's own data
   3. story ribbon (their events + educational 2–3 month lag)
   4. their own Lens photos as the canvas, with problem markers
   5. persistent "dermatologist confirms" boundary
   6. status, red-flag messaging, submit-for-review
   Roman-Nepali default with an English toggle. No diagnosis, no LLM
   interpretation — every word is a deterministic template over real data. */

const ZONE_POS: Record<ProblemCard["zone"], { x: number; y: number }> = {
  crown: { x: 50, y: 32 },
  hairline: { x: 50, y: 20 },
  parting: { x: 50, y: 48 },
  allover: { x: 50, y: 40 },
};

const ZONE_ANGLE: Record<ProblemCard["zone"], string> = {
  crown: "crown",
  hairline: "hairline",
  parting: "parting",
  allover: "crown",
};

const SCRIPT_LABEL: Record<Script, string> = { rn: "RN", en: "EN", ne: "ने" };

function verdictTone(level: "strong" | "moderate" | "mild"): string {
  return level === "strong" ? "var(--bad)" : level === "moderate" ? "#8a5a06" : "var(--green-d)";
}

/** "You are here" follicle marker — a small educational visual, not data. */
function FollicleMark({ s }: { s: Script }) {
  return (
    <svg viewBox="0 0 120 110" width="104" role="img"
      aria-label={s === "ne" ? "कपालको जरा" : s === "rn" ? "Kapal ko jara" : "Hair follicle"}>
      <rect x="0" y="0" width="120" height="46" rx="8" fill="#f3e6d4" />
      <rect x="0" y="46" width="120" height="64" rx="8" fill="#e8d3b8" />
      <path d="M60 108 C 58 80, 52 66, 60 40" stroke="#8a5a06" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M60 40 C 58 26, 52 18, 44 10 M60 40 C 62 26, 68 18, 76 10" stroke="#3f2d12" strokeWidth="4" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="96" rx="13" ry="10" fill="#fff" opacity="0.55" />
      <g>
        <path d="M92 22 l0 -14 M86 12 l6 -4 6 4" stroke="#1a7a4c" strokeWidth="3" fill="none" strokeLinecap="round" />
        <rect x="70" y="22" width="72" height="22" rx="11" fill="#1a7a4c" />
        <text x="106" y="37" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="800">
          {s === "ne" ? "तपाईं यहाँ" : s === "rn" ? "TAPAI YAHAN" : "YOU ARE HERE"}
        </text>
      </g>
    </svg>
  );
}

/** Horizontal story ribbon: the user's own events on a timeline. */
function StoryRibbon({ events, s }: { events: StoryEvent[]; s: Script }) {
  const W = Math.max(620, events.length * 130);
  const H = 168;
  const times = events.map((e) => new Date(e.dateISO + "T00:00:00").getTime());
  const min = Math.min(...times, Date.now()) - 20 * 864e5;
  const max = Date.now() + 20 * 864e5;
  const x = (t: number) => 40 + ((t - min) / (max - min)) * (W - 80);

  const onset = events.find((e) => e.key.startsWith("shedding_onset"));
  const illness = events.find((e) => e.key.startsWith("illness_fever"));
  const lagMonths = onset && illness
    ? Math.max(0, Math.round((new Date(onset.dateISO + "T00:00:00").getTime() - new Date(illness.dateISO + "T00:00:00").getTime()) / 2592e6))
    : null;

  const lagNote = s === "ne"
    ? `≈${lagMonths} महिना पछि — बिरामीपछि यस्तो अन्तर सामान्य हो`
    : s === "rn"
      ? `≈${lagMonths} mahina pachhi — birami pachhi yesto antar samanya ho`
      : `≈${lagMonths} mo later — this gap is common after illness`;

  return (
    <div className="hs-ribbon-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={s === "ne" ? "तपाईंको कथा" : s === "rn" ? "Tapaiko katha" : "Your story timeline"}>
        {/* shedding band */}
        {onset && (
          <>
            <rect x={x(new Date(onset.dateISO + "T00:00:00").getTime())} y={52} width={W - 40 - x(new Date(onset.dateISO + "T00:00:00").getTime())} height={44} fill="#fbe9e7" rx={8} />
            <text x={W - 48} y={66} textAnchor="end" fontSize="11" fill="#a33" fontStyle="italic">
              {s === "ne" ? "कपाल झर्ने अवधि" : s === "rn" ? "kapal jharne awadhi" : "shedding period"}
            </text>
          </>
        )}
        <line x1={40} y1={96} x2={W - 40} y2={96} stroke="#cbb" strokeWidth={3} strokeLinecap="round" />
        {/* lag bracket */}
        {onset && illness && lagMonths !== null && lagMonths > 0 && (
          <g>
            <line x1={x(new Date(illness.dateISO + "T00:00:00").getTime())} y1={40}
              x2={x(new Date(onset.dateISO + "T00:00:00").getTime())} y2={40} stroke="#1a7a4c" strokeWidth={2} />
            <line x1={x(new Date(illness.dateISO + "T00:00:00").getTime())} y1={34}
              x2={x(new Date(illness.dateISO + "T00:00:00").getTime())} y2={46} stroke="#1a7a4c" strokeWidth={2} />
            <line x1={x(new Date(onset.dateISO + "T00:00:00").getTime())} y1={34}
              x2={x(new Date(onset.dateISO + "T00:00:00").getTime())} y2={46} stroke="#1a7a4c" strokeWidth={2} />
            <text x={(x(new Date(illness.dateISO + "T00:00:00").getTime()) + x(new Date(onset.dateISO + "T00:00:00").getTime())) / 2}
              y={28} textAnchor="middle" fontSize="11" fill="#1a7a4c" fontWeight="700">{lagNote}</text>
          </g>
        )}
        {events.map((e, i) => {
          const cx = x(new Date(e.dateISO + "T00:00:00").getTime());
          const big = e.key.startsWith("shedding_onset");
          const above = i % 2 === 0;
          return (
            <g key={e.key}>
              <circle cx={cx} cy={96} r={big ? 9 : 6} fill={big ? "#a33" : "#1a7a4c"} stroke="#fff" strokeWidth={2} />
              <text x={cx} y={above ? 128 : 64} textAnchor="middle" fontSize="11" fill="#333" fontWeight="700">
                {e.label[s].slice(0, 18)}
              </text>
              <text x={cx} y={above ? 142 : 78} textAnchor="middle" fontSize="10" fill="#777">
                {monthName(e.dateISO, s)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function RootMapPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLang();
  const [script, setScript] = useState<Script>("rn");
  const [map, setMap] = useState<RootMap | null>(null);
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [angleIdx, setAngleIdx] = useState(0);
  const [showScores, setShowScores] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [m, d] = await Promise.all([scansApi.getRootMap(id), scansApi.getScan(id)]);
      setMap(m);
      setDetail(d);
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const derived = useMemo(() => {
    if (!map || !detail) return null;
    const scores = Object.fromEntries(
      (Object.keys(map.roots) as RootKey[]).map((k) => [k, map.roots[k].score]),
    ) as Record<RootKey, number>;
    const signals = Object.fromEntries(
      (Object.keys(map.roots) as RootKey[]).map((k) => [k, map.roots[k].signals ?? {}]),
    ) as Record<RootKey, Record<string, unknown>>;
    const input = {
      pins: (detail.timeline_events ?? []).map((p) => ({
        event_type: p.event_type, occurred_on: p.occurred_on,
        followup_answers: (p.followup_answers ?? {}) as Record<string, unknown>,
      })),
      signals,
      weakest: (map.weakest_roots ?? []) as RootKey[],
      scores,
    };
    return {
      verdict: buildVerdict(scores),
      cards: buildProblemCards(input),
      events: buildStoryEvents(input),
      scores,
      weakest: input.weakest,
    };
  }, [map, detail]);

  const photos: Photo[] = useMemo(
    () => (detail?.photos ?? []).filter((p) => p.signed_url),
    [detail],
  );

  const activePhoto: Photo | null = useMemo(() => {
    if (!photos.length) return null;
    const card = derived?.cards.find((c) => c.id === activeCard);
    if (card) {
      const want = ZONE_ANGLE[card.zone];
      const hit = photos.findIndex((p) => p.angle === want);
      if (hit >= 0) return photos[hit];
    }
    return photos[Math.min(angleIdx, photos.length - 1)];
  }, [photos, derived, activeCard, angleIdx]);

  function exportImage() {
    if (!derived || exporting) return;
    setExporting(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d");
      if (!ctx) { setExporting(false); return; }
      ctx.fillStyle = "#f7f4ec";
      ctx.fillRect(0, 0, 800, 1000);
      ctx.fillStyle = "#1a7a4c";
      ctx.font = "800 40px sans-serif";
      ctx.fillText("Your Hair Story", 48, 90);
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "30px sans-serif";
      wrap(ctx, derived.verdict.text.en, 48, 150, 700, 42);
      ctx.font = "700 26px sans-serif";
      let y = 330;
      for (const c of derived.cards) {
        ctx.fillStyle = "#1a7a4c";
        ctx.fillText("• " + c.title.en.slice(0, 44), 48, y);
        y += 44;
      }
      ctx.fillStyle = "rgba(26,26,26,0.65)";
      ctx.font = "22px sans-serif";
      ctx.fillText("Jara • not a diagnosis", 48, 960);
      canvas.toBlob((b) => {
        setExporting(false);
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `jaraa-hair-story-${id}.png`;
        a.click();
        toast(t("rootmap.shareToast"));
      }, "image/png");
    } catch {
      setExporting(false);
    }
  }

  function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
    const words = text.split(" ");
    let line = "";
    let yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = w;
        yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  if (loading) return <Loading />;

  const status = map?.status_card ?? "pending_review";
  const labelFor = (k: RootKey): string => t(`jara.roots.${k}`);
  const boundary = NOT_DIAGNOSIS[script];

  return (
    <div className="screen hs-wrap">
      {/* script toggle — Roman-Nepali default */}
      <div className="hs-script" role="group" aria-label="Language">
        {(Object.keys(SCRIPT_LABEL) as Script[]).map((s) => (
          <button key={s} className={script === s ? "on" : ""} onClick={() => setScript(s)}>
            {SCRIPT_LABEL[s]}
          </button>
        ))}
      </div>

      <h1>{script === "ne" ? "तपाईंको कपालको कथा" : script === "rn" ? "Tapaiko Kapal ko Katha" : "Your Hair Story"}</h1>
      {error && <ErrorCard message={error} onRetry={load} />}

      {/* status */}
      <div className="card hs-status">
        {status === "pending_review" && <Chip tone="gold">{t("rootmap.statusPendingTitle")}</Chip>}
        {status === "reviewed" && <Chip>{t("rootmap.statusReviewedTitle")}</Chip>}
        {status === "red_flagged" && <Chip tone="red">{t("rootmap.statusRedTitle")}</Chip>}
        <p className="muted tiny">
          {status === "pending_review" && t("rootmap.statusPendingBody")}
          {status === "reviewed" && map && t("rootmap.reviewedBy", { date: map.generated_at.slice(0, 10) })}
          {status === "red_flagged" && t("rootmap.statusRedBody")}
        </p>
      </div>

      {derived && (
        <>
          {/* 1 — verdict */}
          <div className="card hs-verdict" style={{ borderTop: `4px solid ${verdictTone(derived.verdict.level)}` }}>
            <p className="hs-verdict-text">{derived.verdict.text[script]}</p>
            <p className="hs-boundary">{boundary}</p>
          </div>

          {/* 2 — problem cards */}
          <h2 className="hs-h2">
            {script === "ne" ? "मुख्य कुराहरू" : script === "rn" ? "Mukhya kuraharu" : "What stands out"}
          </h2>
          {derived.cards.map((c, i) => (
            <div
              key={c.id}
              className={"card hs-pcard" + (activeCard === c.id ? " active" : "")}
              onClick={() => setActiveCard(activeCard === c.id ? null : c.id)}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setActiveCard(activeCard === c.id ? null : c.id); }}
            >
              <div className="hs-pcard-num">{i + 1}</div>
              <div>
                <h3>{c.title[script]}</h3>
                <p className="hs-reflect"><b>{script === "ne" ? "तपाईंले भन्नुभयो" : script === "rn" ? "Tapaile bhannubhayo" : "You told us"}:</b> {c.reflection[script]}</p>
                <p className="hs-edu">{c.education[script]}</p>
              </div>
            </div>
          ))}

          {/* 3 — story ribbon */}
          {derived.events.length > 0 && (
            <>
              <h2 className="hs-h2">
                {script === "ne" ? "तपाईंको समयरेखा" : script === "rn" ? "Tapaiko samayarekha" : "Your timeline"}
              </h2>
              <div className="card hs-ribbon-card">
                <StoryRibbon events={derived.events} s={script} />
                <p className="tiny muted">
                  {script === "ne"
                    ? "यो तपाईंले भन्नुभएकै घटनाहरू हुन् — केही थपिएको छैन।"
                    : script === "rn"
                      ? "Yo tapaile bhannubhaekai ghatanaharu hun — kehi thapiyeko chhaina."
                      : "These are exactly the events you described — nothing added."}
                </p>
              </div>
            </>
          )}

          {/* 4 — scalp mapped on their own photos */}
          <h2 className="hs-h2">
            {script === "ne" ? "तपाईंको टाउको" : script === "rn" ? "Tapaiko tauko" : "Your scalp, mapped"}
          </h2>
          <div className="card hs-scalp-card">
            <div className="hs-scalp-top">
              <FollicleMark s={script} />
              <p className="tiny muted">
                {script === "ne"
                  ? "तपाईंको आफ्नै फोटोमा चिन्ह — ट्याप गर्दा सम्बन्धित कुरा खुल्छ।"
                  : script === "rn"
                    ? "Tapaiko afnai photo ma chinhha — tap garda sambandhit kura khulchha."
                    : "Markers on your own photos — tap one to see what it relates to."}
              </p>
            </div>
            {activePhoto ? (
              <>
                <div className="hs-photo-frame">
                  <img src={activePhoto.signed_url!} alt={activePhoto.angle} />
                  {derived.cards.map((c) => {
                    const pos = ZONE_POS[c.zone];
                    const show = !activeCard || activeCard === c.id;
                    if (!show) return null;
                    return (
                      <button
                        key={c.id}
                        className={"hs-marker" + (activeCard === c.id ? " active" : "")}
                        style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                        onClick={() => setActiveCard(activeCard === c.id ? null : c.id)}
                        aria-label={c.title[script]}
                      />
                    );
                  })}
                </div>
                {photos.length > 1 && (
                  <div className="hs-angles">
                    {photos.map((p, i) => (
                      <button
                        key={p.id}
                        className={activePhoto.id === p.id ? "on" : ""}
                        onClick={() => { setAngleIdx(i); setActiveCard(null); }}
                      >
                        {p.angle.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="muted">
                {script === "ne"
                  ? "अहिलेसम्म फोटो छैन — Lens चरणमा फोटो थप्नुस्।"
                  : script === "rn"
                    ? "Ahilesamma photo chhaina — Lens charan ma photo thapnus."
                    : "No photos yet — add them in the Lens stage."}
              </p>
            )}
          </div>

          {/* drill-down: words anchored with numbers */}
          <button className="hs-drill" onClick={() => setShowScores((v) => !v)} aria-expanded={showScores}>
            {showScores ? "▾" : "▸"}{" "}
            {script === "ne" ? "विवरण हेर्नुस्" : script === "rn" ? "Bibaran hernus" : "See the details"}
          </button>
          {showScores && (
            <div className="card">
              {derived.weakest.map((k) => (
                <div key={k} className="hs-scorerow">
                  <span>{labelFor(k)}</span>
                  <span className="chip" style={{ background: scoreColor(derived.scores[k]) + "22", color: scoreColor(derived.scores[k]) }}>
                    {derived.scores[k]} · {t(`jara.scoreWord.${scoreWordKey(derived.scores[k])}`)}
                  </span>
                </div>
              ))}
              <p className="tiny muted">{boundary}</p>
            </div>
          )}
        </>
      )}

      {/* 5 — persistent boundary */}
      <NoticeBox tone="notice" title={t("rootmap.footerNote") || "Note"}>
        <p>{boundary}</p>
      </NoticeBox>

      {status === "red_flagged" && (
        <NoticeBox tone="flag" title={t("rootmap.statusRedTitle")}>
          <p>{t("rootmap.statusRedBody")}</p>
        </NoticeBox>
      )}

      {/* 6 — next actions */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("rootmap.whatNext")}</h3>
        <p className="tiny">• {t("rootmap.next1")}</p>
        <p className="tiny">• {t("rootmap.next2")}</p>
        <p className="tiny">• {t("rootmap.next3")}</p>
      </div>

      <div className="btn-row">
        <button className="btn btn-s" onClick={exportImage} disabled={exporting || !derived}>
          {exporting ? t("rootmap.exporting") : t("rootmap.share")}
        </button>
        <button className="btn btn-p" onClick={() => navigate(`/scan/${id}/submit`)}>
          {t("rootmap.submitForReview")}
        </button>
      </div>
    </div>
  );
}
