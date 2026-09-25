import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi } from "../../api/client";
import { adminB3Api, type ChecklistItem, type StaffChecklist } from "../../api/b3admin";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { AdminUser, Role } from "../../api/types";
import {
  bulkSetUserStatus, deletionRequests, coachPerformance,
  type DeletionRequest, type CoachPerformanceRow,
} from "../../api/b4admin";

const K4 = "p12d.admin";

/** A38 — data deletion request queue (privacy tab). */
function DeletionRequestsTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => deletionRequests().then((r) => r.requests));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const rows: DeletionRequest[] = data ?? [];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.deletion.title`)}</h3>
      {rows.length === 0 ? (
        <EmptyState icon={<Icon.doc size={32} />} title={t(`${K4}.deletion.empty`)} />
      ) : (
        <table className="tiny" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t(`${K4}.deletion.user`)}</th>
              <th style={{ textAlign: "left" }}>{t(`${K4}.deletion.scheduledFor`)}</th>
              <th style={{ textAlign: "left" }}>{t(`${K4}.deletion.status`)}</th>
              <th style={{ textAlign: "left" }}>{t(`${K4}.deletion.note`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="kbd">{r.user_id.slice(0, 8)}…</td>
                <td>{r.scheduled_for.slice(0, 16).replace("T", " ")}</td>
                <td><span className="chip">{r.status}</span></td>
                <td>{r.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A41 — coach performance: escalations handled + avg satisfaction. */
function CoachPerfTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => coachPerformance().then((r) => r.coaches));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const rows: CoachPerformanceRow[] = data ?? [];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.coachPerf.title`)}</h3>
      {rows.length === 0 ? (
        <EmptyState icon={<Icon.user size={32} />} title={t(`${K4}.coachPerf.empty`)} />
      ) : (
        <table className="tiny" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t(`${K4}.coachPerf.coach`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.coachPerf.escalations`)}</th>
              <th style={{ textAlign: "right" }}>{t(`${K4}.coachPerf.avgSatisfaction`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.coach_id}>
                <td className="kbd">{c.coach_id.slice(0, 8)}…</td>
                <td style={{ textAlign: "right" }}>{c.escalations}</td>
                <td style={{ textAlign: "right" }}>
                  <b>{c.avgSatisfaction === null ? t(`${K4}.coachPerf.none`) : `${c.avgSatisfaction} / 5`}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const ROLES: Role[] = ["customer", "doctor", "admin", "pharmacy", "coach"];

/**
 * A28 — per-staff onboarding checklist. Canonical item keys are UI-defined for
 * now (labels render the raw key); create-or-replace on save.
 */
const CHECKLIST_KEYS = ["docs_verified", "profile_complete", "training_done", "agreement_signed"];

function StaffChecklistEditor({ user }: { user: AdminUser }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setOpen((o) => !o);
    if (!open && !loaded) {
      setLoading(true);
      adminB3Api
        .getStaffChecklist(user.id)
        .then((r) => {
          const cl: StaffChecklist | null = r.checklist;
          setItems(CHECKLIST_KEYS.map((key) => ({
            key,
            done: cl?.items.find((i) => i.key === key)?.done ?? false,
          })));
          setLoaded(true);
          setLoading(false);
        })
        .catch((e) => {
          setError(apiErrorMessage(t, e));
          setLoading(false);
        });
    }
  }

  async function save() {
    setSaving(true);
    try {
      await adminB3Api.saveStaffChecklist(user.id, items);
      toast(t("p12c.admin.staffChecklist.saveSuccess"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="btn btn-s" onClick={toggle}>
        {t("p12c.admin.staffChecklist.title")}
      </button>
      {open && (
        <div className="card" style={{ marginTop: 8 }}>
          {loading && <Loading />}
          {error && <ErrorCard message={error} />}
          {!loading && items.map((it) => (
            <label className="rowflex" key={it.key} style={{ marginBottom: 8, gap: 10 }}>
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => setItems((p) => p.map((x) => (x.key === it.key ? { ...x, done: !x.done } : x)))}
                style={{ width: 22, height: 22 }}
              />
              <span className="tiny">{it.key}</span>
            </label>
          ))}
          {!loading && items.length === 0 && !error && (
            <p className="tiny muted">{t("p12c.admin.staffChecklist.empty")}</p>
          )}
          <div className="btn-row">
            <button className="btn btn-p" disabled={saving || loading} onClick={save}>
              {saving ? t("common.loading") : t("p12c.admin.staffChecklist.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Users + staff management. Tabs: Staff (non-customer roles) and everyone.
 * Role changes are confirmed and audit-logged server-side.
 */
export default function AdminUsers() {
  const { t } = useLang();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "staff" ? "staff" : "all";
  const section = params.get("section") === "privacy" ? "privacy" : params.get("section") === "coachperf" ? "coachperf" : "users";
  const [q, setQ] = useState("");
  const [changing, setChanging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A36 — bulk selection for suspend/activate.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
  const setSection = (s: "users" | "privacy" | "coachperf") =>
    setParams(s === "users" ? (view === "staff" ? { view: "staff" } : {}) : { section: s }, { replace: true });

  /** A36 — bulk suspend/activate. The server refuses to disable the last active admin. */
  async function bulkStatus(disabled: boolean) {
    const ids = [...selected];
    if (ids.length === 0) {
      setError(t(`${K4}.bulkStatus.selectNone`));
      return;
    }
    const who = t(disabled ? `${K4}.bulkStatus.confirmSuspend` : `${K4}.bulkStatus.confirmActivate`).replace("{n}", String(ids.length));
    if (!window.confirm(who)) return;
    setBulkBusy(true);
    setError(null);
    try {
      const r = await bulkSetUserStatus(ids, disabled);
      setUsers((p) => (p ?? []).map((u) => (ids.includes(u.id) ? { ...u, is_active: !disabled } : u)));
      setSelected(new Set());
      toast(t(`${K4}.bulkStatus.done`).replace("{n}", String(r.updated)));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="screen">
      <h1>{t("adminUsers.title")}</h1>
      <p className="muted tiny">{t("adminUsers.sub")}</p>

      <div className="tabrow" role="tablist">
        <button className={`tab${section === "users" ? " on" : ""}`} role="tab" aria-selected={section === "users"} onClick={() => setSection("users")}>
          {t("adminUsers.title")}
        </button>
        <button className={`tab${section === "privacy" ? " on" : ""}`} role="tab" aria-selected={section === "privacy"} onClick={() => setSection("privacy")}>
          {t(`${K4}.deletion.title`)}
        </button>
        <button className={`tab${section === "coachperf" ? " on" : ""}`} role="tab" aria-selected={section === "coachperf"} onClick={() => setSection("coachperf")}>
          {t(`${K4}.coachPerf.title`)}
        </button>
      </div>

      {section === "privacy" && <DeletionRequestsTab />}
      {section === "coachperf" && <CoachPerfTab />}
      {section === "users" && (
        <>

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

      {/* A36 — bulk suspend/activate toolbar */}
      {!loading && !loadErrMsg && shown.length > 0 && (
        <div className="card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {selected.size > 0 && <span className="tiny muted">{selected.size} selected</span>}
          <button className="btn small danger" disabled={bulkBusy || selected.size === 0} onClick={() => bulkStatus(true)}>
            {t(`${K4}.bulkStatus.suspend`)}
          </button>
          <button className="btn small" disabled={bulkBusy || selected.size === 0} onClick={() => bulkStatus(false)}>
            {t(`${K4}.bulkStatus.activate`)}
          </button>
        </div>
      )}

      {!loading && !loadError && shown.length === 0 && (
        <EmptyState icon={<Icon.user size={32} />} title={t("adminUsers.empty")} />
      )}

      {shown.map((u) => (
        <div className="card" key={u.id} style={{ opacity: u.is_active ? 1 : 0.6 }}>
          <div className="rowflex">
            <input
              type="checkbox"
              checked={selected.has(u.id)}
              onChange={() => toggleSelected(u.id)}
              aria-label={`select ${u.phone}`}
            />
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
            {!u.is_active && <span className="chip muted">suspended</span>}
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
          {u.role !== "customer" && (
            <div style={{ marginTop: 10 }}>
              <StaffChecklistEditor user={u} />
            </div>
          )}
        </div>
      ))}
        </>
      )}
    </div>
  );
}
