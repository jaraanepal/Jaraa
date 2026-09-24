import { useEffect, useState } from "react";
import { adminApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, NoticeBox, apiErrorMessage, toast } from "../components/ui";
import enDict from "../i18n/en.json";
import neDict from "../i18n/ne.json";
import type { AuditEntry, FeatureFlag, FunnelAnalytics, ScanRule } from "../api/types";

type Tab = "flags" | "rules" | "funnel" | "audit";

/** Flag label/description live in the dict as [label, desc] pairs. */
function flagCopy(lang: "ne" | "en", key: string): [string, string] {
  const dict = lang === "ne" ? neDict : enDict;
  const pair = (dict as unknown as { admin: { flags: Record<string, [string, string]> } }).admin.flags[key];
  return pair ?? [key, ""];
}

const MEDICAL_FLAGS = ["prescription_commerce", "teleconsult_booking"];

export default function Admin() {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<Tab>("flags");
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [rules, setRules] = useState<ScanRule[]>([]);
  const [funnel, setFunnel] = useState<FunnelAnalytics | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([adminApi.listFlags(), adminApi.listScanRules(), adminApi.getFunnel(), adminApi.listAudit({ limit: 50 })])
      .then(([f, r, fu, a]) => {
        setFlags(f.flags);
        setRules(r.rules);
        setFunnel(fu);
        setAudit(a.entries);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };

  useEffect(load, [t]);

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
      setError(apiErrorMessage(t, e));
    }
  }

  async function toggleRule(r: ScanRule) {
    try {
      const updated = await adminApi.updateScanRule(r.id, { is_active: !r.is_active });
      setRules((v) => v.map((x) => (x.id === r.id ? updated : x)));
      toast(t("admin.rulesSaved"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="screen">
      <h1>{t("nav.admin")}</h1>
      {error && <ErrorCard message={error} onRetry={load} />}

      <div className="btn-row" role="tablist">
        {(["flags", "rules", "funnel", "audit"] as Tab[]).map((x) => (
          <button key={x} className={tab === x ? "btn btn-p" : "btn btn-g"} onClick={() => setTab(x)} role="tab" aria-selected={tab === x}>
            {x === "flags" && t("admin.flagsTitle")}
            {x === "rules" && t("admin.rulesTitle")}
            {x === "funnel" && t("admin.funnelTitle")}
            {x === "audit" && t("admin.auditTitle")}
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

      {tab === "funnel" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("admin.analyticsTitle")}</h3>
          {funnel && (
            <>
              <p><b>{t("admin.slaTitle")}</b> {t("admin.slaMedian")} {funnel.review_sla_hours_median}h</p>
              <p>{t("admin.kitRate")} {(funnel.plan_view_to_kit_rate * 100).toFixed(1)}%</p>
              <p>{t("admin.rescanRate")} {(funnel.rescan_rate_m2 * 100).toFixed(1)}%</p>
              <p>{t("admin.redFlagMisses")} {funnel.red_flag_misses}</p>
              <h4>{t("admin.funnelTitle")}</h4>
              {funnel.stage_funnel.map((s) => (
                <p key={s.stage} className="tiny">
                  {s.stage}: {s.completed}/{s.entered}
                </p>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "audit" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t("admin.auditTitle")}</h3>
          {audit.slice(0, 30).map((a) => (
            <p key={a.id} className="tiny">
              {a.at.slice(0, 16).replace("T", " ")} — <b>{a.action}</b> — {a.entity}/{a.entity_id.slice(0, 8)} — {a.actor_id.slice(0, 8)}
            </p>
          ))}
          {audit.length === 0 && <p className="muted">—</p>}
        </div>
      )}
    </div>
  );
}
