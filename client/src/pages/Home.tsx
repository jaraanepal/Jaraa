import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { meApi, scansApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { useFlags } from "../auth/FlagsContext";
import { ErrorCard, Loading, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import { clearDraft, draftHasProgress, loadDraft, saveDraft } from "../lib/draft";
import { CommunityTab } from "../components/b3customer";
import { PriceDropCard, ReorderCard, StreakCard } from "../components/b4customer";

const STAGE_KEYS = ["home.stage1", "home.stage2", "home.stage3", "home.stage4"] as const;
const STAGE_SLUGS = ["kahani", "lens", "jara", "root_map"] as const;
const STAGE_ICONS = [Icon.book, Icon.camera, Icon.chart, Icon.pin];

/** Ring fill for the resume state: completed stages / 4. */
function Ring({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg className="jh-ring" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
      <circle className="bgc" cx="23" cy="23" r={r} fill="none" strokeWidth="5" />
      <circle className="fgc" cx="23" cy="23" r={r} fill="none" strokeWidth="5"
        strokeDasharray={c.toFixed(1)} strokeDashoffset={off.toFixed(1)} />
    </svg>
  );
}

export default function Home() {
  const { t } = useLang();
  const { role, isAuthed } = useAuth();
  const flags = useFlags();
  const navigate = useNavigate();
  const [planState, setPlanState] = useState<"loading" | "approved" | "pending" | "error">("loading");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selStage, setSelStage] = useState<number | null>(null);
  // Batch-3 (009): home ↔ community tab.
  const [homeTab, setHomeTab] = useState<"home" | "community">("home");
  // U14: water-intake widget — server-backed daily log (GET/POST /me/water).
  // Rapid taps: the UI updates instantly via a functional setState (no stale
  // closure), and the server sync is debounced so fast taps never drop counts.
  const [glasses, setGlasses] = useState(0);
  const waterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isAuthed) return;
    meApi.getWater().then((r) => setGlasses(r.log?.glasses ?? 0)).catch(() => {});
  }, [isAuthed]);
  useEffect(() => () => { if (waterTimer.current) clearTimeout(waterTimer.current); }, []);
  function bumpGlasses(delta: number) {
    setGlasses((prev) => {
      const next = Math.max(0, Math.min(40, prev + delta));
      if (waterTimer.current) clearTimeout(waterTimer.current);
      waterTimer.current = setTimeout(() => {
        meApi.setWater(new Date().toISOString().slice(0, 10), next).catch(() => {
          /* optimistic: keep the local count on failure */
        });
      }, 600);
      return next;
    });
  }

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
  const stageIdx = Math.max(0, STAGE_SLUGS.indexOf(draft.stage));
  const resumePct = resumable ? (stageIdx / 4) * 100 : 0;

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
    <div className="screen home-screen">
      {/* Animated hero */}
      <section className="jh-hero jh-in jh-d1">
        <div className="jh-brand">
          <span className="jh-mark"><Icon.leaf size={24} /></span>
          <div>
            <div className="jh-greet">{t("home.greeting")}</div>
            <h1 style={{ margin: "2px 0 0" }}>{t("home.welcome")}</h1>
          </div>
        </div>
        <p className="jh-sub" style={{ marginTop: 8 }}>{t("home.intro1")}</p>

        {resumable ? (
          <div className="jh-resume">
            <Ring pct={resumePct} />
            <div className="jh-resume-txt">
              <b>{t("home.scanInProgress")}</b>
              <p className="tiny" style={{ margin: "2px 0 8px", color: "rgba(255,255,255,0.85)" }}>
                {t("home.resumeSub")}
              </p>
              <button className="btn jh-cta" style={{ margin: 0 }} onClick={() => navigate(`/scan/${draft.scanId}`)}>
                {t("home.resumeScan")} — {t("home.resumeAt", { stage: t(STAGE_KEYS[stageIdx] ?? "home.stage1") })}
              </button>
            </div>
          </div>
        ) : (
          <div className="jh-pulsewrap">
            <button
              className="btn jh-cta"
              style={{ margin: 0 }}
              onClick={startScan}
              disabled={starting || !flags.root_scan}
            >
              {starting ? t("common.loading") : t("home.startScan")}
            </button>
          </div>
        )}
      </section>

      {error && <ErrorCard message={error} />}

      {/* U23: home ↔ community tabs (approved tips only, disclaimer pinned) */}
      <div className="btn-row jh-in jh-d2" role="tablist" aria-label={t("p12c.customer.u23_communityTips.title")}>
        <button
          role="tab" aria-selected={homeTab === "home"}
          className={`btn btn-s ${homeTab === "home" ? "btn-p" : "btn-g"}`}
          onClick={() => setHomeTab("home")}
        >
          {t("home.journey")}
        </button>
        <button
          role="tab" aria-selected={homeTab === "community"}
          className={`btn btn-s ${homeTab === "community" ? "btn-p" : "btn-g"}`}
          onClick={() => setHomeTab("community")}
        >
          {t("p12c.customer.u23_communityTips.title")}
        </button>
      </div>

      {homeTab === "community" ? (
        <CommunityTab />
      ) : (
      <>

      {/* Interactive stage stepper */}
      <section className="jh-steps jh-in jh-d2" aria-label={t("home.stagesTitle")}>
        <h3>{t("home.stagesTitle")}</h3>
        <p className="jh-hint">{t("home.tapStage")}</p>
        <div className="jh-track">
          {STAGE_KEYS.map((s, i) => {
            const StageIcon = STAGE_ICONS[i];
            const done = resumable && i < stageIdx;
            const sel = selStage === i;
            return (
              <button
                key={s}
                type="button"
                className={`jh-node jh-in${done ? " done" : ""}${sel ? " sel" : ""}`}
                style={{ animationDelay: `${0.3 + i * 0.08}s` }}
                onClick={() => setSelStage(sel ? null : i)}
                aria-expanded={sel}
              >
                <span className="jh-dot">
                  {done ? <Icon.check size={20} /> : <StageIcon size={20} />}
                </span>
                <span className="jh-nlabel">{t(s)}</span>
              </button>
            );
          })}
        </div>
        {selStage !== null && (
          <p className="jh-stagedesc" key={selStage}>
            <b>{t(STAGE_KEYS[selStage])}</b> — {t(`${STAGE_KEYS[selStage]}d`)}
          </p>
        )}
      </section>

      {/* U14: water-intake widget (client-side daily counter) */}
      {isAuthed && (
        <section className="card" aria-label={t("p12b.customer.water")}>
          <div className="rowflex">
            <div>
              <h3 style={{ marginTop: 0 }}>{t("p12b.customer.water")}</h3>
              <p className="muted tiny" style={{ margin: 0 }}>{t("p12b.customer.waterHint")}</p>
            </div>
            <span className="spacer" />
            <div className="rowflex" style={{ gap: 8 }}>
              <button
                className="btn btn-s btn-g"
                style={{ padding: "8px 14px", fontSize: 18 }}
                disabled={glasses <= 0}
                onClick={() => bumpGlasses(-1)}
                aria-label={t("p12b.customer.glassMinus")}
              >−</button>
              <b aria-live="polite">{glasses} {t("p12b.customer.glasses")}</b>
              <button
                className="btn btn-s btn-p"
                style={{ padding: "8px 14px", fontSize: 18 }}
                disabled={glasses >= 40}
                onClick={() => bumpGlasses(1)}
                aria-label={t("p12b.customer.glassPlus")}
              >+</button>
            </div>
          </div>
        </section>
      )}

      {/* U33: price-drop alerts for wishlisted kits (batch 4) */}
      {isAuthed && <PriceDropCard />}

      {/* U31/U41: check-in streak + reorder suggestions (batch 4) */}
      {isAuthed && <StreakCard />}
      {isAuthed && <ReorderCard />}

      {/* Your journey: plan preview / review timeline / sign-in prompt */}
      {isAuthed ? (
        <section className="jh-journey jh-in jh-d3">
          <h3><Icon.plan size={20} />{t("home.journey")}</h3>
          {planState === "loading" && <Loading />}
          {planState === "approved" && (
            <>
              <p><Icon.check size={16} /> <b>{t("home.planReady")}</b></p>
              <Link className="btn btn-s" to="/plan" style={{ textDecoration: "none", textAlign: "center" }}>
                {t("home.viewPlan")}
              </Link>
              <Link className="linklike" to="/progress">{t("home.viewProgress")}</Link>
            </>
          )}
          {planState === "pending" && (
            <>
              <p className="muted" style={{ marginTop: 2 }}>{t("home.reviewing")}</p>
              <div className="tl" aria-label={t("home.journey")}>
                <div className="tl-step done">
                  <span className="tl-dot"><Icon.check size={12} /></span>
                  <span className="tl-label">{t("home.rvSubmitted")}</span>
                </div>
                <div className="tl-step cur">
                  <span className="tl-dot"><Icon.clock size={12} /></span>
                  <span className="tl-label">{t("home.rvDoctor")}</span>
                </div>
                <div className="tl-step">
                  <span className="tl-dot" />
                  <span className="tl-label">{t("home.rvReady")}</span>
                </div>
              </div>
              <Link className="linklike" to="/progress">{t("home.viewProgress")}</Link>
            </>
          )}
          {planState === "error" && <p className="muted">{t("errors.network")}</p>}
        </section>
      ) : (
        <section className="jh-journey jh-in jh-d3">
          <h3><Icon.user size={20} />{t("home.signInTitle")}</h3>
          <p className="muted">{t("home.signInSub")}</p>
          <Link className="btn btn-s" to="/login" style={{ textDecoration: "none", textAlign: "center" }}>
            {t("home.signIn")}
          </Link>
        </section>
      )}

      {/* Quick actions */}
      <section className="jh-in jh-d4">
        <h3 style={{ marginBottom: 2 }}>{t("home.quick")}</h3>
        <div className="jh-qa">
          {flags.cosmetic_kits && (
            <Link to="/kits">
              <span className="jh-qic gold"><Icon.box size={20} /></span>
              {t("home.qaKits")}
            </Link>
          )}
          {isAuthed && (
            <>
              <Link to="/progress">
                <span className="jh-qic"><Icon.chart size={20} /></span>
                {t("home.qaProgress")}
              </Link>
              <Link to="/plan">
                <span className="jh-qic"><Icon.plan size={20} /></span>
                {t("home.qaPlan")}
              </Link>
              <Link to="/orders">
                <span className="jh-qic"><Icon.truck size={20} /></span>
                {t("home.qaOrders")}
              </Link>
            </>
          )}
          <Link to="/profile">
            <span className="jh-qic"><Icon.user size={20} /></span>
            {t("home.qaProfile")}
          </Link>
          <Link to="/teleconsult">
            <span className="jh-qic"><Icon.video size={20} /></span>
            {t("home.qaTele")}
          </Link>
        </div>
      </section>

      {/* Teleconsult feature card */}
      <Link to="/teleconsult" className="jh-tele jh-in jh-d5">
        <span className="jh-qic"><Icon.video size={20} /></span>
        <span>
          <b>{t("teleconsult.title")}</b>
          <br />
          <span className="muted">
            {flags.teleconsult_booking ? t("teleconsult.bookingTitle") : t("teleconsult.disabledTitle")}
          </span>
        </span>
      </Link>

      </>
      )}

      <p className="tiny muted center jh-in jh-d6">{t("home.under16")}</p>
    </div>
  );
}
