import { describe, expect, it } from "vitest";
import { ROOT_ORDER, scoreColor, scoreWordKey, weakestRoots } from "../lib/rootmap";
import type { RootKey } from "../api/types";

const ALL: RootKey[] = ["nutrition", "stress_sleep", "hormones", "scalp", "damage", "medical_family"];

function scoresOf(partial: Partial<Record<RootKey, number>>): Record<RootKey, number> {
  return Object.fromEntries(ALL.map((k) => [k, partial[k] ?? 50])) as Record<RootKey, number>;
}

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

describe("weakestRoots", () => {
  it("returns the two lowest-scoring roots in ROOT_ORDER", () => {
    expect(weakestRoots(scoresOf({ scalp: 20, nutrition: 30 }))).toEqual(["scalp", "nutrition"]);
  });

  it("handles ties deterministically by ROOT_ORDER", () => {
    const w = weakestRoots(scoresOf({}), 2);
    expect(w).toEqual([ROOT_ORDER[0], ROOT_ORDER[1]]);
  });
});
