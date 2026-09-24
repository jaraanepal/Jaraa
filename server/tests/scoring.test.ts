// Scoring suite — transparent weighted 0–100 root scores.
import { describe, it, expect } from "vitest";
import { computeRootScores, weakestRoots, scoreColor, ROOTS } from "../src/modules/scan/scoring";
import { buildQualityPrompt, promptIsQualityOnly } from "../src/lib/gemini";

const empty = { pins: [], answers: {} };

describe("computeRootScores", () => {
  it("empty input scores every root at 100", () => {
    const s = computeRootScores(empty);
    for (const k of ROOTS) expect(s[k].score).toBe(100);
  });

  it("crash-diet pin + fatigue lower nutrition transparently", () => {
    const s = computeRootScores({
      pins: [{ event_type: "crash_diet", followup_answers: {} }],
      answers: { fatigue: true, diet: "veg" },
    });
    expect(s.nutrition.score).toBe(100 - 18 - 12);
    expect(s.nutrition.signals).toMatchObject({ crash_diet: true, fatigue: true, diet: "veg" });
    expect(s.scalp.score).toBe(100); // untouched roots stay 100
  });

  it("short sleep + high stress lower stress_sleep", () => {
    const s = computeRootScores({ pins: [], answers: { sleep_hours: 5, stress_level: 5 } });
    expect(s.stress_sleep.score).toBe(100 - 20 - 15);
    expect(s.stress_sleep.signals).toMatchObject({ sleep_hours: 5, stress_level: 5 });
  });

  it("daily heat + coloring lower damage", () => {
    const s = computeRootScores({ pins: [], answers: { heat_styling: "daily", coloring: true } });
    expect(s.damage.score).toBe(100 - 20 - 12);
  });

  it("family pattern + recent illness lower medical_family", () => {
    const recent = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const s = computeRootScores({
      pins: [{ event_type: "illness_fever", occurred_on: recent, followup_answers: {} }],
      answers: { family_pattern: true },
    });
    expect(s.medical_family.score).toBe(100 - 15 - 12);
  });

  it("scores clamp to 0–100", () => {
    const s = computeRootScores({
      pins: [{ event_type: "crash_diet", followup_answers: {} }],
      answers: { fatigue: true, recent_weight_change: true, sleep_hours: 1, stress_level: 5, heat_styling: "daily", coloring: true, tight_hairstyles: true },
    });
    for (const k of ROOTS) {
      expect(s[k].score).toBeGreaterThanOrEqual(0);
      expect(s[k].score).toBeLessThanOrEqual(100);
    }
  });
});

describe("weakestRoots / scoreColor", () => {
  it("orders weakest first", () => {
    const s = computeRootScores({ pins: [], answers: { sleep_hours: 4, stress_level: 5 } });
    const w = weakestRoots(s, 2);
    expect(w[0]).toBe("stress_sleep");
    expect(w).toHaveLength(2);
  });
  it("color thresholds pair with labels (never color-only)", () => {
    expect(scoreColor(90)).toBe("#16a34a");
    expect(scoreColor(60)).toBe("#d97706");
    expect(scoreColor(30)).toBe("#dc2626");
  });
});

describe("gemini quality prompt", () => {
  it("prompt is constrained to quality signals (no diagnostic terms)", () => {
    const p = buildQualityPrompt("hairline");
    expect(p).toContain("hairline");
    expect(promptIsQualityOnly(p)).toBe(true);
  });
});
