import { useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, NoticeBox, apiErrorMessage } from "../components/ui";
import { EMAIL_RE } from "../lib/password";

/** Forgot password — always shows the same "check your email" state. */
export default function ForgotPassword() {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) {
      setError(t("auth.invalidEmail"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.forgotPassword(em);
      setSent(true); // same state for known and unknown emails
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>{t("auth.forgotTitle")}</h1>
      {sent ? (
        <div>
          <NoticeBox tone="ok" title={t("auth.forgotDoneTitle")}>
            <p>{t("auth.forgotDone")}</p>
          </NoticeBox>
          <div className="center" style={{ marginTop: 12 }}>
            <Link className="linklike" to="/login">{t("auth.backToLogin")}</Link>
          </div>
        </div>
      ) : (
        <div className="card">
          {error && <ErrorCard message={error} />}
          <p className="muted">{t("auth.forgotBody")}</p>
          <label className="fl" htmlFor="fp-email">{t("auth.emailLabel")}</label>
          <input
            id="fp-email"
            type="email"
            inputMode="email"
            placeholder={t("auth.emailPh")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <button className="btn btn-p" onClick={submit} disabled={busy}>
            {busy ? t("auth.sending") : t("auth.sendResetLink")}
          </button>
          <div className="center" style={{ marginTop: 8 }}>
            <Link className="linklike" to="/login">{t("auth.backToLogin")}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
