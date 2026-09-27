import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OAUTH_PROVIDER_KEY } from "../components/GoogleButton";

const setAccessToken = vi.fn();
vi.mock("../api/client", () => ({ setAccessToken: (...args: unknown[]) => setAccessToken(...args) }));

async function loadButton(fbEnabled: string, googleEnabled = "false") {
  vi.resetModules();
  vi.stubEnv("VITE_FACEBOOK_OAUTH_ENABLED", fbEnabled);
  vi.stubEnv("VITE_GOOGLE_OAUTH_ENABLED", googleEnabled);
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  return import("../components/FacebookButton");
}

beforeEach(() => {
  setAccessToken.mockClear();
  sessionStorage.clear();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("FacebookButton", () => {
  it("renders nothing when VITE_FACEBOOK_OAUTH_ENABLED is not true", async () => {
    const { FacebookButton } = await loadButton("false");
    const { container } = render(<FacebookButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the button when enabled", async () => {
    const { FacebookButton } = await loadButton("true");
    render(<FacebookButton />);
    expect(screen.getByRole("button", { name: "Continue with Facebook" })).toBeTruthy();
  });

  it("click marks the provider as facebook", async () => {
    const { FacebookButton } = await loadButton("true");
    render(<FacebookButton />);
    // jsdom does not navigate; the assign() call no-ops there.
    fireEvent.click(screen.getByRole("button", { name: "Continue with Facebook" }));
    expect(sessionStorage.getItem(OAUTH_PROVIDER_KEY)).toBe("facebook");
  });

  it("builds the Supabase facebook authorize URL with the callback redirect", async () => {
    const { buildFacebookAuthorizeUrl } = await loadButton("true");
    const url = buildFacebookAuthorizeUrl();
    expect(url).toContain("https://example.supabase.co/auth/v1/authorize?provider=facebook");
    expect(url).toContain(`redirect_to=${encodeURIComponent(`${window.location.origin}/auth/callback`)}`);
  });

  it("exchanges the token on /auth/callback when it started the flow", async () => {
    const { FacebookButton } = await loadButton("true");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "app-jwt" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, "facebook");
    window.history.pushState({}, "", "/auth/callback#access_token=fb-token");
    render(<FacebookButton showButton={false} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/facebook");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("fb-token");
    await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith("app-jwt"));
  });

  it("ignores the callback landing when Google started the flow", async () => {
    const { FacebookButton } = await loadButton("true");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, "google");
    window.history.pushState({}, "", "/auth/callback#access_token=google-token");
    render(<FacebookButton showButton={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GoogleButton ignores the callback landing when Facebook started the flow", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_GOOGLE_OAUTH_ENABLED", "true");
    vi.stubEnv("VITE_FACEBOOK_OAUTH_ENABLED", "false");
    const { GoogleButton } = await import("../components/GoogleButton");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, "facebook");
    window.history.pushState({}, "", "/auth/callback#access_token=fb-token");
    render(<GoogleButton showButton={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
