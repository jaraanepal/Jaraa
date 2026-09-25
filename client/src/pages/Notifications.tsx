import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { notificationsApi } from "../api/client";
import type { AppNotification } from "../api/types";
import { useLang } from "../i18n/LanguageContext";
import { Loading, EmptyState, apiErrorMessage } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";

/**
 * P-6: user notification inbox. Tapping a notification marks it read
 * and navigates to its link (e.g. /plan).
 */
export default function Notifications() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const r = await notificationsApi.list(50, 0);
    setItems(r.notifications);
    setUnread(r.unread_count);
    return r;
  }, []);
  const state = useAsync(load);

  async function open(n: AppNotification) {
    if (!n.read_at) {
      try {
        await notificationsApi.markRead(n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
        setUnread((u) => Math.max(0, u - 1));
      } catch {
        /* non-fatal — still navigate */
      }
    }
    if (n.link) navigate(n.link);
  }

  const title = (n: AppNotification) => (lang === "ne" && n.title_ne ? n.title_ne : n.title_en);
  const body = (n: AppNotification): string | null =>
    (lang === "ne" && n.body_ne ? n.body_ne : n.body_en) ?? null;

  if (state.loading) return <Loading />;

  const errMsg = state.error ? apiErrorMessage(t, state.error) : null;

  return (
    <div className="screen">
      <h1>{t("notif.title")}</h1>
      {errMsg && <p className="err">{errMsg}</p>}
      {unread > 0 && <p className="muted tiny">{t("notif.unread", { n: unread })}</p>}

      {!items.length ? (
        <EmptyState
          icon={<Icon.bell size={40} />}
          title={t("notif.emptyTitle")}
          body={t("notif.emptyBody")}
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                background: n.read_at ? "transparent" : "var(--green-l)",
                border: 0, borderBottom: "1px solid var(--line)",
                padding: "12px 14px", cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: n.read_at ? "var(--mut)" : "var(--green)", marginTop: 2 }}>
                  <Icon.bell size={20} />
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: n.read_at ? 400 : 700 }}>{title(n)}</p>
                  {body(n) && <p className="muted tiny" style={{ margin: "4px 0 0" }}>{body(n)}</p>}
                  <p className="tiny" style={{ margin: "6px 0 0", color: "var(--mut)" }}>
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
                {!n.read_at && (
                  <span
                    style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: "var(--gold)", marginTop: 6, flexShrink: 0,
                    }}
                  />
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="center" style={{ marginTop: 12 }}>
        <Link className="linklike" to="/">{t("common.back")}</Link>
      </div>
    </div>
  );
}
