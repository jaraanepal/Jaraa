// auth2 suite — P3/P5: password auth for every role.
// Covers: password strength validator, signup (email/phone, strength,
// match, duplicates), login (email/phone), forgot/reset password
// (single-use, expiry, no enumeration), admin staff creation RBAC.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { testDeps, tokenFor, auth } from "./helpers";
import { hashPassword } from "../src/lib/jwt";
import { validatePasswordStrength, newResetToken, hashResetToken } from "../src/lib/password";
import { normalizeNpPhone } from "../src/lib/otp";

const RESET_SECRET = "test-jwt-secret"; // helpers JWT_SECRET; routes fall back to it

describe("validatePasswordStrength", () => {
  it("rejects passwords shorter than 8 chars", () => {
    const r = validatePasswordStrength("Ab1");
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/8 characters/);
  });
  it("rejects missing lowercase", () => {
    expect(validatePasswordStrength("ABCDEF12").ok).toBe(false);
  });
  it("rejects missing uppercase", () => {
    expect(validatePasswordStrength("abcdef12").ok).toBe(false);
  });
  it("rejects missing number", () => {
    expect(validatePasswordStrength("Abcdefgh").ok).toBe(false);
  });
  it("accepts a compliant password", () => {
    const r = validatePasswordStrength("Abcdef12");
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("rejects empty / non-string input", () => {
    expect(validatePasswordStrength("").ok).toBe(false);
  });
});

describe("normalizeNpPhone — founder's number", () => {
  it('normalizes "9709571512" to "+9779709571512"', () => {
    expect(normalizeNpPhone("9709571512")).toBe("+9779709571512");
  });
});

function setup() {
  return testDeps();
}

describe("POST /auth/signup", () => {
  it("rejects weak passwords with 400", async () => {
    const { app } = setup();
    const r = await request(app).post("/api/v1/auth/signup")
      .send({ email: "a@example.com", password: "weak", password_confirm: "weak" });
    expect(r.status).toBe(400);
  });
  it("rejects mismatched passwords with 400", async () => {
    const { app } = setup();
    const r = await request(app).post("/api/v1/auth/signup")
      .send({ email: "a@example.com", password: "Abcdef12", password_confirm: "Abcdef13" });
    expect(r.status).toBe(400);
  });
  it("requires exactly one of email/phone", async () => {
    const { app } = setup();
    const both = await request(app).post("/api/v1/auth/signup")
      .send({ email: "a@example.com", phone: "9709571512", password: "Abcdef12", password_confirm: "Abcdef12" });
    expect(both.status).toBe(400);
    const neither = await request(app).post("/api/v1/auth/signup")
      .send({ password: "Abcdef12", password_confirm: "Abcdef12" });
    expect(neither.status).toBe(400);
  });
  it("rejects invalid email and invalid phone", async () => {
    const { app } = setup();
    const badEmail = await request(app).post("/api/v1/auth/signup")
      .send({ email: "not-an-email", password: "Abcdef12", password_confirm: "Abcdef12" });
    expect(badEmail.status).toBe(400);
    const badPhone = await request(app).post("/api/v1/auth/signup")
      .send({ phone: "12345", password: "Abcdef12", password_confirm: "Abcdef12" });
    expect(badPhone.status).toBe(400);
  });
  it("creates an email account and returns a session", async () => {
    const { app } = setup();
    const r = await request(app).post("/api/v1/auth/signup")
      .send({ email: "new@example.com", password: "Abcdef12", password_confirm: "Abcdef12" });
    expect(r.status).toBe(201);
    expect(r.body.access_token).toBeTruthy();
    expect(r.body.user.email).toBe("new@example.com");
    expect(r.body.user.role).toBe("customer");
  });
  it("creates a phone account with the founder's number format", async () => {
    const { app } = setup();
    const r = await request(app).post("/api/v1/auth/signup")
      .send({ phone: "9709571512", password: "Abcdef12", password_confirm: "Abcdef12" });
    expect(r.status).toBe(201);
    expect(r.body.user.phone).toBe("+9779709571512");
  });
  it("rejects duplicate email and duplicate phone with 409", async () => {
    const { app } = setup();
    const payload = { email: "dup@example.com", password: "Abcdef12", password_confirm: "Abcdef12" };
    expect((await request(app).post("/api/v1/auth/signup").send(payload)).status).toBe(201);
    expect((await request(app).post("/api/v1/auth/signup").send(payload)).status).toBe(409);
    const phonePayload = { phone: "9841234567", password: "Abcdef12", password_confirm: "Abcdef12" };
    expect((await request(app).post("/api/v1/auth/signup").send(phonePayload)).status).toBe(201);
    expect((await request(app).post("/api/v1/auth/signup").send(phonePayload)).status).toBe(409);
  });
});

describe("POST /auth/login (email or phone + password)", () => {
  async function withUser() {
    const { app, store } = setup();
    const email = "login@example.com";
    await request(app).post("/api/v1/auth/signup")
      .send({ email, password: "Abcdef12", password_confirm: "Abcdef12" });
    return { app, store, email };
  }
  it("logs in with email + password", async () => {
    const { app, email } = await withUser();
    const r = await request(app).post("/api/v1/auth/login").send({ email, password: "Abcdef12" });
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBeTruthy();
  });
  it("logs in with phone + password", async () => {
    const { app } = setup();
    await request(app).post("/api/v1/auth/signup")
      .send({ phone: "9851234567", password: "Abcdef12", password_confirm: "Abcdef12" });
    const r = await request(app).post("/api/v1/auth/login").send({ phone: "9851234567", password: "Abcdef12" });
    expect(r.status).toBe(200);
  });
  it("returns 401 for wrong password, unknown identifier, malformed phone", async () => {
    const { app, email } = await withUser();
    expect((await request(app).post("/api/v1/auth/login").send({ email, password: "Wrongpass1" })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/login").send({ email: "nobody@example.com", password: "Abcdef12" })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/login").send({ phone: "zzz", password: "Abcdef12" })).status).toBe(401);
  });
  it("returns 400 when the password is missing", async () => {
    const { app, email } = await withUser();
    expect((await request(app).post("/api/v1/auth/login").send({ email })).status).toBe(400);
  });
});

describe("forgot-password / reset-password", () => {
  it("always returns 200 (no user enumeration)", async () => {
    const { app } = setup();
    const unknown = await request(app).post("/api/v1/auth/forgot-password").send({ email: "ghost@example.com" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.ok).toBe(true);
    const malformed = await request(app).post("/api/v1/auth/forgot-password").send({ email: "not-an-email" });
    expect(malformed.status).toBe(200);
  });
  it("stores a token for a known account and resets the password", async () => {
    const { app, store } = setup();
    const email = "reset@example.com";
    const signup = await request(app).post("/api/v1/auth/signup")
      .send({ email, password: "Abcdef12", password_confirm: "Abcdef12" });
    const userId = signup.body.user.id as string;
    const fp = await request(app).post("/api/v1/auth/forgot-password").send({ email });
    expect(fp.status).toBe(200);
    expect(store.passwordResets.size).toBe(1);

    // Consume a token we mint directly (same HMAC the route uses).
    const token = newResetToken();
    await store.savePasswordReset({
      token_hash: hashResetToken(token, RESET_SECRET),
      user_id: userId,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    const rp = await request(app).post("/api/v1/auth/reset-password")
      .send({ token, password: "Newpass99", password_confirm: "Newpass99" });
    expect(rp.status).toBe(200);
    expect(store.passwordResets.size).toBe(1); // only the forgot-password row remains

    // New password works, old one does not.
    expect((await request(app).post("/api/v1/auth/login").send({ email, password: "Newpass99" })).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/login").send({ email, password: "Abcdef12" })).status).toBe(401);
  });
  it("rejects token reuse (single-use)", async () => {
    const { app, store } = setup();
    const signup = await request(app).post("/api/v1/auth/signup")
      .send({ email: "reuse@example.com", password: "Abcdef12", password_confirm: "Abcdef12" });
    const token = newResetToken();
    await store.savePasswordReset({
      token_hash: hashResetToken(token, RESET_SECRET),
      user_id: signup.body.user.id as string,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    const body = { token, password: "Newpass99", password_confirm: "Newpass99" };
    expect((await request(app).post("/api/v1/auth/reset-password").send(body)).status).toBe(200);
    const again = await request(app).post("/api/v1/auth/reset-password").send(body);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("invalid_token");
  });
  it("rejects expired tokens", async () => {
    const { app, store } = setup();
    const signup = await request(app).post("/api/v1/auth/signup")
      .send({ email: "expired@example.com", password: "Abcdef12", password_confirm: "Abcdef12" });
    const token = newResetToken();
    await store.savePasswordReset({
      token_hash: hashResetToken(token, RESET_SECRET),
      user_id: signup.body.user.id as string,
      expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
    });
    const r = await request(app).post("/api/v1/auth/reset-password")
      .send({ token, password: "Newpass99", password_confirm: "Newpass99" });
    expect(r.status).toBe(400);
  });
  it("rejects weak or mismatched new passwords", async () => {
    const { app, store } = setup();
    const signup = await request(app).post("/api/v1/auth/signup")
      .send({ email: "weaknew@example.com", password: "Abcdef12", password_confirm: "Abcdef12" });
    const mk = async () => {
      const token = newResetToken();
      await store.savePasswordReset({
        token_hash: hashResetToken(token, RESET_SECRET),
        user_id: signup.body.user.id as string,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      return token;
    };
    const weak = await request(app).post("/api/v1/auth/reset-password")
      .send({ token: await mk(), password: "short", password_confirm: "short" });
    expect(weak.status).toBe(400);
    const mismatch = await request(app).post("/api/v1/auth/reset-password")
      .send({ token: await mk(), password: "Newpass99", password_confirm: "Newpass98" });
    expect(mismatch.status).toBe(400);
  });
});

describe("POST /admin/staff (P3)", () => {
  async function adminSetup() {
    const { app, store } = setup();
    const admin = await store.createUser({
      phone: "+9779800000001",
      email: "boss@jaraa.test",
      role: "admin",
      passwordHash: await hashPassword("AdminPass1"),
    });
    const customer = await store.createUser({
      phone: "+9779800000002",
      email: "cust@jaraa.test",
      role: "customer",
      passwordHash: await hashPassword("Customer1"),
    });
    return { app, adminToken: tokenFor(admin), customerToken: tokenFor(customer) };
  }
  it("rejects unauthenticated (401) and non-admin (403)", async () => {
    const { app, customerToken } = await adminSetup();
    const body = { email: "doc@jaraa.test", password: "DoctorPass1", role: "doctor" };
    expect((await request(app).post("/api/v1/admin/staff").send(body)).status).toBe(401);
    expect((await request(app).post("/api/v1/admin/staff").set(auth(customerToken)).send(body)).status).toBe(403);
  });
  it("creates a doctor and returns no password hash", async () => {
    const { app, adminToken } = await adminSetup();
    const r = await request(app).post("/api/v1/admin/staff").set(auth(adminToken))
      .send({ email: "doc@jaraa.test", password: "DoctorPass1", role: "doctor" });
    expect(r.status).toBe(201);
    expect(r.body.email).toBe("doc@jaraa.test");
    expect(r.body.role).toBe("doctor");
    expect(r.body).not.toHaveProperty("password_hash");
    // The new doctor can sign in with email + password.
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: "doc@jaraa.test", password: "DoctorPass1" });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("doctor");
  });
  it("rejects weak passwords, bad roles, duplicates", async () => {
    const { app, adminToken } = await adminSetup();
    const h = { Authorization: `Bearer ${adminToken}` };
    expect((await request(app).post("/api/v1/admin/staff").set(h)
      .send({ email: "w@jaraa.test", password: "weak", role: "doctor" })).status).toBe(400);
    expect((await request(app).post("/api/v1/admin/staff").set(h)
      .send({ email: "w@jaraa.test", password: "DoctorPass1", role: "customer" })).status).toBe(400);
    expect((await request(app).post("/api/v1/admin/staff").set(h)
      .send({ email: "boss@jaraa.test", password: "DoctorPass1", role: "coach" })).status).toBe(409);
  });
});
