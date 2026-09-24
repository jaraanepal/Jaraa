import { useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { Case } from "../../api/types";

const STATUS_KEY: Record<Case["status"], string> = {
  queued: "doctor.stNew",
  in_review: "doctor.stInReview",
  needs_info: "doctor.stNeedsInfo",
  reviewed: "doctor.stReviewed",
};

function slaLabel(slaDueAt: string, t: (k: string) => string): string {
  const left = new Date(slaDueAt).getTime() - Date.now();
  if (left <= 0) return `${t("doctor.sla")}: !`;
  const h = Math.floor(left / 3600000);
  return `${t("doctor.sla")}: ${h}h`;
}

/**
 * Case list panel, filtered by status. Used by the doctor dashboard
 * tabs (review queue + reviewed history).
 */
export function CaseList({ status }: { status: Case["status"] }) {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    doctorApi.listCases(status, 50).then((r) => r.cases),
  );
  const [claimError, setClaimError] = useState<string | null>(null);

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

  // Red-flag cases first, then oldest SLA.
  const sorted = [...data].sort((a, b) => {
    const pa = a.priority === "red_flag" ? 0 : 1;
    const pb = b.priority === "red_flag" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.sla_due_at).getTime() - new Date(b.sla_due_at).getTime();
  });

  return (
    <div>
      {claimError && <ErrorCard message={claimError} />}
      {sorted.length === 0 && (
        <EmptyState
          icon={<Icon.doc size={32} />}
          title={t(status === "reviewed" ? "doctorDash.emptyReviewed" : "doctorDash.emptyQueue")}
        />
      )}
      {sorted.map((c) => (
        <div className="card" key={c.id}>
          <div className="rowflex">
            <span style={{ color: c.priority === "red_flag" ? "var(--bad)" : "var(--green)" }}>
              <Icon.doc size={26} />
            </span>
            <div>
              <b className="kbd">{c.scan_id.slice(0, 8)}</b>
              <br />
              <span className="tiny" style={{ color: "var(--gold)" }}>
                <Icon.clock size={12} /> {slaLabel(c.sla_due_at, t)}
              </span>
              {c.priority === "red_flag" && (
                <>
                  <br />
                  <Chip tone="red">{t("doctor.redFlagPriority")}</Chip>
                </>
              )}
            </div>
            <span className="spacer" />
            <span className="chip">{t(STATUS_KEY[c.status])}</span>
          </div>
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
      ))}
    </div>
  );
}
