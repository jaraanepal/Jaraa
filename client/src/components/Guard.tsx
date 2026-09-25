import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { checkAccess, dashboardPathFor, loginPathFor, matchRule } from "../lib/guards";
import { draftHasProgress, loadDraft } from "../lib/draft";
import { useLang } from "../i18n/LanguageContext";
import { Icon } from "./icons";
import type { Role } from "../api/types";

/**
 * Role guard: reads auth state (role from /me/profile via the JWT claim),
 * applies the pure checkAccess() rules, and redirects:
 *   - not authed  -> the role's own login page (staff consoles never see the
 *                    customer OTP login), with returnTo
 *   - wrong role  -> role-mismatch screen (P11): "Log out first, then try."
 *                    with [Log out] and [Go back] actions
 * Guest mode counts as a guest pass for guestAllowed routes (scan flow).
 *
 * While the one-shot session restore is running (authReady === false) the
 * guard renders nothing, so a restored session never flashes a login page.
 */
export function Guard({ children }: { children: JSX.Element }) {
  const { isAuthed, isGuest, role, profileLoading, authReady } = useAuth();
  const location = useLocation();
  const path = location.pathname;

  if (authReady === false) return null;
  if (profileLoading && isAuthed) return null;

  const rule = matchRule(path);
  if (!rule) return <Navigate to="/" replace />;

  const guestPass = draftHasProgress(loadDraft()) || isGuest;
  const access = checkAccess({ isAuthed, role }, path, guestPass);

  // P-4: "/" is the home page for every role. A signed-in non-customer
  // (doctor, admin, pharmacy, coach) landing on "/" goes straight to
  // their own dashboard instead of the role-mismatch screen. Guests and
  // customers keep the existing Home page.
  if (path === "/" && isAuthed && role && role !== "customer") {
    return <Navigate to={dashboardPathFor(role)} replace />;
  }

  if (access === "login") {
    const loginPath = loginPathFor(path);
    return <Navigate to={`${loginPath}?returnTo=${encodeURIComponent(path)}`} replace />;
  }
  if (access === "forbidden") {
    return <RoleMismatchPage path={path} />;
  }
  return children;
}

const ROLE_LABEL_KEYS: Record<Role, string> = {
  customer: "errors.roleCustomer",
  doctor: "errors.roleDoctor",
  admin: "errors.roleAdmin",
  pharmacy: "errors.rolePharmacy",
  coach: "errors.roleCoach",
};

/**
 * P11 — role-mismatch screen. Shown when a signed-in user opens another
 * role's routes (e.g. a customer opening /admin, or an admin opening a
 * customer-only flow):
 *   [Log out] logs out and lands on the attempted area's own login page,
 *             so they can sign back in with the right account;
 *   [Go back] returns them to their own role's dashboard.
 */
export function RoleMismatchPage({ path }: { path: string }) {
  const { t } = useLang();
  const { role, logout } = useAuth();
  const navigate = useNavigate();

  const roleLabel = role ? t(ROLE_LABEL_KEYS[role]) : t("common.na");

  const handleLogout = async () => {
    await logout();
    navigate(loginPathFor(path), { replace: true });
  };
  const handleGoBack = () => {
    navigate(role ? dashboardPathFor(role) : "/", { replace: true });
  };

  return (
    <div className="screen center" style={{ padding: "40px 0" }}>
      <div style={{ color: "var(--bad)" }}>
        <Icon.lock size={56} />
      </div>
      <h1>{t("errors.roleMismatchTitle")}</h1>
      <p className="muted">{t("errors.roleMismatchAs", { role: roleLabel })}</p>
      <p className="muted">{t("errors.roleMismatchBody")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 320 }}>
        <button type="button" className="btn btn-p" onClick={handleLogout}>
          {t("errors.roleMismatchLogout")}
        </button>
        <button type="button" className="btn btn-s" onClick={handleGoBack}>
          {t("errors.roleMismatchGoBack")}
        </button>
      </div>
    </div>
  );
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
