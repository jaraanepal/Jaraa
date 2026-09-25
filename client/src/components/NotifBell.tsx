import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { notificationsApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { Icon } from "./icons";

/**
 * P-6: header bell with unread badge. Polls lightly (every 60s) and
 * refreshes when the auth state changes.
 */
export default function NotifBell() {
  const { t } = useLang();
  const { isAuthed } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!isAuthed) { setUnread(0); return; }
    let alive = true;
    const fetchCount = () => {
      notificationsApi.list(1, 0)
        .then((r) => { if (alive) setUnread(r.unread_count); })
        .catch(() => { /* non-fatal — badge just stays */ });
    };
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [isAuthed]);

  if (!isAuthed) return null;

  return (
    <Link
      to="/notifications"
      aria-label={t("notif.title")}
      title={t("notif.title")}
      style={{ position: "relative", color: "#fff", minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
    >
      <Icon.bell size={20} />
      {unread > 0 && (
        <span
          style={{
            position: "absolute", top: 4, right: 2,
            background: "var(--gold)", color: "#fff",
            fontSize: 10, fontWeight: 700, lineHeight: 1,
            minWidth: 18, height: 18, borderRadius: 9,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "0 4px",
          }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
