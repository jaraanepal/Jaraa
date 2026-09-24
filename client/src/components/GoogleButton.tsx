import { useEffect, useState } from "react";
import { setAccessToken } from "../api/client";

/**
 * "Continue with Google" button.
 *
 * Rendered ONLY when VITE_GOOGLE_OAUTH_ENABLED === "true" — otherwise this
 * component renders null so the UI degrades gracefully when Google OAuth
 * isn't configured.
 *
 * Flow: click -> redirect to Supabase's Google authorize endpoint ->
 * Supabase redirects back to <app>/auth/callback#access_token=... -> this
 * component (mounted anywhere in the tree) picks the token out of the URL
 * fragment, exchanges it for a Jaraa app session via POST /auth/google,
 * stores the access JWT, and navigates home. The httpOnly refresh cookie
 * set by /auth/google lets the API client silently refresh afterwards.
 *
 * NOTE: the integrator places this component on the login / sign-up pages;
 * it handles the /auth/callback landing itself (the SPA fallback serves
 * index.html there), so no router changes are needed.
 */
const ENABLED = import.meta.env.VITE_GOOGLE_OAUTH_ENABLED === "true";
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const API = `${(import.meta.env.VITE_API_BASE_URL as string | undefined) || ""}/api/v1`;

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.4 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth callback handler — runs on every mount so the /auth/callback
  // landing is exchanged no matter which page the button was placed on.
  useEffect(() => {
    if (!ENABLED) return;
    if (!window.location.pathname.endsWith("/auth/callback")) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const oauthError = params.get("error_description") || params.get("error");
    // scrub tokens from the URL before doing anything else
    window.history.replaceState(null, "", "/auth/callback");
    if (oauthError) {
      setError(oauthError);
      return;
    }
    if (!accessToken) return;
    setBusy(true);
    fetch(`${API}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // receive the httpOnly refresh cookie
      body: JSON.stringify({ access_token: accessToken }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { access_token?: string; message?: string };
        if (!r.ok || !body.access_token) {
          throw new Error(body.message || "Google sign-in failed.");
        }
        setAccessToken(body.access_token);
        window.location.replace("/");
      })
      .catch((e: Error) => {
        setError(e.message);
        setBusy(false);
      });
  }, []);

  if (!ENABLED) return null;

  const start = () => {
    if (!SUPABASE_URL) {
      setError("Google sign-in is not configured (VITE_SUPABASE_URL unset).");
      return;
    }
    const base = ((import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined) || window.location.origin).replace(/\/$/, "");
    const url =
      `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/authorize?provider=google` +
      `&redirect_to=${encodeURIComponent(`${base}/auth/callback`)}`;
    window.location.assign(url);
  };

  return (
    <div className="google-btn-wrap">
      <button type="button" className="btn btn-google" onClick={start} disabled={busy} aria-label="Continue with Google">
        <GoogleGlyph />
        <span>{busy ? "Signing in…" : "Continue with Google"}</span>
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
