import { describe, expect, it } from "vitest";
import { RED_FLAG_COPY_KEY, detectRedFlags, type ScanSignals } from "../lib/redflags";
import en from "../i18n/en.json";

const CLEAN: ScanSignals = {};

describe("red-flag rules RF1–RF7", () => {
  it("RF1 fires on sudden patchy loss", () => {
    expect(detectRedFlags({ ...CLEAN, suddenPatchyLoss: true })).toEqual([
      { type: "RF1", reason: "sudden patchy/bald-spot loss" },
    ]);
  });

  it("RF2 fires on thyroid medication or symptoms", () => {
    expect(detectRedFlags({ thyroidMedication: true })[0].type).toBe("RF2");
    expect(detectRedFlags({ thyroidSymptoms: true })[0].type).toBe("RF2");
  });

  it("RF3 fires on PCOS diagnosis or symptoms", () => {
    expect(detectRedFlags({ pcosDiagnosed: true })[0].type).toBe("RF3");
    expect(detectRedFlags({ pcosSymptoms: true })[0].type).toBe("RF3");
  });

  it("RF4 fires on scalp pain/sores", () => {
    expect(detectRedFlags({ scalpPainSores: true })[0].type).toBe("RF4");
  });

  it("RF5 fires on shedding with systemic symptoms", () => {
    expect(detectRedFlags({ sheddingWithSystemic: true })[0].type).toBe("RF5");
  });

  it("RF6 fires only when the suspect drug is still being taken", () => {
    expect(detectRedFlags({ hairLossDrugStillTaking: true })[0].type).toBe("RF6");
    expect(detectRedFlags(CLEAN)).toEqual([]);
  });

  it("RF7 fires for under-16 without guardian consent", () => {
    expect(detectRedFlags({ ageBand: "u16" })[0].type).toBe("RF7");
    expect(detectRedFlags({ ageBand: "u16", guardianConsent: true })).toEqual([]);
    expect(detectRedFlags({ ageBand: "16-22" })).toEqual([]);
  });

  it("clean signals raise nothing", () => {
    expect(detectRedFlags(CLEAN)).toEqual([]);
  });

  it("accumulates multiple flags at once", () => {
    const hits = detectRedFlags({
      suddenPatchyLoss: true,
      scalpPainSores: true,
      sheddingWithSystemic: true,
    });
    expect(hits.map((h) => h.type).sort()).toEqual(["RF1", "RF4", "RF5"]);
  });

  it("every RF code has a bilingual dictionary entry", () => {
    const codes = ["RF1", "RF2", "RF3", "RF4", "RF5", "RF6", "RF7"] as const;
    for (const code of codes) {
      const key = RED_FLAG_COPY_KEY[code]; // e.g. "redflags.RF1"
      const [section, leaf] = key.split(".");
      expect(((en as unknown) as Record<string, Record<string, string>>)[section][leaf].length).toBeGreaterThan(0);
    }
  });
});
