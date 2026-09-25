import { useState } from "react";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { ErrorCard, apiErrorMessage, toast } from "../../components/ui";
import { Icon } from "../../components/icons";

type Role = "customer" | "doctor" | "pharmacy" | "coach" | "";

/**
 * A1: broadcast an in-app notification to all users or one role.
 * Shows the server's sent/failed counts after sending.
 */
export default function AdminBroadcast() {
  const { t } = useLang();
  const [titleEn, setTitleEn] = useState("");
  const [titleNe, setTitleNe] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyNe, setBodyNe] = useState("");
  const [role, setRole] = useState<Role>("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!titleEn.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi.broadcast({
        title_en: titleEn.trim(),
        title_ne: titleNe.trim() || undefined,
        body_en: bodyEn.trim() || undefined,
        body_ne: bodyNe.trim() || undefined,
        role: role || undefined,
        link: link.trim() || undefined,
      });
      let msg = t("p12.admin.broadcastSent", { n: r.sent });
      if (r.failed > 0) msg += ` · ${t("p12.admin.broadcastFailed", { n: r.failed })}`;
      toast(msg);
      setTitleEn("");
      setTitleNe("");
      setBodyEn("");
      setBodyNe("");
      setLink("");
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>{t("p12.admin.broadcast")}</h1>
      <p className="muted tiny">{t("p12.admin.broadcastHint")}</p>

      <div className="card">
        {error && <ErrorCard message={error} />}
        <label className="fl" htmlFor="bc-title-en">{t("p12.admin.titleEnPh")}</label>
        <input
          id="bc-title-en"
          type="text"
          placeholder={t("p12.admin.titleEnPh")}
          value={titleEn}
          onChange={(e) => setTitleEn(e.target.value)}
        />
        <label className="fl" htmlFor="bc-title-ne">{t("p12.admin.titleNePh")}</label>
        <input
          id="bc-title-ne"
          type="text"
          placeholder={t("p12.admin.titleNePh")}
          value={titleNe}
          onChange={(e) => setTitleNe(e.target.value)}
        />
        <label className="fl" htmlFor="bc-body-en">{t("p12.admin.bodyEnPh")}</label>
        <textarea
          id="bc-body-en"
          rows={2}
          placeholder={t("p12.admin.bodyEnPh")}
          value={bodyEn}
          onChange={(e) => setBodyEn(e.target.value)}
        />
        <label className="fl" htmlFor="bc-body-ne">{t("p12.admin.bodyNePh")}</label>
        <textarea
          id="bc-body-ne"
          rows={2}
          placeholder={t("p12.admin.bodyNePh")}
          value={bodyNe}
          onChange={(e) => setBodyNe(e.target.value)}
        />
        <div className="rowflex" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label className="fl" htmlFor="bc-role">{t("p12.admin.audience")}</label>
            <select id="bc-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="">{t("p12.admin.everyone")}</option>
              <option value="customer">customer</option>
              <option value="doctor">doctor</option>
              <option value="pharmacy">pharmacy</option>
              <option value="coach">coach</option>
            </select>
          </div>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label className="fl" htmlFor="bc-link">{t("p12.admin.linkPh")}</label>
            <input
              id="bc-link"
              type="text"
              placeholder={t("p12.admin.linkPh")}
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </div>
        </div>
        <button className="btn btn-p" disabled={busy || !titleEn.trim()} onClick={send}>
          {busy ? t("common.loading") : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon.bell size={18} /> {t("p12.admin.sendBroadcast")}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
