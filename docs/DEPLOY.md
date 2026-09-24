# DEPLOY.md — Jaraa PWA on Render + Supabase

One web service (the API serves the PWA) + one Supabase project. Matches the Nepal Shop's
operational setup, so the same runbook applies.

## 0. Prerequisites (founder-owned)

- GitHub account, Render account, Supabase account, Brevo account.
- The Jaraa logo file is already in `client/public/` — nothing to do.

## 1. Create the Supabase project (Jaraa-only)

1. Supabase → New project → name `jaraa`, region closest to Nepal (e.g. Singapore).
2. **Never reuse the Nepal Shop's project.**
3. SQL Editor → run in order:
   - `db/migrations/001_init.sql` (22 tables, RLS, private `scan-photos` bucket, flag + rule seeds)
   - `db/migrations/002_app.sql` (guest scans, staff password auth, refresh tokens, deletion requests)
   - `db/migrations/003_profile_extras.sql` (profiles.photo_path + addresses JSON, private `profile-photos` bucket)
   - `db/migrations/004_password_resets.sql` (single-use password-reset tokens, HMAC-hashed)
   - `db/migrations/005_kit_details.sql` (kit category/images/whats-included/usage/stock/is_active, public `kit-images` bucket)
   This creates all tables, RLS policies, the private `scan-photos` storage bucket,
   feature-flag seeds (`teleconsult_booking` OFF, `prescription_commerce` OFF) and the
   `scan_rules` seeds.
4. Project Settings → API → copy `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` into Render env (see `docs/RENDER_ENV_VARS.md`).

## 2. Brevo (email — HTTPS, not SMTP)

Render blocks outbound SMTP ports (25/465/587), so the app uses the Brevo HTTPS API only.

1. Brevo → Sign up → Senders → add and verify your sender email.
2. SMTP & API → API Keys → create → copy `BREVO_API_KEY`.
3. Set `BREVO_API_KEY` + `BREVO_SENDER_EMAIL` in Render env.

## 3. Push to GitHub

```bash
cd ~/workspace/jaraa-pwa/jaraa-app
git init && git add -A && git commit -m "Jaraa PWA v1"
gh repo create jaraa-pwa --private --source=. --push
```

## 4. Create the Render Web Service

- Render → New → Web Service → connect the `jaraa-pwa` repo.
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- Instance: Free to start (paid when limits hit).
- Add every variable from `docs/RENDER_ENV_VARS.md`.

## 5. First boot + smoke test

1. Deploy → open `https://<your-service>.onrender.com/health` → expect `{"ok":true}`.
2. Log in at `/login` with `ADMIN_EMAIL`/`ADMIN_PASSWORD` (request OTP to that flow's
   phone, or use the admin password login at `/admin-login`).
3. Open `/admin` → Feature flags: confirm `teleconsult_booking` **OFF** and
   `prescription_commerce` **OFF**.
4. Run a full customer journey on your phone: OTP login → Root Scan (4 stages) →
   submit → doctor review → plan → kit order (COD).
5. Delete `ADMIN_PASSWORD` from Render env after first login; redeploy.

## 6. Ongoing

- Staging soak 48h before any prod deploy; prod deploys are manual tagged releases.
- Daily Supabase DB backups are automatic on paid tiers; keep bucket versioning on.
- Rollback: redeploy the previous release tag; every migration has a down path in
  `db/migrations/` (future-dated files pair up/down).
