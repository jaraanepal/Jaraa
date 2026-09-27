// "Continue with Google / Facebook" — POST /auth/:provider { access_token }.
// The client obtains a Supabase Auth access token via the provider OAuth
// redirect flow (see client GoogleButton / FacebookButton). We verify it by
// calling Supabase's /auth/v1/user with the token, require an email address,
// find-or-create the app user by email (role customer), and issue our own
// app session (access JWT + rotating refresh cookie) via jwt.ts helpers.
// The provider/Supabase token is never stored — only the email is used.
import { Router } from "express";
import type { Deps } from "../../deps";
import { asyncHandler, badRequest, clientIp } from "../../http";
import { signAccess, issueRefresh, refreshCookieHeader } from "../../lib/jwt";
import { normalizeEmail } from "../../lib/emailOtp";
import { audit } from "../../lib/audit";
import type { Role } from "../../db/types";

type OAuthProvider = "google" | "facebook";

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  facebook: "Facebook",
};

interface SupabaseUserInfo {
  email?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: { name?: string | null; full_name?: string | null };
}

export function oauthRoutes(deps: Deps): Router {
  const r = Router();
  const { store, jwtSecret, secureCookies } = deps;
  const maxAgeSec = 30 * 24 * 3600;

  for (const provider of ["google", "facebook"] as const) {
    const label = PROVIDER_LABEL[provider];
    // POST /auth/google | POST /auth/facebook
    r.post(
      `/${provider}`,
      asyncHandler(async (req, res) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        if (!supabaseUrl) {
          res.status(501).json({
            code: "not_configured",
            message: `${label} sign-in is not configured on this server (SUPABASE_URL is unset).`,
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
              apikey: `${process.env.SUPABASE_ANON_KEY ?? ""}`,
            },
          });
          if (!verify.ok) {
            res.status(401).json({ code: "unauthorized", message: `${label} token is invalid or expired.` });
            return;
          }
          info = (await verify.json()) as SupabaseUserInfo;
        } catch (e) {
          res.status(502).json({
            code: "verification_failed",
            message: `Could not verify the ${label} token with Supabase.`,
            details: { error: (e as Error).message },
          });
          return;
        }

        let email: string;
        try {
          email = normalizeEmail(String(info.email ?? ""));
        } catch {
          throw badRequest(`No email address on the ${label} account.`, { field: "email" });
        }

        let user = await store.getUserByEmail(email);
        let isNew = false;
        if (!user) {
          // users.phone is NOT NULL UNIQUE — OAuth accounts get a synthetic,
          // non-dialable placeholder so two OAuth users never collide.
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
        await audit(store, { actorId: user.id, action: `auth.${provider}`, entity: "user", entityId: user.id, ip: clientIp(req) });
        res.json({
          access_token: access.token,
          user: { id: user.id, email: user.email, role: user.role as Role, is_new_user: isNew },
        });
      })
    );
  }

  return r;
}
