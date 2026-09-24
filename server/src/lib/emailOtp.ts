// Email OTP service — mirrors lib/otp.ts (SMS OTP) security semantics exactly:
// 6-digit code, 5-min TTL, single-use, 3-strike lockout, rate limits
// (3 requests / 10 min per email in-memory, 20 / hour per email via the
// otp row, 20 / hour per IP in-memory).
//
// Storage: reuses the otp_codes table / OtpStore shape (code_hash,
// expires_at, attempts_left, request_count, window_start). Keys are
// namespaced as "email:<addr>" so they can never collide with the
// "+977…" phone keys the SMS flow uses.
//
// Delivery: real sends go through Brevo HTTPS (sendEmail). ONLY when
// BREVO_API_KEY/BREVO_SENDER_EMAIL are unset does it fall back to a
// console.log dev adapter — in that case NO email is actually sent.
// Never SMTP: Render blocks ports 25/465/587, so there are intentionally
// no SMTP code paths anywhere in this codebase.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { sendEmail, emailOtpEmail } from "./brevo";
import type { OtpStore } from "./otp";
import type { OtpRow } from "../db/types";

const CODE_TTL_MS = 5 * 60 * 1000;
export const EMAIL_OTP_TTL_SEC = CODE_TTL_MS / 1000;
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_REQUESTS_PER_10MIN = 3;
const MAX_REQUESTS_PER_HOUR = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type EmailOtpDelivery = "brevo" | "log";

export class EmailOtpError extends Error {
  constructor(public code: "rate_limited" | "invalid_email", message: string, public retryAfterSec?: number) {
    super(message);
  }
}

/** Normalizes to lowercase, validates shape. Throws EmailOtpError("invalid_email"). */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new EmailOtpError("invalid_email", `invalid email address: ${input}`);
  }
  return email;
}

export class EmailOtpService {
  private tenMin = new Map<string, number[]>(); // email -> request timestamps
  private ipHour = new Map<string, number[]>(); // ip -> request timestamps
  constructor(
    private store: OtpStore,
    private hmacSecret: string,
    private now: () => number = Date.now,
    private devMode = false,
  ) {}

  private prune(m: Map<string, number[]>, key: string, windowMs: number): number[] {
    const t = this.now();
    const arr = (m.get(key) ?? []).filter((x) => t - x < windowMs);
    m.set(key, arr);
    return arr;
  }

  private storeKey(email: string): string {
    return `email:${email}`;
  }

  async request(emailRaw: string, ip?: string): Promise<{ expiresInSec: number; delivery: EmailOtpDelivery; devCode?: string }> {
    const email = normalizeEmail(emailRaw);
    const key = this.storeKey(email);

    const recent = this.prune(this.tenMin, email, 10 * 60 * 1000);
    if (recent.length >= MAX_REQUESTS_PER_10MIN) {
      const retryAfterSec = Math.ceil((recent[0] + 10 * 60 * 1000 - this.now()) / 1000);
      throw new EmailOtpError("rate_limited", "Too many OTP requests. Try again shortly.", Math.max(retryAfterSec, 1));
    }
    if (ip) {
      const ipRecent = this.prune(this.ipHour, ip, 3_600_000);
      if (ipRecent.length >= MAX_REQUESTS_PER_HOUR) {
        throw new EmailOtpError("rate_limited", "Too many OTP requests from this network.");
      }
      ipRecent.push(this.now());
    }
    const existing = await this.store.otpGet(key);
    if (existing && this.now() - existing.window_start < 3_600_000 && existing.request_count >= MAX_REQUESTS_PER_HOUR) {
      throw new EmailOtpError("rate_limited", "Too many OTP requests. Try again later.");
    }
    recent.push(this.now());

    const code = String(randomInt(100000, 1000000));
    const row: OtpRow = {
      code_hash: this.hash(email, code),
      expires_at: this.now() + CODE_TTL_MS,
      attempts_left: MAX_VERIFY_ATTEMPTS,
      request_count: existing && this.now() - existing.window_start < 3_600_000 ? existing.request_count + 1 : 1,
      window_start: existing && this.now() - existing.window_start < 3_600_000 ? existing.window_start : this.now(),
    };
    await this.store.otpUpsert(key, row);
    const delivery = await this.deliver(email, code);
    return { expiresInSec: EMAIL_OTP_TTL_SEC, delivery, devCode: this.devMode ? code : undefined };
  }

  /** Returns true on success. Wrong attempts decrement; 3 strikes locks the code out. */
  async verify(emailRaw: string, code: string): Promise<boolean> {
    let email: string;
    try { email = normalizeEmail(emailRaw); } catch { return false; }
    const key = this.storeKey(email);
    const rec = await this.store.otpGet(key);
    if (!rec || this.now() > rec.expires_at || rec.attempts_left <= 0) {
      if (rec) await this.store.otpDelete(key);
      return false;
    }
    const candidate = this.hash(email, code);
    const ok = candidate.length === rec.code_hash.length &&
      timingSafeEqual(Buffer.from(candidate), Buffer.from(rec.code_hash));
    if (ok) {
      await this.store.otpDelete(key); // single-use
      return true;
    }
    rec.attempts_left -= 1;
    if (rec.attempts_left <= 0) await this.store.otpDelete(key);
    else await this.store.otpUpsert(key, rec);
    return false;
  }

  private async deliver(email: string, code: string): Promise<EmailOtpDelivery> {
    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
      // dev adapter: Brevo not configured — code goes to the server log only.
      // Honest limitation: no real email leaves this box in this mode.
      console.log(`[email-otp] BREVO_API_KEY/BREVO_SENDER_EMAIL unset — dev adapter. Code for ${email}: ${code}`);
      return "log";
    }
    const m = emailOtpEmail(code);
    await sendEmail(email, m.subject, m.html);
    return "brevo";
  }

  private hash(email: string, code: string): string {
    return createHmac("sha256", this.hmacSecret).update(`${email}:${code}`).digest("hex");
  }
}
