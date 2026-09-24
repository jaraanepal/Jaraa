import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, NoticeBox, apiErrorMessage } from "../components/ui";
import { PasswordFields } from "../components/PasswordInput";
import { checkPassword } from "../lib/password";

/** Reset password — reached from the emailed link (?token=…). */
export default function ResetPassword() {
  const { t } = useLang();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [retype, setRetype] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
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
      await authApi.resetPassword({ token, password, password_confirm: retype });
      setDone(true);
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "invalid_token") {
        setError(t("auth.resetInvalid"));
      } else {
        setError(apiErrorMessage(t, e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="screen">
        <h1>{t("auth.resetTitle")}</h1>
        <ErrorCard message={t("auth.resetInvalid")} />
        <div className="center">
          <Link className="linklike" to="/forgot-password">{t("auth.forgotPassword")}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1>{t("auth.resetTitle")}</h1>
      {done ? (
        <div>
          <NoticeBox tone="ok" title={t("auth.resetDoneTitle")}>
            <p>{t("auth.resetDone")}</p>
          </NoticeBox>
          <div className="center" style={{ marginTop: 12 }}>
            <Link className="btn btn-p" to="/login" style={{ textDecoration: "none" }}>
              {t("auth.signIn")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="card">
          {error && <ErrorCard message={error} />}
          <p className="muted">{t("auth.resetBody")}</p>
          <PasswordFields
            t={t}
            password={password}
            setPassword={setPassword}
            retype={retype}
            setRetype={setRetype}
            passwordLabel={t("auth.newPasswordLabel")}
            autoFocus
          />
          <button className="btn btn-p" onClick={submit} disabled={busy} style={{ marginTop: 12 }}>
            {busy ? t("auth.settingPassword") : t("auth.setNewPassword")}
          </button>
        </div>
      )}
    </div>
  );
}
