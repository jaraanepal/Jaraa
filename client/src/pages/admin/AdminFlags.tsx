import { useState } from "react";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { ErrorCard, Loading, NoticeBox, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import enDict from "../../i18n/en.json";
import neDict from "../../i18n/ne.json";
import type { FeatureFlag, ScanRule } from "../../api/types";
import {
  flagHistory, getDashboardConfig, setDashboardConfig,
  type FlagHistoryEntry, type DashboardConfig,
} from "../../api/b4admin";

const K4 = "p12d.admin";

type Tab = "flags" | "rules" | "history" | "dashconfig";

/** Known dashboard cards per role (A30) — the config stores { hiddenCards: [...] }. */
const ROLE_CARDS: Record<string, string[]> = {
  doctor: ["workload", "queue", "sla", "reviews"],
  admin: ["users", "orders", "kits", "flags", "audit", "moderation"],
  pharmacy: ["orders", "stock", "couriers", "claims"],
  coach: ["clients", "checkins", "escalations", "nudges"],
  customer: ["scan", "plan", "kits", "reminders"],
};

/** A35 — feature-flag change history from the audit log. */
function FlagHistoryTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => flagHistory(100).then((r) => r.history));
  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const rows: FlagHistoryEntry[] = data ?? [];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.flagHistory.title`)}</h3>
      {rows.length === 0 ? (
        <p className="tiny muted">{t(`${K4}.flagHistory.empty`)}</p>
      ) : (
        rows.map((h) => (
          <p key={h.id} className="tiny">
            {h.at.slice(0, 16).replace("T", " ")} — <b>{h.action}</b> — {h.entity_id} —{" "}
            {(h.actor_id ?? "").slice(0, 8)}
          </p>
        ))
      )}
    </div>
  );
}

/** A30 — per-role dashboard card toggles. */
function DashboardConfigTab() {
  const { t } = useLang();
  const [role, setRole] = useState("admin");
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { error, loading, retry } = useAsync(() =>
    getDashboardConfig(role).then((r) => {
      const cfg: DashboardConfig | null = r.config;
      const h = (cfg?.config as { hiddenCards?: unknown } | undefined)?.hiddenCards;
      setHidden(Array.isArray(h) ? h.filter((x): x is string => typeof x === "string") : []);
      return true;
    }), [role]);
  const errMsg = err ?? (error ? apiErrorMessage(t, error) : null);

  function toggle(card: string) {
    setHidden((p) => {
      const cur = p ?? [];
      return cur.includes(card) ? cur.filter((c) => c !== card) : [...cur, card];
    });
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await setDashboardConfig(role, { hiddenCards: hidden ?? [] });
      toast(t(`${K4}.dashboardConfig.saved`));
    } catch (e) {
      setErr(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  const cards = ROLE_CARDS[role] ?? [];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K4}.dashboardConfig.title`)}</h3>
      <label className="fl">{t(`${K4}.dashboardConfig.role`)}</label>
      <div className="filterrow">
        <select value={role} onChange={(e) => { setRole(e.target.value); setHidden(null); }}>
          {Object.keys(ROLE_CARDS).map((r) => (
            <option key={r} value={r}>{t(`roles.${r}`)}</option>
          ))}
        </select>
      </div>
      {errMsg && <ErrorCard message={errMsg} onRetry={() => { setErr(null); retry(); }} />}
      {loading || hidden === null ? (
        <Loading />
      ) : (
        <>
          <p className="tiny muted">{t(`${K4}.dashboardConfig.note`)}</p>
          {cards.map((c) => (
            <label className="rowflex" key={c} style={{ margin: "10px 0" }}>
              <input type="checkbox" checked={!hidden.includes(c)} onChange={() => toggle(c)} />
              <span>
                <b>{t(`${K4}.cards.${c}`)}</b>{" "}
                <span className={`chip${hidden.includes(c) ? " muted" : ""}`}>
                  {hidden.includes(c) ? t(`${K4}.dashboardConfig.hidden`) : t(`${K4}.dashboardConfig.shown`)}
                </span>
              </span>
            </label>
          ))}
          <button className="btn" disabled={saving} onClick={save}>
            {saving ? "…" : t(`${K4}.dashboardConfig.save`)}
          </button>
        </>
      )}
    </div>
  );
}

/** Flag label/description live in the dict as [label, desc] pairs. */
function flagCopy(lang: "ne" | "en", key: string): [string, string] {
  const dict = lang === "ne" ? neDict : enDict;
  const pair = (dict as unknown as { admin: { flags: Record<string, [string, string]> } }).admin.flags[key];
  return pair ?? [key, ""];
}

const MEDICAL_FLAGS = ["prescription_commerce", "teleconsult_booking"];

/** Feature flags + scan-rules editor (moved out of the old Admin page). */
export default function AdminFlags() {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<Tab>("flags");
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [rules, setRules] = useState<ScanRule[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loaded = useAsync(() =>
    Promise.all([adminApi.listFlags(), adminApi.listScanRules()]).then(([f, r]) => {
      setFlags(f.flags);
      setRules(r.rules);
      return true;
    }),
  );

  async function toggleFlag(f: FeatureFlag) {
    const next = !f.is_enabled;
    if (next && MEDICAL_FLAGS.includes(f.key)) {
      // Medical flags may only turn ON after the legal gate — confirm explicitly.
      if (!window.confirm(t("admin.flagsSub"))) return;
    }
    try {
      const updated = await adminApi.setFlag(f.key, next);
      setFlags((v) => v.map((x) => (x.key === f.key ? updated : x)));
    } catch (e) {
      setSaveError(apiErrorMessage(t, e));
    }
  }

  async function toggleRule(r: ScanRule) {
    try {
      const updated = await adminApi.updateScanRule(r.id, { is_active: !r.is_active });
      setRules((v) => v.map((x) => (x.id === r.id ? updated : x)));
      toast(t("admin.rulesSaved"));
    } catch (e) {
      setSaveError(apiErrorMessage(t, e));
    }
  }

  if (loaded.loading) return <Loading />;
  if (loaded.error) return <div className="screen"><h1>{t("admin.flagsTitle")}</h1><ErrorCard message={apiErrorMessage(t, loaded.error)} onRetry={loaded.retry} /></div>;

  return (
    <div className="screen">
      <h1>{t("admin.flagsTitle")}</h1>
      {saveError && <ErrorCard message={saveError} onRetry={() => setSaveError(null)} />}

      <div className="tabrow" role="tablist">
        {(["flags", "rules", "history", "dashconfig"] as Tab[]).map((x) => (
          <button key={x} className={`tab${tab === x ? " on" : ""}`} onClick={() => setTab(x)} role="tab" aria-selected={tab === x}>
            {x === "flags" ? t("admin.flagsTitle")
              : x === "rules" ? t("admin.rulesTitle")
              : x === "history" ? t(`${K4}.flagHistory.title`)
              : t(`${K4}.dashboardConfig.title`)}
          </button>
        ))}
      </div>

      {tab === "flags" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("admin.flagsTitle")}</h3>
          {flags.map((f) => {
            const [label, desc] = flagCopy(lang, f.key);
            return (
              <div className="rowflex" key={f.key} style={{ margin: "12px 0", alignItems: "flex-start" }}>
                <div>
                  <b>{label}</b>
                  <br />
                  <span className="tiny muted">{desc}</span>
                </div>
                <span className="spacer" />
                <span className="tiny muted" style={{ minWidth: 28, textAlign: "right" }}>
                  {f.is_enabled ? t("admin.on") : t("admin.off")}
                </span>
                <button
                  className={`toggle ${f.is_enabled ? "on" : ""}`}
                  onClick={() => toggleFlag(f)}
                  aria-pressed={f.is_enabled}
                  aria-label={`${label}: ${f.is_enabled ? t("admin.on") : t("admin.off")}`}
                />
              </div>
            );
          })}
          <NoticeBox tone="notice" title="">
            <p className="tiny">{t("admin.flagsSub")}</p>
          </NoticeBox>
          <p className="tiny muted">{t("admin.testTeleconsultBody")}</p>
        </div>
      )}

      {tab === "rules" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("admin.rulesTitle")}</h3>
          <p className="tiny muted">{t("admin.rulesSub")}</p>
          {rules
            .sort((a, b) => a.priority - b.priority)
            .map((r) => (
              <div className="rowflex" key={r.id} style={{ margin: "12px 0", alignItems: "flex-start" }}>
                <div>
                  <b className="kbd">{r.id}</b>
                  <br />
                  <span className="tiny muted">
                    {t("admin.priority")}: {r.priority} • {t("admin.action")}: {r.action}
                  </span>
                  <br />
                  <span className="tiny muted">{t("admin.trigger")}: {JSON.stringify(r.trigger_condition)}</span>
                </div>
                <span className="spacer" />
                <button
                  className={`toggle ${r.is_active ? "on" : ""}`}
                  onClick={() => toggleRule(r)}
                  aria-pressed={r.is_active}
                  aria-label={r.id}
                />
              </div>
            ))}
        </div>
      )}

      {tab === "history" && <FlagHistoryTab />}
      {tab === "dashconfig" && <DashboardConfigTab />}
    </div>
  );
}
