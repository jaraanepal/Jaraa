/**
 * Client mirror of server/src/lib/password.ts.
 * The server re-checks every time — this is only for the live meter and
 * instant feedback. Rules: min 8 chars, ≥1 lowercase, ≥1 uppercase, ≥1 number.
 */
export interface PasswordCheck {
  ok: boolean;
  score: number; // 0–4
  min8: boolean;
  lower: boolean;
  upper: boolean;
  digit: boolean;
}

export function checkPassword(pw: string): PasswordCheck {
  const min8 = pw.length >= 8;
  const lower = /[a-z]/.test(pw);
  const upper = /[A-Z]/.test(pw);
  const digit = /[0-9]/.test(pw);
  const score = [min8, lower, upper, digit].filter(Boolean).length;
  return { ok: min8 && lower && upper && digit, score, min8, lower, upper, digit };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NEPAL_MOBILE = /^9\d{9}$/;
