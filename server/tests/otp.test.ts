// OTP suite — ports the 15 spike behaviors to the DB-backed OtpService
// (otp_codes table via the memory store here; Supabase impl mirrors it).
import { describe, it, expect } from "vitest";
import { OtpService, OtpError, normalizeNpPhone, OTP_TTL_SEC } from "../src/lib/otp";
import { MemoryStore } from "../src/db/memory";

class SpySms {
  name = "spy";
  sent: { to: string; msg: string }[] = [];
  async sendSms(toE164: string, message: string) {
    this.sent.push({ to: toE164, msg: message });
    return { providerRef: `spy-${this.sent.length}` };
  }
}

function setup() {
  const store = new MemoryStore();
  const sms = new SpySms();
  let t = 1_700_000_000_000;
  const now = () => t;
  const svc = new OtpService(sms, store, "hmac-secret", now, false);
  return { store, sms, svc, setT: (v: number) => { t = v; }, getT: () => t };
}

describe("normalizeNpPhone", () => {
  it("1. passes E.164 Nepal numbers through unchanged", () => {
    expect(normalizeNpPhone("+9779841234567")).toBe("+9779841234567");
  });
  it("2. normalizes a bare 10-digit mobile to E.164", () => {
    expect(normalizeNpPhone("9841234567")).toBe("+9779841234567");
  });
  it("3. strips a leading trunk 0", () => {
    expect(normalizeNpPhone("09841234567")).toBe("+9779841234567");
  });
  it("4. strips a 977 country prefix without +", () => {
    expect(normalizeNpPhone("9779851234567")).toBe("+9779851234567");
  });
  it("5. rejects too-short numbers", () => {
    expect(() => normalizeNpPhone("98412345")).toThrow(OtpError);
  });
  it("6. rejects non-mobile prefixes (e.g. 951…)", () => {
    expect(() => normalizeNpPhone("+9779512345678")).toThrow(OtpError);
  });
});

describe("OtpService request/verify", () => {
  it("7. request sends an SMS and returns a 300s TTL", async () => {
    const { svc, sms } = setup();
    const out = await svc.request("9841234567");
    expect(out.expiresInSec).toBe(OTP_TTL_SEC);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].to).toBe("+9779841234567");
    expect(sms.sent[0].msg).toMatch(/Jaraa: your code is \d{6}/);
  });

  it("8. verify with the correct code succeeds (dev capture via store)", async () => {
    const { svc, store } = setup();
    const dev = new OtpService(new SpySms(), store, "hmac-secret", () => 1_700_000_000_000, true);
    const { devCode } = await dev.request("9841234567");
    expect(await dev.verify("9841234567", devCode!)).toBe(true);
    void svc;
  });

  it("9. verify with a wrong code fails", async () => {
    const { svc } = setup();
    await svc.request("9841234567");
    expect(await svc.verify("9841234567", "000000")).toBe(false);
  });

  it("10. codes are single-use: a second verify of the right code fails", async () => {
    const { store } = setup();
    const dev = new OtpService(new SpySms(), store, "hmac-secret", () => 1_700_000_000_000, true);
    const { devCode } = await dev.request("9841234567");
    expect(await dev.verify("9841234567", devCode!)).toBe(true);
    expect(await dev.verify("9841234567", devCode!)).toBe(false);
  });

  it("11. three wrong attempts lock the code out (3-strike lockout)", async () => {
    const { store } = setup();
    const dev = new OtpService(new SpySms(), store, "hmac-secret", () => 1_700_000_000_000, true);
    const { devCode } = await dev.request("9841234567");
    expect(await dev.verify("9841234567", "111111")).toBe(false);
    expect(await dev.verify("9841234567", "222222")).toBe(false);
    expect(await dev.verify("9841234567", "333333")).toBe(false);
    // even the right code now fails
    expect(await dev.verify("9841234567", devCode!)).toBe(false);
  });

  it("12. expired codes fail (5-min TTL)", async () => {
    const { store, setT } = setup();
    let t = 1_700_000_000_000;
    const dev = new OtpService(new SpySms(), store, "hmac-secret", () => t, true);
    const { devCode } = await dev.request("9841234567");
    t += 5 * 60 * 1000 + 1000; // past TTL
    setT(t);
    expect(await dev.verify("9841234567", devCode!)).toBe(false);
  });

  it("13. re-request replaces the old code", async () => {
    const { store } = setup();
    const dev = new OtpService(new SpySms(), store, "hmac-secret", () => 1_700_000_000_000, true);
    const first = await dev.request("9841234567");
    const second = await dev.request("9841234567");
    expect(await dev.verify("9841234567", first.devCode!)).toBe(false);
    expect(await dev.verify("9841234567", second.devCode!)).toBe(true);
  });

  it("14. rate limit: 4th request within 10 minutes is rejected", async () => {
    const { svc } = setup();
    await svc.request("9841234567");
    await svc.request("9841234567");
    await svc.request("9841234567");
    await expect(svc.request("9841234567")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("15. rate window resets after 10 minutes", async () => {
    const { svc, setT, getT } = setup();
    await svc.request("9841234567");
    await svc.request("9841234567");
    await svc.request("9841234567");
    setT(getT() + 10 * 60 * 1000 + 1);
    const out = await svc.request("9841234567");
    expect(out.expiresInSec).toBe(OTP_TTL_SEC);
  });
});
