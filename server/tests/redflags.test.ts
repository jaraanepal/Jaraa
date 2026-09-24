// Red-flag suite — exactly one unit test per rule (RF1–RF7).
import { describe, it, expect } from "vitest";
import { evaluateRedFlags, type FlagInput } from "../src/modules/scan/redflags";

const types = (i: FlagInput) => evaluateRedFlags(i).map((f) => f.flag_type);

describe("red flags RF1–RF7", () => {
  it("RF1: sudden patchy shedding -> flag; gradual non-patchy -> no flag", () => {
    const raised = types({
      pin: { event_type: "shedding_onset", followup_answers: { sudden_or_gradual: "sudden", patchy: true } },
    });
    expect(raised).toContain("RF1");
    expect(types({
      pin: { event_type: "shedding_onset", followup_answers: { sudden_or_gradual: "gradual", patchy: false } },
    })).not.toContain("RF1");
  });

  it("RF2: thyroid medication or symptoms -> flag", () => {
    expect(types({ answers: { thyroid_med: true } })).toContain("RF2");
    expect(types({ answers: { thyroid_symptoms: true } })).toContain("RF2");
    expect(types({ answers: {} })).not.toContain("RF2");
  });

  it("RF3: irregular periods + acne/excess hair, or diagnosed PCOS -> flag", () => {
    expect(types({ answers: { irregular_periods: true, acne: true } })).toContain("RF3");
    expect(types({ answers: { pcos_diagnosed: true } })).toContain("RF3");
    // irregular periods alone is not enough
    expect(types({ answers: { irregular_periods: true } })).not.toContain("RF3");
  });

  it("RF4: scalp pain / sores / burning / pus -> flag", () => {
    expect(types({ answers: { scalp_pain: true } })).toContain("RF4");
    expect(types({ answers: { scalp_pus: true } })).toContain("RF4");
    expect(types({ answers: { itching: true } })).not.toContain("RF4");
  });

  it("RF5: shedding with systemic symptoms -> flag", () => {
    expect(types({ answers: { fever: true } })).toContain("RF5");
    expect(types({ answers: { rapid_weight_loss: true } })).toContain("RF5");
    expect(types({ answers: { extreme_fatigue: true } })).toContain("RF5");
    expect(types({ answers: { fatigue: true } })).not.toContain("RF5");
  });

  it("RF6: hair-loss drug + still taking -> flag; stopped -> no flag", () => {
    const pin = (still: boolean) => ({
      pin: {
        event_type: "medication_change",
        followup_answers: { medicine: "Isotretinoin 20mg", still_taking: still },
      },
    });
    expect(types(pin(true))).toContain("RF6");
    expect(types(pin(false))).not.toContain("RF6");
    expect(types({
      pin: { event_type: "medication_change", followup_answers: { medicine: "Vitamin D", still_taking: true } },
    })).not.toContain("RF6");
  });

  it("RF7: under-16 -> guardian-flow flag", () => {
    expect(types({ profile: { is_minor: true } })).toContain("RF7");
    expect(types({ answers: { age_under_16: true } })).toContain("RF7");
    expect(types({ profile: { age_band: "16-22" } })).not.toContain("RF7");
  });
});
