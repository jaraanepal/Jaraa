import { useState } from "react";
import { Link } from "react-router-dom";
import { doctorB3Api, type B3SecondOpinion } from "../../api/b3doctor";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

const STATUS_TONE: Record<B3SecondOpinion["status"], "red" | "amber" | "grey"> = {
  pending: "amber",
  accepted: "red",
  declined: "grey",
  done: "grey",
};

const STATUS_KEY: Record<B3SecondOpinion["status"], string> = {
  pending: "p12c.doctor.soStPending",
  accepted: "p12c.doctor.soStAccepted",
  declined: "p12c.doctor.soStDeclined",
  done: "p12c.doctor.soStDone",
};

import { useAuth } from "../../auth/AuthContext";

/**
 * D22 — "Second opinions" tab: Sent / Received sub-tabs. Pending received
 * requests get Accept / Decline buttons. (The request modal lives on the
 * case page; this tab is the inbox.)
 */
export function DoctorSecondOpinions() {
  const { t } = useLang();
  const { profile } = useAuth();
  const me = profile?.user_id ?? "";
  const [sub, setSub] = useState<"sent" | "received">("received");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, error, loading, retry } = useAsync(() =>
    doctorB3Api.listSecondOpinions().then((r) => r.secondOpinions),
  );

  const list = (data ?? []).filter((s) =>
    sub === "sent" ? s.requester_id === me : s.reviewer_id === me,
  );

  async function decide(id: string, accept: boolean) {
    setBusyId(id);
    try {
      await doctorB3Api.decideSecondOpinion(id, accept);
      toast(accept ? t("p12c.doctor.soStAccepted") : t("p12c.doctor.soStDeclined"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <p className="muted tiny">{t("p12c.doctor.soSub")}</p>
      <div className="tabrow" style={{ margin: "8px 0" }}>
        <button className={`tab${sub === "received" ? " on" : ""}`} onClick={() => setSub("received")}>
          {t("p12c.doctor.soReceivedTab")} ({(data ?? []).filter((s) => s.reviewer_id === me).length})
        </button>
        <button className={`tab${sub === "sent" ? " on" : ""}`} onClick={() => setSub("sent")}>
          {t("p12c.doctor.soSentTab")} ({(data ?? []).filter((s) => s.requester_id === me).length})
        </button>
      </div>
      {loading && <Loading />}
      {error ? <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} /> : null}
      {!loading && !error && list.length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("p12c.doctor.soEmpty")} />
      )}
      {list.map((s) => (
        <div className="card" key={s.id} style={{ padding: "8px 12px" }}>
          <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4 }}>
            <Link className="linklike" to={`/doctor/case/${s.case_id}`}>
              {t("p12c.doctor.auditCase")} {s.case_id.slice(0, 8)}
            </Link>
            <Chip tone={STATUS_TONE[s.status]}>{t(STATUS_KEY[s.status])}</Chip>
            <span className="spacer" />
            <span className="tiny muted">{new Date(s.created_at).toLocaleDateString()}</span>
          </div>
          {s.note && <p className="tiny" style={{ margin: "6px 0 0" }}>{s.note}</p>}
          {sub === "received" && s.status === "pending" && (
            <div className="rowflex" style={{ marginTop: 8 }}>
              <button
                className="btn btn-p btn-s"
                style={{ width: "auto", margin: 0 }}
                disabled={busyId === s.id}
                onClick={() => decide(s.id, true)}
              >
                {t("p12c.doctor.soAccept")}
              </button>
              <button
                className="btn btn-s"
                style={{ width: "auto", margin: 0 }}
                disabled={busyId === s.id}
                onClick={() => decide(s.id, false)}
              >
                {t("p12c.doctor.soDecline")}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
