import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { useFlags } from "../auth/FlagsContext";
import { Icon } from "./icons";
import { Modal, ToastHost } from "./ui";
import NotifBell from "./NotifBell";

function EscapeHatch() {
  const { t } = useLang();
  const flags = useFlags();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="escapebar">
        <Icon.chat size={16} />
        <span>{t("escape.prompt")}</span>
        <span className="spacer" />
        <button onClick={() => setOpen(true)}>{t("escape.button")}</button>
      </div>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2>{t("escape.modalTitle")}</h2>
          {/* Pre-legal: teleconsult is OFF, so the hatch saves the draft scan
              instead of routing to booking (flow doc G2). */}
          <p>{t("escape.modalBodyOff")}</p>
          {flags.teleconsult_booking && <p className="tiny muted">teleconsult_booking: ON</p>}
          <button className="btn btn-p" onClick={() => setOpen(false)}>
            {t("escape.ok")}
          </button>
        </Modal>
      )}
    </>
  );
}

function LanguageToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="langtoggle" role="group" aria-label="Language / भाषा">
      <button className={lang === "ne" ? "on" : ""} onClick={() => setLang("ne")} aria-pressed={lang === "ne"}>
        नेपाली
      </button>
      <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")} aria-pressed={lang === "en"}>
        EN
      </button>
    </div>
  );
}

/** PWA install prompt (beforeinstallprompt), dismissible. */
function InstallPrompt() {
  const { t } = useLang();
  const [deferred, setDeferred] = useState<{ prompt: () => void } | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("jaraa:install:dismissed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setDeferred(e as unknown as { prompt: () => void });
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem("jaraa:install:dismissed", "1");
    } catch {
      /* ignore */
    }
  }, []);
  if (!deferred || dismissed) return null;
  return (
    <div className="card" role="dialog" aria-label={t("common.installTitle")}>
      <h3>{t("common.installTitle")}</h3>
      <p className="muted">{t("common.installBody")}</p>
      <div className="btn-row">
        <button className="btn btn-p" onClick={() => deferred.prompt()}>
          {t("common.installButton")}
        </button>
        <button className="btn btn-g" onClick={dismiss}>
          {t("common.installLater")}
        </button>
      </div>
    </div>
  );
}

type NavItem = { to: string; key: string; icon: (p: { size?: number }) => JSX.Element; end?: boolean };

/** Bottom mobile nav — EXACTLY four items, always in this order (Problem 2). */
function BottomNav() {
  const { t } = useLang();
  const items: NavItem[] = [
    { to: "/", key: "nav.home", icon: Icon.home, end: true },
    { to: "/progress", key: "nav.progress", icon: Icon.chart },
    { to: "/kits", key: "nav.kits", icon: Icon.box },
    { to: "/profile", key: "nav.profile", icon: Icon.user },
  ];
  return (
    <nav className="bottomnav" aria-label="Primary">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? "active" : "")} end={i.end}>
          {i.icon({ size: 22 })}
          <span>{t(i.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Role-aware left sidebar drawer (Problem 2):
 * - customers: Scan, My Plan, Orders, Video consult, Settings (v3 behavior)
 * - admin: dashboard, kits, orders, staff/users, flags, audit
 * - doctor: review queue, reviewed plans, profile
 * - pharmacy: fulfilment queue, profile
 * - coach: my customers, follow-ups, profile
 * Every drawer ends with Settings (language) + a two-step Log out.
 */
function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  const { role, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  // Close on navigation.
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Reset the logout confirm whenever the drawer opens.
  useEffect(() => {
    if (open) setConfirmingLogout(false);
  }, [open ]);

  // Keep the closed drawer out of the tab order (React 18 types lack `inert`).
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [open ]);

  // Escape to close + focus management + body scroll lock.
  useEffect(() => {
    if (!open) return;
    openBtnRef.current = document.activeElement as HTMLButtonElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      openBtnRef.current?.focus();
    };
  }, [open, onClose]);

  const links: NavItem[] =
    role === "admin"
      ? [
          { to: "/admin", key: "nav.admin", icon: Icon.gear, end: true },
          { to: "/admin/kits", key: "adminKits.title", icon: Icon.box },
          { to: "/admin/orders", key: "drawer.orders", icon: Icon.truck },
          { to: "/admin/users?view=staff", key: "drawer.staff", icon: Icon.user },
          { to: "/admin/users", key: "drawer.users", icon: Icon.user },
          { to: "/admin/flags", key: "admin.flagsTitle", icon: Icon.alert },
          { to: "/admin/audit", key: "admin.auditTitle", icon: Icon.doc },
          { to: "/admin/profile", key: "nav.profile", icon: Icon.user },
        ]
      : role === "doctor"
        ? [
            { to: "/doctor", key: "nav.doctor", icon: Icon.doc, end: true },
            { to: "/doctor/reviewed", key: "doctorDash.reviewedTab", icon: Icon.check },
            { to: "/doctor/profile", key: "nav.profile", icon: Icon.user },
          ]
        : role === "pharmacy"
          ? [
              { to: "/pharmacy", key: "nav.pharmacy", icon: Icon.truck, end: true },
              { to: "/pharmacy/profile", key: "nav.profile", icon: Icon.user },
            ]
          : role === "coach"
            ? [
                { to: "/coach", key: "nav.coach", icon: Icon.book, end: true },
                { to: "/coach/followups", key: "coachDash.followups", icon: Icon.chat },
                { to: "/coach/profile", key: "nav.profile", icon: Icon.user },
              ]
            : [
                { to: "/scan", key: "nav.scan", icon: Icon.scan },
                { to: "/plan", key: "nav.plan", icon: Icon.plan },
                { to: "/orders", key: "nav.orders", icon: Icon.truck },
                { to: "/teleconsult", key: "teleconsult.title", icon: Icon.video },
              ];

  async function doLogout() {
    setConfirmingLogout(false);
    onClose();
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className={`drawerroot${open ? " open" : ""}`} aria-hidden={open ? undefined : "true"}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside
        ref={asideRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.menu")}
      >
        <div className="drawer-head">
          <strong>{t("nav.menu")}</strong>
          <button ref={closeRef} className="drawer-close" onClick={onClose} aria-label={t("nav.closeMenu")}>
            <Icon.cross size={20} />
          </button>
        </div>
        <nav aria-label={t("nav.menu")}>
          {links.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              onClick={onClose}
              className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
            >
              {i.icon({ size: 20 })}
              <span>{t(i.key)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="drawer-foot">
          <div className="drawer-settings">
            <h3>{t("nav.settings")}</h3>
            <div className="rowflex">
              <span className="muted">{t("common.language")}</span>
              <span className="spacer" />
              <LanguageToggle />
            </div>
          </div>
          <div className="drawer-logout">
            {confirmingLogout ? (
              <div>
                <p className="tiny" style={{ margin: "4px 0 8px" }}>
                  <b>{t("drawer.logoutConfirm")}</b>
                </p>
                <div className="btn-row">
                  <button className="btn btn-p" onClick={doLogout}>
                    {t("drawer.logoutYes")}
                  </button>
                  <button className="btn btn-g" onClick={() => setConfirmingLogout(false)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button className="drawer-link drawer-logout-btn" onClick={() => setConfirmingLogout(true)}>
                <Icon.logout size={20} />
                <span>{t("common.signOut")}</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function Layout() {
  const { t } = useLang();
  const { isAuthed, role, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hideChrome = location.pathname === "/login";
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="app">
      <header className="topbar">
        {isAuthed && !hideChrome && (
          <button
            className="hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("nav.menu")}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
          >
            <Icon.menu size={22} />
          </button>
        )}
        <Link to="/" className="brand" style={{ color: "#fff", textDecoration: "none" }} aria-label="Jaraa home">
          <img src="/logo.png" alt="Jaraa logo" />
          <div>
            Jaraa
            <small>जरा · root / origin</small>
          </div>
        </Link>
        <LanguageToggle />
        {isAuthed && !hideChrome && <NotifBell />}
        {isAuthed && !hideChrome && (
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            aria-label={t("common.signOut")}
            title={t("common.signOut")}
            style={{ background: "none", border: 0, color: "#fff", minHeight: 44, minWidth: 44, cursor: "pointer" }}
          >
            <Icon.logout size={20} />
          </button>
        )}
      </header>

      {!hideChrome && <EscapeHatch />}

      <main className="main">
        <InstallPrompt />
        <Outlet />
      </main>

      <footer className="appfoot">
        <img src="/logo.png" alt="Jaraa logo" />
        <div className="tag">{t("footer.tagline")}</div>
        <p>{t("footer.rights")}</p>
        <p>{t("footer.madeIn")}{role ? ` · ${role}` : ""}</p>
      </footer>

      {!hideChrome && isAuthed && <BottomNav />}
      {!hideChrome && isAuthed && <Drawer open={drawerOpen} onClose={closeDrawer} />}
      <ToastHost />
    </div>
  );
}
