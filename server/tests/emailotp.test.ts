// Email OTP suite — mirrors the SMS OTP semantics (server/tests/otp.test.ts):
// 6-digit code, 5-min TTL, single-use, 3-strike lockout, rate limits.
// Brevo is mocked by UNSETTING the keys: no network is hit; the tests assert
// the console.log dev-adapter fallback instead.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { testDeps, auth } from "./helpers";
import { EmailOtpService, EmailOtpError, normalizeEmail, EMAIL_OTP_TTL_SEC } from "../src/lib/emailOtp";
import { MemoryStore } from "../src/db/memory";

const ENV_KEYS = ["BREVO_API_KEY", "BREVO_SENDER_EMAIL", "OTP_DEV_MODE", "SUPABASE_URL", "SUPABASE_ANON_KEY"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function serviceSetup(devMode = true) {
  const store = new MemoryStore();
  let t = 1_700_000_000_000;
  const svc = new EmailOtpService(store, "hmac-secret", () => t, devMode);
  return { store, svc, setT: (v: number) => { t = v; } };
}

function captureLogs() {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { console.log = orig; } };
}

describe("normalizeEmail", () => {
  it("1. lowercases and trims", () => {
    expect(normalizeEmail("  Test@Example.COM ")).toBe("test@example.com");
  });
  it("2. rejects malformed addresses", () => {
    for (const bad of ["not-an-email", "a@b", "@x.com", "a b@c.com", ""]) {
      expect(() => normalizeEmail(bad), bad).toThrow(EmailOtpError);
    }
  });
});

describe("EmailOtpService request/verify", () => {
  it("3. request returns a 300s TTL and dev code in dev mode", async () => {
    const { svc } = serviceSetup();
    const out = await svc.request("user@example.com");
    expect(out.expiresInSec).toBe(EMAIL_OTP_TTL_SEC);
    expect(out.devCode).toMatch(/^\d{6}$/);
  });

  it("4. verify with the correct code succeeds", async () => {
    const { svc } = serviceSetup();
    const { devCode } = await svc.request("user@example.com");
    expect(await svc.verify("user@example.com", devCode!)).toBe(true);
  });

  it("5. verify with a wrong code fails", async () => {
    const { svc } = serviceSetup();
    await svc.request("user@example.com");
    expect(await svc.verify("user@example.com", "000000")).toBe(false);
  });

  it("6. codes are single-use", async () => {
    const { svc } = serviceSetup();
    const { devCode } = await svc.request("user@example.com");
    expect(await svc.verify("USER@example.com", devCode!)).toBe(true); // case-insensitive key
    expect(await svc.verify("user@example.com", devCode!)).toBe(false);
  });

  it("7. three wrong attempts lock the code out", async () => {
    const { svc } = serviceSetup();
    const { devCode } = await svc.request("user@example.com");
    expect(await svc.verify("user@example.com", "111111")).toBe(false);
    expect(await svc.verify("user@example.com", "222222")).toBe(false);
    expect(await svc.verify("user@example.com", "333333")).toBe(false);
    expect(await svc.verify("user@example.com", devCode!)).toBe(false);
  });

  it("8. expired codes fail (5-min TTL)", async () => {
    const { svc, setT } = serviceSetup();
    const { devCode } = await svc.request("user@example.com");
    setT(1_700_000_000_000 + 5 * 60 * 1000 + 1000);
    expect(await svc.verify("user@example.com", devCode!)).toBe(false);
  });

  it("9. email keys are namespaced — never collide with phone OTP keys", async () => {
    const { store, svc } = serviceSetup();
    const { devCode } = await svc.request("user@example.com");
    // a phone-style key in the shared otp_codes table is untouched
    expect(await store.otpGet("user@example.com")).toBeNull();
    expect(await store.otpGet("email:user@example.com")).not.toBeNull();
    expect(await svc.verify("user@example.com", devCode!)).toBe(true);
  });

  it("10. rate limit: 4th request within 10 minutes is rejected", async () => {
    const { svc } = serviceSetup();
    await svc.request("user@example.com");
    await svc.request("user@example.com");
    await svc.request("user@example.com");
    await expect(svc.request("user@example.com")).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("11. dev adapter: Brevo unset -> code goes to console.log, no network", async () => {
    const { lines, restore } = captureLogs();
    try {
      const { svc } = serviceSetup(true); // devMode so we know the code
      const out = await svc.request("devonly@example.com");
      expect(out.delivery).toBe("log");
      const logged = lines.find((l) => l.includes("[email-otp]") && l.includes("devonly@example.com"));
      expect(logged).toBeTruthy();
      // the code itself is in the log so a dev can sign in locally without Brevo
      expect(logged).toContain(out.devCode!);
    } finally {
      restore();
    }
  });
});

describe("POST /auth/email-otp/*", () => {
  function apiSetup() {
    process.env.OTP_DEV_MODE = "true";
    return testDeps();
  }

  it("12. request -> verify happy path issues an app session", async () => {
    const { app } = apiSetup();
    const r1 = await request(app).post("/api/v1/auth/email-otp/request").send({ email: "New@Example.com" });
    expect(r1.status).toBe(200);
    expect(r1.body.sent).toBe(true);
    expect(r1.body.expires_in_sec).toBe(EMAIL_OTP_TTL_SEC);
    expect(r1.body.delivery).toBe("log"); // Brevo unset in tests
    expect(r1.body.dev_code).toMatch(/^\d{6}$/);

    const r2 = await request(app).post("/api/v1/auth/email-otp/verify")
      .send({ email: "new@example.com", code: r1.body.dev_code });
    expect(r2.status).toBe(200);
    expect(r2.body.access_token).toBeTruthy();
    expect(r2.body.user.email).toBe("new@example.com");
    expect(r2.body.user.role).toBe("customer");
    expect(r2.body.user.is_new_user).toBe(true);
    expect(r2.headers["set-cookie"]?.join(";")).toContain("jaraa_rt=");

    // the issued session actually works
    const me = await request(app).get("/api/v1/me/profile").set(auth(r2.body.access_token));
    expect(me.status).toBe(200);
  });

  it("13. verify is single-use: the same code fails twice", async () => {
    const { app } = apiSetup();
    const r1 = await request(app).post("/api/v1/auth/email-otp/request").send({ email: "once@example.com" });
    const good = await request(app).post("/api/v1/auth/email-otp/verify")
      .send({ email: "once@example.com", code: r1.body.dev_code });
    expect(good.status).toBe(200);
    const again = await request(app).post("/api/v1/auth/email-otp/verify")
      .send({ email: "once@example.com", code: r1.body.dev_code });
    expect(again.status).toBe(401);
  });

  it("14. wrong code -> 401", async () => {
    const { app } = apiSetup();
    await request(app).post("/api/v1/auth/email-otp/request").send({ email: "wrong@example.com" });
    const r = await request(app).post("/api/v1/auth/email-otp/verify")
      .send({ email: "wrong@example.com", code: "000000" });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("unauthorized");
  });

  it("15. malformed email -> 400", async () => {
    const { app } = apiSetup();
    const r = await request(app).post("/api/v1/auth/email-otp/request").send({ email: "not-an-email" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("validation_error");
  });

  it("16. rate limit: 4th request in 10 min -> 429", async () => {
    const { app } = apiSetup();
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post("/api/v1/auth/email-otp/request").send({ email: "spam@example.com" });
      expect(r.status).toBe(200);
    }
    const r = await request(app).post("/api/v1/auth/email-otp/request").send({ email: "spam@example.com" });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("rate_limited");
  });

  it("17. existing email user signs in without creating a duplicate", async () => {
    const { app, store } = apiSetup();
    await store.createUser({ phone: "+9779841111111", email: "known@example.com", role: "customer" });
    const r1 = await request(app).post("/api/v1/auth/email-otp/request").send({ email: "known@example.com" });
    const r2 = await request(app).post("/api/v1/auth/email-otp/verify")
      .send({ email: "known@example.com", code: r1.body.dev_code });
    expect(r2.status).toBe(200);
    expect(r2.body.user.is_new_user).toBe(false);
    expect(r2.body.user.id).toBe((await store.getUserByEmail("known@example.com"))!.id);
  });
});

describe("POST /auth/google", () => {
  function mockFetch(response: { ok: boolean; body?: unknown }) {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: response.ok,
      json: async () => response.body ?? {},
    })) as typeof fetch;
    return () => { globalThis.fetch = orig; };
  }

  it("18. SUPABASE_URL unset -> 501 with a clear message", async () => {
    const { app } = testDeps();
    const r = await request(app).post("/api/v1/auth/google").send({ access_token: "whatever" });
    expect(r.status).toBe(501);
    expect(r.body.code).toBe("not_configured");
  });

  it("19. valid Google token -> app session, user created, profile name saved", async () => {
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    const { app, store } = testDeps();
    const restore = mockFetch({
      ok: true,
      body: { email: "GUser@Example.com", user_metadata: { full_name: "G User" } },
    });
    try {
      const r = await request(app).post("/api/v1/auth/google").send({ access_token: "google-at" });
      expect(r.status).toBe(200);
      expect(r.body.access_token).toBeTruthy();
      expect(r.body.user.email).toBe("guser@example.com");
      expect(r.body.user.role).toBe("customer");
      expect(r.body.user.is_new_user).toBe(true);
      const profile = await store.getProfile(r.body.user.id);
      expect(profile?.name).toBe("G User");
      // repeat sign-in finds the same user
      const r2 = await request(app).post("/api/v1/auth/google").send({ access_token: "google-at" });
      expect(r2.body.user.is_new_user).toBe(false);
      expect(r2.body.user.id).toBe(r.body.user.id);
    } finally {
      restore();
    }
  });

  it("20. invalid Google token -> 401", async () => {
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    const { app } = testDeps();
    const restore = mockFetch({ ok: false });
    try {
      const r = await request(app).post("/api/v1/auth/google").send({ access_token: "bogus" });
      expect(r.status).toBe(401);
    } finally {
      restore();
    }
  });

  it("21. missing access_token -> 400; token without email -> 400", async () => {
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    const { app } = testDeps();
    const r1 = await request(app).post("/api/v1/auth/google").send({});
    expect(r1.status).toBe(400);
    const restore = mockFetch({ ok: true, body: { email: null } });
    try {
      const r2 = await request(app).post("/api/v1/auth/google").send({ access_token: "x" });
      expect(r2.status).toBe(400);
    } finally {
      restore();
    }
  });
});
