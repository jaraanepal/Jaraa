/**
 * P-14: Nepal mobile normalization. Saved addresses may store the phone as
 * typed ("+977-9841234567", "984 123 4567", ...); checkout and the order
 * API both expect the 10-digit local form ("9841234567").
 */
export function normalizeNpPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const withoutCc = digits.replace(/^(00977|977)/, "");
  if (withoutCc.length === 10) return withoutCc;
  return digits;
}

/** True when the value is a valid Nepal mobile number after normalization. */
export function isValidNpPhone(raw: string): boolean {
  return /^9\d{9}$/.test(normalizeNpPhone(raw));
}
