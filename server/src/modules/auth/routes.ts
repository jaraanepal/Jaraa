import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, unauthorized, clientIp, parseCookies } from "../../http";
import { requireAuth, type AuthedRequest } from "../../middleware/auth";
import { OtpError, normalizeNpPhone } from "../../lib/otp";
import { signAccess, issueRefresh, rotateRefresh, refreshCookieHeader, clearRefreshCookie, verifyPassword, hashToken, REFRESH_COOKIE } from "../../lib/jwt";
import { sendEmail, welcomeEmail } from "../../lib/brevo";
import { audit } from "../../lib/audit";

export function authRoutes(deps: Deps): Router {
  const r = Router();
  const { store, otp, jwtSecret, secureCookies } = deps;
  const maxAgeSec = 30 * 24 * 3600;

  async function issueSession(res: import("express").Response, user: { id: string; role: "customer" | "doctor" | "admin" | "pharmacy" | "coach"; phone: string }) {
    const access = signAccess(user, jwtSecret);
    const refresh = await issueRefresh(store, user.id);
    res.setHeader("Set-Cookie", refreshCookieHeader(refresh.token, maxAgeSec, secureCookies));
    return {
      access_token: access.token, token_type: "Bearer", expires_in_sec: access.expiresInSec,
      user: { id: user.id, phone: user.phone, role: user.role },
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

  // POST /auth/login — email + password (doctor/admin/staff; any user with a password).
  // NOTE: TOTP 2FA is a documented follow-up (see README); this issues a normal JWT today.
  r.post("/login", asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) throw badRequest("Request failed validation.", { field: !email ? "email" : "password" });
    const user = await store.getUserByEmail(String(email));
    if (!user?.password_hash || !user.is_active) {
      res.status(401).json({ code: "unauthorized", message: "Invalid email or password." });
      return;
    }
    if (!(await verifyPassword(String(password), user.password_hash))) {
      res.status(401).json({ code: "unauthorized", message: "Invalid email or password." });
      return;
    }
    const session = await issueSession(res, user);
    await audit(store, { actorId: user.id, action: "auth.login", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.json(session);
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
