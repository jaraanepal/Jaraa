import { describe, expect, it } from "vitest";
import {
  buildProblemCards, buildStoryEvents, buildVerdict,
  interviewRedFlag, interviewToAnswers, interviewToPins,
  nextQuestion, storyBits, NOT_DIAGNOSIS,
  type IQAnswers, type StoryInput,
} from "../lib/hairstory";
import type { RootKey } from "../api/types";

const ALL: RootKey[] = ["nutrition", "stress_sleep", "hormones", "scalp", "damage", "medical_family"];
const scoresOf = (p: Partial<Record<RootKey, number>>) =>
  Object.fromEntries(ALL.map((k) => [k, p[k] ?? 60])) as Record<RootKey, number>;
const sig = (p: Partial<Record<RootKey, Record<string, unknown>>> = {}) =>
  Object.fromEntries(ALL.map((k) => [k, p[k] ?? {}])) as Record<RootKey, Record<string, unknown>>;

function input(p: Partial<StoryInput> = {}): StoryInput {
  return {
    pins: [],
    signals: sig(),
    weakest: [],
    scores: scoresOf({}),
    ...p,
  };
}

describe("nextQuestion — interview order + branching", () => {
  it("starts with onset", () => {
    expect(nextQuestion({})?.id).toBe("onset");
  });

  it("asks events second, then branches into illness follow-ups", () => {
    const a: IQAnswers = { onset: "m3" };
    expect(nextQuestion(a)?.id).toBe("events");
    const b: IQAnswers = { ...a, events: ["illness"] };
    expect(nextQuestion(b)?.id).toBe("ill_kind");
    const c: IQAnswers = { ...b, ill_kind: "fever" };
    expect(nextQuestion(c)?.id).toBe("ill_month");
    const d: IQAnswers = { ...c, ill_month: "2026-03-01" };
    expect(nextQuestion(d)?.id).toBe("bothers");
  });

  it("branches into sleep when stress is picked", () => {
    expect(nextQuestion({ onset: "m1", events: ["stress"] })?.id).toBe("sleep");
    expect(nextQuestion({ onset: "m1", events: ["stress"], sleep: "lt5" })?.id).toBe("bothers");
  });

  it("branches into medicine name + still-taking", () => {
    const a: IQAnswers = { onset: "m1", events: ["medicine"] };
    expect(nextQuestion(a)?.id).toBe("med_name");
    expect(nextQuestion({ ...a, med_name: "__skip__" })?.id).toBe("med_still");
  });

  it("branches into childbirth timing", () => {
    expect(nextQuestion({ onset: "m1", events: ["childbirth"] })?.id).toBe("birth_when");
  });

  it("skips all branches when nothing happened", () => {
    const a: IQAnswers = { onset: "m1", events: ["none"] };
    expect(nextQuestion(a)?.id).toBe("bothers");
  });

  it("asks periods only for female profiles", () => {
    const base: IQAnswers = { onset: "m1", events: ["none"], bothers: ["nothing"], area: "crown" };
    expect(nextQuestion(base, { gender: "female" })?.id).toBe("periods");
    expect(nextQuestion(base, { gender: "male" })?.id).toBe("heat");
    expect(nextQuestion(base, {})?.id).toBe("heat");
  });

  it("ends after the optional note", () => {
    const done: IQAnswers = {
      onset: "m1", events: ["none"], bothers: ["nothing"], area: "crown",
      heat: "never", color: "no", family: "no", note: "__skip__",
    };
    expect(nextQuestion(done, { gender: "male" })).toBeNull();
  });
});

describe("interviewRedFlag", () => {
  it("detects RF4 for pain/sores", () => {
    expect(interviewRedFlag({ bothers: ["pain"] })).toBe("RF4");
  });
  it("detects RF1 for bald patches", () => {
    expect(interviewRedFlag({ bothers: ["patches"] })).toBe("RF1");
  });
  it("returns null for routine answers", () => {
    expect(interviewRedFlag({ bothers: ["itching", "nothing"] })).toBeNull();
    expect(interviewRedFlag({})).toBeNull();
  });
});

describe("interviewToPins / interviewToAnswers", () => {
  const a: IQAnswers = {
    onset: "m3", events: ["illness", "stress", "diet", "medicine"],
    ill_kind: "fever", ill_month: "2026-06-01",
    sleep: "lt5", diet_less: "often", med_name: "X", med_still: "yes",
    bothers: ["itching", "flakes"], area: "crown", heat: "often", color: "yes",
    family: "yes", periods: "irregular",
  };

  it("creates one pin per answered branch, never duplicates a type", () => {
    const pins = interviewToPins(a);
    const types = pins.map((p) => p.event_type);
    expect(types).toContain("shedding_onset");
    expect(types).toContain("illness_fever");
    expect(types).toContain("stress_period");
    expect(types).toContain("crash_diet");
    expect(types).toContain("medication_change");
    expect(new Set(types).size).toBe(types.length);
  });

  it("maps answers to the server answer blob the scorer reads", () => {
    const out = interviewToAnswers(a);
    expect(out.sleep_hours).toBe(4);
    expect(out.itching).toBe(true);
    expect(out.flaking).toBe(true);
    expect(out.heat_styling).toBe("daily");
    expect(out.coloring).toBe(true);
    expect(out.family_pattern).toBe(true);
    expect(out.irregular_periods).toBe(true);
    expect(out.recent_weight_change).toBe(true);
  });

  it("produces no pins and no answers for an all-skipped interview", () => {
    const skip: IQAnswers = { onset: "__skip__", events: [], bothers: [], note: "__skip__" };
    expect(interviewToPins(skip)).toEqual([]);
    expect(interviewToAnswers(skip)).toEqual({});
  });
});

describe("storyBits — story-so-far strip", () => {
  it("builds readable bits in all three scripts", () => {
    const bits = storyBits({
      onset: "m3", events: ["illness", "stress"],
      ill_kind: "fever", ill_month: "2026-06-01", sleep: "lt5",
    });
    expect(bits.length).toBe(3);
    for (const b of bits) {
      expect(b.text.rn.length).toBeGreaterThan(0);
      expect(b.text.en.length).toBeGreaterThan(0);
      expect(b.text.ne.length).toBeGreaterThan(0);
    }
    expect(bits[0].text.rn).toContain("2-3 mahina");
  });

  it("ignores skipped questions", () => {
    expect(storyBits({ onset: "__skip__", events: [] })).toEqual([]);
  });
});

describe("buildVerdict", () => {
  it("is strong below 40, moderate below 70, mild otherwise", () => {
    expect(buildVerdict(scoresOf({ scalp: 20 })).level).toBe("strong");
    expect(buildVerdict(scoresOf({ scalp: 55 })).level).toBe("moderate");
    const allGood = Object.fromEntries(ALL.map((k) => [k, 80])) as Record<RootKey, number>;
    expect(buildVerdict(allGood).level).toBe("mild");
  });

  it("speaks in all three scripts without a diagnosis", () => {
    const v = buildVerdict(scoresOf({ scalp: 20 }));
    expect(v.text.rn).toContain("sudhar huna sakchha");
    expect(v.text.en.length).toBeGreaterThan(0);
    expect(v.text.ne.length).toBeGreaterThan(0);
    expect(v.text.en.toLowerCase()).not.toContain("diagnos");
  });

  it("keeps the dermatologist boundary in every script", () => {
    expect(NOT_DIAGNOSIS.rn).toContain("dermatologist");
    expect(NOT_DIAGNOSIS.en).toContain("dermatologist");
    expect(NOT_DIAGNOSIS.ne.length).toBeGreaterThan(0);
  });
});

describe("buildProblemCards", () => {
  it("builds an illness card naming the month, from the user's own pin", () => {
    const cards = buildProblemCards(input({
      pins: [{
        event_type: "illness_fever", occurred_on: "2026-06-01",
        followup_answers: { ill_kind: "fever", ill_when: "36" },
      }],
      weakest: ["nutrition"],
    }));
    const ill = cards.find((c) => c.id === "illness")!;
    expect(ill).toBeDefined();
    expect(ill.title.en).toContain("June");
    expect(ill.reflection.en).toContain("You told us");
    expect(ill.education.en.length).toBeGreaterThan(0);
  });

  it("builds a sleep card from low sleep hours", () => {
    const cards = buildProblemCards(input({
      signals: sig({ stress_sleep: { sleep_hours: 4 } }),
      weakest: ["stress_sleep"],
    }));
    expect(cards.some((c) => c.id === "sleep")).toBe(true);
  });

  it("builds a nutrition card from a crash-diet pin", () => {
    const cards = buildProblemCards(input({
      pins: [{ event_type: "crash_diet", occurred_on: "2026-05-01", followup_answers: {} }],
      weakest: ["nutrition"],
    }));
    expect(cards.some((c) => c.id === "nutrition")).toBe(true);
  });

  it("returns at most three cards", () => {
    const cards = buildProblemCards(input({
      pins: [
        { event_type: "illness_fever", occurred_on: "2026-06-01", followup_answers: { ill_kind: "fever" } },
        { event_type: "crash_diet", occurred_on: "2026-05-01", followup_answers: {} },
      ],
      signals: sig({
        stress_sleep: { sleep_hours: 4 },
        scalp: { itching: true },
        damage: { coloring: true },
        medical_family: { family_pattern: true },
      }),
      weakest: ["stress_sleep"],
    }));
    expect(cards.length).toBeLessThanOrEqual(3);
  });

  it("falls back to an honest general card when nothing fires", () => {
    const cards = buildProblemCards(input({ weakest: ["scalp"] }));
    expect(cards.length).toBe(1);
    expect(cards[0].id).toBe("general");
  });

  it("every card has all three scripts", () => {
    const cards = buildProblemCards(input({
      pins: [{ event_type: "illness_fever", occurred_on: "2026-06-01", followup_answers: { ill_kind: "covid" } }],
      signals: sig({ stress_sleep: { sleep_hours: 5 } }),
      weakest: ["nutrition"],
    }));
    for (const c of cards) {
      for (const f of [c.title, c.reflection, c.education]) {
        expect(f.rn.length).toBeGreaterThan(0);
        expect(f.en.length).toBeGreaterThan(0);
        expect(f.ne.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildStoryEvents", () => {
  it("sorts events oldest-first and labels them", () => {
    const evs = buildStoryEvents(input({
      pins: [
        { event_type: "shedding_onset", occurred_on: "2026-08-01", followup_answers: {} },
        { event_type: "illness_fever", occurred_on: "2026-05-01", followup_answers: { ill_kind: "fever" } },
      ],
    }));
    expect(evs[0].key).toContain("illness_fever");
    expect(evs[1].key).toContain("shedding_onset");
    expect(evs[0].label.rn.length).toBeGreaterThan(0);
    expect(evs[0].detail?.en).toContain("fever");
  });
});
