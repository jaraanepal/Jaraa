import { useMemo, useState } from "react";
import { useScan } from "./ScanShell";
import { useLang } from "../../i18n/LanguageContext";
import { useAuth } from "../../auth/AuthContext";
import { Chip, ErrorCard, NoticeBox, ScoreBar, apiErrorMessage } from "../../components/ui";
import { Icon } from "../../components/icons";
import {
  STAGE3_QUESTIONS, allRootsAnswered, questionVisible, rootScoreFor,
  type AdaptivePath, type QuestionVisibility,
} from "../../lib/stage3";
import type { RedFlagType, RootKey } from "../../api/types";
import { scansApi } from "../../api/client";

const ROOTS: RootKey[] = ["nutrition", "stress_sleep", "hormones", "scalp", "damage", "medical_family"];

export default function Jara() {
  const { t, lang } = useLang();
  const { profile } = useAuth();
  const { scanId, draft, updateDraft, goStage } = useScan();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sliderVals, setSliderVals] = useState<Record<string, string>>({});

  const path: AdaptivePath = draft.path;
  const vis: QuestionVisibility = useMemo(
    () => ({ path, gender: profile?.gender }),
    [path, profile?.gender],
  );
  const visible = useMemo(
    () => STAGE3_QUESTIONS.filter((q) => questionVisible(q, vis)),
    [vis],
  );
  const scores = useMemo(
    () => Object.fromEntries(ROOTS.map((r) => [r, rootScoreFor(r, draft.answers, vis)])),
    [draft.answers, vis],
  );
  const done = useMemo(() => allRootsAnswered(draft.answers, vis), [draft.answers, vis]);

  function answer(qid: string, value: string) {
    const q = STAGE3_QUESTIONS.find((x) => x.qid === qid);
    const next = { ...draft.answers, [qid]: value };
    const patch: Partial<typeof draft> = { answers: next };
    // Red-flag hooks on answers (thyroid -> RF2, PCOS -> RF3, scalp pain -> RF4).
    if (q?.flagOn) {
      const flag = q.flagOn(value) as RedFlagType | null;
      if (flag && !draft.redFlags.includes(flag)) {
        patch.redFlags = [...draft.redFlags, flag];
      }
    }
    updateDraft(patch);
  }

  async function continueToMap() {
    setSaving(true);
    setError(null);
    try {
      // Persist Stage-3 answers to the server (POST /scans/:id/answers) before
      // entering Root Map: the server recomputes root scores from its own
      // copy of the answers, so local-only answers would score as blank.
      // 409 here means the answers raised a red flag — surface it honestly.
      try {
        await scansApi.saveAnswers(scanId, draft.answers as Record<string, unknown>);
      } catch (e: any) {
        const code = e?.code;
        if (code === "red_flags_raised") throw e;
        // Non-flag failures (offline etc.) must not trap the user: answers
        // stay in the local draft and sync on the next attempt.
      }
      await scansApi.advanceStage(scanId, "root_map");
      goStage("root_map");
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>{t("jara.title")}</h1>
      <p className="muted">{t("jara.subtitle")}</p>
      {error && <ErrorCard message={error} />}

      {draft.medFlag && (
        <NoticeBox tone="notice" title={t("kahani.medFlagTitle")}>
          <p>{t("kahani.medFlagBody")}</p>
        </NoticeBox>
      )}
      {draft.redFlags.length > 0 && (
        <NoticeBox tone="flag" title={t("jara.redFlagTitle")}>
          <p>
            {draft.redFlags.map((f) => (
              <span key={f}><Chip tone="red">{t(`redflags.${f}`)}</Chip><br /></span>
            ))}
          </p>
          <p className="muted">{t("jara.redFlagBody")}</p>
        </NoticeBox>
      )}

      {ROOTS.map((root) => {
        const qs = visible.filter((q) => q.root === root);
        if (qs.length === 0) {
          return (
            <p key={root} className="tiny muted">
              {t(`jara.roots.${root}`)} — {t("jara.hiddenOnPath")}
            </p>
          );
        }
        const s = scores[root];
        return (
          <section className="rootgroup" key={root}>
            <div className="rh">
              <h3>{t(`jara.roots.${root}`)}</h3>
              <span className="tiny muted">
                {t("jara.answeredOf", { a: s.answered, t: s.total })}
              </span>
            </div>
            <div className="rowflex">
              <ScoreBar score={s.score} />
              <b>{s.score}</b>
              <span className="tiny muted">
                {s.score >= 70 ? t("jara.scoreWord.good") : s.score >= 40 ? t("jara.scoreWord.fair") : t("jara.scoreWord.needsCare")}
              </span>
            </div>
            {qs.map((q) => (
              <div key={q.qid} style={{ margin: "14px 0" }}>
                <div className="bubble q"><Icon.chat size={16} /> {t(q.textKey)}</div>
                {q.type === "slider" ? (
                  <div>
                    <input
                      type="range"
                      min={q.min ?? 3}
                      max={q.max ?? 10}
                      value={sliderVals[q.qid] ?? draft.answers[q.qid] ?? String(q.defaultValue ?? 7)}
                      onChange={(e) => setSliderVals((v) => ({ ...v, [q.qid]: e.target.value }))}
                      onBlur={(e) => answer(q.qid, e.target.value)}
                      aria-label={t(q.textKey)}
                    />
                    <div className="rowflex">
                      <b>{sliderVals[q.qid] ?? draft.answers[q.qid] ?? String(q.defaultValue ?? 7)}h</b>
                      <span className="spacer" />
                      <button
                        className="btn btn-p"
                        style={{ width: "auto", margin: 0 }}
                        onClick={() => answer(q.qid, sliderVals[q.qid] ?? draft.answers[q.qid] ?? String(q.defaultValue ?? 7))}
                      >
                        {t("common.ok")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="opts">
                    {q.opts!.map((o) => (
                      <button
                        key={o.value}
                        className={draft.answers[q.qid] === o.value ? "sel" : ""}
                        onClick={() => answer(q.qid, o.value)}
                        aria-pressed={draft.answers[q.qid] === o.value}
                      >
                        {t(o.labelKey)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      })}

      <button className="btn btn-p" disabled={!done || saving} onClick={continueToMap}>
        {saving ? t("common.loading") : t("jara.seeRootMap")}
      </button>
      {!done && <p className="muted tiny">{t("jara.needOnePerRoot")}</p>}
      <button className="linklike" onClick={() => goStage("lens")}>← {t("lens.title")}</button>
      <span className="sr-only">{lang}</span>
    </div>
  );
}
