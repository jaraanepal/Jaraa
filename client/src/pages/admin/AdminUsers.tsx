import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { AdminUser, Role } from "../../api/types";

const ROLES: Role[] = ["customer", "doctor", "admin", "pharmacy", "coach"];

/**
 * Users + staff management. Tabs: Staff (non-customer roles) and everyone.
 * Role changes are confirmed and audit-logged server-side.
 */
export default function AdminUsers() {
  const { t } = useLang();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "staff" ? "staff" : "all";
  const [q, setQ] = useState("");
  const [changing, setChanging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError, loading, retry } = useAsync(() =>
    adminApi.listUsers().then((r) => r.users),
  );
  const loadErrMsg = loadError ? apiErrorMessage(t, loadError) : null;

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  // Keep local list in sync after load.
  useEffect(() => {
    if (data) setUsers(data);
  }, [data]);

  const shown = useMemo(() => {
    const list = users ?? [];
    const byView = view === "staff" ? list.filter((u) => u.role !== "customer") : list;
    const needle = q.trim().toLowerCase();
    if (!needle) return byView;
    return byView.filter(
      (u) =>
        u.phone.toLowerCase().includes(needle) ||
        (u.email ?? "").toLowerCase().includes(needle) ||
        (u.name ?? "").toLowerCase().includes(needle),
    );
  }, [users, view, q]);

  async function changeRole(u: AdminUser, role: Role) {
    if (role === u.role) return;
    const who = u.name || u.phone;
    if (!window.confirm(t("adminUsers.roleConfirm", { name: who, role }))) return;
    setChanging(u.id);
    setError(null);
    try {
      const updated = await adminApi.updateUserRole(u.id, role);
      setUsers((p) => (p ?? []).map((x) => (x.id === u.id ? updated : x)));
      toast(t("adminUsers.roleSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setChanging(null);
    }
  }

  const setView = (v: "all" | "staff") =>
    setParams(v === "staff" ? { view: "staff" } : {}, { replace: true });

  return (
    <div className="screen">
      <h1>{t("adminUsers.title")}</h1>
      <p className="muted tiny">{t("adminUsers.sub")}</p>

      <div className="tabrow" role="tablist">
        <button className={`tab${view === "all" ? " on" : ""}`} role="tab" aria-selected={view === "all"} onClick={() => setView("all")}>
          {t("adminUsers.allTab")}
        </button>
        <button className={`tab${view === "staff" ? " on" : ""}`} role="tab" aria-selected={view === "staff"} onClick={() => setView("staff")}>
          {t("adminUsers.staffTab")}
        </button>
      </div>

      <div className="searchbar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("adminUsers.searchPh")}
          aria-label={t("adminUsers.searchPh")}
        />
      </div>

      {error && <ErrorCard message={error} />}
      {loading && <Loading />}
      {loadErrMsg && <ErrorCard message={loadErrMsg} onRetry={retry} />}

      {!loading && !loadError && shown.length === 0 && (
        <EmptyState icon={<Icon.user size={32} />} title={t("adminUsers.empty")} />
      )}

      {shown.map((u) => (
        <div className="card" key={u.id}>
          <div className="rowflex">
            <span style={{ color: "var(--green)" }}><Icon.user size={24} /></span>
            <div>
              <b>{u.name || u.phone}</b>
              <br />
              <span className="tiny muted">
                {u.phone}
                {u.email ? ` · ${u.email}` : ""} · {u.created_at.slice(0, 10)}
              </span>
            </div>
            <span className="spacer" />
            <span className={`chip${u.role === "customer" ? " grey" : ""}`}>{u.role}</span>
          </div>
          <label className="fl" style={{ marginTop: 10 }}>{t("adminUsers.changeRole")}</label>
          <div className="filterrow">
            <select
              value={u.role}
              disabled={changing === u.id}
              onChange={(e) => changeRole(u, e.target.value as Role)}
              aria-label={`${t("adminUsers.changeRole")} — ${u.phone}`}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{t(`roles.${r}`)}</option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}
