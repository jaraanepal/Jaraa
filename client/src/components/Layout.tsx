import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { useFlags } from "../auth/FlagsContext";
import { Icon } from "./icons";
import { Modal, ToastHost } from "./ui";
import NotifBell from "./NotifBell";
import { OfflineBanner } from "./b4customer";

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
 * Role-aware left sidebar drawer (v14 — every role's sidebar lists ALL pages
 * available to that role):
 * - customers: home, scan, plan, progress, kits, habits, orders, wishlist,
 *   challenges, referral, teleconsult, notifications, help, my data, profile
 * - admin: dashboard, kits, orders, staff/users, flags, audit, broadcast,
 *   refunds, sla, verifications, finance, payouts, plan templates, tickets,
 *   articles, cases, kit analytics, tools, profile
 * - doctor: queue, reviewed, patients, follow-ups, availability, activity,
 *   archived, second opinions, calendar, triage presets, digest, tools,
 *   notifications, profile
 * - pharmacy: queue, adjust stock, manifest, expiry, claims, holidays,
 *   reports, fulfilment performance, damaged-stock quarantine, shift summary,
 *   courier performance, return-rate analytics, packaging materials,
 *   COD reconciliation, tools, notifications, profile
 * - coach: dashboard, my customers, follow-ups, tools, notifications, profile
 * Every drawer ends with Settings (language) + a two-step Log out.
 */
/** Role-aware nav links (Problem 2, v14) — shared by the mobile drawer and the
    desktop staff side nav, so both always show the same items. Every role's
    sidebar lists ALL pages available to that role (v14 problems 1-4). */
function roleLinks(role: string | null): NavItem[] {
  return role === "admin"
  ? [
      { to: "/admin", key: "nav.admin", icon: Icon.gear, end: true },
      { to: "/admin/kits", key: "adminKits.title", icon: Icon.box },
      { to: "/admin/orders", key: "drawer.orders", icon: Icon.truck },
      { to: "/admin/users?view=staff", key: "drawer.staff", icon: Icon.user },
      { to: "/admin/users", key: "drawer.users", icon: Icon.user },
      { to: "/admin/flags", key: "admin.flagsTitle", icon: Icon.alert },
      { to: "/admin/audit", key: "admin.auditTitle", icon: Icon.doc },
      { to: "/admin/broadcast", key: "p12.admin.broadcast", icon: Icon.chat },
      { to: "/admin/refunds", key: "p12.admin.refunds", icon: Icon.chart },
      { to: "/admin/sla", key: "p12.admin.sla", icon: Icon.clock },
      { to: "/admin/verifications", key: "p12.admin.verification", icon: Icon.check },
      { to: "/admin/finance", key: "p12.admin.finance", icon: Icon.chart },
      { to: "/admin/payouts", key: "p12c.admin.payouts.title", icon: Icon.chart },
      { to: "/admin/plan-templates", key: "p12c.admin.planTemplates.title", icon: Icon.doc },
      { to: "/admin/tickets", key: "p12.admin.tickets", icon: Icon.chat },
      { to: "/admin/articles", key: "p12.admin.articles", icon: Icon.book },
      { to: "/admin/cases", key: "adminCases.title", icon: Icon.doc },
      { to: "/admin/kit-analytics", key: "p12.admin.kitAnalytics", icon: Icon.box },
      { to: "/admin/tools", key: "p12b.admin.title", icon: Icon.gear },
      { to: "/admin/profile", key: "nav.profile", icon: Icon.user },
    ]
  : role === "doctor"
    ? [
        { to: "/doctor", key: "nav.doctor", icon: Icon.doc, end: true },
        { to: "/doctor/reviewed", key: "doctorDash.reviewedTab", icon: Icon.check },
        { to: "/doctor/patients", key: "p12.doctor.patientsTab", icon: Icon.user },
        { to: "/doctor/followups", key: "p12.doctor.followups", icon: Icon.chat },
        { to: "/doctor/availability", key: "p12.doctor.availability", icon: Icon.clock },
        { to: "/doctor/activity", key: "v14doctor.navActivity", icon: Icon.chart },
        { to: "/doctor/archived", key: "p12c.doctor.archivedBadge", icon: Icon.box },
        { to: "/doctor/second-opinions", key: "p12c.doctor.soTitle", icon: Icon.doc },
        { to: "/doctor/calendar", key: "p12c.doctor.calTitle", icon: Icon.clock },
        { to: "/doctor/triage-presets", key: "p12c.doctor.tpTitle", icon: Icon.gear },
        { to: "/doctor/digest", key: "v14doctor.navDigest", icon: Icon.book },
        { to: "/doctor/tools", key: "p12b.doctor.title", icon: Icon.gear },
        { to: "/notifications", key: "nav.notifications", icon: Icon.alert },
        { to: "/doctor/profile", key: "nav.profile", icon: Icon.user },
      ]
    : role === "pharmacy"
      ? [
          { to: "/pharmacy", key: "nav.pharmacy", icon: Icon.truck, end: true },
          { to: "/pharmacy/queue", key: "pharmacy.queueTitle", icon: Icon.clock },
          { to: "/pharmacy/stock", key: "p12.pharmacy.adjustStock", icon: Icon.box },
          { to: "/pharmacy/manifest", key: "p12d.pharmacy.tabManifest", icon: Icon.doc },
          { to: "/pharmacy/expiry", key: "p12d.pharmacy.tabExpiry", icon: Icon.alert },
          { to: "/pharmacy/claims", key: "p12d.pharmacy.tabClaims", icon: Icon.chat },
          { to: "/pharmacy/holidays", key: "p12d.pharmacy.tabHolidays", icon: Icon.clock },
          { to: "/pharmacy/reports", key: "p12d.pharmacy.tabReports", icon: Icon.chart },
          { to: "/pharmacy/performance", key: "p12.pharmacy.performance", icon: Icon.chart },
          { to: "/pharmacy/quarantine", key: "p12c.pharmacy.quarantineTitle", icon: Icon.alert },
          { to: "/pharmacy/shift", key: "p12c.pharmacy.shiftTitle", icon: Icon.user },
          { to: "/pharmacy/couriers", key: "p12c.pharmacy.courierTitle", icon: Icon.truck },
          { to: "/pharmacy/returns", key: "p12c.pharmacy.returnsTitle", icon: Icon.box },
          { to: "/pharmacy/packaging", key: "p12c.pharmacy.packagingTitle", icon: Icon.box },
          { to: "/pharmacy/cod", key: "p12c.pharmacy.codTitle", icon: Icon.chart },
          { to: "/pharmacy/tools", key: "p12b.pharmacy.title", icon: Icon.gear },
          { to: "/notifications", key: "nav.notifications", icon: Icon.alert },
          { to: "/pharmacy/profile", key: "nav.profile", icon: Icon.user },
        ]
      : role === "coach"
        ? [
            { to: "/coach", key: "nav.coach", icon: Icon.book, end: true },
            { to: "/coach/customers", key: "v14coach.myCustomers", icon: Icon.user },
            { to: "/coach/followups", key: "coachDash.followups", icon: Icon.chat },
            { to: "/coach/tools", key: "p12b.coach.title", icon: Icon.gear },
            { to: "/notifications", key: "nav.notifications", icon: Icon.alert },
            { to: "/coach/profile", key: "nav.profile", icon: Icon.user },
          ]
        : [
            { to: "/", key: "nav.home", icon: Icon.home, end: true },
            { to: "/scan", key: "nav.scan", icon: Icon.scan },
            { to: "/plan", key: "nav.plan", icon: Icon.plan },
            { to: "/progress", key: "nav.progress", icon: Icon.chart },
            { to: "/kits", key: "nav.kits", icon: Icon.box },
            { to: "/habits", key: "p12.customer.habitCheckin", icon: Icon.check },
            { to: "/orders", key: "nav.orders", icon: Icon.truck },
            { to: "/wishlist", key: "p12.customer.wishlist", icon: Icon.box },
            { to: "/my-challenges", key: "p12.customer.myChallenges", icon: Icon.chart },
            { to: "/referral", key: "p12.customer.referral", icon: Icon.user },
            { to: "/teleconsult", key: "teleconsult.title", icon: Icon.video },
            { to: "/notifications", key: "nav.notifications", icon: Icon.alert },
            { to: "/help", key: "p12.customer.help", icon: Icon.chat },
            { to: "/my-data", key: "p12.customer.myData", icon: Icon.doc },
            { to: "/profile", key: "nav.profile", icon: Icon.user },
          ];
}

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

  const links = roleLinks(role);

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

/**
 * Persistent left sidebar on desktop (≥1024px, v13) — ALL roles including
 * the customer. Same links as the mobile drawer, with active-link
 * highlighting; hidden by CSS below the desktop breakpoint, where the
 * bottom nav shows instead.
 */
function SideNav() {
  const { t } = useLang();
  const { role } = useAuth();
  return (
    <aside className="sidenav" aria-label={t("nav.menu")}>
      <div className="side-title">{t("nav.menu")}</div>
      <nav>
        {roleLinks(role).map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) => `drawer-link${isActive ? " active" : ""}`}
          >
            {i.icon({ size: 20 })}
            <span>{t(i.key)}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
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
    <div className={`app app-role-${role ?? "guest"}`}>
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

      <div className="deskrow">
        {!hideChrome && isAuthed && <SideNav />}
        <div className="deskcol">
          <main className="main">
            <InstallPrompt />
            {/* U39: offline banner (batch 4) */}
            <OfflineBanner />
            <Outlet />
          </main>

          <footer className="appfoot">
            <img src="/logo.png" alt="Jaraa logo" />
            <div className="tag">{t("footer.tagline")}</div>
            <p>{t("footer.rights")}</p>
            <p>{t("footer.madeIn")}{role ? ` · ${role}` : ""}</p>
          </footer>
        </div>
      </div>

      {!hideChrome && isAuthed && <BottomNav />}
      {!hideChrome && isAuthed && <Drawer open={drawerOpen} onClose={closeDrawer} />}
      <ToastHost />
    </div>
  );
}
