import { describe, expect, it } from "vitest";
import { checkPassword, EMAIL_RE, NEPAL_MOBILE } from "../lib/password";

// Client mirror of server/src/lib/password.ts — must enforce the same rules.
describe("client password check mirrors the server", () => {
  it("rejects short / missing-class passwords", () => {
    expect(checkPassword("Ab1").ok).toBe(false);
    expect(checkPassword("ABCDEF12").ok).toBe(false); // no lowercase
    expect(checkPassword("abcdef12").ok).toBe(false); // no uppercase
    expect(checkPassword("Abcdefgh").ok).toBe(false); // no digit
  });

  it("accepts a compliant password with score 4", () => {
    const c = checkPassword("Abcdef12");
    expect(c.ok).toBe(true);
    expect(c.score).toBe(4);
  });

  it("scores partial passwords for the meter", () => {
    expect(checkPassword("abcdefgh").score).toBe(2); // length + lower
    expect(checkPassword("abc").score).toBe(1); // lower only
  });
});

describe("identifier helpers", () => {
  it("accepts valid emails and 10-digit Nepal mobiles", () => {
    expect(EMAIL_RE.test("user@example.com")).toBe(true);
    expect(EMAIL_RE.test("not-an-email")).toBe(false);
    expect(NEPAL_MOBILE.test("9709571512")).toBe(true); // founder's number
    expect(NEPAL_MOBILE.test("12345")).toBe(false);
  });
});
