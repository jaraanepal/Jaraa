import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, apiErrorMessage } from "../components/ui";
import { EMAIL_RE } from "../lib/password";

type StaffRole = "admin" | "doctor" | "pharmacy" | "coach";

const ROLE_HOME: Record<StaffRole, string> = {
  admin: "/admin",
  doctor: "/doctor",
  pharmacy: "/pharmacy",
  coach: "/coach",
};

/**
 * Dedicated staff login — email + password only, branded per role.
 * One component, four routes (/admin/login, /doctor/login, /pharmacy/login,
 * /coach/login). Staff NEVER see the customer OTP flow.
 */
export default function StaffLogin({ role }: { role: StaffRole }) {
  const { t } = useLang();
  const { passwordLogin } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || ROLE_HOME[role];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleName = t(`auth.roleNames.${role}` as string);

  async function submit() {
    if (!EMAIL_RE.test(email.trim())) {
      setError(t("auth.invalidEmail"));
      return;
    }
    if (!password) {
      setError(t("auth.invalidCredentials"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await passwordLogin(email.trim().toLowerCase(), password);
      // Only land on the returnTo if it belongs to this staff area;
      // otherwise the role home is the safe default.
      const safe = returnTo.startsWith(`/${role}`) ? returnTo : ROLE_HOME[role];
      navigate(safe, { replace: true });
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 401) {
        setError(t("auth.invalidCredentials"));
      } else {
        setError(apiErrorMessage(t, e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="center" style={{ margin: "12px 0" }}>
        <img src="/logo.png" alt="Jaraa" style={{ width: 96, height: 96, borderRadius: 22, objectFit: "cover" }} />
      </div>
      <h1 className="center">{t("auth.staffTitle", { role: roleName })}</h1>
      <p className="muted center">{t("auth.staffSub")}</p>
      {error && <ErrorCard message={error} />}
      <div className="card">
        <label className="fl" htmlFor="staff-email">{t("auth.emailLabel")}</label>
        <input
          id="staff-email"
          type="email"
          inputMode="email"
          placeholder={t("auth.emailPh")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
        />
        <label className="fl" htmlFor="staff-pw">{t("auth.passwordLabel")}</label>
        <input
          id="staff-pw"
          type="password"
          placeholder={t("auth.passwordPh")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <button className="btn btn-p" onClick={submit} disabled={busy}>
          {busy ? t("auth.signingIn") : t("auth.signIn")}
        </button>
        <div className="center" style={{ marginTop: 8 }}>
          <Link className="linklike" to="/forgot-password">{t("auth.forgotPassword")}</Link>
        </div>
      </div>
    </div>
  );
}
