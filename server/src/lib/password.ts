// Password strength rules + reset-token helpers.
// Strength policy (same for every role): min 8 chars, ≥1 lowercase,
// ≥1 uppercase, ≥1 number. Server is the authority; the client mirrors
// these rules for its live meter but the server re-checks every time.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface PasswordStrengthResult {
  ok: boolean;
  errors: string[];
}

export function validatePasswordStrength(pw: string): PasswordStrengthResult {
  const errors: string[] = [];
  if (typeof pw !== "string" || pw.length < 8) {
    errors.push("Password must be at least 8 characters long.");
  }
  if (!/[a-z]/.test(pw)) {
    errors.push("Password must contain at least one lowercase letter (a–z).");
  }
  if (!/[A-Z]/.test(pw)) {
    errors.push("Password must contain at least one uppercase letter (A–Z).");
  }
  if (!/[0-9]/.test(pw)) {
    errors.push("Password must contain at least one number (0–9).");
  }
  return { ok: errors.length === 0, errors };
}

/** Client mirror of the server rules: 0–4 score for the live strength meter. */
export function passwordScore(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (/[a-z]/.test(pw)) s += 1;
  if (/[A-Z]/.test(pw)) s += 1;
  if (/[0-9]/.test(pw)) s += 1;
  return s;
}

/** New single-use reset token (raw — sent to the user, never stored). */
export function newResetToken(): string {
  return randomBytes(32).toString("hex");
}

/** HMAC of a reset token for DB storage. `secret` is a server-side secret. */
export function hashResetToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(`password-reset:${token}`).digest("hex");
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Deterministic placeholder phone for email-only signups.
 * users.phone is UNIQUE NOT NULL (E.164), so an email-only account gets a
 * non-E.164 placeholder that can never collide with a real number. The user
 * can attach a real phone later; login by email is unaffected.
 */
export function placeholderPhoneForEmail(email: string): string {
  const h = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
  return `email:${h}`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
