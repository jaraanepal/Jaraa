import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, StatCard } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { CaseList } from "./CaseList";
import { SlaBar, msShort, slaState, urgencyRank, waitMs, waitShort } from "./caseUtils";

/**
 * Doctor landing page: workload stats (queue load, red flags, SLA pressure,
 * red-flag rate, average wait), a "needs attention" panel with the most
 * urgent cases and their SLA countdown bars, plus tabs for the review
 * queue and the reviewed-plan history.
 */
export default function DoctorDashboard({ initialTab = "queue" }: { initialTab?: "queue" | "reviewed" }) {
  const { t } = useLang();
  const [tab, setTab] = useState<"queue" | "reviewed">(initialTab);

  const queued = useAsync(() => doctorApi.listCases("queued", 50).then((r) => r.cases));
  const reviewed = useAsync(() => doctorApi.listCases("reviewed", 50).then((r) => r.cases));

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

      <div className="tabrow" role="tablist">
        <button className={`tab${tab === "queue" ? " on" : ""}`} role="tab" aria-selected={tab === "queue"} onClick={() => setTab("queue")}>
          {t("doctorDash.queueTab")} ({q.length})
        </button>
        <button className={`tab${tab === "reviewed" ? " on" : ""}`} role="tab" aria-selected={tab === "reviewed"} onClick={() => setTab("reviewed")}>
          {t("doctorDash.reviewedTab")} ({reviewed.loading ? "…" : (reviewed.data ?? []).length})
        </button>
      </div>

      {tab === "queue" ? <CaseList status="queued" /> : <CaseList status="reviewed" />}
    </div>
  );
}
