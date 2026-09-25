import { describe, expect, it } from "vitest";
import { isValidNpPhone, normalizeNpPhone } from "../lib/phone";

/** P-14: saved addresses store the phone as typed — checkout must normalize. */
describe("normalizeNpPhone", () => {
  it("passes through plain 10-digit numbers", () => {
    expect(normalizeNpPhone("9841234567")).toBe("9841234567");
  });
  it("strips +977 / 977 / 00977 country codes", () => {
    expect(normalizeNpPhone("+9779841234567")).toBe("9841234567");
    expect(normalizeNpPhone("9779841234567")).toBe("9841234567");
    expect(normalizeNpPhone("009779841234567")).toBe("9841234567");
  });
  it("removes spaces and dashes", () => {
    expect(normalizeNpPhone("+977-984 123 4567")).toBe("9841234567");
  });
  it("leaves short/invalid values untouched (still invalid)", () => {
    expect(normalizeNpPhone("98412")).toBe("98412");
    expect(isValidNpPhone("98412")).toBe(false);
  });
});

describe("isValidNpPhone", () => {
  it("accepts local and international formats of a valid mobile", () => {
    expect(isValidNpPhone("9841234567")).toBe(true);
    expect(isValidNpPhone("+977 9841234567")).toBe(true);
  });
  it("rejects non-mobile and malformed numbers", () => {
    expect(isValidNpPhone("014567890")).toBe(false);
    expect(isValidNpPhone("984123456")).toBe(false);
    expect(isValidNpPhone("")).toBe(false);
  });
});
