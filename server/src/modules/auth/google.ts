// "Continue with Google" — POST /auth/google { access_token }.
// The client obtains a Supabase Auth access token via the Google OAuth
// redirect flow (see client GoogleButton). We verify it by calling
// Supabase's /auth/v1/user with the token, require a verified email,
// find-or-create the app user by email (role customer), and issue our own
// app session (access JWT + rotating refresh cookie) via jwt.ts helpers.
// The Google/Supabase token is never stored — only the email is used.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, clientIp } from "../../http";
import { signAccess, issueRefresh, refreshCookieHeader } from "../../lib/jwt";
import { normalizeEmail } from "../../lib/emailOtp";
import { audit } from "../../lib/audit";
import type { Role } from "../../db/types";

interface SupabaseUserInfo {
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: { name?: string | null; full_name?: string | null };
}

export function googleAuthRoutes(deps: Deps): Router {
  const r = Router();
  const { store, jwtSecret, secureCookies } = deps;
  const maxAgeSec = 30 * 24 * 3600;

  // POST /auth/google
  r.post("/google", asyncHandler(async (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      res.status(501).json({
        code: "not_configured",
        message: "Google sign-in is not configured on this server (SUPABASE_URL is unset).",
      });
      return;
    }
    const { access_token } = req.body ?? {};
    if (!access_token || typeof access_token !== "string") {
      throw badRequest("Request failed validation.", { field: "access_token" });
    }

    let info: SupabaseUserInfo;
    try {
      const verify = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
          apikey: process.env.SUPABASE_ANON_KEY ?? "",
        },
      });
      if (!verify.ok) {
        res.status(401).json({ code: "unauthorized", message: "Google token is invalid or expired." });
        return;
      }
      info = (await verify.json()) as SupabaseUserInfo;
    } catch (e) {
      res.status(502).json({
        code: "verification_failed",
        message: "Could not verify the Google token with Supabase.",
        details: { error: (e as Error).message },
      });
      return;
    }

    let email: string;
    try {
      email = normalizeEmail(String(info.email ?? ""));
    } catch {
      throw badRequest("No email address on the Google account.", { field: "email" });
    }

    let user = await store.getUserByEmail(email);
    let isNew = false;
    if (!user) {
      // users.phone is NOT NULL UNIQUE — Google accounts get a synthetic,
      // non-dialable placeholder so two Google users never collide.
      user = await store.createUser({ phone: `email:${email}`, email, role: "customer" });
      isNew = true;
    }
    const name = info.user_metadata?.full_name ?? info.user_metadata?.name ?? null;
    if (isNew && name) {
      await store.upsertProfile(user.id, { name: String(name).slice(0, 120) });
    }

    const access = signAccess(user, jwtSecret);
    const refresh = await issueRefresh(store, user.id);
    res.setHeader("Set-Cookie", refreshCookieHeader(refresh.token, maxAgeSec, secureCookies));
    await audit(store, { actorId: user.id, action: "auth.google", entity: "user", entityId: user.id, ip: clientIp(req) });
    res.json({
      access_token: access.token, token_type: "Bearer", expires_in_sec: access.expiresInSec,
      user: { id: user.id, email: user.email, role: user.role as Role, is_new_user: isNew },
    });
  }));

  return r;
}
