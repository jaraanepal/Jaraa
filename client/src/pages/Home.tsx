import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { meApi, scansApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { useFlags } from "../auth/FlagsContext";
import { ErrorCard, Loading, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import { clearDraft, draftHasProgress, loadDraft, saveDraft } from "../lib/draft";

const STAGE_KEYS = ["home.stage1", "home.stage2", "home.stage3", "home.stage4"] as const;

export default function Home() {
  const { t } = useLang();
  const { role, isAuthed } = useAuth();
  const flags = useFlags();
  const navigate = useNavigate();
  const [planState, setPlanState] = useState<"loading" | "approved" | "pending" | "error">("loading");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Role landing: non-customers go to their own consoles.
  useEffect(() => {
    if (role === "doctor") navigate("/doctor", { replace: true });
    else if (role === "admin") navigate("/admin", { replace: true });
    else if (role === "pharmacy") navigate("/pharmacy", { replace: true });
    else if (role === "coach") navigate("/coach", { replace: true });
  }, [role, navigate]);

  // Guests have no plan to fetch — the plan card is hidden for them.
  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    meApi
      .getPlan()
      .then((p) => {
        if (alive) setPlanState(p.status === "approved" ? "approved" : "pending");
      })
      .catch((e) => {
        if (!alive) return;
        const code = (e as { code?: string })?.code;
        // No plan yet (404) means the scan is still with the dermatologist.
        setPlanState(code === "not_found" || code === "not_ready" ? "pending" : "error");
      });
    return () => {
      alive = false;
    };
  }, [isAuthed]);

  const draft = loadDraft();
  const resumable = draftHasProgress(draft) && draft.scanId;

  async function startScan() {
    setStarting(true);
    setError(null);
    try {
      const scan = await scansApi.createScan();
      clearDraft();
      saveDraft({ ...loadDraft(), scanId: scan.id, guest: true, stage: "kahani" });
      navigate(`/scan/${scan.id}`);
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="screen">
      <section className="hero">
        <h1>{t("home.welcome")}</h1>
        <p>{t("home.intro1")}</p>
        <p className="tiny" style={{ opacity: 0.85 }}>{t("home.intro2")}</p>
      </section>

      {error && <ErrorCard message={error} />}

      <div className="card">
        <h3>{t("home.stagesTitle")}</h3>
        {STAGE_KEYS.map((s, i) => (
          <p key={s} style={{ margin: "6px 0" }}>
            <span className="chip gold">{i + 1}</span> <b>{t(s)}</b> —{" "}
            <span className="muted">{t(`${s}d`)}</span>
          </p>
        ))}
      </div>

      {resumable ? (
        <button className="btn btn-p" onClick={() => navigate(`/scan/${draft.scanId}`)}>
          {t("home.resumeScan")} — {t("home.resumeAt", { stage: t(STAGE_KEYS[["kahani", "lens", "jara", "root_map"].indexOf(draft.stage)] ?? "home.stage1") })}
        </button>
      ) : (
        <button className="btn btn-p" onClick={startScan} disabled={starting || !flags.root_scan}>
          {starting ? t("common.loading") : t("home.startScan")}
        </button>
      )}

      {isAuthed && (
      <div className="card">
        {planState === "loading" && <Loading />}
        {planState === "approved" && (
          <>
            <p><Icon.check size={16} /> <b>{t("home.planReady")}</b></p>
            <Link className="btn btn-s" to="/plan" style={{ textDecoration: "none", textAlign: "center" }}>
              {t("home.viewPlan")}
            </Link>
          </>
        )}
        {planState === "pending" && <p className="muted">{t("home.reviewing")}</p>}
        {planState === "error" && <p className="muted">{t("errors.network")}</p>}
        <Link className="linklike" to="/progress">{t("home.viewProgress")}</Link>
      </div>
      )}

      {flags.cosmetic_kits && (
        <div className="card rowflex">
          <Icon.box size={28} />
          <div>
            <b>{t("nav.kits")}</b>
            <br />
            <Link className="linklike" to="/kits">{t("home.browseKits")}</Link>
          </div>
        </div>
      )}

      <div className="card rowflex">
        <Icon.video size={28} />
        <div>
          <b>{t("teleconsult.title")}</b>
          <br />
          <Link className="linklike" to="/teleconsult">
            {flags.teleconsult_booking ? t("teleconsult.bookingTitle") : t("teleconsult.disabledTitle")}
          </Link>
        </div>
      </div>

      <p className="tiny muted center">{t("home.under16")}</p>
    </div>
  );
}
