import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import ne from "../i18n/ne.json";

type Dict = Record<string, unknown>;

/**
 * Flatten a dictionary to dotted key paths. Array-valued leaves
 * (admin.flags.*, coach.cards, coach.nudges) expand as key[i].
 */
function flatKeys(obj: Dict, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        // Array of objects (coach.cards): recurse; array of strings: leaf.
        if (item !== null && typeof item === "object") out.push(...flatKeys(item as Dict, `${p}[${i}]`));
        else out.push(`${p}[${i}]`);
      });
    } else if (v !== null && typeof v === "object") {
      out.push(...flatKeys(v as Dict, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function get(obj: Dict, path: string): unknown {
  // Supports key[3] array indexing.
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== "object") return undefined;
    const m = part.match(/^(.+)\[(\d+)\]$/);
    if (m) {
      const arr = (acc as Dict)[m[1]];
      return Array.isArray(arr) ? arr[Number(m[2])] : undefined;
    }
    return (acc as Dict)[part];
  }, obj);
}

const enKeys = flatKeys(en as Dict);
const neKeys = flatKeys(ne as Dict);

describe("dictionary completeness", () => {
  it("en and ne have identical key sets (arrays expanded)", () => {
    const onlyEn = enKeys.filter((k) => !neKeys.includes(k));
    const onlyNe = neKeys.filter((k) => !enKeys.includes(k));
    expect(onlyEn, `missing in ne: ${onlyEn.join(", ")}`).toEqual([]);
    expect(onlyNe, `missing in en: ${onlyNe.join(", ")}`).toEqual([]);
  });

  it("every leaf is a non-empty string in both languages", () => {
    for (const k of enKeys) {
      const ev = get(en as Dict, k);
      const nv = get(ne as Dict, k);
      expect(typeof ev, `${k} (en) is not a string`).toBe("string");
      expect(typeof nv, `${k} (ne) is not a string`).toBe("string");
      expect((ev as string).trim().length, `${k} (en) is empty`).toBeGreaterThan(0);
      expect((nv as string).trim().length, `${k} (ne) is empty`).toBeGreaterThan(0);
    }
  });

  it("no unbalanced {{ }} template braces", () => {
    for (const k of enKeys) {
      for (const [lang, dict] of [["en", en], ["ne", ne]] as const) {
        const v = get(dict as Dict, k) as string;
        const opens = (v.match(/\{\{/g) || []).length;
        const closes = (v.match(/\}\}/g) || []).length;
        expect(opens, `${k} (${lang}): unbalanced {{`).toBe(closes);
      }
    }
  });

  it("no emoji characters in any UI string", () => {
    // The UI brief is absolute: NO EMOJIS anywhere in UI.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const k of enKeys) {
      for (const [lang, dict] of [["en", en], ["ne", ne]] as const) {
        const v = get(dict as Dict, k) as string;
        expect(v, `${k} (${lang}) contains an emoji`).not.toMatch(emoji);
      }
    }
  });

  it("keeps the verbatim required copy", () => {
    expect(get(en as Dict, "rootmap.footerNote")).toBe(
      "Jaraa organizes the evidence; your dermatologist makes the decisions.",
    );
    expect(get(en as Dict, "escape.button")).toBe("I'd rather tell my dermatologist");
    expect((get(ne as Dict, "rootmap.footerNote") as string).trim().length).toBeGreaterThan(0);
    expect((get(ne as Dict, "escape.button") as string).trim().length).toBeGreaterThan(0);
  });

  it("every interpolation placeholder has balanced single braces", () => {
    for (const k of enKeys) {
      for (const [lang, dict] of [["en", en], ["ne", ne]] as const) {
        const v = get(dict as Dict, k) as string;
        const opens = (v.match(/\{[a-zA-Z]/g) || []).length;
        const closes = (v.match(/\}/g) || []).length;
        expect(closes >= opens, `${k} (${lang}): unbalanced {var}`).toBe(true);
      }
    }
  });
});
