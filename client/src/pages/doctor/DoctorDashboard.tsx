import { useState } from "react";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { StatCard } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { CaseList } from "./CaseList";

/**
 * Doctor landing page: stat cards (queue load, red flags, SLA pressure)
 * plus tabs for the review queue and reviewed-plan history.
 */
export default function DoctorDashboard({ initialTab = "queue" }: { initialTab?: "queue" | "reviewed" }) {
  const { t } = useLang();
  const [tab, setTab] = useState<"queue" | "reviewed">(initialTab);

  const queued = useAsync(() => doctorApi.listCases("queued", 50).then((r) => r.cases));
  const reviewed = useAsync(() => doctorApi.listCases("reviewed", 50).then((r) => r.cases));

  const q = queued.data ?? [];
  const redFlags = q.filter((c) => c.priority === "red_flag").length;
  const overdue = q.filter((c) => new Date(c.sla_due_at).getTime() <= Date.now()).length;

  return (
    <div className="screen">
      <h1>{t("doctor.queueTitle")}</h1>
      <p className="muted tiny">{t("doctor.queueSub")}</p>

      <div className="statgrid">
        <StatCard label={t("doctorDash.waiting")} value={queued.loading ? "…" : String(q.length)} icon={<Icon.doc size={26} />} />
        <StatCard label={t("doctor.redFlagPriority")} value={queued.loading ? "…" : String(redFlags)} icon={<Icon.alert size={26} />} />
        <StatCard label={t("doctorDash.overdue")} value={queued.loading ? "…" : String(overdue)} icon={<Icon.clock size={26} />} />
        <StatCard label={t("doctorDash.reviewedCount")} value={reviewed.loading ? "…" : String((reviewed.data ?? []).length)} icon={<Icon.check size={26} />} />
      </div>

      <div className="tabrow" role="tablist">
        <button className={`tab${tab === "queue" ? " on" : ""}`} role="tab" aria-selected={tab === "queue"} onClick={() => setTab("queue")}>
          {t("doctorDash.queueTab")} ({q.length})
        </button>
        <button className={`tab${tab === "reviewed" ? " on" : ""}`} role="tab" aria-selected={tab === "reviewed"} onClick={() => setTab("reviewed")}>
          {t("doctorDash.reviewedTab")}
        </button>
      </div>

      {tab === "queue" ? <CaseList status="queued" /> : <CaseList status="reviewed" />}
    </div>
  );
}
