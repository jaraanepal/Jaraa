import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { scansApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { ErrorCard, Loading, NoticeBox, apiErrorMessage } from "../../components/ui";
import { Icon } from "../../components/icons";
import type { Case, ScanDetail } from "../../api/types";
import { finishDraft } from "./ScanShell";
import { loadDraft } from "../../lib/draft";

export default function SubmitScan() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Case | null>(null);

  useEffect(() => {
    if (!id) return;
    scansApi
      .getScan(id)
      .then((d) => {
        setDetail(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  }, [id, t]);

  async function submit() {
    if (!id) return;
    setSubmitting(true);
    setError(null);
    setBlocked(false);
    try {
      const c = await scansApi.submit(id);
      finishDraft();
      setDone(c);
    } catch (e) {
      if ((e as { code?: string })?.code === "red_flag_unresolved") {
        setBlocked(true);
      } else {
        setError(apiErrorMessage(t, e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading />;

  if (done) {
    return (
      <div className="screen center">
        <div style={{ color: "var(--green)" }}><Icon.check size={56} /></div>
        <h1>{t("submit.successTitle")}</h1>
        <p>{t("submit.successBody")}</p>
        <p><b>{t("submit.caseId", { id: done.id.slice(0, 8) })}</b></p>
        <Link className="btn btn-p" to="/progress" style={{ textDecoration: "none", textAlign: "center" }}>
          {t("submit.viewProgress")}
        </Link>
      </div>
    );
  }

  const draft = loadDraft();
  const pins = (detail?.timeline_events.length ?? 0) + draft.pins.length;
  const photos = detail?.photos.length ?? Object.keys(draft.uploadedAngles).length;
  const unresolved = detail?.red_flags.filter((f) => !f.resolved_at) ?? [];
  const scoresOk = !!detail?.root_scores || Object.keys(draft.answers).length > 0;

  const row = (ok: boolean, label: string) => (
    <p key={label} style={{ color: ok ? "inherit" : "var(--muted)" }}>
      {ok ? <Icon.check size={16} /> : <Icon.cross size={16} />} {label}
    </p>
  );

  return (
    <div className="screen">
      <h1>{t("submit.title")}</h1>
      {error && <ErrorCard message={error} onRetry={() => navigate(`/scan/${id}/map`)} />}

      {blocked && (
        <NoticeBox tone="flag" title={t("submit.blockedTitle")}>
          <p>{t("submit.blockedBody")}</p>
          <p className="muted tiny">{t("errors.red_flag_unresolved")}</p>
        </NoticeBox>
      )}

      <div className="card">
        {pins > 0
          ? row(true, t("submit.checkKahani", { n: pins }))
          : row(false, t("submit.checkKahaniSkipped"))}
        {row(photos >= 3, t("submit.checkPhotos", { have: Math.min(photos, 5) }))}
        {row(scoresOk, t("submit.checkScores"))}
        {row(draft.consentPhoto || photos > 0, t("submit.checkConsent"))}
        {row(unresolved.length === 0, t("submit.checkNoFlags"))}
        <p className="muted tiny">{t("submit.incompleteNote")}</p>
      </div>

      <button className="btn btn-p" disabled={submitting || blocked} onClick={submit}>
        {submitting ? t("common.loading") : t("submit.submitButton")}
      </button>
      <div className="btn-row">
        <Link className="linklike" to={`/scan/${id}/map`}>{t("submit.myRootMap")}</Link>
      </div>
    </div>
  );
}
