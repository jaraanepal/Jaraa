import { describe, expect, it } from "vitest";
import { kitPayload, parseIncluded, type KitFormValues } from "../lib/kitForm";

const BASE: KitFormValues = {
  name: "Root Repair Kit",
  description: "Shampoo + oil",
  priceNpr: "1499",
  category: "Hair oil",
  stock: "25",
  includedText: "Shampoo 250ml\nHair oil 100ml\n\n  ",
  usageInstructions: "Use twice a week",
  isActive: true,
};

describe("parseIncluded", () => {
  it("splits lines and drops blanks", () => {
    expect(parseIncluded("a\n\n b \r\n")).toEqual(["a", "b"]);
  });
  it("returns [] for empty text", () => {
    expect(parseIncluded("   ")).toEqual([]);
  });
});

describe("kitPayload", () => {
  it("builds a full payload from valid form values", () => {
    const p = kitPayload(BASE);
    expect("error" in p).toBe(false);
    if (!("error" in p)) {
      expect(p.name).toBe("Root Repair Kit");
      expect(p.price_npr).toBe(1499);
      expect(p.stock).toBe(25);
      expect(p.included).toEqual(["Shampoo 250ml", "Hair oil 100ml"]);
      expect(p.is_active).toBe(true);
    }
  });

  it("rejects a missing name", () => {
    const p = kitPayload({ ...BASE, name: "  " });
    expect(p).toEqual({ error: "adminKits.invalid" });
  });

  it("rejects a missing or non-positive price", () => {
    for (const priceNpr of ["", "0", "-5", "abc"]) {
      expect(kitPayload({ ...BASE, priceNpr })).toEqual({ error: "adminKits.invalid" });
    }
  });

  it("rounds price to whole rupees, omits optional blanks", () => {
    const p = kitPayload({ ...BASE, priceNpr: "1499.9", stock: "", category: "  ", description: "" });
    expect("error" in p).toBe(false);
    if (!("error" in p)) {
      expect(p.price_npr).toBe(1500);
      expect(p.stock).toBeUndefined();
      expect(p.category).toBeUndefined();
      expect(p.description).toBeUndefined();
    }
  });

  it("clamps negative stock to zero", () => {
    const p = kitPayload({ ...BASE, stock: "-3" });
    if (!("error" in p)) expect(p.stock).toBe(0);
    else throw new Error("unexpected error");
  });
});
