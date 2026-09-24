/**
 * Pure helpers for the Root Map diagram.
 * The server returns RootMap.svg with per-root geometry (viewBox + x1/y1/x2/y2
 * + color + length + labels); this module is the client-side fallback / live
 * preview that derives the same diagram from root scores, so the drawing code
 * stays identical in both paths. All functions are pure and unit-tested.
 */
import type { RootKey } from "../api/types";

export const ROOT_ORDER: RootKey[] = [
  "nutrition",
  "stress_sleep",
  "hormones",
  "scalp",
  "damage",
  "medical_family",
];

export interface DiagramRoot {
  root: RootKey;
  /** SVG path "d" for the curved root from the seed to the tip */
  d: string;
  /** tip coordinates */
  tipX: number;
  tipY: number;
  tipR: number;
  strokeWidth: number;
  color: string;
  /** 0–100, mirrors the root score */
  length: number;
  glow: boolean;
  label: string;
  scoreWord: string;
  score: number;
  /** label anchor point (below the tip, clamped inside the viewBox) */
  labelX: number;
  labelY: number;
}

export interface RootDiagram {
  viewBox: string;
  seedX: number;
  seedY: number;
  roots: DiagramRoot[];
  weakest: RootKey[];
}

const SEED_X = 200;
const SEED_Y = 78;

/** Fan directions for the six roots (unit-ish vectors pointing down/out). */
const DIRS: Array<[number, number]> = [
  [-0.95, 0.7],
  [-0.6, 0.85],
  [-0.22, 0.95],
  [0.22, 0.95],
  [0.6, 0.85],
  [0.95, 0.7],
];

/** Score -> color. Mirrors the server palette. */
export function scoreColor(score: number): string {
  if (score >= 70) return "#2d9d5f"; // green — good
  if (score >= 40) return "#d97706"; // amber — fair
  return "#d64545"; // red — needs care
}

/** Score -> text label key (never color-only meaning). */
export function scoreWordKey(score: number): "good" | "fair" | "needsCare" {
  if (score >= 70) return "good";
  if (score >= 40) return "fair";
  return "needsCare";
}

/**
 * Build the living-root diagram from six scores + labels.
 * @param scores  root key -> 0..100
 * @param labels  root key -> display label (already localized)
 * @param words   localized words for good/fair/needsCare
 */
export function rootMapToDiagram(
  scores: Record<RootKey, number>,
  labels: Record<RootKey, string>,
  words: { good: string; fair: string; needsCare: string },
): RootDiagram {
  let min = 101;
  for (const k of ROOT_ORDER) min = Math.min(min, scores[k]);
  const weakest = ROOT_ORDER.filter((k) => scores[k] === min);

  const roots: DiagramRoot[] = ROOT_ORDER.map((root, i) => {
    const score = Math.max(0, Math.min(100, Math.round(scores[root])));
    const color = scoreColor(score);
    const wordKey = scoreWordKey(score);
    const length = score;
    // Length of the drawn root grows with the score; weak roots are short.
    const L = 55 + score * 1.15;
    const [dx, dy] = DIRS[i];
    const tipX = SEED_X + dx * L;
    const tipY = SEED_Y + dy * L;
    // Control point bows the root outward for an organic curve.
    const cx = SEED_X + dx * L * 0.5 - dy * 22;
    const cy = SEED_Y + dy * L * 0.5 + dx * 10;
    const d = `M${SEED_X} ${SEED_Y} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)}`;
    const glow = weakest.includes(root);
    const labelX = Math.max(52, Math.min(348, tipX));
    const labelY = Math.min(308, tipY + 20);
    return {
      root,
      d,
      tipX,
      tipY,
      tipR: 7 + score / 30,
      strokeWidth: 6 + score / 28,
      color,
      length,
      glow,
      label: labels[root],
      scoreWord: words[wordKey],
      score,
      labelX,
      labelY,
    };
  });

  return { viewBox: "0 0 400 330", seedX: SEED_X, seedY: SEED_Y, roots, weakest };
}

/** Delta between two scan versions, newest first. */
export function rootDeltas(
  newer: Record<RootKey, number>,
  older: Record<RootKey, number>,
): Array<{ root: RootKey; from: number; to: number; delta: number; pct: number }> {
  return ROOT_ORDER.map((root) => {
    const from = older[root] ?? 0;
    const to = newer[root] ?? 0;
    const delta = to - from;
    const pct = from > 0 ? Math.round((delta / from) * 100) : to > 0 ? 100 : 0;
    return { root, from, to, delta, pct };
  });
}
