import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { checkAccess, matchRule } from "../lib/guards";
import { draftHasProgress, loadDraft } from "../lib/draft";
import { useLang } from "../i18n/LanguageContext";
import { Icon } from "./icons";

/**
 * Role guard: reads auth state (role from /me/profile via the JWT claim),
 * applies the pure checkAccess() rules, and redirects:
 *   - not authed  -> /login (with returnTo), unless a guest draft exists
 *   - wrong role   -> 403 page
 */
export function Guard({ children }: { children: JSX.Element }) {
  const { isAuthed, role, profileLoading } = useAuth();
  const location = useLocation();
  const path = location.pathname;

  if (profileLoading && isAuthed) return null;

  const rule = matchRule(path);
  if (!rule) return <Navigate to="/" replace />;

  const hasGuestDraft = draftHasProgress(loadDraft());
  const access = checkAccess({ isAuthed, role }, path, hasGuestDraft);

  if (access === "login") {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(path)}`} replace />;
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
