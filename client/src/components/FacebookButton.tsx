import { useEffect, useState } from "react";
import { setAccessToken } from "../api/client";
import { OAUTH_PROVIDER_KEY } from "./GoogleButton";

/**
 * "Continue with Facebook" button — mirrors GoogleButton.
 *
 * Rendered ONLY when VITE_FACEBOOK_OAUTH_ENABLED === "true" — otherwise this
 * component renders null so the UI degrades gracefully when Facebook OAuth
 * isn't configured.
 *
 * Flow: click -> redirect to Supabase's Facebook authorize endpoint ->
 * Supabase redirects back to <app>/auth/callback#access_token=... -> this
 * component (mounted on the AuthCallback page with showButton={false})
 * picks the token out of the URL fragment, exchanges it for a Jaraa app
 * session via POST /auth/facebook, stores the access JWT, and navigates
 * home. The httpOnly refresh cookie set by /auth/facebook lets the API
 * client silently refresh afterwards.
 *
 * OAUTH_PROVIDER_KEY (sessionStorage) records that Facebook started the
 * flow, so Google's callback handler ignores this landing and vice versa.
 */
const ENABLED = import.meta.env.VITE_FACEBOOK_OAUTH_ENABLED === "true";
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const API = `${(import.meta.env.VITE_API_BASE_URL as string | undefined) || ""}/api/v1`;

/** Builds the Supabase Facebook authorize URL, or null when unconfigured. */
export function buildFacebookAuthorizeUrl(): string | null {
  if (!SUPABASE_URL) return null;
  const base = ((import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined) || window.location.origin).replace(/\/$/, "");
  return (
    `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/authorize?provider=facebook` +
    `&redirect_to=${encodeURIComponent(`${base}/auth/callback`)}`
  );
}

function FacebookGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </svg>
  );
}

export function FacebookButton({ showButton = true }: { showButton?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth callback handler — runs only for the Facebook flow (see
  // OAUTH_PROVIDER_KEY); GoogleButton handles its own flow on this page.
  useEffect(() => {
    if (!ENABLED) return;
    if (!window.location.pathname.endsWith("/auth/callback")) return;
    if (sessionStorage.getItem(OAUTH_PROVIDER_KEY) !== "facebook") return;
    sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
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
    fetch(`${API}/auth/facebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // receive the httpOnly refresh cookie
      body: JSON.stringify({ access_token: accessToken }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { access_token?: string; message?: string };
        if (!r.ok || !body.access_token) {
          throw new Error(body.message || "Facebook sign-in failed.");
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
    const url = buildFacebookAuthorizeUrl();
    if (!url) {
      setError("Facebook sign-in is not configured (VITE_SUPABASE_URL unset).");
      return;
    }
    sessionStorage.setItem(OAUTH_PROVIDER_KEY, "facebook");
    window.location.assign(url);
  };

  return (
    <div className="facebook-btn-wrap">
      {showButton && (
        <button type="button" className="btn btn-facebook" onClick={start} disabled={busy} aria-label="Continue with Facebook">
          <FacebookGlyph />
          <span>{busy ? "Signing in…" : "Continue with Facebook"}</span>
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
