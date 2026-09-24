import { checkPassword } from "../lib/password";

/**
 * Password + retype fields with a LIVE strength meter and mismatch error.
 * Used identically by Signup and ResetPassword — same rules for every role.
 * The server re-validates; this is instant client feedback only.
 */
export function PasswordFields({
  t,
  password,
  setPassword,
  retype,
  setRetype,
  passwordLabel,
  autoFocus,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  password: string;
  setPassword: (v: string) => void;
  retype: string;
  setRetype: (v: string) => void;
  passwordLabel?: string;
  autoFocus?: boolean;
}) {
  const c = checkPassword(password);
  const mismatch = retype !== "" && password !== retype;
  const meterLabel =
    password === "" ? "" : c.score <= 1 ? t("auth.strengthWeak") : c.score <= 3 ? t("auth.strengthMedium") : t("auth.strengthStrong");
  const meterColor = c.score <= 1 ? "var(--bad)" : c.score <= 3 ? "#c98a12" : "var(--green)";

  const rules: [boolean, string][] = [
    [c.min8, t("auth.ruleMin8")],
    [c.lower, t("auth.ruleLower")],
    [c.upper, t("auth.ruleUpper")],
    [c.digit, t("auth.ruleDigit")],
  ];

  return (
    <div>
      <label className="fl" htmlFor="pw">{passwordLabel ?? t("auth.passwordLabel")}</label>
      <input
        id="pw"
        type="password"
        placeholder={t("auth.passwordPh")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        autoFocus={autoFocus}
      />
      {password !== "" && (
        <div style={{ margin: "6px 0 2px" }}>
          <div
            aria-hidden="true"
            style={{ height: 6, borderRadius: 4, background: "#e5e0d5", overflow: "hidden" }}
          >
            <div
              style={{
                height: "100%",
                width: `${(c.score / 4) * 100}%`,
                background: meterColor,
                transition: "width 150ms",
              }}
            />
          </div>
          <div className="tiny" style={{ marginTop: 4 }}>
            {t("auth.strengthLabel")}: <b style={{ color: meterColor }}>{meterLabel}</b>
          </div>
          <ul className="tiny" style={{ margin: "4px 0 0", paddingLeft: 18, listStyle: "none" }}>
            {rules.map(([met, label], i) => (
              <li key={i} style={{ color: met ? "var(--green)" : "var(--muted)" }}>
                {met ? "✓" : "○"} {label}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="fl" htmlFor="pw2">{t("auth.retypeLabel")}</label>
      <input
        id="pw2"
        type="password"
        placeholder={t("auth.retypePh")}
        value={retype}
        onChange={(e) => setRetype(e.target.value)}
        autoComplete="new-password"
      />
      {mismatch && <p className="tiny" style={{ color: "var(--bad)" }}>{t("auth.mismatch")}</p>}
    </div>
  );
}
