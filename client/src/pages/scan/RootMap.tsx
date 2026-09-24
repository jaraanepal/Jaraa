import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { scansApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, ErrorCard, Loading, NoticeBox, apiErrorMessage, toast } from "../../components/ui";
import { rootMapToDiagram } from "../../lib/rootmap";
import type { RootKey, RootMap } from "../../api/types";

export default function RootMapPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const navigate = useNavigate();
  const [map, setMap] = useState<RootMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setMap(await scansApi.getRootMap(id));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  /** Client-side fallback diagram when the server sent no SVG geometry. */
  const fallback = useMemo(() => {
    if (!map || map.svg.roots.length > 0) return null;
    const scores = Object.fromEntries(
      (Object.keys(map.roots) as RootKey[]).map((k) => [k, map.roots[k].score]),
    ) as Record<RootKey, number>;
    const labels = Object.fromEntries(
      (Object.keys(map.roots) as RootKey[]).map((k) => [k, t(`jara.roots.${k}`)]),
    ) as Record<RootKey, string>;
    return rootMapToDiagram(scores, labels, {
      good: t("jara.scoreWord.good"),
      fair: t("jara.scoreWord.fair"),
      needsCare: t("jara.scoreWord.needsCare"),
    });
  }, [map, t]);

  function exportImage() {
    const svg = svgRef.current;
    if (!svg) return;
    setExporting(true);
    try {
      const data = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 660;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setExporting(false);
          return;
        }
        ctx.fillStyle = "#f7f4ec";
        ctx.fillRect(0, 0, 800, 660);
        ctx.drawImage(img, 0, 0, 800, 660);
        ctx.fillStyle = "rgba(26,26,26,0.65)";
        ctx.font = "22px sans-serif";
        ctx.fillText("Jara • not a diagnosis", 32, 632);
        canvas.toBlob((b) => {
          setExporting(false);
          if (!b) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = `jaraa-root-map-${id}.png`;
          a.click();
          toast(t("rootmap.shareToast"));
        }, "image/png");
      };
      img.onerror = () => setExporting(false);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
    } catch {
      setExporting(false);
    }
  }

  if (loading) return <Loading />;

  const status = map?.status_card ?? "pending_review";
  const labelFor = (k: RootKey): string => t(`jara.roots.${k}`);

  return (
    <div className="screen">
      <h1>{t("rootmap.title")}</h1>
      {error && <ErrorCard message={error} onRetry={load} />}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("rootmap.mapLabel")}</h3>
        {status === "pending_review" && <Chip tone="gold">{t("rootmap.statusPendingTitle")}</Chip>}
        {status === "reviewed" && <Chip>{t("rootmap.statusReviewedTitle")}</Chip>}
        {status === "red_flagged" && <Chip tone="red">{t("rootmap.statusRedTitle")}</Chip>}
        <p className="muted tiny">
          {status === "pending_review" && t("rootmap.statusPendingBody")}
          {status === "reviewed" && map && t("rootmap.reviewedBy", { date: map.generated_at.slice(0, 10) })}
          {status === "red_flagged" && t("rootmap.statusRedBody")}
        </p>
        <p style={{ fontStyle: "italic", color: "var(--green)" }}>
          {map?.footer_note || t("rootmap.footerNote")}
        </p>
      </div>

      {map && (
        <div className="card" style={{ padding: 8 }}>
          <svg ref={svgRef} viewBox={map.svg.viewBox || "0 0 400 330"} width="100%" role="img" aria-label={t("rootmap.mapLabel")}>
            {map.svg.roots.length > 0
              ? map.svg.roots.map((r) => (
                  <g key={r.root}>
                    <line
                      x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2}
                      stroke={r.color} strokeWidth={5 + r.length / 25} strokeLinecap="round"
                    />
                    <circle cx={r.x2} cy={r.y2} r={7 + r.length / 30} fill={r.color} opacity={0.9} />
                    <text x={r.x2} y={r.y2 + 22} textAnchor="middle" fontSize="11" fill="#1a1a1a" fontWeight="700">
                      {labelFor(r.root as RootKey)}
                    </text>
                  </g>
                ))
              : fallback?.roots.map((n) => (
                  <g key={n.root}>
                    <path d={n.d} stroke={n.color} strokeWidth={n.strokeWidth} fill="none" strokeLinecap="round" />
                    <circle cx={n.tipX} cy={n.tipY} r={n.tipR} fill={n.color} opacity={0.9} />
                    <text x={n.labelX} y={n.labelY} textAnchor="middle" fontSize="11" fill="#1a1a1a" fontWeight="700">
                      {n.label}
                    </text>
                  </g>
                ))}
          </svg>
          <p className="tiny muted">{t("rootmap.legend")}</p>
          {map.weakest_roots.length > 0 && (
            <p className="tiny">
              <b>{t("rootmap.weakestNote")}:</b>{" "}
              {map.weakest_roots.map((k) => labelFor(k)).join(", ")}
            </p>
          )}
        </div>
      )}

      {status === "red_flagged" && (
        <NoticeBox tone="flag" title={t("rootmap.statusRedTitle")}>
          <p>{t("rootmap.statusRedBody")}</p>
        </NoticeBox>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("rootmap.whatNext")}</h3>
        <p className="tiny">• {t("rootmap.next1")}</p>
        <p className="tiny">• {t("rootmap.next2")}</p>
        <p className="tiny">• {t("rootmap.next3")}</p>
      </div>

      <div className="btn-row">
        <button className="btn btn-s" onClick={exportImage} disabled={exporting || !map}>
          {exporting ? t("rootmap.exporting") : t("rootmap.share")}
        </button>
        <button className="btn btn-p" onClick={() => navigate(`/scan/${id}/submit`)}>
          {t("rootmap.submitForReview")}
        </button>
      </div>
    </div>
  );
}
