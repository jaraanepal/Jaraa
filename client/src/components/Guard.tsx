import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { checkAccess, loginPathFor, matchRule } from "../lib/guards";
import { draftHasProgress, loadDraft } from "../lib/draft";
import { useLang } from "../i18n/LanguageContext";
import { Icon } from "./icons";

/**
 * Role guard: reads auth state (role from /me/profile via the JWT claim),
 * applies the pure checkAccess() rules, and redirects:
 *   - not authed  -> the role's own login page (staff consoles never see the
 *                    customer OTP login), with returnTo
 *   - wrong role   -> 403 page
 * Guest mode counts as a guest pass for guestAllowed routes (scan flow).
 */
export function Guard({ children }: { children: JSX.Element }) {
  const { isAuthed, isGuest, role, profileLoading } = useAuth();
  const location = useLocation();
  const path = location.pathname;

  if (profileLoading && isAuthed) return null;

  const rule = matchRule(path);
  if (!rule) return <Navigate to="/" replace />;

  const guestPass = draftHasProgress(loadDraft()) || isGuest;
  const access = checkAccess({ isAuthed, role }, path, guestPass);

  if (access === "login") {
    const loginPath = loginPathFor(path);
    return <Navigate to={`${loginPath}?returnTo=${encodeURIComponent(path)}`} replace />;
  }
  if (access === "forbidden") {
    return <Navigate to="/403" replace />;
  }
  return children;
}

export function ForbiddenPage() {
  const { t } = useLang();
  return (
    <div className="screen center" style={{ padding: "40px 0" }}>
      <div style={{ color: "var(--bad)" }}>
        <Icon.lock size={56} />
      </div>
      <h1>{t("errors.forbiddenTitle")}</h1>
      <p className="muted">{t("errors.forbiddenBody")}</p>
      <a className="btn btn-p" href="/" style={{ textDecoration: "none", display: "block" }}>
        {t("errors.goHome")}
      </a>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useLang();
  return (
    <div className="screen center" style={{ padding: "40px 0" }}>
      <h1>{t("errors.notFoundTitle")}</h1>
      <p className="muted">{t("errors.notFoundBody")}</p>
      <a className="btn btn-p" href="/" style={{ textDecoration: "none", display: "block" }}>
        {t("errors.goHome")}
      </a>
    </div>
  );
}
