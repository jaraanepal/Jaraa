import { useState } from "react";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { ErrorCard, Loading, NoticeBox, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import enDict from "../../i18n/en.json";
import neDict from "../../i18n/ne.json";
import type { FeatureFlag, ScanRule } from "../../api/types";

type Tab = "flags" | "rules";

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
        {(["flags", "rules"] as Tab[]).map((x) => (
          <button key={x} className={`tab${tab === x ? " on" : ""}`} onClick={() => setTab(x)} role="tab" aria-selected={tab === x}>
            {x === "flags" ? t("admin.flagsTitle") : t("admin.rulesTitle")}
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
    </div>
  );
}
