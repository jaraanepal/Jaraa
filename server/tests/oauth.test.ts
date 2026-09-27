// OAuth (Google + Facebook) server tests — POST /api/v1/auth/:provider.
// The handler verifies the Supabase token via /auth/v1/user, then
// find-or-creates the app user by email (role customer).
import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { testDeps } from "./helpers";

const SUPABASE_URL = "https://example.supabase.co";

function mockSupabaseUser(info: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).startsWith(`${SUPABASE_URL}/auth/v1/user`)) {
        return { ok, status: ok ? 200 : 401, json: async () => info };
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
});

describe.each(["google", "facebook"] as const)("POST /api/v1/auth/%s", (provider) => {
  it("returns 501 when SUPABASE_URL is unset", async () => {
    const { app } = testDeps();
    const r = await request(app).post(`/api/v1/auth/${provider}`).send({ access_token: "x" });
    expect(r.status).toBe(501);
    expect(r.body.code).toBe("not_configured");
  });

  it("returns 400 when access_token is missing", async () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    const { app } = testDeps();
    const r = await request(app).post(`/api/v1/auth/${provider}`).send({});
    expect(r.status).toBe(400);
  });

  it("returns 401 when the Supabase token is invalid", async () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    mockSupabaseUser({}, false);
    const { app } = testDeps();
    const r = await request(app).post(`/api/v1/auth/${provider}`).send({ access_token: "bad" });
    expect(r.status).toBe(401);
  });

  it("creates a customer user and issues a session on first login", async () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    mockSupabaseUser({
      email: `${provider}-user@example.com`,
      email_confirmed_at: new Date().toISOString(),
      user_metadata: { full_name: "OAuth User" },
    });
    const { app, store } = testDeps();
    const r = await request(app).post(`/api/v1/auth/${provider}`).send({ access_token: "valid" });
    expect(r.status).toBe(200);
    expect(typeof r.body.access_token).toBe("string");
    expect(r.body.user.email).toBe(`${provider}-user@example.com`);
    expect(r.body.user.role).toBe("customer");
    expect(r.body.user.is_new_user).toBe(true);
    const user = await store.getUserByEmail(`${provider}-user@example.com`);
    expect(user?.role).toBe("customer");
  });

  it("reuses the existing user on repeat login", async () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    mockSupabaseUser({ email: "repeat@example.com", user_metadata: {} });
    const { app } = testDeps();
    const first = await request(app).post(`/api/v1/auth/${provider}`).send({ access_token: "valid" });
    const second = await request(app).post(`/api/v1/auth/${provider}`).send({ access_token: "valid" });
    expect(first.body.user.is_new_user).toBe(true);
    expect(second.body.user.is_new_user).toBe(false);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it("rejects 400 when the provider account has no email", async () => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    mockSupabaseUser({ email: null, user_metadata: {} });
    const { app } = testDeps();
    const r = await request(app).post(`/api/v1/auth/${provider}`).send({ access_token: "valid" });
    expect(r.status).toBe(400);
  });
});
