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

## Render-provided (do not set manually)

`PORT` — Render injects it; the server listens on `process.env.PORT`.

## First-boot checklist

1. All **Required** vars set.
2. Migration `db/migrations/001_init.sql` run in the Jaraa Supabase project's SQL editor.
3. Deploy → check `/health` → log in with `ADMIN_EMAIL`/`ADMIN_PASSWORD` → open `/admin` → confirm `teleconsult_booking` and `prescription_commerce` are **OFF**.
4. Delete `ADMIN_PASSWORD` from Render env after first login (keep `ADMIN_EMAIL`).
