import { GoogleButton } from "../components/GoogleButton";
import { FacebookButton } from "../components/FacebookButton";
import { Loading } from "../components/ui";

/**
 * OAuth landing page. Supabase redirects here with the provider token in the
 * URL fragment (#access_token=...). The matching provider button picks it up
 * on mount (disambiguated via sessionStorage), exchanges it for a Jaraa app
 * session via POST /api/v1/auth/:provider, and navigates home.
 * Not behind <Guard/> — the visitor isn't logged in yet.
 */
export default function AuthCallback() {
  return (
    <div className="screen" style={{ textAlign: "center", paddingTop: 64 }}>
      <Loading />
      <p className="muted">Signing you in…</p>
      <GoogleButton showButton={false} />
      <FacebookButton showButton={false} />
    </div>
  );
}
