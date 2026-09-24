// Email OTP sign-in — POST /auth/email-otp/request, POST /auth/email-otp/verify.
// Real OTP codes are delivered via Brevo HTTPS; without Brevo config the
// service falls back to the console.log dev adapter (no real email sent).
// On successful verification the user is found-or-created by email (role
// customer) and an app session (access JWT + rotating refresh cookie) is
// issued, mirroring modules/auth/routes.ts issueSession.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, clientIp } from "../../http";
import { signAccess, issueRefresh, refreshCookieHeader } from "../../lib/jwt";
import { EmailOtpService, EmailOtpError, normalizeEmail } from "../../lib/emailOtp";
import { audit } from "../../lib/audit";
import type { Role } from "../../db/types";

export function emailOtpRoutes(deps: Deps): Router {
  const r = Router();
  const { store, jwtSecret, secureCookies } = deps;
  const maxAgeSec = 30 * 24 * 3600;
  const emailOtp = new EmailOtpService(
    store,
    process.env.OTP_HMAC_SECRET ?? "change-me-in-env",
    Date.now,
    process.env.OTP_DEV_MODE === "true",
  );

  async function issueSession(res: import("express").Response, user: { id: string; role: Role }) {
    const access = signAccess(user, jwtSecret);
    const refresh = await issueRefresh(store, user.id);
    res.setHeader("Set-Cookie", refreshCookieHeader(refresh.token, maxAgeSec, secureCookies));
    return {
      access_token: access.token, token_type: "Bearer", expires_in_sec: access.expiresInSec,
    };
  }

  // POST /auth/email-otp/request
  r.post("/email-otp/request", asyncHandler(async (req, res) => {
    const { email } = req.body ?? {};
    if (!email || typeof email !== "string") throw badRequest("Request failed validation.", { field: "email" });
    try {
      const out = await emailOtp.request(email, clientIp(req));
      const body: Record<string, unknown> = {
        sent: true, expires_in_sec: out.expiresInSec, delivery: out.delivery,
      };
      // DEV MODE ONLY — never in production
      if (out.devCode) body.dev_code = out.devCode;
      res.json(body);
    } catch (e) {
      if (e instanceof EmailOtpError && e.code === "rate_limited") {
        res.status(429).json({
          code: "rate_limited",
          message: "Too many OTP requests. Try again shortly.",
          details: e.retryAfterSec ? { retry_after_sec: e.retryAfterSec } : undefined,
        });
        return;
      }
      if (e instanceof EmailOtpError && e.code === "invalid_email") {
        throw badRequest("Request failed validation.", { field: "email" });
      }
      throw e;
    }
  }));

  // POST /auth/email-otp/verify
  r.post("/email-otp/verify", asyncHandler(async (req, res) => {
    const { email, code } = req.body ?? {};
    if (!email || !code) throw badRequest("Request failed validation.", { field: !email ? "email" : "code" });
    const ok = await emailOtp.verify(String(email), String(code));
    if (!ok) {
      res.status(401).json({ code: "unauthorized", message: "Invalid or expired code." });
      return;
    }
    const norm = normalizeEmail(String(email));
    let user = await store.getUserByEmail(norm);
    let isNew = false;
    if (!user) {
      // users.phone is NOT NULL UNIQUE — email-only accounts get a synthetic,
      // non-dialable placeholder so two email users never collide; they sign
      // in via email OTP (or Google), never via the phone number.
      user = await store.createUser({ phone: `email:${norm}`, email: norm, role: "customer" });
      isNew = true;
    }
    const session = await issueSession(res, user);
    await audit(store, { actorId: user.id, action: "auth.email_otp_verify", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.json({
      ...session,
      user: { id: user.id, email: user.email, role: user.role, is_new_user: isNew },
    });
  }));

  return r;
}
