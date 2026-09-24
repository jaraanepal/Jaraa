import { describe, expect, it } from "vitest";
import { ROOT_ORDER, rootDeltas, rootMapToDiagram, scoreColor, scoreWordKey } from "../lib/rootmap";
import type { RootKey } from "../api/types";

const ALL: RootKey[] = ["nutrition", "stress_sleep", "hormones", "scalp", "damage", "medical_family"];

function scoresOf(partial: Partial<Record<RootKey, number>>): Record<RootKey, number> {
  return Object.fromEntries(ALL.map((k) => [k, partial[k] ?? 50])) as Record<RootKey, number>;
}
const labels = Object.fromEntries(ALL.map((k) => [k, k])) as Record<RootKey, string>;
const words = { good: "good", fair: "fair", needsCare: "needs care" };

describe("rootMapToDiagram", () => {
  it("emits the six roots in fixed ROOT_ORDER", () => {
    const d = rootMapToDiagram(scoresOf({}), labels, words);
    expect(d.roots).toHaveLength(6);
    expect(d.roots.map((r) => r.root)).toEqual(ROOT_ORDER);
    expect(d.viewBox).toBe("0 0 400 330");
  });

  it("passes through localized labels and score words", () => {
    const d = rootMapToDiagram(scoresOf({ nutrition: 80, scalp: 20 }), labels, words);
    const byRoot = Object.fromEntries(d.roots.map((r) => [r.root, r]));
    expect(byRoot.nutrition.label).toBe("nutrition");
    expect(byRoot.nutrition.scoreWord).toBe("good");
    expect(byRoot.scalp.scoreWord).toBe("needs care");
  });

  it("clamps out-of-range scores to 0..100", () => {
    const d = rootMapToDiagram(scoresOf({ nutrition: 140, scalp: -20 }), labels, words);
    const byRoot = Object.fromEntries(d.roots.map((r) => [r.root, r]));
    expect(byRoot.nutrition.score).toBe(100);
    expect(byRoot.scalp.score).toBe(0);
  });

  it("flags the weakest roots with glow", () => {
    const d = rootMapToDiagram(scoresOf({ scalp: 10, damage: 10 }), labels, words);
    expect(d.weakest.sort()).toEqual(["damage", "scalp"]);
    const byRoot = Object.fromEntries(d.roots.map((r) => [r.root, r]));
    expect(byRoot.scalp.glow).toBe(true);
    expect(byRoot.damage.glow).toBe(true);
    expect(byRoot.nutrition.glow).toBe(false);
  });

  it("grows root length and stroke with score", () => {
    const d = rootMapToDiagram(scoresOf({ nutrition: 90, scalp: 10 }), labels, words);
    const byRoot = Object.fromEntries(d.roots.map((r) => [r.root, r]));
    expect(byRoot.nutrition.length).toBeGreaterThan(byRoot.scalp.length);
    expect(byRoot.nutrition.strokeWidth).toBeGreaterThan(byRoot.scalp.strokeWidth);
  });

  it("keeps every tip inside the viewBox", () => {
    const d = rootMapToDiagram(scoresOf({ nutrition: 100, stress_sleep: 100, hormones: 100, scalp: 100, damage: 100, medical_family: 100 }), labels, words);
    for (const r of d.roots) {
      expect(r.tipX).toBeGreaterThanOrEqual(0);
      expect(r.tipX).toBeLessThanOrEqual(400);
      expect(r.tipY).toBeGreaterThanOrEqual(0);
      expect(r.tipY).toBeLessThanOrEqual(330);
    }
  });
});

describe("scoreColor / scoreWordKey bands", () => {
  it("uses green >= 70, amber 40-69, red < 40", () => {
    expect(scoreColor(70)).toBe("#2d9d5f");
    expect(scoreColor(100)).toBe("#2d9d5f");
    expect(scoreColor(40)).toBe("#d97706");
    expect(scoreColor(69)).toBe("#d97706");
    expect(scoreColor(39)).toBe("#d64545");
    expect(scoreColor(0)).toBe("#d64545");
  });

  it("maps bands to good/fair/needsCare", () => {
    expect(scoreWordKey(80)).toBe("good");
    expect(scoreWordKey(50)).toBe("fair");
    expect(scoreWordKey(10)).toBe("needsCare");
  });
});

describe("rootDeltas", () => {
  it("computes per-root deltas and percentages", () => {
    const ds = rootDeltas(scoresOf({ nutrition: 60 }), scoresOf({ nutrition: 50 }));
    const n = ds.find((x) => x.root === "nutrition")!;
    expect(n.from).toBe(50);
    expect(n.to).toBe(60);
    expect(n.delta).toBe(10);
    expect(n.pct).toBe(20);
  });
});
