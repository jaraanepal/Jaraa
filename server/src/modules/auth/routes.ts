import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, conflict, unauthorized, clientIp, parseCookies } from "../../http";
import { requireAuth, type AuthedRequest } from "../../middleware/auth";
import { OtpError, normalizeNpPhone } from "../../lib/otp";
import { signAccess, issueRefresh, rotateRefresh, refreshCookieHeader, clearRefreshCookie, verifyPassword, hashPassword, hashToken, REFRESH_COOKIE } from "../../lib/jwt";
import {
  validatePasswordStrength, newResetToken, hashResetToken, timingSafeEqualHex,
  placeholderPhoneForEmail, EMAIL_RE,
} from "../../lib/password";
import { sendEmail, welcomeEmail } from "../../lib/brevo";
import { passwordResetEmail, passwordChangedEmail } from "./passwordEmails";
import { audit } from "../../lib/audit";
import type { Role } from "../../db/types";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function authRoutes(deps: Deps): Router {
  const r = Router();
  const { store, otp, jwtSecret, secureCookies } = deps;
  const maxAgeSec = 30 * 24 * 3600;
  // HMAC secret for password-reset tokens: purpose-separated from the JWT secret.
  const resetHmacSecret = process.env.OTP_HMAC_SECRET ?? jwtSecret;

  async function issueSession(res: import("express").Response, user: { id: string; role: "customer" | "doctor" | "admin" | "pharmacy" | "coach"; phone: string; email: string | null }) {
    const access = signAccess(user, jwtSecret);
    const refresh = await issueRefresh(store, user.id);
    res.setHeader("Set-Cookie", refreshCookieHeader(refresh.token, maxAgeSec, secureCookies));
    return {
      access_token: access.token, token_type: "Bearer", expires_in_sec: access.expiresInSec,
      user: { id: user.id, phone: user.phone, email: user.email, role: user.role },
    };
  }

  // POST /auth/otp/request
  r.post("/otp/request", asyncHandler(async (req, res) => {
    const { phone } = req.body ?? {};
    if (!phone || typeof phone !== "string") throw badRequest("Request failed validation.", { field: "phone" });
    try {
      const out = await otp.request(phone, clientIp(req));
      const body: Record<string, unknown> = { sent: true, expires_in_sec: out.expiresInSec };
      // DEV MODE ONLY — never in production
      if (out.devCode) body.dev_code = out.devCode;
      res.json(body);
    } catch (e) {
      if (e instanceof OtpError && e.code === "rate_limited") {
        res.status(429).json({
          code: "rate_limited",
          message: "Too many OTP requests. Try again shortly.",
          details: e.retryAfterSec ? { retry_after_sec: e.retryAfterSec } : undefined,
        });
        return;
      }
      if (e instanceof OtpError && e.code === "invalid_phone") throw badRequest("Request failed validation.", { field: "phone" });
      throw e;
    }
  }));

  // POST /auth/otp/verify
  r.post("/otp/verify", asyncHandler(async (req, res) => {
    const { phone, code, claim_guest_scan_id } = req.body ?? {};
    if (!phone || !code) throw badRequest("Request failed validation.", { field: !phone ? "phone" : "code" });
    const ok = await otp.verify(String(phone), String(code));
    if (!ok) {
      res.status(401).json({ code: "unauthorized", message: "Invalid or expired code." });
      return;
    }
    const e164 = normalizeNpPhone(String(phone));
    let user = await store.getUserByPhone(e164);
    let isNew = false;
    if (!user) {
      user = await store.createUser({ phone: e164, role: "customer" });
      isNew = true;
      if (user.email) {
        const w = welcomeEmail(null);
        sendEmail(user.email, w.subject, w.html).catch((e) => console.error("[brevo]", e));
      }
    }
    if (claim_guest_scan_id) {
      const scan = await store.getScan(String(claim_guest_scan_id));
      if (scan && !scan.user_id) {
        await store.updateScan(scan.id, { user_id: user.id, guest_token: null });
      }
    }
    const session = await issueSession(res, user);
    await audit(store, { actorId: user.id, action: "auth.otp_verify", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.json({ ...session, user: { ...session.user, is_new_user: isNew } });
  }));

  // POST /auth/signup — email OR phone + password (+ retype). Same flow for every role.
  r.post("/signup", asyncHandler(async (req, res) => {
    const { email, phone, password, password_confirm } = req.body ?? {};
    const hasEmail = typeof email === "string" && email.trim() !== "";
    const hasPhone = typeof phone === "string" && phone.trim() !== "";
    if (hasEmail === hasPhone) {
      throw badRequest("Provide exactly one of email or phone.", { field: !hasEmail && !hasPhone ? "email" : "identifier" });
    }
    let emailNorm: string | null = null;
    let phoneNorm: string;
    if (hasEmail) {
      emailNorm = String(email).trim().toLowerCase();
      if (!EMAIL_RE.test(emailNorm)) throw badRequest("Request failed validation.", { field: "email" });
      if (await store.getUserByEmail(emailNorm)) throw conflict("An account with this email already exists.");
      phoneNorm = placeholderPhoneForEmail(emailNorm);
    } else {
      try {
        phoneNorm = normalizeNpPhone(String(phone));
      } catch {
        throw badRequest("Request failed validation.", { field: "phone" });
      }
      if (await store.getUserByPhone(phoneNorm)) throw conflict("An account with this phone number already exists.");
    }
    const strength = validatePasswordStrength(typeof password === "string" ? password : "");
    if (!strength.ok) throw badRequest("Password does not meet the strength rules.", { field: "password", errors: strength.errors });
    if (password !== password_confirm) throw badRequest("Passwords do not match.", { field: "password_confirm" });

    const user = await store.createUser({
      phone: phoneNorm,
      email: emailNorm,
      role: "customer",
      passwordHash: await hashPassword(String(password)),
    });
    if (user.email) {
      const w = welcomeEmail(null);
      sendEmail(user.email, w.subject, w.html).catch((e) => console.error("[brevo]", e));
    }
    const session = await issueSession(res, user);
    await audit(store, { actorId: user.id, action: "auth.signup", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.status(201).json(session);
  }));

  // POST /auth/login — email OR phone + password (any user with a password).
  // Same flow for every role: the JWT role claim decides where the client routes.
  // NOTE: TOTP 2FA is a documented follow-up (see README); this issues a normal JWT today.
  r.post("/login", asyncHandler(async (req, res) => {
    const { email, phone, password } = req.body ?? {};
    if (!password) throw badRequest("Request failed validation.", { field: "password" });
    let user = null;
    if (typeof email === "string" && email.trim() !== "") {
      user = await store.getUserByEmail(String(email).trim().toLowerCase());
    } else if (typeof phone === "string" && phone.trim() !== "") {
      try {
        user = await store.getUserByPhone(normalizeNpPhone(String(phone)));
      } catch {
        user = null; // invalid phone format -> same generic 401, no enumeration
      }
    } else {
      throw badRequest("Request failed validation.", { field: "email" });
    }
    if (!user?.password_hash || !user.is_active) {
      res.status(401).json({ code: "unauthorized", message: "Invalid email/phone or password." });
      return;
    }
    if (!(await verifyPassword(String(password), user.password_hash))) {
      res.status(401).json({ code: "unauthorized", message: "Invalid email/phone or password." });
      return;
    }
    const session = await issueSession(res, user);
    await audit(store, { actorId: user.id, action: "auth.login", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.json(session);
  }));

  // POST /auth/forgot-password — always 200 (no user enumeration).
  // If the email belongs to an active account, a single-use 1-hour reset
  // token is stored (HMAC-hashed) and a Brevo reset link is emailed.
  r.post("/forgot-password", asyncHandler(async (req, res) => {
    const { email } = req.body ?? {};
    if (typeof email === "string" && EMAIL_RE.test(email.trim())) {
      const user = await store.getUserByEmail(email.trim().toLowerCase());
      if (user?.email && user.is_active) {
        const token = newResetToken();
        await store.savePasswordReset({
          token_hash: hashResetToken(token, resetHmacSecret),
          user_id: user.id,
          expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
        });
        const url = `${PUBLIC_BASE}/reset-password?token=${encodeURIComponent(token)}`;
        const m = passwordResetEmail(url);
        sendEmail(user.email, m.subject, m.html).catch((e) => console.error("[brevo]", e));
        await audit(store, { actorId: user.id, action: "auth.password_reset_request", entity: "user", entityId: user.id, ip: clientIp(req) });
      }
    }
    res.json({ ok: true });
  }));

  // POST /auth/reset-password — consume a reset token, set a new password.
  r.post("/reset-password", asyncHandler(async (req, res) => {
    const { token, password, password_confirm } = req.body ?? {};
    if (!token || typeof token !== "string") throw badRequest("Request failed validation.", { field: "token" });
    const presentedHash = hashResetToken(token, resetHmacSecret);
    const rec = await store.getPasswordReset(presentedHash);
    const usable =
      !!rec &&
      !rec.used_at &&
      new Date(rec.expires_at).getTime() >= Date.now() &&
      timingSafeEqualHex(rec.token_hash, presentedHash);
    if (!usable || !rec) {
      res.status(400).json({ code: "invalid_token", message: "This reset link is invalid or expired." });
      return;
    }
    const strength = validatePasswordStrength(typeof password === "string" ? password : "");
    if (!strength.ok) throw badRequest("Password does not meet the strength rules.", { field: "password", errors: strength.errors });
    if (password !== password_confirm) throw badRequest("Passwords do not match.", { field: "password_confirm" });
    const user = await store.getUserById(rec.user_id);
    if (!user || !user.is_active) {
      await store.deletePasswordReset(presentedHash);
      res.status(400).json({ code: "invalid_token", message: "This reset link is invalid or expired." });
      return;
    }
    await store.setUserPassword(user.id, await hashPassword(String(password)));
    await store.deletePasswordReset(presentedHash); // single-use
    if (user.email) {
      const m = passwordChangedEmail();
      sendEmail(user.email, m.subject, m.html).catch((e) => console.error("[brevo]", e));
    }
    await audit(store, { actorId: user.id, action: "auth.password_reset", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.json({ ok: true });
  }));

  // POST /auth/refresh — rotate the jaraa_rt cookie
  r.post("/refresh", asyncHandler(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const presented = cookies[REFRESH_COOKIE];
    if (!presented) throw unauthorized("Refresh token missing.");
    const out = await rotateRefresh(store, presented, jwtSecret);
    if (!out) {
      res.setHeader("Set-Cookie", clearRefreshCookie(secureCookies));
      throw unauthorized("Refresh token invalid or expired.");
    }
    res.setHeader("Set-Cookie", refreshCookieHeader(out.refresh.token, maxAgeSec, secureCookies));
    res.json({
      access_token: out.access.token, token_type: "Bearer", expires_in_sec: out.access.expiresInSec,
      user: { id: out.user.id, phone: out.user.phone, role: out.user.role },
    });
  }));

  // POST /auth/logout
  r.post("/logout", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[REFRESH_COOKIE]) await store.deleteRefreshToken(hashToken(cookies[REFRESH_COOKIE]));
    res.setHeader("Set-Cookie", clearRefreshCookie(secureCookies));
    res.json({ ok: true });
  }));

  void randomUUID;
  return r;
}
