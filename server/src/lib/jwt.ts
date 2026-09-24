// JWT access tokens (15 min) + rotating refresh tokens stored hashed in the
// refresh_tokens table. Refresh token travels in the httpOnly `jaraa_rt` cookie.
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import type { Store } from "../db/store";
import type { Role, User } from "../db/types";

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
export const REFRESH_COOKIE = "jaraa_rt";

export interface AccessClaims { sub: string; role: Role; type: "access" }

export function signAccess(user: Pick<User, "id" | "role">, secret: string): { token: string; expiresInSec: number } {
  const token = jwt.sign({ sub: user.id, role: user.role, type: "access" } satisfies AccessClaims,
    secret, { expiresIn: ACCESS_TTL_SEC });
  return { token, expiresInSec: ACCESS_TTL_SEC };
}

export function verifyAccess(token: string, secret: string): AccessClaims {
  const decoded = jwt.verify(token, secret) as AccessClaims & { type?: string };
  if (decoded.type !== "access") throw new Error("not an access token");
  return { sub: decoded.sub, role: decoded.role, type: "access" };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues a fresh refresh token, storing only its hash. Returns the raw token. */
export async function issueRefresh(store: Store, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
  await store.saveRefreshToken({ token_hash: hashToken(token), user_id: userId, expires_at: expiresAt });
  return { token, expiresAt };
}

/** Rotates: consumes the presented token, issues a new pair. Returns null if invalid/expired. */
export async function rotateRefresh(store: Store, presented: string, jwtSecret: string) {
  const rec = await store.getRefreshToken(hashToken(presented));
  if (!rec) return null;
  if (new Date(rec.expires_at).getTime() < Date.now()) {
    await store.deleteRefreshToken(hashToken(presented));
    return null;
  }
  await store.deleteRefreshToken(hashToken(presented));
  const user = await store.getUserById(rec.user_id);
  if (!user || !user.is_active) return null;
  const access = signAccess(user, jwtSecret);
  const refresh = await issueRefresh(store, user.id);
  return { user, access, refresh };
}

export function refreshCookieHeader(token: string, maxAgeSec: number, secure: boolean): string {
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly", "Path=/api/v1/auth", "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearRefreshCookie(secure: boolean): string {
  return refreshCookieHeader("", 0, secure);
}

// scrypt password hashing (node:crypto — no extra dependency)
import { scrypt as _scrypt, randomBytes as _rb, timingSafeEqual as _tse } from "node:crypto";
import { promisify } from "node:util";
const scryptAsync = promisify(_scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = _rb(16).toString("hex");
  const dk = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${dk.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hex] = stored.split(":");
  if (algo !== "scrypt" || !salt || !hex) return false;
  const dk = (await scryptAsync(password, salt, 64)) as Buffer;
  const want = Buffer.from(hex, "hex");
  return dk.length === want.length && _tse(dk, want);
}
