// DB-backed OTP service — ported from spikes/otp/src/otp.ts.
// Semantics preserved: 6-digit code, 5-min TTL, single-use, Nepal E.164
// normalization, 3-strike lockout. Rate limits per contract: 3 requests / 10
// min per phone (in-memory sliding window, single instance), 20 / hour per
// phone (rolling window in otp_codes), 20 / hour per IP (in-memory).
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { SmsProvider } from "./sms";
import type { OtpRow } from "../db/types";

const CODE_TTL_MS = 5 * 60 * 1000;
export const OTP_TTL_SEC = CODE_TTL_MS / 1000;
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_REQUESTS_PER_10MIN = 3;
const MAX_REQUESTS_PER_HOUR = 20;

export class OtpError extends Error {
  constructor(public code: "rate_limited" | "invalid_phone", message: string, public retryAfterSec?: number) {
    super(message);
  }
}

/** Normalizes Nepali mobile input to E.164. Throws on invalid. */
export function normalizeNpPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  let d = digits;
  if (d.startsWith("977")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  // Nepal mobiles: 10 digits starting 96/97/98
  if (!/^9[678]\d{8}$/.test(d)) throw new OtpError("invalid_phone", `invalid Nepal mobile number: ${input}`);
  return `+977${d}`;
}

export interface OtpStore {
  otpGet(phone: string): Promise<OtpRow | null>;
  otpUpsert(phone: string, row: OtpRow): Promise<void>;
  otpDelete(phone: string): Promise<void>;
}

export class OtpService {
  private tenMin = new Map<string, number[]>(); // phone -> request timestamps
  private ipHour = new Map<string, number[]>(); // ip -> request timestamps
  constructor(
    private provider: SmsProvider,
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

  async request(phoneRaw: string, ip?: string): Promise<{ expiresInSec: number; devCode?: string }> {
    const phone = normalizeNpPhone(phoneRaw);

    const recent = this.prune(this.tenMin, phone, 10 * 60 * 1000);
    if (recent.length >= MAX_REQUESTS_PER_10MIN) {
      const retryAfterSec = Math.ceil((recent[0] + 10 * 60 * 1000 - this.now()) / 1000);
      throw new OtpError("rate_limited", "Too many OTP requests. Try again shortly.", Math.max(retryAfterSec, 1));
    }
    if (ip) {
      const ipRecent = this.prune(this.ipHour, ip, 3_600_000);
      if (ipRecent.length >= MAX_REQUESTS_PER_HOUR) {
        throw new OtpError("rate_limited", "Too many OTP requests from this network.");
      }
      ipRecent.push(this.now());
    }
    const existing = await this.store.otpGet(phone);
    if (existing && this.now() - existing.window_start < 3_600_000 && existing.request_count >= MAX_REQUESTS_PER_HOUR) {
      throw new OtpError("rate_limited", "Too many OTP requests. Try again later.");
    }
    recent.push(this.now());

    const code = String(randomInt(100000, 1000000));
    const row: OtpRow = {
      code_hash: this.hash(phone, code),
      expires_at: this.now() + CODE_TTL_MS,
      attempts_left: MAX_VERIFY_ATTEMPTS,
      request_count: existing && this.now() - existing.window_start < 3_600_000 ? existing.request_count + 1 : 1,
      window_start: existing && this.now() - existing.window_start < 3_600_000 ? existing.window_start : this.now(),
    };
    await this.store.otpUpsert(phone, row);
    await this.provider.sendSms(phone, `Jaraa: your code is ${code}. Valid 5 minutes.`);
    return { expiresInSec: OTP_TTL_SEC, devCode: this.devMode ? code : undefined };
  }

  /** Returns true on success. Wrong attempts decrement; 3 strikes locks the code out. */
  async verify(phoneRaw: string, code: string): Promise<boolean> {
    let phone: string;
    try { phone = normalizeNpPhone(phoneRaw); } catch { return false; }
    const rec = await this.store.otpGet(phone);
    if (!rec || this.now() > rec.expires_at || rec.attempts_left <= 0) {
      if (rec) await this.store.otpDelete(phone);
      return false;
    }
    const candidate = this.hash(phone, code);
    const ok = candidate.length === rec.code_hash.length &&
      timingSafeEqual(Buffer.from(candidate), Buffer.from(rec.code_hash));
    if (ok) {
      await this.store.otpDelete(phone); // single-use
      return true;
    }
    rec.attempts_left -= 1;
    if (rec.attempts_left <= 0) await this.store.otpDelete(phone);
    else await this.store.otpUpsert(phone, rec);
    return false;
  }

  private hash(phone: string, code: string): string {
    return createHmac("sha256", this.hmacSecret).update(`${phone}:${code}`).digest("hex");
  }
}
