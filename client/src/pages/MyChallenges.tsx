import { meApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";
import { CertificateCard, SurveyForm } from "../components/b4customer";

const DAY_MS = 86_400_000;

/**
 * C4-customer — My challenges: challenge cards with days-left countdown
 * and a progress bar, plus one-tap "mark complete". Only real assigned
 * challenges are shown — none are invented.
 */
export default function MyChallenges() {
  const { t, lang } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => meApi.listMyChallenges().then((r) => r.assignments),
    [],
  );

  async function complete(assignmentId: string) {
    try {
      await meApi.completeChallenge(assignmentId);
      toast(t("p12.customer.challengeDone"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="screen">
        <h1>{t("p12.customer.myChallenges")}</h1>
        <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />
      </div>
    );
  }

  const assignments = data ?? [];

  return (
    <div className="screen">
      <h1>{t("p12.customer.myChallenges")}</h1>

      {assignments.length === 0 && <EmptyState icon={<Icon.plan size={32} />} title={t("p12.customer.noChallenges")} />}

      {assignments.map((a) => {
        const c = a.challenge;
        const days = c?.days ?? 0;
        const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(a.started_at)) / DAY_MS));
        const daysLeft = days > 0 ? Math.max(0, days - elapsed) : 0;
        const pct = days > 0 ? Math.min(100, Math.round((elapsed / days) * 100)) : 0;
        const done = a.completed_at != null;
        return (
          <div className="card" key={a.id}>
            <div className="rowflex">
              <div style={{ flex: 1 }}>
                <b>{c ? (lang === "ne" ? c.title_ne ?? c.title_en : c.title_en) : a.challenge_id.slice(0, 8)}</b>
                <br />
                <span className="tiny muted">
                  {a.started_at.slice(0, 10)}
                  {c?.description_en && (
                    <>
                      {" — "}
                      {lang === "ne" ? c.description_ne ?? c.description_en : c.description_en}
                    </>
                  )}
                </span>
              </div>
              {done ? (
                <Chip tone="gold">{t("p12.customer.challengeDone")}</Chip>
              ) : (
                days > 0 && <span className="chip">{t("p12.customer.daysLeft", { n: daysLeft })}</span>
              )}
            </div>
            {!done && days > 0 && (
              <div style={{ margin: "10px 0", height: 8, borderRadius: 6, background: "var(--line)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--green)" }} />
              </div>
            )}
            {!done && (
              <button className="btn btn-p btn-s" onClick={() => void complete(a.id)}>
                {t("p12.customer.completeChallenge")}
              </button>
            )}
            {/* C28: certificate for completed challenges (batch 4) */}
            {done && (
              <div style={{ marginTop: 10 }}>
                <CertificateCard assignmentId={a.id} />
              </div>
            )}
            {/* C45: end-of-challenge survey (batch 4) */}
            {done && (
              <div style={{ marginTop: 4 }}>
                <SurveyForm assignmentId={a.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
