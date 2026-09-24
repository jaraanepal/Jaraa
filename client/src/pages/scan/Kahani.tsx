import { useMemo, useRef, useState } from "react";
import { useScan } from "./ScanShell";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, NoticeBox, toast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { scansApi } from "../../api/client";
import type { DraftPin, ScanDraft } from "../../lib/draft";
import type { AdaptivePath } from "../../lib/stage3";
import type { PinType, RedFlagType } from "../../api/types";
import { detectRedFlags, type ScanSignals } from "../../lib/redflags";

const PIN_TYPES: PinType[] = [
  "shedding_onset", "illness_fever", "childbirth", "crash_diet",
  "medication_change", "stress_period", "moved_city_water", "hair_treatment", "other",
];

const PIN_COLORS: Record<PinType, string> = {
  shedding_onset: "#1e3b2a", illness_fever: "#c0392b", childbirth: "#b08d4a",
  crash_diet: "#2d9d5f", medication_change: "#7c3aed", stress_period: "#d97706",
  moved_city_water: "#2563eb", hair_treatment: "#be5a9e", other: "#5d665e",
};

interface FuOpt { value: string; labelKey: string }
interface Followup {
  qid: string;
  textKey: string;
  type: "opts" | "slider" | "text";
  opts?: FuOpt[];
  min?: number; max?: number;
  placeholderKey?: string;
}

const PIN_FU: Record<PinType, Followup[]> = {
  shedding_onset: [
    { qid: "sudden", textKey: "kahani.fu.sudden", type: "opts", opts: [
      { value: "sudden", labelKey: "kahani.fu.sudden_sudden" },
      { value: "gradual", labelKey: "kahani.fu.sudden_gradual" },
      { value: "unsure", labelKey: "common.notSure" }] },
    { qid: "patches", textKey: "kahani.fu.patches", type: "opts", opts: [
      { value: "yes", labelKey: "common.yes" }, { value: "no", labelKey: "common.no" }] },
  ],
  illness_fever: [
    { qid: "ill_when", textKey: "kahani.fu.ill_when", type: "opts", opts: [
      { value: "l3", labelKey: "kahani.fu.ill_when_l3" },
      { value: "36", labelKey: "kahani.fu.ill_when_36" },
      { value: "612", labelKey: "kahani.fu.ill_when_612" },
      { value: "g12", labelKey: "kahani.fu.ill_when_g12" }] },
    { qid: "sys_symp", textKey: "kahani.fu.sys_symp", type: "opts", opts: [
      { value: "yes", labelKey: "common.yes" }, { value: "no", labelKey: "common.no" }] },
  ],
  childbirth: [
    { qid: "birth_when", textKey: "kahani.fu.birth_when", type: "opts", opts: [
      { value: "le12", labelKey: "kahani.fu.birth_when_le12" },
      { value: "gt12", labelKey: "kahani.fu.birth_when_gt12" }] },
  ],
  crash_diet: [
    { qid: "diet_howlong", textKey: "kahani.fu.diet_howlong", type: "opts", opts: [
      { value: "lt3", labelKey: "kahani.fu.diet_howlong_lt3" },
      { value: "ge3", labelKey: "kahani.fu.diet_howlong_ge3" }] },
  ],
  medication_change: [
    { qid: "med_name", textKey: "kahani.fu.med_name", type: "text", placeholderKey: "kahani.fu.med_name_ph" },
    { qid: "med_still", textKey: "kahani.fu.med_still", type: "opts", opts: [
      { value: "yes", labelKey: "common.yes" }, { value: "no", labelKey: "common.no" }] },
    { qid: "med_known", textKey: "kahani.fu.med_known", type: "opts", opts: [
      { value: "yes", labelKey: "common.yes" },
      { value: "no", labelKey: "common.no" },
      { value: "unsure", labelKey: "common.notSure" }] },
  ],
  stress_period: [
    { qid: "sleep_h", textKey: "kahani.fu.sleep_h", type: "slider", min: 3, max: 10 },
  ],
  moved_city_water: [
    { qid: "move_when", textKey: "kahani.fu.move_when", type: "opts", opts: [
      { value: "l6", labelKey: "kahani.fu.move_when_l6" },
      { value: "g6", labelKey: "kahani.fu.move_when_g6" }] },
  ],
  hair_treatment: [
    { qid: "treat_type", textKey: "kahani.fu.treat_type", type: "opts", opts: [
      { value: "color", labelKey: "kahani.fu.treat_type_color" },
      { value: "rebond", labelKey: "kahani.fu.treat_type_rebond" },
      { value: "other", labelKey: "kahani.fu.treat_type_other" }] },
  ],
  other: [
    { qid: "other_what", textKey: "kahani.fu.other_what", type: "text", placeholderKey: "kahani.fu.med_name_ph" },
  ],
};

/** pos 0 (2 years ago) .. 100 (today) -> localized "N months ago" */
function monthsAgoLabel(t: (k: string, v?: Record<string, string | number>) => string, pos: number): string {
  const m = Math.round(((100 - pos) / 100) * 24);
  if (m <= 0) return t("time.today");
  if (m === 1) return t("time.oneMonthAgo");
  if (m < 12) return t("time.nMonthsAgo", { n: m });
  const y = Math.floor(m / 12);
  const r = m % 12;
  return r === 0 ? t("time.nYearsAgo", { n: y }) : t("time.nYearsNMonthsAgo", { y, m: r });
}

function dateFromPos(pos: number): string {
  const m = Math.round(((100 - pos) / 100) * 24);
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString().slice(0, 10);
}

export default function Kahani() {
  const { t } = useLang();
  const { scanId, draft, updateDraft, goStage } = useScan();
  const [selType, setSelType] = useState<PinType | null>(null);
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [sliderVal, setSliderVal] = useState("7");
  const [textVal, setTextVal] = useState("");
  const tlRef = useRef<HTMLDivElement>(null);

  const openPin = useMemo(() => draft.pins.find((p) => p.id === openPinId) ?? null, [draft.pins, openPinId]);
  const nextFu = openPin ? (PIN_FU[openPin.type] ?? []).find((f) => openPin.answers[f.qid] === undefined) ?? null : null;

  /** Derive adaptive path + medical flag + red flags from the story so far. */
  function evalPaths(pins: DraftPin[]): Partial<ScanDraft> {
    const patch: Partial<ScanDraft> = {};
    let path: AdaptivePath = draft.path === "young" ? "young" : "standard";
    if (pins.some((p) => p.type === "childbirth" && p.answers.birth_when === "le12")) {
      path = "postpartum";
    } else if (pins.some((p) => p.type === "stress_period" && Number(p.answers.sleep_h) < 6)) {
      path = "stress";
    } else if (pins.length === 1 && pins[0].type === "shedding_onset") {
      path = "sparse";
    }
    patch.path = path;

    patch.medFlag = pins.some((p) => p.type === "medication_change" && p.answers.med_still === "yes");

    // Client-side red-flag signals from the story. The server is authoritative
    // (409 red_flag_unresolved); this gives instant, honest feedback in the UI.
    const signals: ScanSignals = {
      suddenPatchyLoss: pins.some((p) => p.type === "shedding_onset" && p.answers.patches === "yes"),
      sheddingWithSystemic: pins.some((p) => p.type === "illness_fever" && p.answers.sys_symp === "yes"),
      hairLossDrugStillTaking: pins.some(
        (p) => p.type === "medication_change" && p.answers.med_still === "yes" && p.answers.med_known === "yes",
      ),
    };
    const merged: RedFlagType[] = [...draft.redFlags];
    for (const h of detectRedFlags(signals)) {
      if (!merged.includes(h.type)) merged.push(h.type);
    }
    patch.redFlags = merged;
    return patch;
  }

  /** Merge server-raised flags into the draft. */
  function mergeServerFlags(raised: Array<{ flag_type: RedFlagType }>) {
    if (!raised.length) return;
    updateDraft((() => {
      const merged: RedFlagType[] = [...draft.redFlags];
      for (const f of raised) if (!merged.includes(f.flag_type)) merged.push(f.flag_type);
      return { redFlags: merged };
    })());
  }

  function placePin(clientX: number) {
    if (!selType) {
      toast(t("kahani.pickPin"));
      return;
    }
    const tl = tlRef.current;
    if (!tl) return;
    const r = tl.getBoundingClientRect();
    let pos = Math.round(((clientX - r.left - 16) / (r.width - 32)) * 100);
    pos = Math.max(0, Math.min(100, pos));
    const pin: DraftPin = { id: `pin-${Date.now()}`, type: selType, pos, answers: {} };
    const pins = [...draft.pins, pin];
    updateDraft({ pins, ...evalPaths(pins) });
    setSelType(null);
    setOpenPinId(pin.id);
    toast(t("kahani.pinAdded"));
    // Best-effort server sync; the local draft is the source of truth offline.
    scansApi
      .addTimelineEvent(scanId, { event_type: pin.type, occurred_on: dateFromPos(pos), followup_answers: {} })
      .then((res) => mergeServerFlags(res.red_flags_raised))
      .catch(() => {});
  }

  function answerPin(qid: string, value: string) {
    if (!openPin) return;
    const pins = draft.pins.map((p) =>
      p.id === openPin.id ? { ...p, answers: { ...p.answers, [qid]: value } } : p,
    );
    updateDraft({ pins, ...evalPaths(pins) });
    const fu = (PIN_FU[openPin.type] ?? []).find((f) => f.qid === qid);
    if (fu?.type === "slider") setSliderVal("7");
    if (fu?.type === "text") setTextVal("");
    // Sync answers to the server (best effort).
    const updated = pins.find((p) => p.id === openPin.id);
    if (updated) {
      scansApi
        .addTimelineEvent(scanId, {
          event_type: updated.type,
          occurred_on: dateFromPos(updated.pos),
          followup_answers: updated.answers,
        })
        .then((res) => mergeServerFlags(res.red_flags_raised))
        .catch(() => {});
    }
  }

  function deletePin() {
    if (!openPinId) return;
    const pins = draft.pins.filter((p) => p.id !== openPinId);
    updateDraft({ pins, ...evalPaths(pins) });
    setOpenPinId(null);
  }

  function continueToLens() {
    const pins = draft.pins;
    let path = draft.path;
    if (path === "standard" && pins.length === 1 && pins[0].type === "shedding_onset") path = "sparse";
    updateDraft({ path });
    goStage("lens");
  }

  function skip() {
    updateDraft({ path: draft.path === "standard" ? "sparse" : draft.path });
    goStage("jara");
  }

  const canContinue = draft.pins.length > 0;

  return (
    <div>
      <h1>{t("kahani.title")}</h1>
      <p className="muted">{t("kahani.subtitle")}</p>

      {draft.path === "postpartum" && (
        <NoticeBox tone="ok" title={t("kahani.postpartumTitle")}><p>{t("kahani.postpartumBody")}</p></NoticeBox>
      )}
      {draft.medFlag && (
        <NoticeBox tone="notice" title={t("kahani.medFlagTitle")}><p>{t("kahani.medFlagBody")}</p></NoticeBox>
      )}
      {draft.path === "stress" && (
        <NoticeBox tone="notice" title={t("kahani.stressTitle")}><p>{t("kahani.stressBody")}</p></NoticeBox>
      )}
      {draft.path === "sparse" && (
        <div className="card"><p><b>{t("kahani.sparseTitle")}</b> — {t("kahani.sparseBody")}</p></div>
      )}
      {draft.path === "young" && (
        <div className="card"><p><b>{t("kahani.youngTitle")}</b> — {t("kahani.youngBody")}</p></div>
      )}
      {draft.redFlags.length > 0 && (
        <NoticeBox tone="flag" title={t("kahani.redFlagTitle")}>
          <p>
            {draft.redFlags.map((f) => (
              <span key={f}><Chip tone="red">{t(`redflags.${f}`)}</Chip><br /></span>
            ))}
          </p>
          <p className="muted">{t("kahani.redFlagBody")}</p>
        </NoticeBox>
      )}

      <div className="palette" role="group" aria-label={t("kahani.pickPin")}>
        {PIN_TYPES.map((pt) => (
          <button key={pt} className={selType === pt ? "sel" : ""} onClick={() => setSelType(pt)} aria-pressed={selType === pt}>
            <span style={{ color: PIN_COLORS[pt] }}><Icon.pin size={22} /></span>
            {t(`kahani.pins.${pt}`)}
          </button>
        ))}
      </div>
      <p className="muted tiny">
        {selType ? t("kahani.tapTimeline", { pin: t(`kahani.pins.${selType}`) }) : t("kahani.pickPin")}
      </p>

      <div
        className="timeline"
        ref={tlRef}
        role="button"
        tabIndex={0}
        aria-label={t("kahani.title")}
        onClick={(e) => placePin(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && tlRef.current) {
            const r = tlRef.current.getBoundingClientRect();
            placePin(r.left + r.width / 2);
          }
        }}
      >
        <div className="tl-track" />
        {draft.pins.map((p) => (
          <button
            key={p.id}
            className="pin"
            style={{ left: `calc(16px + (100% - 32px) * ${p.pos / 100})`, background: PIN_COLORS[p.type] }}
            onClick={(e) => {
              e.stopPropagation();
              setOpenPinId(p.id);
            }}
            aria-label={`${t(`kahani.pins.${p.type}`)} — ${monthsAgoLabel(t, p.pos)}`}
          >
            <Icon.pin size={20} />
          </button>
        ))}
        <div className="tl-ends">
          <span>← {t("kahani.twoYearsAgo")}</span>
          <span>{t("kahani.today")} →</span>
        </div>
      </div>

      {openPin && (
        <div className="card">
          <h3>
            <span style={{ color: PIN_COLORS[openPin.type], verticalAlign: "-4px", marginRight: 6 }}>
              <Icon.pin size={18} />
            </span>
            {t(`kahani.pins.${openPin.type}`)} <Chip>{monthsAgoLabel(t, openPin.pos)}</Chip>
          </h3>
          {nextFu ? (
            <>
              <div className="bubble q"><Icon.chat size={16} /> {t(nextFu.textKey)}</div>
              {nextFu.type === "opts" && (
                <div className="opts">
                  {nextFu.opts!.map((o) => (
                    <button key={o.value} onClick={() => answerPin(nextFu.qid, o.value)}>
                      {t(o.labelKey)}
                    </button>
                  ))}
                </div>
              )}
              {nextFu.type === "slider" && (
                <div>
                  <input
                    type="range" min={nextFu.min} max={nextFu.max} value={sliderVal}
                    onChange={(e) => setSliderVal(e.target.value)}
                    aria-label={t(nextFu.textKey)}
                  />
                  <div className="rowflex">
                    <b>{sliderVal}h</b>
                    <span className="spacer" />
                    <button className="btn btn-p" style={{ width: "auto", margin: 0 }} onClick={() => answerPin(nextFu.qid, sliderVal)}>
                      {t("common.ok")}
                    </button>
                  </div>
                </div>
              )}
              {nextFu.type === "text" && (
                <div>
                  <input
                    type="text" value={textVal}
                    placeholder={nextFu.placeholderKey ? t(nextFu.placeholderKey) : ""}
                    onChange={(e) => setTextVal(e.target.value)}
                    aria-label={t(nextFu.textKey)}
                  />
                  <button className="btn btn-p" onClick={() => answerPin(nextFu.qid, textVal)}>
                    {t("common.save")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="muted">{t("kahani.allDone")}</p>
              <button className="btn btn-s" onClick={() => setOpenPinId(null)}>{t("kahani.addAnother")}</button>
            </>
          )}
          <button className="linklike" style={{ color: "var(--bad)" }} onClick={deletePin}>
            {t("kahani.deletePin")}
          </button>
        </div>
      )}

      <button className="btn btn-p" disabled={!canContinue} onClick={continueToLens}>
        {t("kahani.continueN", { n: draft.pins.length })}
      </button>
      {!canContinue && <p className="muted tiny">{t("kahani.needOnePin")}</p>}
      <button className="linklike" onClick={skip}>{t("kahani.skip")}</button>
    </div>
  );
}
