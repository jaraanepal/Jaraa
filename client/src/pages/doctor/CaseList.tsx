import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, ScoreBar, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { SlaBar, urgencyRank, waitMs, waitShort, weakestRoots } from "./caseUtils";
import type { Case, RootKey, ScanDetail } from "../../api/types";

const STATUS_KEY: Record<Case["status"], string> = {
  queued: "doctor.stNew",
  in_review: "doctor.stInReview",
  needs_info: "doctor.stNeedsInfo",
  reviewed: "doctor.stReviewed",
};

const ROOT_KEYS: RootKey[] = ["nutrition", "stress_sleep", "hormones", "scalp", "damage", "medical_family"];

export type CaseListSort = "priority" | "oldest";

export interface CaseListProps {
  status: Case["status"];
  /** Controlled sort for the D1 toolbar (priority = red_flag → high → oldest; oldest = created_at asc). */
  sort?: CaseListSort;
  /** D2 date filters (YYYY-MM-DD), applied to created_at. */
  dateFrom?: string;
  dateTo?: string;
  /** D2: red-flag-only filter. */
  redFlagOnly?: boolean;
  /** D2: needs_info-only filter. */
  needsInfoOnly?: boolean;
  /** D8: when true, each row shows a checkbox for bulk selection. */
  selectable?: boolean;
  selected?: string[];
  onToggleSelect?: (id: string) => void;
}

function priorityRank(c: Case): number {
  return c.priority === "red_flag" ? 0 : c.priority === "high" ? 1 : 2;
}

/**
 * Case list panel, filtered by status, with doctor workflow filters
 * (priority, waiting time, weakest root, sort order). For the review
 * queue each case is progressively enriched with its scan detail
 * (photo count + weakest roots) — fetched with the existing
 * doctorApi.getCaseScan endpoint, never invented.
 *
 * Batch-1 (P-12) extensions: controlled `sort` / date / red-flag-only /
 * needs-info-only props for the D1+D2 toolbar, and D8 row selection via
 * the `selectable` + `selected` + `onToggleSelect` props.
 */
export function CaseList({
  status,
  sort: sortProp,
  dateFrom,
  dateTo,
  redFlagOnly,
  needsInfoOnly,
  selectable,
  selected,
  onToggleSelect,
}: CaseListProps) {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    doctorApi.listCases(status, 50).then((r) => r.cases),
  );
  const [claimError, setClaimError] = useState<string | null>(null);

  // Workflow filters — all computed from already-fetched data.
  const [fPriority, setFPriority] = useState<"all" | Case["priority"]>("all");
  const [fWait, setFWait] = useState<"all" | "12h" | "24h">("all");
  const [fRoot, setFRoot] = useState<"all" | RootKey>("all");
  const [sort, setSort] = useState<"urgency" | "oldest" | "newest">("urgency");

  // Progressive enrichment for queued cases: scan detail per case.
  const [scans, setScans] = useState<Record<string, ScanDetail>>({});
  const [enriching, setEnriching] = useState(false);
  useEffect(() => {
    if (!data || status !== "queued") return;
    let alive = true;
    setEnriching(true);
    Promise.allSettled(
      data.map((c) => doctorApi.getCaseScan(c.scan_id).then((s) => ({ id: c.id, s }))),
    ).then((results) => {
      if (!alive) return;
      const map: Record<string, ScanDetail> = {};
      for (const r of results) {
        if (r.status === "fulfilled") map[r.value.id] = r.value.s;
      }
      setScans(map);
      setEnriching(false);
    });
    return () => {
      alive = false;
    };
  }, [data, status]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let out = [...data];
    if (fPriority !== "all") out = out.filter((c) => c.priority === fPriority);
    if (fWait !== "all") {
      const min = fWait === "12h" ? 12 * 3600_000 : 24 * 3600_000;
      out = out.filter((c) => waitMs(c) >= min);
    }
    if (fRoot !== "all") out = out.filter((c) => weakestRoots(scans[c.id]).includes(fRoot));
    // D2 controlled filters.
    if (dateFrom) out = out.filter((c) => c.created_at.slice(0, 10) >= dateFrom);
    if (dateTo) out = out.filter((c) => c.created_at.slice(0, 10) <= dateTo);
    if (redFlagOnly) out = out.filter((c) => c.priority === "red_flag");
    if (needsInfoOnly) out = out.filter((c) => c.status === "needs_info");
    // D1 controlled sort, else the internal sort control.
    if (sortProp === "priority") {
      out.sort(
        (a, b) =>
          priorityRank(a) - priorityRank(b) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    } else if (sortProp === "oldest") {
      out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      out.sort((a, b) =>
        sort === "oldest"
          ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          : sort === "newest"
            ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            : urgencyRank(a) - urgencyRank(b),
      );
    }
    return out;
  }, [data, fPriority, fWait, fRoot, sort, scans, sortProp, dateFrom, dateTo, redFlagOnly, needsInfoOnly]);

  async function claim(id: string) {
    setClaimError(null);
    try {
      await doctorApi.claimCase(id);
      toast(t("doctor.claimedToast"));
      retry();
    } catch (e) {
      setClaimError(apiErrorMessage(t, e));
    }
  }

  if (loading) return <Loading />;
  if (error || !data) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;

  const selStyle: React.CSSProperties = { marginLeft: 4, width: "auto", minHeight: 40 };

  return (
    <div>
      {claimError && <ErrorCard message={claimError} />}

      <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4, margin: "8px 0" }}>
        <label className="tiny muted">
          {t("doctorDash.filterPriority")}
          <select value={fPriority} onChange={(e) => setFPriority(e.target.value as typeof fPriority)} style={selStyle} aria-label={t("doctorDash.filterPriority")}>
            <option value="all">{t("doctorDash.filterAll")}</option>
            <option value="red_flag">{t("doctorDash.priRed")}</option>
            <option value="high">{t("doctorDash.priHigh")}</option>
            <option value="normal">{t("doctorDash.priNormal")}</option>
          </select>
        </label>
        <label className="tiny muted">
          {t("doctorDash.filterWait")}
          <select value={fWait} onChange={(e) => setFWait(e.target.value as typeof fWait)} style={selStyle} aria-label={t("doctorDash.filterWait")}>
            <option value="all">{t("doctorDash.filterAll")}</option>
            <option value="12h">{t("doctorDash.wait12h")}</option>
            <option value="24h">{t("doctorDash.wait24h")}</option>
          </select>
        </label>
        {status === "queued" && (
          <label className="tiny muted">
            {t("doctorDash.filterRoot")}
            <select value={fRoot} onChange={(e) => setFRoot(e.target.value as typeof fRoot)} style={selStyle} aria-label={t("doctorDash.filterRoot")}>
              <option value="all">{t("doctorDash.rootAny")}</option>
              {ROOT_KEYS.map((r) => (
                <option key={r} value={r}>{t(`jara.roots.${r}`)}</option>
              ))}
            </select>
          </label>
        )}
        {!sortProp && (
          <label className="tiny muted">
            {t("doctorDash.sortBy")}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={selStyle} aria-label={t("doctorDash.sortBy")}>
              <option value="urgency">{t("doctorDash.sortUrgency")}</option>
              <option value="oldest">{t("doctorDash.sortOldest")}</option>
              <option value="newest">{t("doctorDash.sortNewest")}</option>
            </select>
          </label>
        )}
      </div>
      {status === "queued" && enriching && (
        <p className="tiny muted" style={{ margin: "0 0 6px" }}>{t("doctorDash.loadingDetails")}</p>
      )}

      {filtered.length === 0 && data.length > 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("doctorDash.noMatch")} />
      )}
      {data.length === 0 && (
        <EmptyState
          icon={<Icon.doc size={32} />}
          title={t(status === "reviewed" ? "doctorDash.emptyReviewed" : "doctorDash.emptyQueue")}
        />
      )}

      {filtered.map((c) => {
        const scan = scans[c.id];
        const weak = weakestRoots(scan);
        return (
          <div className="card" key={c.id}>
            <div className="rowflex">
              {selectable && (
                <input
                  type="checkbox"
                  checked={selected?.includes(c.id) ?? false}
                  onChange={() => onToggleSelect?.(c.id)}
                  aria-label={t("p12.doctor.selectToggle")}
                  style={{ width: 28, height: 28, minHeight: 28 }}
                />
              )}
              <span style={{ color: c.priority === "red_flag" ? "var(--bad)" : "var(--green)" }}>
                <Icon.doc size={26} />
              </span>
              <div style={{ flex: 1 }}>
                <b className="kbd">{c.scan_id.slice(0, 8)}</b>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  {t("doctorDash.waitTime", { n: waitShort(c) })}
                  {scan && (
                    <>
                      {" · "}
                      {t("doctorDash.photosCount", { n: scan.photos.length })}
                    </>
                  )}
                </div>
                {c.priority === "red_flag" && <Chip tone="red">{t("doctor.redFlagPriority")}</Chip>}
                {c.priority === "high" && <Chip tone="amber">{t("doctorDash.priHigh")}</Chip>}
              </div>
              <span className="chip">{t(STATUS_KEY[c.status])}</span>
            </div>

            {weak.length > 0 && scan?.root_scores && (
              <div style={{ marginTop: 6 }}>
                <div className="tiny muted">{t("doctorDash.weakest")}</div>
                {weak.map((r) => (
                  <div className="rowflex" key={r} style={{ margin: "3px 0" }}>
                    <span className="tiny" style={{ minWidth: 92 }}>{t(`jara.roots.${r}`)}</span>
                    <ScoreBar score={scan.root_scores![r].score} />
                    <b className="tiny">{scan.root_scores![r].score}</b>
                  </div>
                ))}
              </div>
            )}

            <SlaBar c={c} t={t} />

            <div className="btn-row">
              <Link className="btn btn-s" to={`/doctor/case/${c.id}`} style={{ textDecoration: "none", textAlign: "center" }}>
                {t("doctor.openCase")}
              </Link>
              {status === "queued" && !c.assigned_doctor_id && (
                <button className="btn btn-g" onClick={() => claim(c.id)}>
                  {t("doctor.claim")}
                </button>
              )}
              {c.assigned_doctor_id && <span className="tiny muted">{t("doctor.claimed")}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
