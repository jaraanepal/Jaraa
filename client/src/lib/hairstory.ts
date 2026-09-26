/**
 * "Your Hair Story" — P-1 (conversational Kahani) + P-2 (Hair Story result).
 *
 * Pure, UI-free logic with trilingual copy (rn = Roman-Nepali, en, ne).
 * Everything here is deterministic template logic — it reflects the user's
 * own words and visualizes their own data. It never diagnoses.
 */
import type { PinType, RedFlagType, RootKey } from "../api/types";
import { detectRedFlags } from "./redflags";

export type Script = "rn" | "en" | "ne";
export type Tri = Record<Script, string>;
export const tri = (rn: string, en: string, ne: string): Tri => ({ rn, en, ne });

/* ------------------------------------------------------------------ */
/* months                                                              */
/* ------------------------------------------------------------------ */

const MONTHS_RN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_NE = ["जनवरी", "फेब्रुअरी", "मार्च", "अप्रिल", "मे", "जुन",
  "जुलाई", "अगस्ट", "सेप्टेम्बर", "अक्टोबर", "नोभेम्बर", "डिसेम्बर"];

export function monthName(dateISO: string, s: Script): string {
  const m = new Date(dateISO + "T00:00:00").getMonth();
  if (Number.isNaN(m)) return "";
  if (s === "ne") return MONTHS_NE[m];
  return MONTHS_RN[m]; // rn + en share month names
}

export function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* interview question bank                                             */
/* ------------------------------------------------------------------ */

export type AnswerVal = string | string[];
export type IQAnswers = Record<string, AnswerVal>;

export interface IQOption {
  value: string;
  label: Tri;
}

export interface IQ {
  id: string;
  text: Tri;
  sub?: Tri;
  kind: "single" | "multi" | "month" | "text";
  options?: IQOption[];
  optional?: boolean;
}

const ONSET_OPTS: IQOption[] = [
  { value: "m1", label: tri("Yo mahina", "This month", "यो महिना") },
  { value: "m3", label: tri("2-3 mahina aghi", "2–3 months ago", "२–३ महिना अगाडि") },
  { value: "m9", label: tri("6-12 mahina aghi", "6–12 months ago", "६–१२ महिना अगाडि") },
  { value: "m18", label: tri("1 barsa bhanda aghi", "Over a year ago", "१ वर्षभन्दा अगाडि") },
];

export const ONSET_MONTHS: Record<string, number> = { m1: 1, m3: 3, m9: 9, m18: 18 };

const EVENT_OPTS: IQOption[] = [
  { value: "illness", label: tri("Thulo jwaro / birami", "Serious illness / fever", "ठूलो ज्वरो / बिरामी") },
  { value: "stress", label: tri("Thulo tanab", "Big stress", "ठूलो तनाव") },
  { value: "diet", label: tri("Khana cum / diet", "Eating much less / dieting", "खाना कम / डाइट") },
  { value: "medicine", label: tri("Naya aushadhi", "New medicine", "नयाँ औषधि") },
  { value: "childbirth", label: tri("Bachcha janmeko", "Childbirth", "बच्चा जन्मेको") },
  { value: "none", label: tri("Khas kehi thiena", "Nothing unusual", "खास केही थिएन") },
];

function includes(a: IQAnswers, id: string, v: string): boolean {
  const cur = a[id];
  return Array.isArray(cur) ? cur.includes(v) : cur === v;
}

export interface IQContext {
  gender?: string | null;
}

export function nextQuestion(a: IQAnswers, ctx: IQContext = {}): IQ | null {
  const has = (id: string) => a[id] !== undefined;
  if (!has("onset")) {
    return {
      id: "onset", kind: "single", options: ONSET_OPTS,
      text: tri(
        "Tapaile pahilo patak samanyabhanda dherai kapal jhareko kahile dekhnubhayo?",
        "When did you first notice more hair fall than usual?",
        "तपाईंले पहिलो पटक सामान्यभन्दा धेरै कपाल झरेको कहिले देख्नुभयो?",
      ),
    };
  }
  if (!has("events")) {
    return {
      id: "events", kind: "multi", options: EVENT_OPTS,
      text: tri(
        "Tyo bela — wa tyo bhanda alik aghi — tapai ko jiwan ma ke bhairaheko thiyo? (jati milchha sabai chhannus)",
        "What was going on in your life around then, or a little before? (pick all that fit)",
        "त्यो बेला — वा त्यो भन्दा अलिक अघि — तपाईंको जीवनमा के भइरहेको थियो? (जति मिल्छ सबै छान्नुस्)",
      ),
    };
  }
  if (includes(a, "events", "illness") && !has("ill_kind")) {
    return {
      id: "ill_kind", kind: "single",
      options: [
        { value: "fever", label: tri("Thulo jwaro", "High fever", "ठूलो ज्वरो") },
        { value: "covid", label: tri("COVID", "COVID", "कोभिड") },
        { value: "surgery", label: tri("Operation", "Surgery", "अपरेशन") },
        { value: "other", label: tri("Arko birami", "Another illness", "अर्को बिरामी") },
      ],
      text: tri("Kasto birami thiyo?", "What kind of illness was it?", "कस्तो बिरामी थियो?"),
    };
  }
  if (includes(a, "events", "illness") && !has("ill_month")) {
    return {
      id: "ill_month", kind: "month",
      text: tri("Tyo birami kati mahina aghi thiyo?", "Which month was that illness?", "त्यो बिरामी कुन महिनामा थियो?"),
      sub: tri("Andaji mausam chhannus — thik thaha chhaina bhane pani hunchha", "Pick the approximate month — a guess is fine", "अन्दाजी महिना छान्नुस् — ठिक थाहा छैन भने पनि हुन्छ"),
    };
  }
  if (includes(a, "events", "stress") && !has("sleep")) {
    return {
      id: "sleep", kind: "single",
      options: [
        { value: "lt5", label: tri("5 ghanta bhanda cum", "Less than 5 hours", "५ घण्टाभन्दा कम") },
        { value: "h5_6", label: tri("5-6 ghanta", "5–6 hours", "५–६ घण्टा") },
        { value: "h7_8", label: tri("7-8 ghanta", "7–8 hours", "७–८ घण्टा") },
        { value: "gt8", label: tri("8 ghanta bhanda dherai", "More than 8 hours", "८ घण्टाभन्दा धेरै") },
      ],
      text: tri("Ajkal tapai kati sutnuhunchha?", "How much do you sleep these days?", "आजकल तपाईं कति सुत्नुहुन्छ?"),
    };
  }
  if (includes(a, "events", "diet") && !has("diet_less")) {
    return {
      id: "diet_less", kind: "single",
      options: [
        { value: "often", label: tri("Dheraijaso chhutchha", "I skip meals often", "धेरैजसो छुट्छ") },
        { value: "sometimes", label: tri("Kahile kahi", "Sometimes", "कहिलेकाहीं") },
        { value: "no", label: tri("Hoina, thik chha", "No, I eat fine", "होइन, ठिक छ") },
      ],
      text: tri("Tapai khana chhodnuhunchha wa pahilebhanda cum khanuhunchha?", "Do you skip meals or eat less than before?", "तपाईं खाना छोड्नुहुन्छ वा पहिलेभन्दा कम खानुहुन्छ?"),
    };
  }
  if (includes(a, "events", "medicine") && !has("med_name")) {
    return {
      id: "med_name", kind: "text", optional: true,
      text: tri("Aushadhi ko naam thaha chha? (nachehe skip garnus)", "Do you remember the medicine's name? (skip if you like)", "औषधिको नाम थाहा छ? (नचाहे स्किप गर्नुस्)"),
    };
  }
  if (includes(a, "events", "medicine") && !has("med_still")) {
    return {
      id: "med_still", kind: "single",
      options: [
        { value: "yes", label: tri("Ho, ajhai khanchhu", "Yes, still taking it", "हो, अझै खान्छु") },
        { value: "no", label: tri("Hoina, chhode", "No, stopped", "होइन, छोडे") },
      ],
      text: tri("Tyo aushadhi ajhai khanuhunchha?", "Are you still taking that medicine?", "त्यो औषधि अझै खानुहुन्छ?"),
    };
  }
  if (includes(a, "events", "childbirth") && !has("birth_when")) {
    return {
      id: "birth_when", kind: "single",
      options: [
        { value: "le12", label: tri("12 mahina bhitra", "Within the last 12 months", "१२ महिनाभित्र") },
        { value: "gt12", label: tri("12 mahina bhanda aghi", "More than 12 months ago", "१२ महिनाभन्दा अघि") },
      ],
      text: tri("Bachcha kahile janmeko thiyo?", "When was the baby born?", "बच्चा कहिले जन्मेको थियो?"),
    };
  }
  if (!has("bothers")) {
    return {
      id: "bothers", kind: "multi",
      options: [
        { value: "itching", label: tri("Chilauchha", "Itching", "चिलाउँछ") },
        { value: "flakes", label: tri("Filo / dandruff", "Flakes / dandruff", "फिलो / ड्यान्ड्रफ") },
        { value: "oily", label: tri("Chiplo tauko", "Oily scalp", "चिप्लो टाउको") },
        { value: "dry", label: tri("Sukhkha tauko", "Dry scalp", "सुक्खा टाउको") },
        { value: "pain", label: tri("Dukchha / khatira", "Pain / sores", "दुख्छ / खतिरा") },
        { value: "patches", label: tri("Tukra-tukra kapal jharchha", "Bald patches", "टुक्रा-टुक्रा कपाल झर्छ") },
        { value: "nothing", label: tri("Arko kehi chhaina", "Nothing else", "अर्को केही छैन") },
      ],
      text: tri(
        "Kapal jharnu bahek, arko ke le sataunchha? (jati milchha sabai)",
        "Besides shedding, what else bothers you? (pick all that fit)",
        "कपाल झर्नु बाहेक, अर्को के ले सताउँछ? (जति मिल्छ सबै)",
      ),
    };
  }
  if (!has("area")) {
    return {
      id: "area", kind: "single",
      options: [
        { value: "crown", label: tri("Tauko ko mathi (crown)", "Crown / top", "टाउकोको माथि") },
        { value: "hairline", label: tri("Kapal ko rekha (agadi)", "Hairline (front)", "कपालको रेखा (अगाडि)") },
        { value: "parting", label: tri("Sintho / bato", "Parting line", "सिन्थो / बाटो") },
        { value: "allover", label: tri("Sabaitira", "All over", "सबैतिर") },
        { value: "unsure", label: tri("Thaha chhaina", "Not sure", "थाहा छैन") },
      ],
      text: tri("Kaha sabaibhanda dherai patlo dekhinchha?", "Where does it look thinnest?", "कहाँ सबैभन्दा धेरै पातलो देखिन्छ?"),
    };
  }
  if (ctx.gender === "female" && !has("periods")) {
    return {
      id: "periods", kind: "single",
      options: [
        { value: "regular", label: tri("Niyamit chha", "Regular", "नियमित छ") },
        { value: "irregular", label: tri("Aniyamit chha", "Irregular", "अनियमित छ") },
        { value: "unsure", label: tri("Thaha chhaina", "Not sure", "थाहा छैन") },
      ],
      text: tri("Tapaiko mahinawari niyamit chha?", "Are your periods regular?", "तपाईंको महिनावारी नियमित छ?"),
    };
  }
  if (!has("heat")) {
    return {
      id: "heat", kind: "single",
      options: [
        { value: "often", label: tri("Dheraijaso", "Often", "धेरैजसो") },
        { value: "sometimes", label: tri("Kahile kahi", "Sometimes", "कहिलेकाहीं") },
        { value: "never", label: tri("Kahilei hoina", "Never", "कहिल्यै होइन") },
      ],
      text: tri("Tapai heat (straightener/dryer) prayog garnuhunchha?", "Do you use heat (straightener / dryer) on your hair?", "तपाईं हिट (स्ट्रेटनर / ड्रायर) प्रयोग गर्नुहुन्छ?"),
    };
  }
  if (!has("color")) {
    return {
      id: "color", kind: "single",
      options: [
        { value: "yes", label: tri("Ho", "Yes", "हो") },
        { value: "no", label: tri("Hoina", "No", "होइन") },
      ],
      text: tri("Tapai kapal ma rang lagaunuhunchha?", "Do you colour your hair?", "तपाईं कपालमा रङ्ग लगाउनुहुन्छ?"),
    };
  }
  if (!has("family")) {
    return {
      id: "family", kind: "single",
      options: [
        { value: "yes", label: tri("Ho", "Yes", "हो") },
        { value: "no", label: tri("Hoina", "No", "होइन") },
        { value: "dontknow", label: tri("Thaha chhaina", "Don't know", "थाहा छैन") },
      ],
      text: tri("Pariwar ma kasailai yestai kapal jharne samasya chha?", "Does anyone in your family have similar hair loss?", "परिवारमा कसैलाई यस्तै कपाल झर्ने समस्या छ?"),
    };
  }
  if (!has("note")) {
    return {
      id: "note", kind: "text", optional: true,
      text: tri(
        "Dermatologist lai bhanna arko kehi chha? (nachehe skip garnus)",
        "Anything else you'd like your dermatologist to know? (skip if you like)",
        "डर्माटोलोजिस्टलाई भन्न अर्को केही छ? (नचाहे स्किप गर्नुस्)",
      ),
    };
  }
  return null;
}

/** Red-flag answers inside the interview: pain/sores or bald patches. */
export function interviewRedFlag(a: IQAnswers): RedFlagType | null {
  const b = a["bothers"];
  const vals = Array.isArray(b) ? b : b ? [b] : [];
  if (vals.includes("pain")) {
    const hits = detectRedFlags({ scalpPainSores: true });
    return hits[0]?.type ?? null;
  }
  if (vals.includes("patches")) {
    const hits = detectRedFlags({ suddenPatchyLoss: true });
    return hits[0]?.type ?? null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* story-so-far strip                                                  */
/* ------------------------------------------------------------------ */

export interface StoryBit {
  key: string;
  text: Tri;
}

const ILL_KIND: Record<string, Tri> = {
  fever: tri("Thulo jwaro", "High fever", "ठूलो ज्वरो"),
  covid: tri("COVID", "COVID", "कोभिड"),
  surgery: tri("Operation", "Surgery", "अपरेशन"),
  other: tri("Birami", "Illness", "बिरामी"),
};

const SLEEP_LABEL: Record<string, Tri> = {
  lt5: tri("5 ghanta bhanda cum sutne", "sleeping under 5 hours", "५ घण्टाभन्दा कम सुत्ने"),
  h5_6: tri("5-6 ghanta sutne", "sleeping 5–6 hours", "५–६ घण्टा सुत्ने"),
  h7_8: tri("7-8 ghanta sutne", "sleeping 7–8 hours", "७–८ घण्टा सुत्ने"),
  gt8: tri("8 ghanta bhanda dherai sutne", "sleeping 8+ hours", "८ घण्टाभन्दा धेरै सुत्ने"),
};

const ONSET_LABEL: Record<string, Tri> = {
  m1: tri("yo mahina dekhi kapal jharna thalyo", "shedding started this month", "यो महिनादेखि कपाल झर्न थाल्यो"),
  m3: tri("2-3 mahina dekhi kapal jhariraheko", "shedding for 2–3 months", "२–३ महिनादेखि कपाल झरिरहेको"),
  m9: tri("6-12 mahina dekhi kapal jhariraheko", "shedding for 6–12 months", "६–१२ महिनादेखि कपाल झरिरहेको"),
  m18: tri("1 barsa bhanda dherai dekhi kapal jhariraheko", "shedding for over a year", "१ वर्षभन्दा धेरैदेखि कपाल झरिरहेको"),
};

export function storyBits(a: IQAnswers): StoryBit[] {
  const bits: StoryBit[] = [];
  const str = (id: string) => (typeof a[id] === "string" ? (a[id] as string) : "");
  if (a["onset"] && ONSET_LABEL[str("onset")]) {
    bits.push({ key: "onset", text: ONSET_LABEL[str("onset")] });
  }
  if (includes(a, "events", "illness") && str("ill_kind") && str("ill_month")) {
    const kind = ILL_KIND[str("ill_kind")] ?? ILL_KIND.other;
    bits.push({
      key: "illness",
      text: tri(
        `${kind.rn} — ${monthName(str("ill_month"), "rn")}`,
        `${kind.en} — ${monthName(str("ill_month"), "en")}`,
        `${kind.ne} — ${monthName(str("ill_month"), "ne")}`,
      ),
    });
  }
  if (includes(a, "events", "stress") && str("sleep") && SLEEP_LABEL[str("sleep")]) {
    const sl = SLEEP_LABEL[str("sleep")];
    bits.push({
      key: "stress",
      text: tri(`Tanab ko samaya — ${sl.rn}`, `A stressful time — ${sl.en}`, `तनावको समय — ${sl.ne}`),
    });
  }
  if (includes(a, "events", "diet") && ["often", "sometimes"].includes(str("diet_less"))) {
    bits.push({ key: "diet", text: tri("Khana cum khane badi", "Eating less lately", "खाना कम खाने बानी") });
  }
  if (includes(a, "events", "medicine")) {
    const nm = str("med_name");
    bits.push({
      key: "medicine",
      text: tri(
        nm ? `Naya aushadhi: ${nm}` : "Naya aushadhi",
        nm ? `New medicine: ${nm}` : "New medicine",
        nm ? `नयाँ औषधि: ${nm}` : "नयाँ औषधि",
      ),
    });
  }
  if (includes(a, "events", "childbirth")) {
    bits.push({ key: "childbirth", text: tri("Bachcha janmeko", "Childbirth", "बच्चा जन्मेको") });
  }
  return bits;
}

/* ------------------------------------------------------------------ */
/* server mapping: interview answers -> pins + answers blob            */
/* ------------------------------------------------------------------ */

export interface PlanPin {
  event_type: PinType;
  occurred_on: string;
  followup_answers: Record<string, unknown>;
}

/** Build timeline pins from a finished interview. Pure — no I/O. */
export function interviewToPins(a: IQAnswers): PlanPin[] {
  const pins: PlanPin[] = [];
  const str = (id: string) => {
    const v = typeof a[id] === "string" ? (a[id] as string) : "";
    return v === "__skip__" ? "" : v;
  };
  const onset = str("onset");
  if (onset && ONSET_MONTHS[onset]) {
    pins.push({ event_type: "shedding_onset", occurred_on: monthsAgoISO(ONSET_MONTHS[onset]), followup_answers: { sudden: "unsure" } });
  }
  if (includes(a, "events", "illness") && str("ill_kind") && str("ill_month")) {
    const months = Math.max(0, Math.round((Date.now() - new Date(str("ill_month") + "T00:00:00").getTime()) / 2592e6));
    const bucket = months <= 3 ? "l3" : months <= 6 ? "36" : months <= 12 ? "612" : "g12";
    pins.push({ event_type: "illness_fever", occurred_on: str("ill_month"), followup_answers: { ill_when: bucket, ill_kind: str("ill_kind") } });
  }
  if (includes(a, "events", "stress") && str("sleep")) {
    const h: Record<string, number> = { lt5: 4, h5_6: 5.5, h7_8: 7.5, gt8: 9 };
    pins.push({ event_type: "stress_period", occurred_on: monthsAgoISO(2), followup_answers: { sleep_h: h[str("sleep")] ?? 7 } });
  }
  if (includes(a, "events", "diet") && ["often", "sometimes"].includes(str("diet_less"))) {
    pins.push({ event_type: "crash_diet", occurred_on: monthsAgoISO(3), followup_answers: { diet_howlong: str("diet_less") === "often" ? "ge3" : "lt3" } });
  }
  if (includes(a, "events", "medicine")) {
    pins.push({
      event_type: "medication_change", occurred_on: monthsAgoISO(3),
      followup_answers: { med_name: str("med_name") || "unknown", med_still: str("med_still") === "yes" ? "yes" : "no" },
    });
  }
  if (includes(a, "events", "childbirth") && str("birth_when")) {
    pins.push({ event_type: "childbirth", occurred_on: monthsAgoISO(str("birth_when") === "le12" ? 8 : 18), followup_answers: { birth_when: str("birth_when") } });
  }
  return pins;
}

const SLEEP_HOURS: Record<string, number> = { lt5: 4, h5_6: 5.5, h7_8: 7.5, gt8: 9 };

/** Build the server answers blob from a finished interview. Pure — no I/O. */
export function interviewToAnswers(a: IQAnswers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const str = (id: string) => {
    const v = typeof a[id] === "string" ? (a[id] as string) : "";
    return v === "__skip__" ? "" : v;
  };
  const bothers = Array.isArray(a["bothers"]) ? (a["bothers"] as string[]) : [];
  if (str("sleep") && SLEEP_HOURS[str("sleep")] !== undefined) out.sleep_hours = SLEEP_HOURS[str("sleep")];
  if (bothers.includes("itching")) out.itching = true;
  if (bothers.includes("flakes")) out.flaking = true;
  if (bothers.includes("oily")) out.oiliness = 4;
  if (str("heat") === "often") out.heat_styling = "daily";
  else if (str("heat") === "sometimes") out.heat_styling = "weekly";
  if (str("color") === "yes") out.coloring = true;
  if (str("family") === "yes") out.family_pattern = true;
  if (str("periods") === "irregular") out.irregular_periods = true;
  if (str("diet_less") === "often") out.recent_weight_change = true;
  if (str("note")) out.derm_note = str("note");
  if (str("area")) out.thinning_area = str("area");
  return out;
}

/* ------------------------------------------------------------------ */
/* draft persistence boundary                                         */
/* ------------------------------------------------------------------ */

/**
 * ScanDraft.answers is Record<string,string>; multi-select answers are
 * JSON-encoded at this boundary and decoded on the way back. Pure.
 */
export function answersToDraft(a: IQAnswers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) out[k] = Array.isArray(v) ? JSON.stringify(v) : v;
  return out;
}

export function answersFromDraft(d: Record<string, string>): IQAnswers {
  const out: IQAnswers = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "string" && v.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(v);
        if (Array.isArray(parsed)) { out[k] = parsed.map(String); continue; }
      } catch { /* fall through to plain string */ }
    }
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Hair Story builders (P-2)                                           */
/* ------------------------------------------------------------------ */

export interface StoryEvent {
  key: string;
  dateISO: string;
  label: Tri;
  detail?: Tri;
}

export interface ProblemCard {
  id: string;
  title: Tri;
  reflection: Tri;
  education: Tri;
  /** where to place the marker on the scalp photo */
  zone: "crown" | "hairline" | "parting" | "allover";
}

export interface StoryInput {
  pins: { event_type: PinType; occurred_on: string; followup_answers: Record<string, unknown> }[];
  signals: Record<RootKey, Record<string, unknown>>;
  weakest: RootKey[];
  scores: Record<RootKey, number>;
}

const PIN_LABEL: Record<string, Tri> = {
  shedding_onset: tri("Kapal jharna thalyo", "Shedding started", "कपाल झर्न थाल्यो"),
  illness_fever: tri("Birami / jwaro", "Illness / fever", "बिरामी / ज्वरो"),
  childbirth: tri("Bachcha janmeko", "Childbirth", "बच्चा जन्मेको"),
  crash_diet: tri("Khana cum", "Eating less", "खाना कम"),
  medication_change: tri("Aushadhi pariwartan", "Medicine change", "औषधि परिवर्तन"),
  stress_period: tri("Tanab ko samaya", "Stressful time", "तनावको समय"),
  moved_city_water: tri("Thau sareko", "Moved place", "ठाउँ सरेको"),
  hair_treatment: tri("Kapal treatment", "Hair treatment", "कपाल ट्रिटमेन्ट"),
  other: tri("Arko ghatana", "Another event", "अर्को घटना"),
};

export function buildStoryEvents(input: StoryInput): StoryEvent[] {
  return input.pins
    .slice()
    .sort((x, y) => x.occurred_on.localeCompare(y.occurred_on))
    .map((p, i) => {
      const label = PIN_LABEL[p.event_type] ?? PIN_LABEL.other;
      let detail: Tri | undefined;
      if (p.event_type === "illness_fever" && p.followup_answers["ill_kind"]) {
        const k = String(p.followup_answers["ill_kind"]);
        detail = ILL_KIND[k] ?? ILL_KIND.other;
      }
      if (p.event_type === "stress_period" && p.followup_answers["sleep_h"] !== undefined) {
        const h = Number(p.followup_answers["sleep_h"]);
        detail = tri(`${h} ghanta sutne`, `sleeping ${h}h`, `${h} घण्टा सुत्ने`);
      }
      return { key: `${p.event_type}-${i}`, dateISO: p.occurred_on, label, detail };
    });
}

/** Severity from the weakest score. Words only — numbers stay on drill-down. */
export function buildVerdict(scores: Record<RootKey, number>): { level: "strong" | "moderate" | "mild"; text: Tri } {
  const min = Math.min(...Object.values(scores));
  if (min < 40) {
    return {
      level: "strong",
      text: tri(
        "Tapaiko kapal jharne samasya gambhir chha, tara sudhar huna sakchha.",
        "Your hair fall is serious — but it can get better.",
        "तपाईंको कपाल झर्ने समस्या गम्भीर छ, तर सुधार हुन सक्छ।",
      ),
    };
  }
  if (min < 70) {
    return {
      level: "moderate",
      text: tri(
        "Tapaiko kapal jhariraheko chha — samayamai dhyan diiyo bhane sudhar huna sakchha.",
        "Your hair is shedding — with timely care, it can improve.",
        "तपाईंको कपाल झरिरहेको छ — समयमै ध्यान दिइयो भने सुधार हुन सक्छ।",
      ),
    };
  }
  return {
    level: "mild",
    text: tri(
      "Tapaiko kapal ko awastha samanya bhanda ramro chha — yasalai yestai rakhnus.",
      "Your hair is doing better than average — let's keep it that way.",
      "तपाईंको कपालको अवस्था सामान्यभन्दा राम्रो छ — यसलाई यस्तै राख्नुस्।",
    ),
  };
}

export const NOT_DIAGNOSIS: Tri = tri(
  "Jaraa le tathya dekhaunchha; nirnaya dermatologist le garnuhunchha.",
  "Jaraa organizes the evidence; your dermatologist makes the decisions.",
  "जराले तथ्य देखाउँछ; निर्णय डर्माटोलोजिस्टले गर्नुहुन्छ।",
);

function monthOf(iso: string, s: Script): string {
  return monthName(iso.slice(0, 10), s);
}

/** Deterministic problem cards from the user's own pins + signals. Max 3. */
export function buildProblemCards(input: StoryInput): ProblemCard[] {
  const cards: ProblemCard[] = [];
  const { pins, signals } = input;
  const illness = pins.find((p) => p.event_type === "illness_fever");
  const stressPin = pins.find((p) => p.event_type === "stress_period");
  const dietPin = pins.find((p) => p.event_type === "crash_diet");
  const sleepH = Number(signals.stress_sleep?.["sleep_hours"]);
  const onset = pins.find((p) => p.event_type === "shedding_onset");

  const onsetTxt = (s: Script): string => {
    if (!onset) return s === "ne" ? "केही समयदेखि" : s === "rn" ? "kehi samayadekhi" : "for some time";
    const m = monthOf(onset.occurred_on, s);
    return s === "ne" ? `${m} देखि` : s === "rn" ? `${m} dekhi` : `since ${m}`;
  };

  if (illness) {
    const kind = String(illness.followup_answers["ill_kind"] ?? "");
    const kindTri = ILL_KIND[kind] ?? ILL_KIND.other;
    cards.push({
      id: "illness",
      zone: "allover",
      title: {
        rn: `Shedding after your ${monthOf(illness.occurred_on, "rn")} ${kindTri.rn.toLowerCase()}`,
        en: `Shedding after your ${monthOf(illness.occurred_on, "en")} ${kindTri.en.toLowerCase()}`,
        ne: `${monthOf(illness.occurred_on, "ne")} को ${kindTri.ne} पछि कपाल झर्नु`,
      },
      reflection: {
        rn: `Tapaile bhannubhayo: ${monthOf(illness.occurred_on, "rn")} ma ${kindTri.rn.toLowerCase()}, kapal jharna ${onsetTxt("rn")}.`,
        en: `You told us: ${kindTri.en.toLowerCase()} in ${monthOf(illness.occurred_on, "en")}, shedding ${onsetTxt("en")}.`,
        ne: `तपाईंले भन्नुभयो: ${monthOf(illness.occurred_on, "ne")} मा ${kindTri.ne}, कपाल झर्नु ${onsetTxt("ne")}।`,
      },
      education: tri(
        "Thulo birami pachhi 2-3 mahinama kapal jharna thalnu samanya pattern ho — tapai ko pani yestai dekhiyeko chha.",
        "Shedding that starts 2–3 months after a serious illness is a common pattern — yours lines up with it.",
        "ठूलो बिरामीपछि २–३ महिनामा कपाल झर्न थाल्नु सामान्य प्याटर्न हो — तपाईंको पनि यस्तै देखिएको छ।",
      ),
    });
  }

  if ((Number.isFinite(sleepH) && sleepH < 6) || stressPin) {
    cards.push({
      id: "sleep",
      zone: "crown",
      title: tri("Cum sutai le kapal lai asar", "Low sleep is straining your hair", "कम सुताइले कपाललाई असर"),
      reflection: {
        rn: `Tapaile bhannubhayo: ${Number.isFinite(sleepH) ? `dainik ${sleepH} ghanta matra sutne` : "tanab ko samaya"}.`,
        en: `You told us: ${Number.isFinite(sleepH) ? `only about ${sleepH} hours of sleep a day` : "a stressful period"}.`,
        ne: `तपाईंले भन्नुभयो: ${Number.isFinite(sleepH) ? `दैनिक ${sleepH} घण्टा मात्र सुत्ने` : "तनावको समय"}।`,
      },
      education: tri(
        "Kapal tab baliyo hunchha jab sharir le aram paunchha — nindra kapal ko lagi aushadhi jastai ho.",
        "Hair grows strongest when the body rests — sleep works like medicine for hair.",
        "कपाल तब बलियो हुन्छ जब शरीरले आराम पाउँछ — निन्द्रा कपालको लागि औषधिजस्तै हो।",
      ),
    });
  }

  const nutritionHit = dietPin || signals.nutrition?.["crash_diet"] || signals.nutrition?.["fatigue"] || signals.nutrition?.["recent_weight_change"];
  if (nutritionHit) {
    cards.push({
      id: "nutrition",
      zone: "parting",
      title: tri("Kapal lai poshan pugeko chhaina", "Your hair is underfed", "कपाललाई पोषण पुगेको छैन"),
      reflection: tri(
        "Tapaile bhannubhayo: khana cum khane badi / thak lagne.",
        "You told us: eating less lately, feeling tired.",
        "तपाईंले भन्नुभयो: खाना कम खाने बानी / थकान लाग्ने।",
      ),
      education: tri(
        "Kapal protein le banchha — khana ma protein cum bhayo bhane kapal pahile kamjor hunchha.",
        "Hair is built from protein — when food lacks it, hair is the first to weaken.",
        "कपाल प्रोटिनले बन्छ — खानामा प्रोटिन कम भयो भने कपाल पहिले कमजोर हुन्छ।",
      ),
    });
  }

  const scalpHit = signals.scalp?.["itching"] || signals.scalp?.["flaking"] || (signals.scalp?.["oiliness"] as number) >= 4;
  if (scalpHit) {
    const bits: Tri[] = [];
    if (signals.scalp?.["itching"]) bits.push(tri("chilauchha", "itching", "चिलाउँछ"));
    if (signals.scalp?.["flaking"]) bits.push(tri("filo", "flakes", "फिलो"));
    if ((signals.scalp?.["oiliness"] as number) >= 4) bits.push(tri("chiplo", "oiliness", "चिप्लो"));
    cards.push({
      id: "scalp",
      zone: "crown",
      title: tri("Tauko ko chhala aswastha", "An unhappy scalp", "टाउकोको छाला अस्वस्थ"),
      reflection: {
        rn: `Tapaile bhannubhayo: tauko ${bits.map((b) => b.rn).join(", ")}.`,
        en: `You told us: scalp ${bits.map((b) => b.en).join(", ")}.`,
        ne: `तपाईंले भन्नुभयो: टाउको ${bits.map((b) => b.ne).join(", ")}।`,
      },
      education: tri(
        "Swastha kapal swastha tauko bata auchha — tauko thik bhayo bhane kapal pani sudhrinchha.",
        "Healthy hair grows from a healthy scalp — fix the scalp and the hair follows.",
        "स्वस्थ कपाल स्वस्थ टाउकोबाट आउँछ — टाउको ठिक भयो भने कपाल पनि सुध्रिन्छ।",
      ),
    });
  }

  const damageHit = signals.damage?.["heat_styling"] || signals.damage?.["coloring"] || signals.damage?.["hair_treatment_pin"];
  if (damageHit) {
    cards.push({
      id: "damage",
      zone: "hairline",
      title: tri("Heat ra rang le bigareko", "Damage from heat & colour", "हिट र रङ्गले बिगारेको"),
      reflection: tri(
        "Tapaile bhannubhayo: heat / rang prayog garne.",
        "You told us: you use heat or colour on your hair.",
        "तपाईंले भन्नुभयो: हिट / रङ्ग प्रयोग गर्ने।",
      ),
      education: tri(
        "Dherai heat ra chemical le kapal ko bahiri taha bigarchha — cum garda kapal baliyo hunchha.",
        "Too much heat and chemicals wear down hair's outer layer — less of it keeps hair stronger.",
        "धेरै हिट र केमिकलले कपालको बाहिरी तह बिगार्छ — कम गर्दा कपाल बलियो हुन्छ।",
      ),
    });
  }

  if (signals.medical_family?.["family_pattern"]) {
    cards.push({
      id: "family",
      zone: "crown",
      title: tri("Pariwar ma pani yestai", "It runs in the family", "परिवारमा पनि यस्तै"),
      reflection: tri(
        "Tapaile bhannubhayo: pariwar ma kasailai yestai samasya chha.",
        "You told us: someone in your family has similar hair loss.",
        "तपाईंले भन्नुभयो: परिवारमा कसैलाई यस्तै समस्या छ।",
      ),
      education: tri(
        "Pariwarik kapal jharne samasya samayamai samatiyo bhane dherai sudhar huna sakchha.",
        "Family-pattern hair fall caught early can improve a lot with the right care.",
        "पारिवारिक कपाल झर्ने समस्या समयमै समातियो भने धेरै सुधार हुन सक्छ।",
      ),
    });
  }

  if (signals.hormones?.["irregular_periods"] || signals.hormones?.["thyroid"] || signals.hormones?.["pcos"]) {
    cards.push({
      id: "hormones",
      zone: "parting",
      title: tri("Sharir ko santulan", "Your body's balance", "शरीरको सन्तुलन"),
      reflection: tri(
        "Tapaile bhannubhayo: mahinawari aniyamit / thyroid sambandhi kura.",
        "You told us: irregular cycles or thyroid-related signs.",
        "तपाईंले भन्नुभयो: महिनावारी अनियमित / थाइराइड सम्बन्धी कुरा।",
      ),
      education: tri(
        "Kapal sharir ko santulan sanga jodiyeko chha — yo kura dermatologist le hernechhan.",
        "Hair is tied to the body's balance — your dermatologist will look into this.",
        "कपाल शरीरको सन्तुलनसँग जोडिएको छ — यो कुरा डर्माटोलोजिस्टले हेर्नेछन्।",
      ),
    });
  }

  // Fallback: if nothing fired, say so honestly from the weakest root.
  if (cards.length === 0 && input.weakest.length > 0) {
    cards.push({
      id: "general",
      zone: "allover",
      title: tri("Kapal jharne samasya", "Hair fall that needs attention", "कपाल झर्ने समस्या"),
      reflection: tri(
        "Tapaiko jawaf herda kapal lai sahayog chahiyeko dekhiyeko chha.",
        "From your answers, your hair looks like it needs some support.",
        "तपाईंको जवाफ हेर्दा कपाललाई सहयोग चाहिएको देखिएको छ।",
      ),
      education: tri(
        "Thap jankari ko lagi dermatologist sanga kura garnus — uni nai sahi bato dekhaunechhan.",
        "Talk to your dermatologist for the full picture — they'll point the right way.",
        "थप जानकारीको लागि डर्माटोलोजिस्टसँग कुरा गर्नुस् — उनी नै सही बाटो देखाउनेछन्।",
      ),
    });
  }

  return cards.slice(0, 3);
}
