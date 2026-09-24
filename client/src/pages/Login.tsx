import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, apiErrorMessage, toast } from "../components/ui";
import { Icon } from "../components/icons";

const NEPAL_MOBILE = /^9\d{9}$/;

export default function Login() {
  const { t } = useLang();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/";

  const [phone, setPhone] = useState("");
  const [ageBand, setAgeBand] = useState("");
  const [gender, setGender] = useState("");
  const [step, setStep] = useState<"phone" | "otp" | "guardian">("phone");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const toE164 = (p: string) => `+977${p}`;

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
      navigate(returnTo, { replace: true });
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "guardian") return <Guardian onBack={() => setStep("phone")} />;

  return (
    <div className="screen">
      <div className="center" style={{ margin: "12px 0" }}>
        <img src="/logo.png" alt="Jaraa" style={{ width: 96, height: 96, borderRadius: 22, objectFit: "cover" }} />
      </div>
      <h1 className="center">{t("login.title")}</h1>
      <p className="muted center">{t("login.subtitle")}</p>
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

      <div className="center">
        <Link className="linklike" to={returnTo === "/login" ? "/" : returnTo}>
          {t("login.continueAsGuest")}
        </Link>
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
