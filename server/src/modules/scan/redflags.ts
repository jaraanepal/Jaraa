// Red-flag engine — RF1–RF7 from docs/ROOT-SCAN-FLOW.md.
// Pure functions. ANY flag true -> stop all plan generation, route to mandatory
// dermatologist review. One unit test per rule (see tests/redflags.test.ts).
export type FlagType = "RF1" | "RF2" | "RF3" | "RF4" | "RF5" | "RF6" | "RF7";

export interface FlagInput {
  pin?: {
    event_type: string;
    followup_answers: Record<string, unknown>;
    occurred_on?: string | null;
  };
  answers?: Record<string, unknown>; // Stage-3 Jara answers
  profile?: { age_band?: string | null; gender?: string | null; is_minor?: boolean };
}

export interface RaisedFlag { flag_type: FlagType; detail: string }

// Drugs with well-documented hair-loss association (patient-facing list kept
// short; matching is substring, case-insensitive).
const HAIR_LOSS_DRUGS = [
  "isotretinoin", "warfarin", "heparin", "lithium", "valproate", "valproic",
  "carbamazepine", "fluoxetine", "sertraline", "paroxetine", "propranolol",
  "atenolol", "metoprolol", "methotrexate", "tamoxifen", "allopurinol",
  "colchicine", "interferon",
];

/** RF1. Sudden patchy/bald-spot loss (possible alopecia areata). */
export function rf1(i: FlagInput): RaisedFlag | null {
  const f = i.pin?.followup_answers ?? {};
  if (i.pin?.event_type === "shedding_onset" && f.sudden_or_gradual === "sudden" && f.patchy === true) {
    return { flag_type: "RF1", detail: "Sudden patchy loss reported — possible alopecia areata. Dermatologist review required." };
  }
  return null;
}

/** RF2. Thyroid medication or suspected thyroid symptoms. */
export function rf2(i: FlagInput): RaisedFlag | null {
  const a = i.answers ?? {};
  const f = i.pin?.followup_answers ?? {};
  if (a.thyroid_med === true || a.thyroid_symptoms === true || f.thyroid === true) {
    return { flag_type: "RF2", detail: "Thyroid medication or symptoms indicated. Dermatologist review required before any plan." };
  }
  return null;
}

/** RF3. PCOS symptoms (irregular periods + acne/excess hair) or diagnosed PCOS. */
export function rf3(i: FlagInput): RaisedFlag | null {
  const a = i.answers ?? {};
  if (a.pcos_diagnosed === true ||
      (a.irregular_periods === true && (a.acne === true || a.excess_hair === true))) {
    return { flag_type: "RF3", detail: "PCOS pattern indicated. Dermatologist review required before any plan." };
  }
  return null;
}

/** RF4. Scalp pain, sores, burning, or pus. */
export function rf4(i: FlagInput): RaisedFlag | null {
  const a = i.answers ?? {};
  const f = i.pin?.followup_answers ?? {};
  if (a.scalp_pain === true || a.scalp_sores === true || a.scalp_burning === true ||
      a.scalp_pus === true || f.scalp_pain === true) {
    return { flag_type: "RF4", detail: "Scalp pain, sores, burning or pus reported. Dermatologist review required." };
  }
  return null;
}

/** RF5. Shedding with systemic symptoms (fever, weight loss, extreme fatigue). */
export function rf5(i: FlagInput): RaisedFlag | null {
  const a = i.answers ?? {};
  if (a.fever === true || a.rapid_weight_loss === true || a.extreme_fatigue === true) {
    return { flag_type: "RF5", detail: "Shedding with systemic symptoms (fever / weight loss / extreme fatigue). Dermatologist review required." };
  }
  return null;
}

/** RF6. medication_change pin with a drug known for hair loss AND still taking it. */
export function rf6(i: FlagInput): RaisedFlag | null {
  const f = i.pin?.followup_answers ?? {};
  if (i.pin?.event_type === "medication_change" && f.still_taking === true) {
    const med = String(f.medicine ?? f.medication ?? "").toLowerCase();
    if (HAIR_LOSS_DRUGS.some((d) => med.includes(d))) {
      return { flag_type: "RF6", detail: `Medication change involving a drug associated with hair loss (${med || "unspecified"}) and still taking it. Dermatologist review required.` };
    }
  }
  return null;
}

/** RF7. Under-16 detected -> guardian flow, scan pauses until guardian consent. */
export function rf7(i: FlagInput): RaisedFlag | null {
  if (i.profile?.is_minor === true || i.answers?.age_under_16 === true) {
    return { flag_type: "RF7", detail: "Under-16 detected. Guardian consent is required before the scan can continue." };
  }
  return null;
}

const RULES: ((i: FlagInput) => RaisedFlag | null)[] = [rf1, rf2, rf3, rf4, rf5, rf6, rf7];

/** Evaluate all seven rules against a pin/answers/profile context. */
export function evaluateRedFlags(input: FlagInput): RaisedFlag[] {
  const out: RaisedFlag[] = [];
  for (const r of RULES) {
    const f = r(input);
    if (f && !out.some((x) => x.flag_type === f.flag_type)) out.push(f);
  }
  return out;
}

export { HAIR_LOSS_DRUGS };
