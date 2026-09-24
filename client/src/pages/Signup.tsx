import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, apiErrorMessage } from "../components/ui";
import { PasswordFields } from "../components/PasswordInput";
import { GoogleButton } from "../components/GoogleButton";
import { checkPassword, EMAIL_RE, NEPAL_MOBILE } from "../lib/password";

type Method = "email" | "phone";

/**
 * Sign-up — email OR phone + password + retype, with a live strength meter.
 * Identical page and rules for every role (customer, doctor, admin,
 * pharmacy, coach); the account is created as a customer and staff roles
 * are granted by an admin afterwards.
 */
export default function Signup() {
  const { t } = useLang();
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/";

  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [retype, setRetype] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const em = email.trim().toLowerCase();
    const ph = phone.replace(/\D/g, "");
    if (method === "email" && !EMAIL_RE.test(em)) {
      setError(t("auth.invalidEmail"));
      return;
    }
    if (method === "phone" && !NEPAL_MOBILE.test(ph)) {
      setError(t("auth.invalidPhone"));
      return;
    }
    const c = checkPassword(password);
    if (!c.ok) {
      setError(t("auth.fixPassword"));
      return;
    }
    if (password !== retype) {
      setError(t("auth.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup(
        method === "email"
          ? { email: em, password, password_confirm: retype }
          : { phone: ph, password, password_confirm: retype },
      );
      navigate(returnTo === "/signup" ? "/" : returnTo, { replace: true });
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 409) {
        setError(t("auth.emailTaken"));
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
      <h1 className="center">{t("auth.signupTitle")}</h1>
      <p className="muted center">{t("auth.signupSub")}</p>
      {error && <ErrorCard message={error} />}

      <GoogleButton />
      <div className="or-divider" aria-hidden="true"><span>{t("auth.orDivider")}</span></div>

      <div className="card">
        <div className="center" style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
          {(["email", "phone"] as Method[]).map((m) => (
            <button
              key={m}
              className={method === m ? "btn btn-p" : "btn"}
              style={{ flex: 1 }}
              onClick={() => { setMethod(m); setError(null); }}
            >
              {t(m === "email" ? "auth.methodEmail" : "auth.methodPhone")}
            </button>
          ))}
        </div>

        {method === "email" ? (
          <div>
            <label className="fl" htmlFor="su-email">{t("auth.emailLabel")}</label>
            <input
              id="su-email"
              type="email"
              inputMode="email"
              placeholder={t("auth.emailPh")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </div>
        ) : (
          <div>
            <label className="fl" htmlFor="su-phone">{t("auth.phoneLabel")}</label>
            <input
              id="su-phone"
              type="tel"
              inputMode="numeric"
              placeholder={t("auth.phonePh")}
              value={phone}
              maxLength={10}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              autoComplete="tel"
              autoFocus
            />
          </div>
        )}

        <PasswordFields
          t={t}
          password={password}
          setPassword={setPassword}
          retype={retype}
          setRetype={setRetype}
        />

        <button className="btn btn-p" onClick={submit} disabled={busy} style={{ marginTop: 12 }}>
          {busy ? t("auth.creatingAccount") : t("auth.createAccountBtn")}
        </button>
      </div>

      <p className="center muted">
        {t("auth.haveAccount")}{" "}
        <Link className="linklike" to="/login">{t("auth.signInLink")}</Link>
      </p>
    </div>
  );
}
