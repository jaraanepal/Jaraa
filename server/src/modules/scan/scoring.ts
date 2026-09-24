// Transparent root scoring — 0–100 per root from timeline pins + Stage-3 answers.
// v1 weighting is deliberately simple and explainable: each root starts at 100
// and documented deductions apply for each negative signal. Signals are stored
// alongside scores so the UI can show "why" (blueprint §3: transparent).
export type RootKey = "nutrition" | "stress_sleep" | "hormones" | "scalp" | "damage" | "medical_family";

export interface ScoreInput {
  pins: { event_type: string; occurred_on?: string | null; followup_answers: Record<string, unknown> }[];
  answers: Record<string, unknown>;
  profile?: { age_band?: string | null; gender?: string | null };
}

export interface RootScore { score: number; signals: Record<string, unknown> }

export const ROOT_LABELS: Record<RootKey, { en: string; ne: string }> = {
  nutrition: { en: "Nutrition", ne: "पोषण" },
  stress_sleep: { en: "Stress & Sleep", ne: "तनाव र निद्रा" },
  hormones: { en: "Hormones", ne: "हर्मोन" },
  scalp: { en: "Scalp", ne: "टाउकोको छाला" },
  damage: { en: "Damage", ne: "क्षति" },
  medical_family: { en: "Medical & Family", ne: "चिकित्सा र परिवार" },
};

export const ROOTS: RootKey[] = ["nutrition", "stress_sleep", "hormones", "scalp", "damage", "medical_family"];

/** Color for the Root Map diagram: always paired with a text label (G5). */
export function scoreColor(score: number): string {
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}

function monthsAgo(occurredOn?: string | null): number | null {
  if (!occurredOn) return null;
  const d = new Date(occurredOn).getTime();
  if (Number.isNaN(d)) return null;
  return (Date.now() - d) / (30.44 * 86_400_000);
}

export function computeRootScores(input: ScoreInput): Record<RootKey, RootScore> {
  const { pins, answers } = input;
  const pinTypes = new Set(pins.map((p) => p.event_type));
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  // --- nutrition ---
  let nutrition = 100;
  const nSig: Record<string, unknown> = {};
  if (pinTypes.has("crash_diet")) { nutrition -= 18; nSig.crash_diet = true; }
  if (answers.fatigue === true) { nutrition -= 12; nSig.fatigue = true; }
  if (answers.recent_weight_change === true) { nutrition -= 10; nSig.recent_weight_change = true; }
  if (answers.diet) nSig.diet = answers.diet;
  if (answers.iron_supplement === true) { nutrition += 4; nSig.iron_supplement = true; }

  // --- stress & sleep ---
  let stress = 100;
  const sSig: Record<string, unknown> = {};
  const sleep = Number(answers.sleep_hours);
  if (Number.isFinite(sleep)) {
    sSig.sleep_hours = sleep;
    if (sleep < 6) stress -= 20; else if (sleep < 7) stress -= 10;
  } else {
    const pin = pins.find((p) => p.event_type === "stress_period");
    const ps = Number(pin?.followup_answers.sleep_hours);
    if (Number.isFinite(ps)) { sSig.sleep_hours = ps; if (ps < 6) stress -= 20; else if (ps < 7) stress -= 10; }
  }
  const stressLevel = Number(answers.stress_level);
  if (Number.isFinite(stressLevel)) {
    sSig.stress_level = stressLevel;
    if (stressLevel >= 4) stress -= 15; else if (stressLevel >= 3) stress -= 7;
  }
  if (pinTypes.has("stress_period")) { stress -= 8; sSig.stress_period_pin = true; }

  // --- hormones ---
  let hormones = 100;
  const hSig: Record<string, unknown> = {};
  if (answers.irregular_periods === true) { hormones -= 12; hSig.irregular_periods = true; }
  if (answers.thyroid_symptoms === true || answers.thyroid_med === true) { hormones -= 20; hSig.thyroid = true; }
  if (answers.pcos_diagnosed === true) { hormones -= 20; hSig.pcos = true; }
  if (input.profile?.gender === "male" && input.profile?.age_band === "16-22") {
    hSig.shortened_young_male = true; // young-starter path: shortened, neutral score
  }

  // --- scalp ---
  let scalp = 100;
  const scSig: Record<string, unknown> = {};
  if (answers.itching === true) { scalp -= 10; scSig.itching = true; }
  if (answers.flaking === true) { scalp -= 10; scSig.flaking = true; }
  const oil = Number(answers.oiliness);
  if (Number.isFinite(oil) && oil >= 4) { scalp -= 8; scSig.oiliness = oil; }

  // --- damage ---
  let damage = 100;
  const dSig: Record<string, unknown> = {};
  const heat = String(answers.heat_styling ?? "");
  if (heat === "daily") { damage -= 20; dSig.heat_styling = "daily"; }
  else if (heat === "weekly") { damage -= 12; dSig.heat_styling = "weekly"; }
  else if (heat) dSig.heat_styling = heat;
  if (answers.coloring === true) { damage -= 12; dSig.coloring = true; }
  if (answers.tight_hairstyles === true) { damage -= 8; dSig.tight_hairstyles = true; }
  if (pinTypes.has("hair_treatment")) { damage -= 10; dSig.hair_treatment_pin = true; }

  // --- medical & family ---
  let medical = 100;
  const mSig: Record<string, unknown> = {};
  if (answers.family_pattern === true) { medical -= 15; mSig.family_pattern = true; }
  if (answers.chronic_illness === true) { medical -= 10; mSig.chronic_illness = true; }
  for (const p of pins) {
    if (p.event_type === "illness_fever") {
      const m = monthsAgo(p.occurred_on);
      if (m !== null && m <= 12) { medical -= 12; mSig.recent_illness = p.occurred_on; break; }
    }
  }

  return {
    nutrition: { score: clamp(nutrition), signals: nSig },
    stress_sleep: { score: clamp(stress), signals: sSig },
    hormones: { score: clamp(hormones), signals: hSig },
    scalp: { score: clamp(scalp), signals: scSig },
    damage: { score: clamp(damage), signals: dSig },
    medical_family: { score: clamp(medical), signals: mSig },
  };
}

/** Weakest roots first (for the Root Map + coach nudges). */
export function weakestRoots(scores: Record<RootKey, RootScore>, n = 2): RootKey[] {
  return ROOTS.slice().sort((a, b) => scores[a].score - scores[b].score).slice(0, n);
}
