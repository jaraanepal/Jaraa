import { useState } from "react";
import { shopApi } from "../../api/client";
import { adminB3Api, type Dispute, type DisputeStatus, type ExportFrequency, type ExportSchedule } from "../../api/b3admin";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, Modal, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { orderTimeline } from "../../lib/orders";
import { ordersToCsv, downloadCsv } from "../../lib/ordersCsv";
import {
  courierPerformance, returnsAnalytics, refundsAnalytics, pharmacyPerformance,
  type CourierPerformanceRow, type RefundReasonRow, type PharmacyPerformance,
} from "../../api/b4admin";

const K4 = "p12d.admin";

/** A31 — courier performance table. */
function CourierPerfTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => courierPerformance());
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const rows: CourierPerformanceRow[] = data?.couriers ?? [];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.courierPerf.title`)}</h3>
      {rows.length === 0 ? (
        <EmptyState icon={<Icon.truck size={32} />} title={t(`${K4}.courierPerf.empty`)} />
      ) : (
        <table className="tiny" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t(`${K4}.courierPerf.courier`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.courierPerf.orders`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.courierPerf.avgDays`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.courierPerf.damageReports`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.courier}>
                <td>{c.courier}</td>
                <td style={{ textAlign: "right" }}>{c.orders}</td>
                <td style={{ textAlign: "right" }}>{c.avg_delivery_days === null ? "—" : c.avg_delivery_days}</td>
                <td style={{ textAlign: "right" }}>{c.damage_reports}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="tiny muted">{data?.note ?? t(`${K4}.courierPerf.note`)}</p>
    </div>
  );
}

/** A32 + A46 — refunds grouped by reason, with share of total refunds. */
function ReturnsAnalyticsTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    Promise.all([returnsAnalytics(), refundsAnalytics()]).then(([byReason, withRate]) => ({
      rows: byReason.by_reason,
      total: withRate.total_refunds,
      rateByReason: new Map(withRate.by_reason.map((r) => [r.reason, r.rate ?? 0])),
    })),
  );
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const rows: RefundReasonRow[] = data?.rows ?? [];
  const rateOf = (reason: string) => data?.rateByReason.get(reason) ?? 0;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.returnsAnalytics.title`)}</h3>
      <p className="tiny muted">
        {t(`${K4}.refunds.totalRefunds`)}: <b>{data?.total ?? 0}</b>
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={<Icon.doc size={32} />} title={t(`${K4}.returnsAnalytics.empty`)} />
      ) : (
        <table className="tiny" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t(`${K4}.returnsAnalytics.reason`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.returnsAnalytics.count`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.returnsAnalytics.totalNpr`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.refunds.rate`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reason}>
                <td>{r.reason}</td>
                <td style={{ textAlign: "right" }}>{r.count}</td>
                <td style={{ textAlign: "right" }}>NPR {r.total_npr}</td>
                <td style={{ textAlign: "right" }}><b>{(rateOf(r.reason) * 100).toFixed(1)}%</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A42 — pharmacy fulfilment performance. */
function PharmacyPerfTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => pharmacyPerformance());
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const p: PharmacyPerformance | null = data?.performance ?? null;
  if (!p) return null;
  const mins = (v: number | null) => (v === null ? t(`${K4}.pharmacyPerf.untracked`) : `${v} ${t(`${K4}.pharmacyPerf.minutes`)}`);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.pharmacyPerf.title`)}</h3>
      <div className="statgrid">
        <StatCard label={t(`${K4}.pharmacyPerf.handled`)} value={String(p.handled)} icon={<Icon.box size={26} />} />
      </div>
      <p className="tiny">
        <b>{t(`${K4}.pharmacyPerf.avgPackMin`)}:</b> {mins(p.avgPackMin)}
        {" · "}
        <b>{t(`${K4}.pharmacyPerf.avgShipMin`)}:</b> {mins(p.avgShipMin)}
      </p>
      <p className="tiny muted">{data?.note ?? t(`${K4}.pharmacyPerf.note`)}</p>
    </div>
  );
}

const DISPUTE_STATUSES: DisputeStatus[] = ["open", "in_review", "resolved", "rejected"];

/** A21 — dispute queue with status filter + resolve dialog. */
function DisputesTab() {
  const { t } = useLang();
  const [status, setStatus] = useState<string>("");
  const { data, error, loading, retry } = useAsync(
    () => adminB3Api.listDisputes(status || undefined).then((r) => r.disputes),
    [status],
  );
  const [selected, setSelected] = useState<Dispute | null>(null);
  const [resolution, setResolution] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [closing, setClosing] = useState<"resolved" | "rejected" | null>(null);
  const errMsg = error ? apiErrorMessage(t, error) : null;

  function openDetail(d: Dispute) {
    setSelected(d);
    setResolution(d.resolution ?? "");
    setFormError(null);
  }

  async function decide(approved: boolean) {
    if (!selected) return;
    if (!resolution.trim()) {
      setFormError(t("p12c.admin.disputes.resolutionRequired"));
      return;
    }
    setClosing(approved ? "resolved" : "rejected");
    setFormError(null);
    try {
      const r = await adminB3Api.resolveDispute(selected.id, { resolution: resolution.trim(), approved });
      setSelected(r.dispute);
      toast(t(approved ? "p12c.admin.disputes.resolveSuccess" : "p12c.admin.disputes.rejectSuccess"));
      retry();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    } finally {
      setClosing(null);
    }
  }

  return (
    <div>
      <div className="filterrow">
        <label className="fl" htmlFor="dispute-status">{t("p12c.admin.disputes.statusFilter")}</label>
        <select id="dispute-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">—</option>
          {DISPUTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`p12c.admin.disputes.status${s === "in_review" ? "InReview" : s[0].toUpperCase() + s.slice(1)}`)}
            </option>
          ))}
        </select>
      </div>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.alert size={32} />} title={t("p12c.admin.disputes.empty")} />
      )}

      {(data ?? []).map((d) => (
        <button className="card" key={d.id} onClick={() => openDetail(d)} style={{ textAlign: "left", width: "100%" }}>
          <div className="rowflex">
            <div>
              <b>{d.subject}</b>
              <br />
              <span className="tiny muted">
                {t("p12c.admin.disputes.orderNo")}: {d.order_id.slice(0, 8)} ·{" "}
                {t("p12c.admin.disputes.raisedBy")}: {d.user_id.slice(0, 8)}
              </span>
            </div>
            <span className="spacer" />
            <span className={`chip${d.status === "open" || d.status === "in_review" ? "" : " grey"}`}>
              {t(`p12c.admin.disputes.status${d.status === "in_review" ? "InReview" : d.status[0].toUpperCase() + d.status.slice(1)}`)}
            </span>
          </div>
        </button>
      ))}

      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <h3 style={{ marginTop: 0 }}>{selected.subject}</h3>
          <p className="tiny muted">
            {t("p12c.admin.disputes.orderNo")}: {selected.order_id} ·{" "}
            {t("p12c.admin.disputes.raisedBy")}: {selected.user_id}
          </p>
          <p>{selected.body}</p>
          {selected.status !== "open" && selected.status !== "in_review" ? (
            <p className="tiny">
              <b>{t("p12c.admin.disputes.resolution")}:</b> {selected.resolution}
            </p>
          ) : (
            <>
              {formError && <ErrorCard message={formError} />}
              <label className="fl">{t("p12c.admin.disputes.resolution")}</label>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={4}
                placeholder={t("p12c.admin.disputes.resolutionPlaceholder")}
              />
              <div className="btn-row">
                <button className="btn btn-p" disabled={closing !== null} onClick={() => decide(true)}>
                  {t("p12c.admin.disputes.markResolved")}
                </button>
                <button className="btn btn-g" disabled={closing !== null} onClick={() => decide(false)}>
                  {t("p12c.admin.disputes.markRejected")}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

/** A27 — order export scheduler: create, active toggle, delete. */
function ExportSchedulesTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminB3Api.listExportSchedules().then((r) => r.schedules),
  );
  const [schedules, setSchedules] = useState<ExportSchedule[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [frequency, setFrequency] = useState<ExportFrequency>("daily");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const shown = schedules ?? data;
  const freqLabel = (f: string) =>
    f === "daily" ? t("p12c.admin.exportSchedules.freqDaily")
    : f === "weekly" ? t("p12c.admin.exportSchedules.freqWeekly")
    : t("p12c.admin.exportSchedules.freqMonthly");

  async function create() {
    setSaving(true);
    try {
      const r = await adminB3Api.createExportSchedule({ frequency });
      setSchedules((p) => [r.schedule, ...(p ?? data ?? [])]);
      setCreating(false);
      toast(t("common.done"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: ExportSchedule) {
    try {
      const r = await adminB3Api.updateExportSchedule(s.id, { is_active: !s.is_active });
      setSchedules((p) => (p ?? data ?? []).map((x) => (x.id === s.id ? r.schedule : x)));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function del(s: ExportSchedule) {
    if (!window.confirm(t("p12c.admin.exportSchedules.confirmDelete"))) return;
    setDeleting(s.id);
    try {
      await adminB3Api.deleteExportSchedule(s.id);
      setSchedules((p) => (p ?? []).filter((x) => x.id !== s.id));
      toast(t("common.done"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="rowflex">
        <div>
          <h3 style={{ margin: 0 }}>{t("p12c.admin.exportSchedules.title")}</h3>
        </div>
        <span className="spacer" />
        <button className="btn btn-p" onClick={() => setCreating(true)}>
          {t("p12c.admin.exportSchedules.create")}
        </button>
      </div>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (shown ?? []).length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("p12c.admin.exportSchedules.empty")} />
      )}

      {(shown ?? []).map((s) => (
        <div className="card" key={s.id}>
          <div className="rowflex">
            <div>
              <b>{t("p12c.admin.exportSchedules.kindOrders")}</b> · {freqLabel(s.frequency)}
              <br />
              <span className="tiny muted">
                {t("p12c.admin.exportSchedules.lastRun")}: {s.last_run_at ? s.last_run_at.slice(0, 16).replace("T", " ") : t("p12c.admin.exportSchedules.never")} ·{" "}
                {t("p12c.admin.exportSchedules.nextRun")}: {s.next_run_at ? s.next_run_at.slice(0, 16).replace("T", " ") : t("p12c.admin.exportSchedules.never")}
              </span>
            </div>
            <span className="spacer" />
            <button className={`chip${s.is_active ? "" : " grey"}`} onClick={() => toggle(s)} style={{ cursor: "pointer" }}>
              {t("p12c.admin.exportSchedules.active")}
            </button>
          </div>
          <div className="btn-row">
            <button className="btn btn-g" disabled={deleting === s.id} onClick={() => del(s)}>
              {t("p12c.admin.exportSchedules.delete")}
            </button>
          </div>
        </div>
      ))}

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h3 style={{ marginTop: 0 }}>{t("p12c.admin.exportSchedules.create")}</h3>
          <label className="fl">{t("p12c.admin.exportSchedules.frequency")}</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as ExportFrequency)}>
            <option value="daily">{t("p12c.admin.exportSchedules.freqDaily")}</option>
            <option value="weekly">{t("p12c.admin.exportSchedules.freqWeekly")}</option>
            <option value="monthly">{t("p12c.admin.exportSchedules.freqMonthly")}</option>
          </select>
          <div className="btn-row">
            <button className="btn btn-p" disabled={saving} onClick={create}>
              {saving ? t("common.loading") : t("common.save")}
            </button>
            <button className="btn btn-g" onClick={() => setCreating(false)}>
              {t("p12c.admin.planTemplates.cancel")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Admin orders overview: every order in the fulfilment system with
 * counts per status. Read-only here — advancement happens in Pharmacy.
 *
 * Tabs: Orders (A9 CSV export), Disputes (A21), Export schedules (A27).
 */
export default function AdminOrders() {
  const { t } = useLang();
  const [tab, setTab] = useState<"orders" | "disputes" | "exports" | "couriers" | "returns" | "pharmacy">("orders");
  const { data, error, loading, retry } = useAsync(() =>
    shopApi.pharmacyOrders().then((r) => r.orders),
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const byStatus = (data ?? []).reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = (data ?? []).filter((o) => o.created_at.slice(0, 10) === today).length;

  /** A9: CSV export of the orders shown. */
  function exportCsv() {
    const csv = ordersToCsv(
      (data ?? []).map((o) => ({
        id: o.id,
        status: o.status,
        total_npr: o.total_npr,
        payment_method: o.payment_method,
        created_at: o.created_at,
      }))
    );
    downloadCsv(csv, `jaraa-orders-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div className="screen">
      <div className="rowflex">
        <div style={{ flex: 1 }}>
          <h1 style={{ marginBottom: 0 }}>{t("adminOrders.title")}</h1>
          <p className="muted tiny">{t("adminOrders.sub")}</p>
        </div>
        {tab === "orders" && (
          <button
            className="btn btn-s"
            style={{ width: "auto", margin: 0 }}
            disabled={loading || (data ?? []).length === 0}
            onClick={exportCsv}
          >
            {t("p12.admin.exportCsv")}
          </button>
        )}
      </div>

      <div className="tabrow" role="tablist">
        <button className={`tab${tab === "orders" ? " on" : ""}`} role="tab" aria-selected={tab === "orders"} onClick={() => setTab("orders")}>
          {t("adminOrders.title")}
        </button>
        <button className={`tab${tab === "disputes" ? " on" : ""}`} role="tab" aria-selected={tab === "disputes"} onClick={() => setTab("disputes")}>
          {t("p12c.admin.disputes.title")}
        </button>
        <button className={`tab${tab === "exports" ? " on" : ""}`} role="tab" aria-selected={tab === "exports"} onClick={() => setTab("exports")}>
          {t("p12c.admin.exportSchedules.title")}
        </button>
        <button className={`tab${tab === "couriers" ? " on" : ""}`} role="tab" aria-selected={tab === "couriers"} onClick={() => setTab("couriers")}>
          {t(`${K4}.courierPerf.title`)}
        </button>
        <button className={`tab${tab === "returns" ? " on" : ""}`} role="tab" aria-selected={tab === "returns"} onClick={() => setTab("returns")}>
          {t(`${K4}.returnsAnalytics.title`)}
        </button>
        <button className={`tab${tab === "pharmacy" ? " on" : ""}`} role="tab" aria-selected={tab === "pharmacy"} onClick={() => setTab("pharmacy")}>
          {t(`${K4}.pharmacyPerf.title`)}
        </button>
      </div>

      {tab === "disputes" && <DisputesTab />}
      {tab === "exports" && <ExportSchedulesTab />}
      {tab === "couriers" && <CourierPerfTab />}
      {tab === "returns" && <ReturnsAnalyticsTab />}
      {tab === "pharmacy" && <PharmacyPerfTab />}

      {tab === "orders" && (
        <>
          {loading && <Loading />}
          {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

          {!loading && !error && (
            <>
              <div className="statgrid">
                <StatCard label={t("adminOrders.total")} value={String(data?.length ?? 0)} icon={<Icon.truck size={26} />} />
                <StatCard label={t("adminDash.ordersToday")} value={String(todayCount)} icon={<Icon.clock size={26} />} />
                <StatCard label={t("orders.status.paid")} value={String(byStatus.paid ?? 0)} icon={<Icon.box size={26} />} />
                <StatCard label={t("orders.status.delivered")} value={String(byStatus.delivered ?? 0)} icon={<Icon.check size={26} />} />
              </div>

              {(data ?? []).length === 0 && (
                <EmptyState icon={<Icon.truck size={32} />} title={t("adminOrders.empty")} />
              )}

              {(data ?? []).map((o) => {
                const tl = orderTimeline(o.status);
                return (
                  <div className="card" key={o.id}>
                    <div className="rowflex">
                      <div>
                        <b className="kbd">{o.id.slice(0, 8)}</b>
                        <br />
                        <span className="tiny muted">
                          {o.created_at.slice(0, 10)} · {o.payment_method.toUpperCase()} · NPR {o.total_npr}
                          {o.shipping_address ? ` · ${o.shipping_address.name}, ${o.shipping_address.city}` : ""}
                        </span>
                      </div>
                      <span className="spacer" />
                      <span className="chip">{t(`orders.status.${o.status}`)}</span>
                    </div>
                    {tl.steps.length > 0 && (
                      <div className="tl" aria-hidden="true">
                        {tl.steps.map((s) => (
                          <div className={`tl-step ${s.state}`} key={s.key}>
                            <span className="tl-dot">{s.state === "done" ? <Icon.check size={12} /> : null}</span>
                            <span className="tl-label">{t(`ordersTimeline.${s.key}`)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}
