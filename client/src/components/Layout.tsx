import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { useFlags } from "../auth/FlagsContext";
import { Icon } from "./icons";
import { Modal, ToastHost } from "./ui";

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

function BottomNav() {
  const { t } = useLang();
  const { role } = useAuth();
  const items: Array<{ to: string; key: string; icon: (p: { size?: number }) => JSX.Element }> = [
    { to: "/", key: "nav.home", icon: Icon.home },
    { to: "/scan", key: "nav.scan", icon: Icon.scan },
    { to: "/plan", key: "nav.plan", icon: Icon.plan },
    { to: "/progress", key: "nav.progress", icon: Icon.chart },
    { to: "/kits", key: "nav.kits", icon: Icon.box },
  ];
  if (role === "doctor") items.push({ to: "/doctor", key: "nav.doctor", icon: Icon.doc });
  if (role === "admin") items.push({ to: "/admin", key: "nav.admin", icon: Icon.gear });
  return (
    <nav className="bottomnav" aria-label="Primary">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? "active" : "")} end={i.to === "/"}>
          {i.icon({ size: 22 })}
          <span>{t(i.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { t } = useLang();
  const { isAuthed, role, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const hideChrome = location.pathname === "/login";

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" style={{ color: "#fff", textDecoration: "none" }} aria-label="Jaraa home">
          <img src="/logo.png" alt="Jaraa logo" />
          <div>
            Jaraa
            <small>जरा · root / origin</small>
          </div>
        </Link>
        <LanguageToggle />
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
      <ToastHost />
    </div>
  );
}
