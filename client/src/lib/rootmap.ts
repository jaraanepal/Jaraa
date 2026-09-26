/**
 * Shared root-score helpers.
 * P-2 removed the tree visualization: the old diagram geometry
 * (rootMapToDiagram) and rootDeltas are gone. What remains are the score
 * color/word helpers used by ScoreBar/ScoreLabel across the app.
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

/** The two weakest roots, for drill-down detail. */
export function weakestRoots(scores: Record<RootKey, number>, n = 2): RootKey[] {
  return ROOT_ORDER.slice()
    .sort((a, b) => scores[a] - scores[b])
    .slice(0, n);
}
