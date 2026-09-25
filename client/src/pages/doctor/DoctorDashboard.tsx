import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { doctorB3Api, type B3Adherence, type B3TriagePreset } from "../../api/b3doctor";
import { doctorB4Api, downloadOwnCasesCsv, type B4Digest, type B4Peer, type B4QueueFilter } from "../../api/b4doctor";
import type { EducationArticle } from "../../api/types";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { CaseList } from "./CaseList";
import type { CaseListSort } from "./CaseList";
import { SlaBar, msShort, slaState, urgencyRank, waitMs, waitShort } from "./caseUtils";
import type { PatientCase, PatientSearchResult } from "../../api/types";
import { DoctorActivity } from "./DoctorActivity";
import { DoctorArchived } from "./DoctorArchived";
import { DoctorSecondOpinions } from "./DoctorSecondOpinions";
import { DoctorFollowupCalendar } from "./DoctorFollowupCalendar";
import { DoctorTriagePresets } from "./DoctorTriagePresets";

type Tab = "queue" | "reviewed" | "patients" | "followups" | "availability" | "activity" | "archived" | "secondops" | "calendar" | "presets" | "digest";

/**
 * Doctor landing page: workload stats (queue load, red flags, SLA pressure,
 * red-flag rate, average wait), a "needs attention" panel with the most
 * urgent cases and their SLA countdown bars, plus tabs for the review
 * queue, the reviewed-plan history, patient search (D7), follow-ups (D6)
 * and availability (D9).
 *
 * Batch-1 (P-12): the queue tab gets a toolbar — D1 sort toggle, D2 date /
 * red-flag-only / needs-info-only filters, and D8 select mode with a bulk
 * priority bar.
 */
export default function DoctorDashboard({ initialTab = "queue" }: { initialTab?: Tab }) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<Tab>(initialTab);

  const queued = useAsync(() => doctorApi.listCases("queued", 50).then((r) => r.cases));
  const reviewed = useAsync(() => doctorApi.listCases("reviewed", 50).then((r) => r.cases));

  // ---- D1/D2 toolbar state ----
  const [sortMode, setSortMode] = useState<CaseListSort>("priority");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [redFlagOnly, setRedFlagOnly] = useState(false);
  const [needsInfoOnly, setNeedsInfoOnly] = useState(false);
  const filtersActive = dateFrom !== "" || dateTo !== "" || redFlagOnly || needsInfoOnly;
  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setRedFlagOnly(false);
    setNeedsInfoOnly(false);
  }

  // ---- D8 bulk select mode ----
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPriority, setBulkPriority] = useState<0 | 50 | 100>(50);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  function toggleSelect(id: string) {
    setSelected((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }
  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelected([]);
  }
  async function applyBulkPriority() {
    if (selected.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const r = await doctorApi.bulkPriority(selected, bulkPriority);
      toast(t("p12.doctor.bulkUpdated", { n: r.updated }));
      setSelected([]);
      setSelectMode(false);
      queued.retry();
    } catch (e) {
      setBulkError(apiErrorMessage(t, e));
    } finally {
      setBulkBusy(false);
    }
  }

  // ---- Batch-3 (009): triage presets for the queue toolbar (D24) ----
  const presets = useAsync(() => doctorB3Api.listTriagePresets().then((r) => r.presets));
  async function applyPreset(p: B3TriagePreset) {
    if (selected.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const r = await doctorApi.bulkPriority(selected, p.priority as 0 | 50 | 100);
      toast(t("p12.doctor.bulkUpdated", { n: r.updated }));
      setSelected([]);
      setSelectMode(false);
      queued.retry();
    } catch (e) {
      setBulkError(apiErrorMessage(t, e));
    } finally {
      setBulkBusy(false);
    }
  }

  // ---- Batch-4 (010): D34 auto-refresh, D40 queue filter presets ----
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [queueFilters, setQueueFilters] = useState<B4QueueFilter[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  async function reloadQueueFilters() {
    try {
      const r = await doctorB4Api.listQueueFilters();
      setQueueFilters(r.filters);
    } catch (e) {
      setFilterError(apiErrorMessage(t, e));
    }
  }
  useEffect(() => { void reloadQueueFilters(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => {
      queued.retry();
      reviewed.retry();
    }, 30000);
    return () => clearInterval(iv);
  }, [autoRefresh]); // eslint-disable-line react-hooks/exhaustive-deps
  function applyQueueFilter(f: B4QueueFilter) {
    const p = f.filters as {
      sort?: string; date_from?: string | null; date_to?: string | null;
      red_flag_only?: boolean; needs_info_only?: boolean;
    };
    if (p.sort === "priority" || p.sort === "oldest") setSortMode(p.sort);
    setDateFrom(p.date_from ?? "");
    setDateTo(p.date_to ?? "");
    setRedFlagOnly(p.red_flag_only ?? false);
    setNeedsInfoOnly(p.needs_info_only ?? false);
    setTab("queue");
  }
  async function saveQueueFilter() {
    const name = filterName.trim();
    if (!name || filterBusy) return;
    setFilterBusy(true);
    setFilterError(null);
    try {
      const r = await doctorB4Api.createQueueFilter(name, {
        sort: sortMode,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        red_flag_only: redFlagOnly,
        needs_info_only: needsInfoOnly,
      });
      setQueueFilters((v) => [r.filter, ...v]);
      setFilterName("");
      toast(t("p12d.doctor.filterSaved"));
    } catch (e) {
      setFilterError(apiErrorMessage(t, e));
    } finally {
      setFilterBusy(false);
    }
  }
  async function deleteQueueFilter(f: B4QueueFilter) {
    try {
      await doctorB4Api.deleteQueueFilter(f.id);
      setQueueFilters((v) => v.filter((x) => x.id !== f.id));
      toast(t("p12d.doctor.filterDeleted"));
    } catch (e) {
      setFilterError(apiErrorMessage(t, e));
    }
  }

  // ---- Batch-4 (010): digest tab state (D29 peers, D37 digest, D42 articles, D43 export) ----
  const [digest, setDigest] = useState<B4Digest | null>(null);
  const [articles, setArticles] = useState<EducationArticle[]>([]);
  const [peers, setPeers] = useState<B4Peer[]>([]);
  const [digestLoaded, setDigestLoaded] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  useEffect(() => {
    if (tab !== "digest" || digestLoaded) return;
    (async () => {
      try {
        const [d, a, p] = await Promise.all([
          doctorB4Api.digest(),
          doctorB4Api.listArticles(),
          doctorB4Api.listPeers(),
        ]);
        setDigest(d);
        setArticles(a.articles);
        setPeers(p.peers);
        setDigestLoaded(true);
      } catch (e) {
        setDigestError(apiErrorMessage(t, e));
      }
    })();
  }, [tab, digestLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  async function exportCsv() {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await downloadOwnCasesCsv();
      toast(t("p12d.doctor.exportOk"));
    } catch {
      toast(t("p12d.doctor.exportFail"));
    } finally {
      setExportBusy(false);
    }
  }

  // ---- D7 patient search ----
  const [pq, setPq] = useState("");
  const [patients, setPatients] = useState<PatientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [activePatient, setActivePatient] = useState<PatientSearchResult | null>(null);
  const [timeline, setTimeline] = useState<PatientCase[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  // Batch-3 (009) D25: adherence widget state.
  const [adherence, setAdherence] = useState<B3Adherence | null>(null);
  const [adherenceLoading, setAdherenceLoading] = useState(false);

  async function runPatientSearch() {
    const q = pq.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setSearched(false);
    setActivePatient(null);
    setTimeline(null);
    try {
      const r = await doctorApi.searchPatients(q);
      setPatients(r.patients);
      setSearched(true);
    } catch (e) {
      setSearchError(apiErrorMessage(t, e));
    } finally {
      setSearching(false);
    }
  }
  async function openPatient(p: PatientSearchResult) {
    setActivePatient(p);
    setTimeline(null);
    setAdherence(null);
    setTimelineLoading(true);
    setAdherenceLoading(true);
    try {
      const r = await doctorApi.patientCases(p.id);
      setTimeline(r.cases);
    } catch (e) {
      setSearchError(apiErrorMessage(t, e));
    } finally {
      setTimelineLoading(false);
    }
    try {
      setAdherence(await doctorB3Api.getPatientAdherence(p.id));
    } catch {
      setAdherence(null); // 403/404 -> hide the widget
    } finally {
      setAdherenceLoading(false);
    }
  }

  const q = queued.data ?? [];
  const redFlags = q.filter((c) => c.priority === "red_flag").length;
  const overdue = q.filter((c) => slaState(c) === "overdue").length;
  const due6h = q.filter((c) => slaState(c) === "due6h").length;
  const redFlagRate = q.length ? `${Math.round((redFlags / q.length) * 100)}%` : "0%";
  const avgWait = q.length ? msShort(q.reduce((s, c) => s + waitMs(c), 0) / q.length) : "—";

  const attention = useMemo(
    () => [...q].sort((a, b) => urgencyRank(a) - urgencyRank(b)).slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queued.data],
  );

  const inputStyle: React.CSSProperties = { width: "auto", minHeight: 40 };

  return (
    <div className="screen">
      <h1>{t("doctor.queueTitle")}</h1>
      <p className="muted tiny">{t("doctor.queueSub")}</p>

      <div className="statgrid">
        <StatCard label={t("doctorDash.waiting")} value={queued.loading ? "…" : String(q.length)} icon={<Icon.doc size={26} />} />
        <StatCard label={t("doctor.redFlagPriority")} value={queued.loading ? "…" : String(redFlags)} icon={<Icon.alert size={26} />} />
        <StatCard label={t("doctorDash.overdue")} value={queued.loading ? "…" : String(overdue)} icon={<Icon.clock size={26} />} />
        <StatCard label={t("doctorDash.due6h")} value={queued.loading ? "…" : String(due6h)} icon={<Icon.clock size={26} />} />
        <StatCard label={t("doctorDash.redFlagRate")} value={queued.loading ? "…" : redFlagRate} icon={<Icon.chart size={26} />} />
        <StatCard label={t("doctorDash.avgWait")} value={queued.loading ? "…" : avgWait} icon={<Icon.clock size={26} />} />
      </div>

      {attention.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("doctorDash.attention")}</h3>
          {attention.map((c, i) => (
            <div key={c.id} style={{ padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
              <div className="rowflex">
                <b className="kbd">{c.scan_id.slice(0, 8)}</b>
                {c.priority === "red_flag" && <Chip tone="red">{t("doctorDash.priRed")}</Chip>}
                {c.priority === "high" && <Chip tone="amber">{t("doctorDash.priHigh")}</Chip>}
                <span className="spacer" />
                <span className="tiny muted">{t("doctorDash.waitTime", { n: waitShort(c) })}</span>
                <Link className="linklike" to={`/doctor/case/${c.id}`}>
                  {t("doctor.openCase")}
                </Link>
              </div>
              <SlaBar c={c} t={t} />
            </div>
          ))}
        </div>
      )}

      <div className="tabrow" role="tablist" style={{ flexWrap: "wrap" }}>
        <button className={`tab${tab === "queue" ? " on" : ""}`} role="tab" aria-selected={tab === "queue"} onClick={() => setTab("queue")}>
          {t("doctorDash.queueTab")} ({q.length})
        </button>
        <button className={`tab${tab === "reviewed" ? " on" : ""}`} role="tab" aria-selected={tab === "reviewed"} onClick={() => setTab("reviewed")}>
          {t("doctorDash.reviewedTab")} ({reviewed.loading ? "…" : (reviewed.data ?? []).length})
        </button>
        <button className={`tab${tab === "patients" ? " on" : ""}`} role="tab" aria-selected={tab === "patients"} onClick={() => setTab("patients")}>
          {t("p12.doctor.patientsTab")}
        </button>
        <button className={`tab${tab === "followups" ? " on" : ""}`} role="tab" aria-selected={tab === "followups"} onClick={() => setTab("followups")}>
          {t("p12.doctor.followups")}
        </button>
        <button className={`tab${tab === "availability" ? " on" : ""}`} role="tab" aria-selected={tab === "availability"} onClick={() => setTab("availability")}>
          {t("p12.doctor.availability")}
        </button>
        <button className={`tab${tab === "activity" ? " on" : ""}`} role="tab" aria-selected={tab === "activity"} onClick={() => setTab("activity")}>
          {t("p12c.doctor.auditTitle")}
        </button>
        <button className={`tab${tab === "archived" ? " on" : ""}`} role="tab" aria-selected={tab === "archived"} onClick={() => setTab("archived")}>
          {t("p12c.doctor.archivedTitle")}
        </button>
        <button className={`tab${tab === "secondops" ? " on" : ""}`} role="tab" aria-selected={tab === "secondops"} onClick={() => setTab("secondops")}>
          {t("p12c.doctor.soTitle")}
        </button>
        <button className={`tab${tab === "calendar" ? " on" : ""}`} role="tab" aria-selected={tab === "calendar"} onClick={() => setTab("calendar")}>
          {t("p12c.doctor.calTitle")}
        </button>
        <button className={`tab${tab === "presets" ? " on" : ""}`} role="tab" aria-selected={tab === "presets"} onClick={() => setTab("presets")}>
          {t("p12c.doctor.tpTitle")}
        </button>
        <button className={`tab${tab === "digest" ? " on" : ""}`} role="tab" aria-selected={tab === "digest"} onClick={() => setTab("digest")}>
          {t("p12d.doctor.digestTab")}
        </button>
      </div>

      {tab === "queue" && (
        <>
          {/* D1 sort toggle + D8 select mode */}
          <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4, margin: "8px 0 0" }}>
            <div className="tabrow" style={{ margin: 0 }}>
              <button
                className={`tab${sortMode === "priority" ? " on" : ""}`}
                onClick={() => setSortMode("priority")}
              >
                {t("p12.doctor.sortPriority")}
              </button>
              <button
                className={`tab${sortMode === "oldest" ? " on" : ""}`}
                onClick={() => setSortMode("oldest")}
              >
                {t("p12.doctor.sortOldest")}
              </button>
            </div>
            <span className="spacer" />
            <button className={`btn btn-s${selectMode ? " btn-p" : ""}`} style={{ width: "auto", margin: 0 }} onClick={toggleSelectMode}>
              {t("p12.doctor.selectToggle")}
            </button>
          </div>

          {/* D2 filters */}
          <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4, margin: "8px 0" }}>
            <span className="tiny muted">{t("p12.doctor.filters")}</span>
            <label className="tiny muted">
              {t("p12.doctor.dateFrom")}
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} aria-label={t("p12.doctor.dateFrom")} />
            </label>
            <label className="tiny muted">
              {t("p12.doctor.dateTo")}
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} aria-label={t("p12.doctor.dateTo")} />
            </label>
            <label className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={redFlagOnly} onChange={(e) => setRedFlagOnly(e.target.checked)} style={{ width: 24, height: 24, minHeight: 24 }} />
              {t("p12.doctor.redFlagOnly")}
            </label>
            <label className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={needsInfoOnly} onChange={(e) => setNeedsInfoOnly(e.target.checked)} style={{ width: 24, height: 24, minHeight: 24 }} />
              {t("p12.doctor.needsInfoOnly")}
            </label>
            {filtersActive && (
              <button className="linklike" onClick={clearFilters}>{t("p12.doctor.clearFilters")}</button>
            )}
          </div>

          {/* Batch-4 (010): D34 auto-refresh toggle */}
          <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4, margin: "4px 0 8px" }}>
            <label className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                style={{ width: 24, height: 24, minHeight: 24 }}
              />
              {t("p12d.doctor.autoRefresh")}
            </label>
          </div>

          {/* Batch-4 (010): D40 saved queue-filter presets */}
          <div className="card" style={{ padding: "8px 12px" }}>
            <b className="tiny">{t("p12d.doctor.filterPresetsTitle")}</b>
            <div className="tiny muted">{t("p12d.doctor.filterHint")}</div>
            {filterError && <ErrorCard message={filterError} />}
            <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4, marginTop: 6 }}>
              {queueFilters.map((f) => (
                <span key={f.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => applyQueueFilter(f)}
                    title={t("p12d.doctor.filterApply", { name: f.name })}
                  >
                    {f.name}
                  </button>
                  <button
                    type="button"
                    className="linklike"
                    style={{ color: "var(--bad)" }}
                    onClick={() => deleteQueueFilter(f)}
                    aria-label={t("p12d.doctor.filterDelete", { name: f.name })}
                  >
                    <Icon.cross size={14} />
                  </button>
                </span>
              ))}
              {queueFilters.length === 0 && <span className="tiny muted">{t("p12d.doctor.filterEmpty")}</span>}
            </div>
            <div className="rowflex" style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder={t("p12d.doctor.filterNamePh")}
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                aria-label={t("p12d.doctor.filterNamePh")}
                maxLength={80}
                style={{ minHeight: 40 }}
              />
              <button
                className="btn btn-s"
                style={{ width: "auto", margin: 0 }}
                disabled={filterBusy || !filterName.trim()}
                onClick={saveQueueFilter}
              >
                {filterBusy ? t("common.loading") : t("p12d.doctor.filterSave")}
              </button>
            </div>
          </div>

          {bulkError && <ErrorCard message={bulkError} />}

          {/* D8 bulk bar */}
          {selectMode && (
            <div className="card" style={{ borderColor: "var(--gold)" }}>
              <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 6 }}>
                <span className="tiny"><b>{selected.length}</b> {t("p12.doctor.selectToggle").toLowerCase()}</span>
                <label className="tiny muted">
                  {t("p12.doctor.bulkSetPriority")}
                  <select
                    value={bulkPriority}
                    onChange={(e) => setBulkPriority(Number(e.target.value) as 0 | 50 | 100)}
                    style={{ marginLeft: 4, width: "auto", minHeight: 40 }}
                    aria-label={t("p12.doctor.bulkSetPriority")}
                  >
                    <option value={0}>{t("p12.doctor.prNormal")}</option>
                    <option value={50}>{t("p12.doctor.prHigh")}</option>
                    <option value={100}>{t("p12.doctor.prRed")}</option>
                  </select>
                </label>
                <button
                  className="btn btn-p"
                  style={{ width: "auto", margin: 0 }}
                  disabled={bulkBusy || selected.length === 0}
                  onClick={applyBulkPriority}
                >
                  {bulkBusy ? t("common.loading") : t("p12.doctor.bulkSetPriority")}
                </button>
              </div>
              {/* D24: one-tap preset chips apply the preset's priority to the selection */}
              {(presets.data ?? []).length > 0 && (
                <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4, marginTop: 8 }}>
                  <span className="tiny muted">{t("p12c.doctor.tpTitle")}:</span>
                  {(presets.data ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="chip"
                      style={{ cursor: "pointer", border: "1px solid var(--line)" }}
                      disabled={bulkBusy || selected.length === 0}
                      onClick={() => applyPreset(p)}
                      title={`${p.name} (${p.priority})`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <CaseList
            status="queued"
            sort={sortMode}
            dateFrom={dateFrom || undefined}
            dateTo={dateTo || undefined}
            redFlagOnly={redFlagOnly}
            needsInfoOnly={needsInfoOnly}
            selectable={selectMode}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        </>
      )}

      {tab === "reviewed" && <CaseList status="reviewed" />}

      {/* Batch-4 (010): digest tab — D37 weekly digest, D43 export, D42 articles, D29 peers */}
      {tab === "digest" && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.digestTitle")}</h3>
            {digestError && <ErrorCard message={digestError} />}
            {!digest && !digestError && <p className="tiny muted">{t("common.loading")}</p>}
            {digest && (
              <>
                <div className="tiny muted" style={{ marginBottom: 8 }}>
                  {t("p12d.doctor.digestWeek", { date: digest.weekStart.slice(0, 10) })}
                </div>
                <div className="statgrid">
                  <StatCard label={t("p12d.doctor.digestReviewed")} value={String(digest.reviewed)} icon={<Icon.doc size={26} />} />
                  <StatCard
                    label={t("p12d.doctor.digestAvg")}
                    value={digest.avgMinutes == null ? t("p12d.doctor.digestNA") : `${Math.round(digest.avgMinutes)}m`}
                    icon={<Icon.clock size={26} />}
                  />
                  <StatCard label={t("p12d.doctor.digestSla")} value={String(digest.slaHits)} icon={<Icon.chart size={26} />} />
                </div>
                {digest.reviewed === 0 && <p className="tiny muted">{t("p12d.doctor.digestEmpty")}</p>}
              </>
            )}
            <button
              className="btn btn-s"
              style={{ width: "auto", margin: "8px 0 0" }}
              disabled={exportBusy}
              onClick={exportCsv}
            >
              {exportBusy ? t("common.loading") : t("p12d.doctor.exportBtn")}
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.articlesTitle")}</h3>
            {articles.length === 0 && <p className="tiny muted">{t("p12d.doctor.articlesEmpty")}</p>}
            {articles.map((a) => (
              <div key={a.id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                <b className="tiny">{lang === "ne" ? a.title_ne ?? a.title_en : a.title_en}</b>
                <div className="tiny muted">
                  {(lang === "ne" ? a.body_ne ?? a.body_en : a.body_en).slice(0, 160)}
                  {(lang === "ne" ? a.body_ne ?? a.body_en : a.body_en).length > 160 ? "\u2026" : ""}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>{t("p12d.doctor.peersTitle")}</h3>
            {peers.length === 0 && <p className="tiny muted">{t("p12d.doctor.peersEmpty")}</p>}
            {peers.map((p, i) => (
              <div key={p.id} style={{ padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
                <b className="tiny">{p.name ?? p.id.slice(0, 8)}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "patients" && (
        <div>
          <div className="rowflex" style={{ margin: "8px 0" }}>
            <input
              type="search"
              placeholder={t("p12.doctor.searchPh")}
              value={pq}
              onChange={(e) => setPq(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runPatientSearch(); }}
              aria-label={t("p12.doctor.searchPh")}
            />
            <button className="btn btn-p" style={{ width: "auto", margin: 0 }} disabled={searching || !pq.trim()} onClick={runPatientSearch}>
              {searching ? t("common.loading") : t("p12.common.view")}
            </button>
          </div>
          {searchError && <ErrorCard message={searchError} />}
          {searched && patients.length === 0 && !searchError && (
            <EmptyState icon={<Icon.doc size={32} />} title={t("p12.doctor.noPatients")} />
          )}
          {patients.map((p) => (
            <div className="card" key={p.id}>
              <div className="rowflex">
                <div style={{ flex: 1 }}>
                  <b>{p.name ?? p.phone}</b>
                  <div className="tiny muted kbd">{p.phone}</div>
                </div>
                <button className="linklike" onClick={() => openPatient(p)}>
                  {t("p12.common.view")}
                </button>
              </div>
              {/* D25: adherence widget */}
              {activePatient?.id === p.id && (
                <div style={{ marginTop: 8 }}>
                  {adherenceLoading && <p className="tiny muted">{t("common.loading")}</p>}
                  {!adherenceLoading && adherence && (
                    <div className="card" style={{ padding: "8px 12px", margin: "0 0 8px" }}>
                      <b className="tiny">{t("p12c.doctor.adhTitle")}</b>
                      <div className="tiny muted">{t("p12c.doctor.adhSub")}</div>
                      {adherence.total === 0 ? (
                        <p className="tiny muted" style={{ margin: "4px 0 0" }}>{t("p12c.doctor.adhEmpty")}</p>
                      ) : (
                        <p className="tiny" style={{ margin: "4px 0 0" }}>
                          {t("p12c.doctor.adhOf", { done: adherence.done, total: adherence.total })}
                          {" · "}
                          {t("p12c.doctor.adhRate")}: {Math.round(adherence.rate * 100)}%
                          {" · "}
                          {t("p12c.doctor.adhCheckins")}: {adherence.done}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {activePatient?.id === p.id && (
                <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  {timelineLoading && <p className="tiny muted">{t("common.loading")}</p>}
                  {timeline && timeline.length === 0 && (
                    <p className="tiny muted">{t("p12.doctor.noTimeline")}</p>
                  )}
                  {timeline && timeline.map((c) => (
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
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "followups" && (
        <Link to="/doctor/followups" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <div className="rowflex">
            <span style={{ color: "var(--green)" }}><Icon.clock size={26} /></span>
            <div style={{ flex: 1 }}>
              <b>{t("p12.doctor.followups")}</b>
              <div className="tiny muted">{t("p12.doctor.followupsDue")}</div>
            </div>
            <span className="linklike">{t("p12.common.view")}</span>
          </div>
        </Link>
      )}

      {tab === "availability" && (
        <Link to="/doctor/availability" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <div className="rowflex">
            <span style={{ color: "var(--green)" }}><Icon.check size={26} /></span>
            <div style={{ flex: 1 }}>
              <b>{t("p12.doctor.availability")}</b>
              <div className="tiny muted">{t("p12.doctor.currentStatus")}</div>
            </div>
            <span className="linklike">{t("p12.common.view")}</span>
          </div>
        </Link>
      )}

      {tab === "activity" && <DoctorActivity />}

      {tab === "archived" && <DoctorArchived />}

      {tab === "secondops" && <DoctorSecondOpinions />}

      {tab === "calendar" && <DoctorFollowupCalendar />}

      {tab === "presets" && <DoctorTriagePresets />}
    </div>
  );
}
