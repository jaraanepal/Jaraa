import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, apiErrorMessage, toast } from "../components/ui";
import { GoogleButton } from "../components/GoogleButton";
import { Icon } from "../components/icons";
import { EMAIL_RE, NEPAL_MOBILE } from "../lib/password";

type Tab = "password" | "otp";

export default function Login() {
  const { t } = useLang();
  const { login, passwordLogin, continueAsGuest } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/";

  const [tab, setTab] = useState<Tab>("password");

  // Password tab
  const [identifier, setIdentifier] = useState("");
  const [pw, setPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // OTP tab (existing flow, kept as the secondary option)
  const [phone, setPhone] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [gender, setGender] = useState("");
  const [step, setStep] = useState<"phone" | "otp" | "guardian">("phone");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const toE164 = (p: string) => `+977${p}`;

  function goAfterLogin() {
    navigate(returnTo === "/login" ? "/" : returnTo, { replace: true });
  }

  function loginErrorMessage(e: unknown): string {
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 401) {
      return t("auth.invalidCredentials");
    }
    return apiErrorMessage(t, e);
  }

  async function signInWithPassword() {
    const id = identifier.trim();
    const digits = id.replace(/\D/g, "");
    const bare = digits.replace(/^977/, "").replace(/^0/, "");
    const isEmail = EMAIL_RE.test(id);
    const isPhone = NEPAL_MOBILE.test(bare);
    if ((!isEmail && !isPhone) || !pw) {
      setPwError(t("auth.invalidIdentifier"));
      return;
    }
    setPwBusy(true);
    setPwError(null);
    try {
      // Server accepts bare 10-digit, 0/977-prefixed, or +977 E.164 — it
      // normalizes; email goes through lowercased.
      await passwordLogin(isEmail ? id.toLowerCase() : bare, pw);
      goAfterLogin();
    } catch (e) {
      setPwError(loginErrorMessage(e));
    } finally {
      setPwBusy(false);
    }
  }

  function guest() {
    continueAsGuest();
    navigate(returnTo === "/login" ? "/" : returnTo, { replace: true });
  }

  async function sendOtp() {
    const p = phone.trim();
    if (!NEPAL_MOBILE.test(p)) {
      setError(t("login.invalidPhone"));
      return;
    }
    if (ageBand === "u16") {
      setStep("guardian");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.requestOtp(toE164(p));
      if (res.dev_code) setDevCode(res.dev_code); // dev/staging only
      setStep("otp");
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) {
      setError(t("login.invalidOtp"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let claim: string | undefined;
      try {
        const d = JSON.parse(localStorage.getItem("jaraa:scan:draft") || "{}");
        if (d.scanId) claim = d.scanId;
      } catch {
        /* ignore */
      }
      await login(toE164(phone.trim()), c, claim);
      goAfterLogin();
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (tab === "otp" && step === "guardian") return <Guardian onBack={() => setStep("phone")} />;

  return (
    <div className="screen">
      <div className="center" style={{ margin: "12px 0" }}>
        <img src="/logo.png" alt="Jaraa" style={{ width: 96, height: 96, borderRadius: 22, objectFit: "cover" }} />
      </div>
      <h1 className="center">{t("login.title")}</h1>
      <p className="muted center">{t("login.subtitle")}</p>

      <GoogleButton />
      <div className="or-divider" aria-hidden="true"><span>{t("auth.orDivider")}</span></div>

      <div className="center" style={{ display: "flex", gap: 8, justifyContent: "center", margin: "12px 0" }}>
        {(["password", "otp"] as Tab[]).map((k) => (
          <button
            key={k}
            className={tab === k ? "btn btn-p" : "btn"}
            style={{ flex: 1, maxWidth: 200 }}
            onClick={() => { setTab(k); setPwError(null); setError(null); }}
          >
            {t(k === "password" ? "auth.passwordTab" : "auth.otpTab")}
          </button>
        ))}
      </div>

      {tab === "password" && (
        <div>
          {pwError && <ErrorCard message={pwError} />}
          <div className="card">
            <label className="fl" htmlFor="ident">{t("auth.identifierLabel")}</label>
            <input
              id="ident"
              type="text"
              inputMode="email"
              placeholder={t("auth.identifierPh")}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            <label className="fl" htmlFor="pwlogin">{t("auth.passwordLabel")}</label>
            <input
              id="pwlogin"
              type="password"
              placeholder={t("auth.passwordPh")}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => { if (e.key === "Enter") signInWithPassword(); }}
            />
            <button className="btn btn-p" onClick={signInWithPassword} disabled={pwBusy}>
              {pwBusy ? t("auth.signingIn") : t("auth.signIn")}
            </button>
            <div className="center" style={{ marginTop: 8 }}>
              <Link className="linklike" to="/forgot-password">{t("auth.forgotPassword")}</Link>
            </div>
          </div>
          <p className="center muted">
            {t("auth.noAccount")}{" "}
            <Link className="linklike" to={returnTo && returnTo !== "/" ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : "/signup"}>
              {t("auth.createAccount")}
            </Link>
          </p>
        </div>
      )}

      {tab === "otp" && (
        <div>
          {error && <ErrorCard message={error} />}
          {step === "phone" && (
            <div className="card">
              <label className="fl" htmlFor="ph">{t("login.phoneLabel")}</label>
              <input
                id="ph"
                type="tel"
                inputMode="numeric"
                placeholder={t("login.phonePlaceholder")}
                value={phone}
                maxLength={10}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                autoComplete="tel"
              />
              <label className="fl" htmlFor="ageb">{t("login.ageLabel")}</label>
              <select id="ageb" value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
                <option value="">—</option>
                {(["u16", "a1622", "a2329", "a3039", "a4049", "a50"] as const).map((k) => (
                  <option key={k} value={k}>{t(`login.age.${k}`)}</option>
                ))}
              </select>
              <label className="fl" htmlFor="gend">{t("login.genderLabel")}</label>
              <select id="gend" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">—</option>
                {(["male", "female", "other"] as const).map((k) => (
                  <option key={k} value={k}>{t(`login.gender.${k}`)}</option>
                ))}
              </select>
              <button className="btn btn-p" onClick={sendOtp} disabled={busy}>
                {busy ? t("common.loading") : t("login.sendOtp")}
              </button>
            </div>
          )}

          {step === "otp" && (
            <div className="card">
              <label className="fl" htmlFor="otp">{t("login.otpLabel")}</label>
              <input
                id="otp"
                type="tel"
                inputMode="numeric"
                placeholder={t("login.otpPlaceholder")}
                value={code}
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
              />
              <p className="tiny muted">{t("login.otpHint")}</p>
              {devCode && (
                <p className="tiny">
                  <span className="kbd">dev: {devCode}</span>
                </p>
              )}
              <button className="btn btn-p" onClick={verify} disabled={busy}>
                {busy ? t("login.loggingIn") : t("login.verify")}
              </button>
              <button className="linklike" onClick={() => setStep("phone")}>
                {t("common.back")}
              </button>
            </div>
          )}
        </div>
      )}

      <p className="tiny muted center">{t("auth.guestNote")}</p>
      <div className="center">
        <button className="linklike" onClick={guest}>
          {t("login.continueAsGuest")}
        </button>
      </div>
    </div>
  );
}

function Guardian({ onBack }: { onBack: () => void }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  return (
    <div className="screen">
      <h1>{t("login.guardianTitle")}</h1>
      <div className="card">
        <p>{t("login.guardianBody")}</p>
        <label className="rowflex" style={{ margin: "12px 0", alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ width: 28, height: 28, minHeight: 28, marginTop: 2 }}
          />
          <span>{t("login.guardianCheckbox")}</span>
        </label>
        <button
          className="btn btn-p"
          onClick={() => {
            if (!checked) {
              toast(t("login.guardianTickFirst"));
              return;
            }
            navigate("/scan", { replace: true });
          }}
        >
          {t("login.guardianContinue")}
        </button>
        <button className="linklike" onClick={onBack}>
          <Icon.cross size={14} /> {t("common.back")}
        </button>
      </div>
    </div>
  );
}
