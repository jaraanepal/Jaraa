/**
 * Client-side red-flag evaluation (RF1–RF7), mirroring the server rules from
 * ROOT-SCAN-FLOW.md. The server is authoritative (409 red_flag_unresolved);
 * this module gives the UI instant, honest feedback during the scan.
 * One unit test per rule lives in src/test/redflags.test.ts.
 */
import type { RedFlagType } from "../api/types";

export interface FlagHit {
  type: RedFlagType;
  /** machine-readable reason, for debugging / copy lookup */
  reason: string;
}

export interface ScanSignals {
  suddenPatchyLoss?: boolean;
  thyroidMedication?: boolean;
  thyroidSymptoms?: boolean;
  pcosDiagnosed?: boolean;
  pcosSymptoms?: boolean; // irregular periods + acne/excess hair
  scalpPainSores?: boolean;
  sheddingWithSystemic?: boolean; // fever / weight loss / extreme fatigue
  hairLossDrugStillTaking?: boolean;
  ageBand?: string; // "16-22" | ... | "u16"
  guardianConsent?: boolean;
}

export function detectRedFlags(s: ScanSignals): FlagHit[] {
  const hits: FlagHit[] = [];
  if (s.suddenPatchyLoss) hits.push({ type: "RF1", reason: "sudden patchy/bald-spot loss" });
  if (s.thyroidMedication || s.thyroidSymptoms)
    hits.push({ type: "RF2", reason: "thyroid medication or suspected thyroid symptoms" });
  if (s.pcosDiagnosed || s.pcosSymptoms) hits.push({ type: "RF3", reason: "PCOS symptoms or diagnosis" });
  if (s.scalpPainSores) hits.push({ type: "RF4", reason: "scalp pain, sores, burning or pus" });
  if (s.sheddingWithSystemic) hits.push({ type: "RF5", reason: "shedding with systemic symptoms" });
  if (s.hairLossDrugStillTaking) hits.push({ type: "RF6", reason: "hair-loss drug still being taken" });
  if (s.ageBand === "u16" && !s.guardianConsent)
    hits.push({ type: "RF7", reason: "under-16 without guardian consent" });
  return hits;
}

/** Friendly bilingual copy per flag, keyed for i18n. */
export const RED_FLAG_COPY_KEY: Record<RedFlagType, string> = {
  RF1: "redflags.RF1",
  RF2: "redflags.RF2",
  RF3: "redflags.RF3",
  RF4: "redflags.RF4",
  RF5: "redflags.RF5",
  RF6: "redflags.RF6",
  RF7: "redflags.RF7",
};
