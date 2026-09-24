# RENDER_ENV_VARS — Jaraa PWA

Set these in Render → your Web Service → **Environment**. Nothing secret goes in the repo —
the app reads everything from `process.env`. After changing env vars, **Manual Deploy →
Deploy latest commit** (or Clear build cache & deploy for the first setup).

## Required

| Variable | Where to get it | Notes |
|---|---|---|
| `SUPABASE_URL` | New Supabase project → Project Settings → API → Project URL | **Create a NEW project for Jaraa — never reuse the Nepal Shop's.** |
| `SUPABASE_ANON_KEY` | Same page → `anon` `public` key | Safe for the client bundle. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → `service_role` key | **Server only.** Never put in frontend code. |
| `BREVO_API_KEY` | Brevo → top-right menu → SMTP & API → API Keys → Create | Brevo free tier: 300 emails/day. |
| `BREVO_SENDER_EMAIL` | Brevo → Senders → add + verify your sender address | Must be verified or Brevo rejects sends. |
| `PUBLIC_BASE_URL` | Your Render service URL, e.g. `https://jaraa-pwa.onrender.com` | No trailing slash. Used for links inside emails. |
| `ADMIN_EMAIL` | You choose, e.g. your own email | Bootstrap admin created on first boot if no admin exists. |
| `ADMIN_PASSWORD` | You choose — long and random | Set once; delete after first login and use a password manager. |
| `OTP_HMAC_SECRET` | Generate: `openssl rand -hex 32` | Signs OTP codes. Changing it invalidates pending OTPs. |
| `JWT_SECRET` | Generate: `openssl rand -hex 32` | Signs app session tokens. |

## Optional (features degrade gracefully without them)

| Variable | Where to get it | What happens if unset |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio (aistudio.google.com) → Get API key | Lens photo **quality** checks are skipped; dermatologist review still works. Gemini is never used for diagnosis. |
| `SMS_API_KEY` / `SMS_SENDER_ID` | VERIFY — Nepal SMS gateway (you pick the provider, open the account) | OTP codes are logged server-side (dev adapter). No real SMS until set. |
| `ESEWA_MERCHANT_ID` / `ESEWA_SECRET` | VERIFY — eSewa sandbox/merchant dashboard | eSewa checkout hidden until set. Khalti + COD unaffected. |
| `KHALTI_PUBLIC_KEY` / `KHALTI_SECRET_KEY` | VERIFY — Khalti sandbox/merchant dashboard | Khalti checkout hidden until set. eSewa + COD unaffected. |
| `SENTRY_DSN` | sentry.io free project | No error tracking until set; logs still work. |
| `NODE_ENV` | Set to `production` | Defaults safe, but set it. |

## Email OTP (real sends via Brevo)

`POST /api/v1/auth/email-otp/request` + `/verify` issue real 6-digit codes by
email — same security semantics as the phone OTP (5-min TTL, single-use,
3-strike lockout, 3 req/10 min + 20 req/hour limits). Keys are namespaced in
the shared `otp_codes` table so they never collide with phone OTP rows.

| Variable | Notes |
|---|---|
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` (already required above) | **Required for real email OTP delivery.** When unset, the code is written to the server log only (`[email-otp]` dev adapter) — no email is actually sent. This fallback is honest and loud, not silent. |
| `OTP_DEV_MODE=true` | Staging only: `/request` returns `dev_code` in the response (same flag as phone OTP). Never in production. |
| `OTP_HMAC_SECRET` (already required) | Also signs email OTP codes. |

## Phone SMS OTP — still log-only (VERIFY)

`SMS_PROVIDER=log` is the only working SMS adapter today: codes print to the
server log. No real SMS leaves the box until a Nepal SMS gateway is chosen,
the account is opened, and `SMS_PROVIDER`/`SMS_API_KEY`/`SMS_SENDER_ID` are
wired to it. (Owner: founder — pick the gateway.)

## "Continue with Google" (Supabase Auth Google OAuth)

Client `GoogleButton` renders only when the build-time flag
`VITE_GOOGLE_OAUTH_ENABLED=true`; otherwise it renders nothing and the UI
degrades gracefully. The server endpoint `POST /api/v1/auth/google` needs:

| Variable | Where to get it | Notes |
|---|---|---|
| `SUPABASE_ANON_KEY` (already required above) | Supabase → Project Settings → API → `anon` key | Sent as the `apikey` header when verifying the Google token against `/auth/v1/user`. |
| `SUPABASE_URL` (already required above) | Same page | If unset, `/auth/google` returns 501 with a clear message. |

**Client build-time vars** (set in Render env *before* the client builds —
Vite inlines them, so changing them needs a rebuild):

| Variable | Value | Notes |
|---|---|---|
| `VITE_GOOGLE_OAUTH_ENABLED` | `true` to show the button | Renders null when not `true`. |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` | Used to build the Google authorize redirect. |
| `VITE_PUBLIC_BASE_URL` | Same as `PUBLIC_BASE_URL` | Used for the OAuth `redirect_to` callback URL (falls back to `window.location.origin`). |

**How to enable Google sign-in (founder steps):**

1. Supabase dashboard → **Authentication → Sign In → Google** → enable the
   provider (create the Google Cloud OAuth client ID/secret there).
2. In the same Google provider settings, whitelist the redirect URL:
   `<PUBLIC_BASE_URL>/auth/callback` (e.g.
   `https://jaraa-pwa.onrender.com/auth/callback`).
3. Set the three `VITE_` vars above in Render env and redeploy (rebuild).
4. The app exchanges the Google token server-side via `POST /auth/google`;
   the Google/Supabase token is never stored — only the email is used to
   find-or-create the app user.

## Render-provided (do not set manually)

`PORT` — Render injects it; the server listens on `process.env.PORT`.

## First-boot checklist

1. All **Required** vars set.
2. Migration `db/migrations/001_init.sql` run in the Jaraa Supabase project's SQL editor.
3. Deploy → check `/health` → log in with `ADMIN_EMAIL`/`ADMIN_PASSWORD` → open `/admin` → confirm `teleconsult_booking` and `prescription_commerce` are **OFF**.
4. Delete `ADMIN_PASSWORD` from Render env after first login (keep `ADMIN_EMAIL`).
