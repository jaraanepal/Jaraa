/**
 * Stage 3 (Jara) question definitions + transparent v1 scoring.
 * Pure functions, driven by data — the UI renders whatever this returns.
 * Mirrors the flow doc: questions render only for roots the adaptive engine
 * keeps active (postpartum hides Hormones-medical, young-starter shortens
 * Hormones, sparse-story adds extra questions).
 */
import type { RootKey } from "../api/types";

export type AdaptivePath = "standard" | "postpartum" | "medical" | "young" | "stress" | "sparse";

export interface Opt {
  value: string;
  labelKey: string;
  score: number;
}

export interface Stage3Question {
  qid: string;
  root: RootKey;
  textKey: string;
  type: "opts" | "slider";
  opts?: Opt[];
  min?: number;
  max?: number;
  /** score derivation for sliders */
  sliderScore?: (v: number) => number;
  defaultValue?: number | (() => number);
  sparseOnly?: boolean;
  femaleOnly?: boolean;
  /** red-flag hook: returns signal keys when the answer is a flag */
  flagOn?: (value: string) => "RF1" | "RF2" | "RF3" | "RF4" | "RF5" | "RF6" | null;
}

export const STAGE3_QUESTIONS: Stage3Question[] = [
  // ---- Nutrition ----
  { qid: "diet", root: "nutrition", textKey: "jara.q.diet", type: "opts",
    opts: [
      { value: "nonveg", labelKey: "jara.q.diet_nonveg", score: 65 },
      { value: "veg", labelKey: "jara.q.diet_veg", score: 55 },
      { value: "vegan", labelKey: "jara.q.diet_vegan", score: 45 },
    ] },
  { qid: "fatigue", root: "nutrition", textKey: "jara.q.fatigue", type: "opts",
    opts: [
      { value: "yes", labelKey: "common.yes", score: 35 },
      { value: "no", labelKey: "common.no", score: 70 },
    ] },
  { qid: "weight", root: "nutrition", textKey: "jara.q.weight", type: "opts",
    opts: [
      { value: "lostlot", labelKey: "jara.q.weight_lostlot", score: 30 },
      { value: "lost", labelKey: "jara.q.weight_lost", score: 55 },
      { value: "stable", labelKey: "jara.q.weight_stable", score: 70 },
      { value: "gained", labelKey: "jara.q.weight_gained", score: 55 },
    ] },
  { qid: "protein", root: "nutrition", textKey: "jara.q.protein", type: "opts", sparseOnly: true,
    opts: [
      { value: "yes", labelKey: "common.yes", score: 75 },
      { value: "no", labelKey: "common.no", score: 40 },
    ] },
  // ---- Stress & Sleep ----
  { qid: "sleep_h", root: "stress_sleep", textKey: "jara.q.sleep_h", type: "slider", min: 3, max: 10,
    defaultValue: 7, sliderScore: (v) => Math.max(10, Math.min(100, Math.round(v * 10))) },
  { qid: "stress_lvl", root: "stress_sleep", textKey: "jara.q.stress_lvl", type: "opts",
    opts: [
      { value: "1", labelKey: "jara.q.stress_lvl_1", score: 100 },
      { value: "2", labelKey: "jara.q.stress_lvl", score: 80 },
      { value: "3", labelKey: "jara.q.stress_lvl", score: 60 },
      { value: "4", labelKey: "jara.q.stress_lvl", score: 40 },
      { value: "5", labelKey: "jara.q.stress_lvl_5", score: 20 },
    ] },
  { qid: "screens", root: "stress_sleep", textKey: "jara.q.screens", type: "opts", sparseOnly: true,
    opts: [
      { value: "yes", labelKey: "common.yes", score: 45 },
      { value: "no", labelKey: "common.no", score: 75 },
    ] },
  // ---- Hormones ----
  { qid: "periods", root: "hormones", textKey: "jara.q.periods", type: "opts", femaleOnly: true,
    opts: [
      { value: "yes", labelKey: "common.yes", score: 35 },
      { value: "no", labelKey: "common.no", score: 70 },
    ] },
  { qid: "thyroid", root: "hormones", textKey: "jara.q.thyroid", type: "opts",
    opts: [
      { value: "yes", labelKey: "common.yes", score: 20 },
      { value: "no", labelKey: "common.no", score: 70 },
    ],
    flagOn: (v) => (v === "yes" ? "RF2" : null) },
  { qid: "pcos", root: "hormones", textKey: "jara.q.pcos", type: "opts", femaleOnly: true,
    opts: [
      { value: "yes", labelKey: "common.yes", score: 25 },
      { value: "no", labelKey: "common.no", score: 70 },
    ],
    flagOn: (v) => (v === "yes" ? "RF3" : null) },
  // ---- Scalp ----
  { qid: "itch", root: "scalp", textKey: "jara.q.itch", type: "opts",
    opts: [
      { value: "yes", labelKey: "common.yes", score: 40 },
      { value: "no", labelKey: "common.no", score: 75 },
    ] },
  { qid: "oil", root: "scalp", textKey: "jara.q.oil", type: "opts",
    opts: [
      { value: "1", labelKey: "jara.q.oil", score: 90 },
      { value: "2", labelKey: "jara.q.oil", score: 75 },
      { value: "3", labelKey: "jara.q.oil", score: 60 },
      { value: "4", labelKey: "jara.q.oil", score: 45 },
      { value: "5", labelKey: "jara.q.oil", score: 30 },
    ] },
  { qid: "pain", root: "scalp", textKey: "jara.q.pain", type: "opts",
    opts: [
      { value: "yes", labelKey: "common.yes", score: 15 },
      { value: "no", labelKey: "common.no", score: 75 },
    ],
    flagOn: (v) => (v === "yes" ? "RF4" : null) },
  { qid: "wash", root: "scalp", textKey: "jara.q.wash", type: "opts", sparseOnly: true,
    opts: [
      { value: "daily", labelKey: "jara.q.wash_daily", score: 60 },
      { value: "alt", labelKey: "jara.q.wash_alt", score: 75 },
      { value: "weekly", labelKey: "jara.q.wash_weekly", score: 65 },
    ] },
  // ---- Damage ----
  { qid: "heat", root: "damage", textKey: "jara.q.heat", type: "opts",
    opts: [
      { value: "daily", labelKey: "jara.q.heat_daily", score: 30 },
      { value: "weekly", labelKey: "jara.q.heat_weekly", score: 55 },
      { value: "rare", labelKey: "jara.q.heat_rare", score: 80 },
    ] },
  { qid: "color", root: "damage", textKey: "jara.q.color", type: "opts",
    opts: [
      { value: "recent", labelKey: "jara.q.color_recent", score: 35 },
      { value: "old", labelKey: "jara.q.color_old", score: 55 },
      { value: "never", labelKey: "jara.q.color_never", score: 80 },
    ] },
  { qid: "tight", root: "damage", textKey: "jara.q.tight", type: "opts",
    opts: [
      { value: "often", labelKey: "jara.q.tight_often", score: 40 },
      { value: "some", labelKey: "jara.q.tight_some", score: 60 },
      { value: "never", labelKey: "jara.q.tight_never", score: 80 },
    ] },
  { qid: "brush", root: "damage", textKey: "jara.q.brush", type: "opts", sparseOnly: true,
    opts: [
      { value: "yes", labelKey: "common.yes", score: 45 },
      { value: "no", labelKey: "common.no", score: 75 },
    ] },
  // ---- Medical & Family ----
  { qid: "family", root: "medical_family", textKey: "jara.q.family", type: "opts",
    opts: [
      { value: "father", labelKey: "jara.q.family_father", score: 45 },
      { value: "mother", labelKey: "jara.q.family_mother", score: 45 },
      { value: "both", labelKey: "jara.q.family_both", score: 30 },
      { value: "none", labelKey: "jara.q.family_none", score: 75 },
    ] },
  { qid: "meds", root: "medical_family", textKey: "jara.q.meds", type: "opts",
    opts: [
      { value: "yes", labelKey: "common.yes", score: 55 },
      { value: "no", labelKey: "common.no", score: 75 },
    ] },
  { qid: "chronic", root: "medical_family", textKey: "jara.q.chronic", type: "opts",
    opts: [
      { value: "yes", labelKey: "common.yes", score: 45 },
      { value: "no", labelKey: "common.no", score: 75 },
    ] },
  { qid: "water", root: "medical_family", textKey: "jara.q.water", type: "opts", sparseOnly: true,
    opts: [
      { value: "yes", labelKey: "common.yes", score: 45 },
      { value: "no", labelKey: "common.no", score: 70 },
    ] },
];

export interface QuestionVisibility {
  path: AdaptivePath;
  gender?: "female" | "male" | "other";
}

/** Adaptive pruning: irrelevant paths never render. */
export function questionVisible(q: Stage3Question, v: QuestionVisibility): boolean {
  if (q.sparseOnly && v.path !== "sparse") return false;
  if (q.root === "hormones" && v.path === "postpartum") return false;
  if (q.femaleOnly && v.gender !== "female") return false;
  if (q.root === "hormones" && v.path === "young" && q.qid !== "thyroid") return false;
  return true;
}

export function questionScore(q: Stage3Question, value: string): number {
  if (q.type === "slider") {
    const fn = q.sliderScore ?? ((n: number) => Math.max(0, Math.min(100, n)));
    return fn(Number(value));
  }
  return q.opts?.find((o) => o.value === value)?.score ?? 50;
}

/** Transparent v1 weighting: unanswered questions count as 50 (neutral). */
export function rootScoreFor(
  root: RootKey,
  answers: Record<string, string>,
  vis: QuestionVisibility,
): { score: number; answered: number; total: number } {
  const qs = STAGE3_QUESTIONS.filter((q) => q.root === root && questionVisible(q, vis));
  if (!qs.length) return { score: 50, answered: 0, total: 0 };
  let sum = 0;
  let answered = 0;
  for (const q of qs) {
    const v = answers[q.qid];
    if (v === undefined) sum += 50;
    else {
      sum += questionScore(q, v);
      answered++;
    }
  }
  return { score: Math.round(sum / qs.length), answered, total: qs.length };
}

export function allRootsAnswered(answers: Record<string, string>, vis: QuestionVisibility): boolean {
  const roots: RootKey[] = ["nutrition", "stress_sleep", "hormones", "scalp", "damage", "medical_family"];
  return roots.every((r) => {
    const qs = STAGE3_QUESTIONS.filter((q) => q.root === r && questionVisible(q, vis));
    return qs.length === 0 || qs.some((q) => answers[q.qid] !== undefined);
  });
}
