import request from "supertest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/db/memory";
import { OtpService } from "../src/lib/otp";
import { LogSmsProvider } from "../src/lib/sms";
import { memoryStorage } from "../src/lib/photos";
import { ChunkAssembler } from "../src/lib/chunks";
import { signAccess } from "../src/lib/jwt";
import type { Deps } from "../src/deps";
import type { User } from "../src/db/types";

export const JWT_SECRET = "test-jwt-secret";

export function testDeps() {
  const store = new MemoryStore();
  const deps: Deps = {
    store,
    otp: new OtpService(new LogSmsProvider(), store, "test-hmac-secret", Date.now, true),
    sms: new LogSmsProvider(),
    storage: memoryStorage(),
    profileStorage: memoryStorage(),
    chunks: new ChunkAssembler(),
    jwtSecret: JWT_SECRET,
    secureCookies: false,
  };
  const app = buildApp(deps, { version: "test", clientDist: "/tmp/jaraa-no-client" });
  return { store, deps, app };
}

/** Full OTP login via the API (dev mode returns dev_code). */
export async function otpLogin(app: unknown, phone: string) {
  const a = app as Parameters<typeof request>[0];
  const r1 = await request(a).post("/api/v1/auth/otp/request").send({ phone });
  if (r1.status !== 200) throw new Error(`otp request failed: ${r1.status} ${JSON.stringify(r1.body)}`);
  const r2 = await request(a).post("/api/v1/auth/otp/verify")
    .send({ phone, code: r1.body.dev_code });
  if (r2.status !== 200) throw new Error(`otp verify failed: ${r2.status} ${JSON.stringify(r2.body)}`);
  return { token: r2.body.access_token as string, user: r2.body.user as { id: string; phone: string; role: string } };
}

export function tokenFor(user: Pick<User, "id" | "role">): string {
  return signAccess(user, JWT_SECRET).token;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
