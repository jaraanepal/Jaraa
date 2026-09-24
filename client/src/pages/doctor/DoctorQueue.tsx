import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
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

export default function DoctorQueue() {
  const { t } = useLang();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    doctorApi
      .listCases("queued")
      .then((r) => {
        setCases(r.cases);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };

  useEffect(load, [t]);

  async function claim(id: string) {
    try {
      await doctorApi.claimCase(id);
      toast(t("doctor.claimedToast"));
      load();
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

  if (loading) return <Loading />;

  // Red-flag cases first, then oldest SLA.
  const sorted = [...cases].sort((a, b) => {
    const pa = a.priority === "red_flag" ? 0 : 1;
    const pb = b.priority === "red_flag" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.sla_due_at).getTime() - new Date(b.sla_due_at).getTime();
  });

  return (
    <div className="screen">
      <h1>{t("doctor.queueTitle")}</h1>
      <p className="muted tiny">{t("doctor.queueSub")}</p>
      {error && <ErrorCard message={error} onRetry={load} />}
      {sorted.length === 0 && !error && <p className="muted">—</p>}

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
            {!c.assigned_doctor_id && (
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
