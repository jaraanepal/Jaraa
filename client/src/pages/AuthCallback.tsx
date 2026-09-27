import { GoogleButton } from "../components/GoogleButton";
import { Loading } from "../components/ui";

/**
 * OAuth landing page. Supabase redirects here with the provider token in the
 * URL fragment (#access_token=...). <GoogleButton/> picks it up on mount,
 * exchanges it for a Jaraa app session via POST /api/v1/auth/google, and
 * navigates home. Not behind <Guard/> — the visitor isn't logged in yet.
 */
export default function AuthCallback() {
  return (
    <div className="screen" style={{ textAlign: "center", paddingTop: 64 }}>
      <Loading />
      <p className="muted">Signing you in…</p>
      <GoogleButton showButton={false} />
    </div>
  );
}
