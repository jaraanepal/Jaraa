import { useEffect, useMemo, useRef, useState } from "react";
import { scansApi } from "../../api/client";
import type { PinType, RedFlag, RedFlagType, TimelineEvent } from "../../api/types";
import { useScan } from "./ScanShell";
import { useAuth } from "../../auth/AuthContext";
import { useLang } from "../../i18n/LanguageContext";
import {
  nextQuestion, storyBits, interviewRedFlag, interviewToAnswers, interviewToPins,
  monthsAgoISO, monthName, ONSET_MONTHS, answersToDraft, answersFromDraft,
  type IQ, type IQAnswers, type Script,
} from "../../lib/hairstory";

/* P-1: the Kahani timeline-pin editor is replaced by a conversational,
   branching interview. One question per screen, large answer chips,
   skip on every question, a live "your story so far" strip, and
   red-flag answers stop the interview for dermatologist review. */

/** Merge server-raised flags ({flag_type, detail}) into client RedFlag records. */
function mergeRaised(
  existing: RedFlag[],
  raised: Array<{ flag_type: string; detail: string }> | undefined,
): RedFlag[] {
  if (!raised?.length) return existing;
  const seen = new Set(existing.map((f) => f.flag_type));
  const extra: RedFlag[] = [];
  for (const r of raised) {
    if (seen.has(r.flag_type as RedFlagType)) continue;
    seen.add(r.flag_type as RedFlagType);
    extra.push({
      id: `server-${r.flag_type}`, scan_id: "", flag_type: r.flag_type as RedFlagType,
      detail: r.detail, created_at: new Date().toISOString(),
    });
  }
  return [...existing, ...extra];
}

/** Which interview questions create a server timeline pin when answered. */
const PIN_QUESTIONS = new Set(["onset", "ill_month", "sleep", "diet_less", "med_still", "birth_when"]);

function pinForQuestion(qid: string, a: IQAnswers): { event_type: PinType; occurred_on: string; followup_answers: Record<string, unknown> } | null {
  const all = interviewToPins(a);
  const want: Record<string, PinType> = {
    onset: "shedding_onset", ill_month: "illness_fever", sleep: "stress_period",
    diet_less: "crash_diet", med_still: "medication_change", birth_when: "childbirth",
  };
  const t = want[qid];
  return all.find((p) => p.event_type === t) ?? null;
}

function derivePath(a: IQAnswers, ageBand?: string | null): "postpartum" | "stress" | "sparse" | "young" | "standard" {
  const ev = a["events"];
  const evs = Array.isArray(ev) ? ev : [];
  const pins = interviewToPins(a);
  if (evs.includes("childbirth") && a["birth_when"] === "le12") return "postpartum";
  if (evs.includes("stress") && ["lt5", "h5_6"].includes(String(a["sleep"] ?? ""))) return "stress";
  if (!pins.length) return "sparse";
  if (ageBand === "16-22") return "young";
  return "standard";
}

export default function Kahani() {
  const { scanId: id, draft, updateDraft, goStage } = useScan();
  const { profile } = useAuth();
  const { lang } = useLang();

  // Roman-Nepali when the app is in Nepali (the default), English otherwise.
  const script: Script = lang === "ne" ? "rn" : "en";

  const [answers, setAnswers] = useState<IQAnswers>(() => answersFromDraft(draft.answers ?? {}));
  const [multi, setMulti] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [flags, setFlags] = useState<RedFlag[]>([]);
  const [flagHit, setFlagHit] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");
  const [finishWarn, setFinishWarn] = useState(false);
  const [serverPinTypes, setServerPinTypes] = useState<Set<string>>(new Set());
  const createdPins = useRef<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>([]);

  // Load existing server pins once so resume never duplicates them.
  useEffect(() => {
    scansApi.getScan(id).then((d) => {
      setServerPinTypes(new Set((d.timeline_events ?? []).map((e: TimelineEvent) => e.event_type)));
      setFlags(d.red_flags ?? []);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const q: IQ | null = useMemo(
    () => (flagHit ? null : nextQuestion(answers, { gender: profile?.gender ?? null })),
    [answers, flagHit, profile?.gender],
  );

  // Keep the multi/text editors in sync with the current question + saved answer.
  useEffect(() => {
    const cur = answers[q?.id ?? ""];
    setMulti(Array.isArray(cur) ? [...cur] : []);
    setText(typeof cur === "string" && cur !== "__skip__" ? cur : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id]);

  function persistLocal(next: IQAnswers) {
    setAnswers(next);
    // updateDraft persists to localStorage synchronously inside ScanShell.
    updateDraft({ answers: answersToDraft(next) });
  }

  async function syncPin(qid: string, next: IQAnswers) {
    if (!PIN_QUESTIONS.has(qid) || createdPins.current.has(qid)) return;
    const pin = pinForQuestion(qid, next);
    if (!pin || serverPinTypes.has(pin.event_type)) {
      if (pin) createdPins.current.add(qid);
      return;
    }
    try {
      const res = await scansApi.addTimelineEvent(id, {
        event_type: pin.event_type, occurred_on: pin.occurred_on, followup_answers: pin.followup_answers,
      });
      createdPins.current.add(qid);
      setServerPinTypes((s) => new Set(s).add(pin.event_type));
      const merged = mergeRaised(flags, res.red_flags_raised);
      if (merged.length !== flags.length) setFlags(merged);
      const onsetMonths = qid === "onset" ? ONSET_MONTHS[String(next["onset"])] ?? 3 : 3;
      updateDraft({
        pins: [...draft.pins, {
          id: `iv-${Date.now()}`, type: pin.event_type,
          pos: Math.max(0, Math.min(100, 100 - onsetMonths * 4)),
          answers: Object.fromEntries(Object.entries(pin.followup_answers).map(([k, v]) => [k, String(v)])),
        }],
      });
    } catch (e: any) {
      // 409: a red flag fired on the server — record it and stop the interview.
      const raised = e?.details?.red_flags_raised;
      if (raised) {
        const merged = mergeRaised(flags, raised);
        setFlags(merged);
        setFlagHit(true);
      }
    }
  }

  /** Push the interview's answers to the server answers blob (best-effort). */
  async function pushAnswers(next: IQAnswers): Promise<boolean> {
    try {
      const res = await scansApi.saveAnswers(id, interviewToAnswers(next));
      const raised = (res as any)?.red_flags_raised;
      if (raised?.length) {
        setFlags((f) => mergeRaised(f, raised));
        setFlagHit(true);
        return false;
      }
      return true;
    } catch (e: any) {
      const raised = e?.details?.red_flags_raised;
      if (raised?.length) {
        setFlags((f) => mergeRaised(f, raised));
        setFlagHit(true);
        return false;
      }
      return true; // local answers are still safe; server sync can retry later
    }
  }

  async function raiseInterviewFlag(bothersVals: string[], onsetVal: string) {
    try {
      if (bothersVals.includes("pain")) {
        const res = await scansApi.saveAnswers(id, { scalp_pain: true });
        setFlags((f) => mergeRaised(f, (res as any)?.red_flags_raised ?? []));
      } else if (bothersVals.includes("patches")) {
        const res = await scansApi.addTimelineEvent(id, {
          event_type: "shedding_onset",
          occurred_on: monthsAgoISO(ONSET_MONTHS[onsetVal] ?? 3),
          followup_answers: { sudden_or_gradual: "sudden", patchy: true },
        });
        setFlags((f) => mergeRaised(f, res.red_flags_raised ?? []));
      }
    } catch (e: any) {
      const raised = e?.details?.red_flags_raised;
      if (raised?.length) setFlags((f) => mergeRaised(f, raised));
    }
    setFlagHit(true);
  }

  function recordAnswer(qid: string, value: string | string[]) {
    const next = { ...answers, [qid]: value };
    persistLocal(next);
    setHistory((h) => [...h, qid]);
    // Red-flag answers stop the interview for dermatologist review.
    if (qid === "bothers" && interviewRedFlag(next)) {
      const vals = Array.isArray(value) ? value : [];
      void raiseInterviewFlag(vals, String(next["onset"] ?? ""));
      return;
    }
    void syncPin(qid, next);
  }

  function skip() {
    if (!q) return;
    recordAnswer(q.id, q.kind === "multi" ? [] : "__skip__");
  }

  function goBack() {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (!prev) return h;
      setAnswers((a) => {
        const next = { ...a };
        delete next[prev];
        updateDraft({ answers: answersToDraft(next) });
        return next;
      });
      return h.slice(0, -1);
    });
  }

  async function finish() {
    const pins = interviewToPins(answers);
    if (!pins.length && serverPinTypes.size === 0) {
      setFinishWarn(true);
      return;
    }
    setDoneMsg(script === "rn" ? "Badhai chha — katha pura bhayo." : "Done — your story is complete.");
    const ok = await pushAnswers(answers);
    const path = derivePath(answers, profile?.age_band);
    updateDraft({ path });
    // A 409 inside pushAnswers already flips to the red-flag screen; only
    // advance when the answers landed without raising a flag.
    if (ok) goStage("lens");
  }

  const bits = useMemo(() => storyBits(answers), [answers]);
  const answeredCount = Object.keys(answers).length;

  if (flagHit) {
    const f = flags[0];
    return (
      <div className="iv-wrap">
        <div className="card iv-flag">
          <div className="iv-flag-ico">⚠️</div>
          <h2>{script === "rn" ? "Yo kura dermatologist le hernu parchha" : "A dermatologist should look at this"}</h2>
          <p>
            {script === "rn"
              ? "Tapaile bhannubhaeko lakshan (dukhnu/khatira wa tukra-tukra kapal jharnu) samanya hoina — yasalai doctor le nai hernu parchha. Tapaiko scan surakshit chha; hamile yo jankari dermatologist lai pathaidinchhau."
              : "What you described (pain/sores, or shedding in patches) isn't routine — a doctor needs to see it. Your scan is saved, and we'll pass this to a dermatologist."}
          </p>
          {f && <p className="mut">{f.flag_type}: {f.detail}</p>}
          <button className="btn btn-p btn-block" onClick={() => goStage("lens")}>
            {script === "rn" ? "Photo tira janus" : "Continue to photos"}
          </button>
        </div>
      </div>
    );
  }

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      out.push({ value: iso, label: monthName(iso, script) });
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, [script]);

  return (
    <div className="iv-wrap">
      {/* live story-so-far strip */}
      <div className="iv-strip" aria-live="polite">
        <div className="iv-strip-title">
          {script === "rn" ? "Tapaiko katha ahilesamma" : "Your story so far"}
        </div>
        {bits.length === 0 ? (
          <div className="iv-strip-empty">
            {script === "rn" ? "Jawaf dindai janus — yaha tapai ko katha banchha." : "Answer as you go — your story builds here."}
          </div>
        ) : (
          <div className="iv-bits">
            {bits.map((b) => (
              <span key={b.key} className="chip">{b.text[script]}</span>
            ))}
          </div>
        )}
      </div>

      {!q ? (
        /* interview complete */
        <div className="card iv-done">
          <div className="iv-done-ico">🌱</div>
          <h2>{script === "rn" ? "Katha pura bhayo!" : "Your story is complete!"}</h2>
          <p>{script === "rn"
            ? "Abha hamro palo — tapai ko kapal ko photo herne."
            : "Now it's our turn — let's look at your hair."}</p>
          {finishWarn && (
            <p className="err">
              {script === "rn"
                ? "Kamti ma euta jawaf dinus — pahilo prashna bata suru garnus."
                : "Please answer at least one question — start with the first one."}
            </p>
          )}
          {doneMsg && <p className="ok">{doneMsg}</p>}
          <div className="rowflex">
            <button className="btn btn-o" onClick={goBack} disabled={history.length === 0}>
              {script === "rn" ? "Farka" : "Back"}
            </button>
            <button className="btn btn-p" onClick={finish} style={{ flex: 1 }}>
              {script === "rn" ? "Photo tira" : "Continue to photos"}
            </button>
          </div>
        </div>
      ) : (
        <div className="card iv-qcard" key={q.id}>
          <div className="iv-qmeta">
            <span className="chip grey">
              {script === "rn" ? `Prashna ${answeredCount + 1}` : `Question ${answeredCount + 1}`}
            </span>
            {history.length > 0 && (
              <button className="iv-backlink" onClick={goBack}>
                {script === "rn" ? "← Farka" : "← Back"}
              </button>
            )}
          </div>
          <h2 className="iv-qtext">{q.text[script]}</h2>
          {q.sub && <p className="mut iv-qsub">{q.sub[script]}</p>}

          {q.kind === "single" && q.options && (
            <div className="iv-opts">
              {q.options.map((o) => (
                <button key={o.value} className="iv-chip" onClick={() => recordAnswer(q.id, o.value)}>
                  {o.label[script]}
                </button>
              ))}
            </div>
          )}

          {q.kind === "multi" && q.options && (
            <>
              <div className="iv-opts">
                {q.options.map((o) => {
                  const on = multi.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      className={"iv-chip" + (on ? " on" : "")}
                      aria-pressed={on}
                      onClick={() => setMulti((m) => (m.includes(o.value) ? m.filter((x) => x !== o.value) : [...m, o.value]))}
                    >
                      {on ? "✓ " : ""}{o.label[script]}
                    </button>
                  );
                })}
              </div>
              <button className="btn btn-p btn-block" onClick={() => recordAnswer(q.id, multi)} disabled={multi.length === 0}>
                {script === "rn" ? "Agadi" : "Continue"}
              </button>
            </>
          )}

          {q.kind === "month" && (
            <div className="iv-months">
              {monthOptions.map((m) => (
                <button key={m.value} className="iv-chip sm" onClick={() => recordAnswer(q.id, m.value)}>
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {q.kind === "text" && (
            <>
              <textarea
                className="input iv-textarea"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={q.text[script]}
              />
              <button className="btn btn-p btn-block" onClick={() => recordAnswer(q.id, text.trim() ? text.trim() : "__skip__")}>
                {script === "rn" ? "Save gara" : "Save"}
              </button>
            </>
          )}

          <button className="iv-skip" onClick={skip}>
            {script === "rn" ? "Skip garnus →" : "Skip →"}
          </button>
        </div>
      )}

      <button className="iv-skipall" onClick={() => { updateDraft({ path: "sparse" }); goStage("jara"); }}>
        {script === "rn" ? "Interview nai skip garne" : "Skip the interview entirely"}
      </button>
    </div>
  );
}
