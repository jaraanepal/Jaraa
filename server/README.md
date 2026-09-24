# Jaraa PWA backend (server/)

TypeScript modular monolith API for the Jaraa hair-health PWA.
Base path: `/api/v1`. Contract: `../../api/openapi.yaml` (M1–M3) plus M4–M8
extensions documented below.

## Boot

```bash
cd ~/workspace/jaraa-pwa/jaraa-app/server
npm install
cp .env.example .env   # fill in real values — never commit
npm run dev            # tsx watch, port 3000
npm run build && npm start   # production
npm test               # vitest (hermetic — no Supabase needed)
```

DB: apply `../db/migrations/001_init.sql` then `../db/migrations/002_app.sql`
in the **Jaraa** Supabase project SQL editor (a NEW project — never the Shop's).
Without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` the server boots with an
in-memory store (dev/test only — data is lost on restart).

First boot with `ADMIN_EMAIL` + `ADMIN_PASSWORD` set creates the admin user
(scrypt-hashed password). Doctor/admin sign-in: `POST /api/v1/auth/login`
(email + password). Customers sign in with phone OTP.

## Layout

```
src/
  index.ts            boot: env, store selection, admin seed, listen
  app.ts              buildApp() — express wiring (also used by tests)
  env.ts              env loading + validation
  http.ts             error helpers ({code,message,details} envelope)
  middleware/auth.ts  bearer JWT, requireRole('doctor'|'admin'|...)
  middleware/flags.ts featureEnabled(key) helper
  db/
    types.ts          entity interfaces (mirror of the migrations)
    store.ts          Store interface — the single seam for all data access
    memory.ts         in-memory Store (tests / dev fallback)
    supabase.ts       Supabase Store (production: Postgres + Storage)
  lib/
    sms.ts            SmsProvider adapter: LogSmsProvider (dev), NepalSmsProvider (VERIFY stub)
    otp.ts            DB-backed OTP (ported spike: 6-digit, 5-min TTL, single-use,
                      Nepal E.164 normalization, 3-strike lockout, rate limits)
    jwt.ts            access JWT (15 min) + refresh tokens (DB, rotating, httpOnly cookie)
    brevo.ts          Brevo HTTPS API sendEmail() — NO SMTP code paths anywhere
    gemini.ts         photo QUALITY check only (lighting/blur/angle/face). Never diagnoses.
    photos.ts         sharp pipeline: EXIF strip, 400px thumbs, private bucket, signed URLs
    chunks.ts         resumable-upload ChunkAssembler (ported spike)
    payments.ts       PaymentProvider: esewa / khalti (VERIFY stubs) / cod (works)
    audit.ts          audit_log writer helper
    nudges.ts         coach nudge generator (pure function)
  modules/
    auth/routes.ts    otp request/verify, email+password login, refresh
    me/routes.ts      profile, consents, plan, root-map history, checkins, progress, data deletion
    scans/routes.ts   scan lifecycle, timeline pins, photos, root map, submit
    scan/redflags.ts  RF1–RF7 pure functions (one unit test per rule)
    scan/scoring.ts   transparent 0–100 root scoring (unit tested)
    scan/engine.ts    stage transitions + adaptive paths from scan_rules
    doctor/routes.ts  queue, claim, annotations, plan compose/approve
    shop/routes.ts    kits, orders (idempotent), payment callbacks, pharmacy fulfilment
    consults/routes.ts  POST /consults/book (403 while teleconsult_booking OFF)
    coach/routes.ts   GET /coach/nudges
    admin/routes.ts   flags, scan-rules, analytics, audit, users
tests/                vitest suites — all hermetic via memory store
```

## API notes (implemented endpoints — also specified in ../../api/openapi.yaml, now 38 paths / 40 ops)

- `POST /auth/login` {email,password} — doctor/admin (and any user with a password)
- `POST /auth/refresh` — rotates the `jaraa_rt` cookie
- `POST /scans/:id/answers` {answers} — Stage-3 Jara answers; recomputes flags + scores
- `POST /scans/:id/photos/upload-chunk` + `/upload-complete` — resumable upload
- `GET /me/checkins` — list my check-ins
- `GET /kits/:id` — one kit; 403 if it has prescription products while `prescription_commerce` OFF
- `GET /orders/:id` — my order (owner, pharmacy, admin)
- `GET /pharmacy/orders`, `PATCH /pharmacy/orders/:id` — fulfilment (role `pharmacy`)
- `GET /doctor/cases/:id` — case detail (audited)
- `GET /coach/nudges` — role `customer` (own) or `coach`
- `GET /admin/users`, `PATCH /admin/users/:id/role`

## Locked medical boundary

- `teleconsult_booking` and `prescription_commerce` are seeded **OFF** and are
  never enabled by default. `POST /consults/book` → 403 `{code:'feature_disabled'}`
  while off; prescription products are filtered from `GET /kits`, return 403 on
  direct access, and are rejected (422) in plan composition and order creation.
- Gemini is constrained to photo-quality signals. No diagnostic or condition
  labels are produced anywhere in the codebase.
- Red flags (RF1–RF7) block plan generation; submit returns 409 until a
  dermatologist resolves every flag.

## VERIFY / follow-ups (not faked)

- **TOTP 2FA** for doctor/admin: NOT implemented — documented follow-up.
  `users.totp_secret` column exists (002_app.sql); login issues a normal JWT today.
- **SMS gateway**: `NepalSmsProvider` throws `VERIFY` until the founder supplies
  a real gateway account (`SMS_API_KEY`, `SMS_SENDER_ID`).
- **eSewa / Khalti**: adapters verify webhook signatures against env secrets;
  sandbox merchant keys are VERIFY. COD works end-to-end today.
- **Gemini**: without `GEMINI_API_KEY`, quality checks return `{skipped:true}`.
