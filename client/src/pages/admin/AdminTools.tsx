import { useState } from "react";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import type { Announcement, Coupon, NotificationTemplate } from "../../api/types";
import { scheduleAnnouncement, consentVersions, createConsentVersion, activateConsentVersion, type ConsentVersion } from "../../api/b4admin";

const K4 = "p12d.admin";
const CK = "p12d.admin.consent";
const CONSENT_KINDS = ["signup", "scan", "marketing", "data"];

/** A45 — consent version list + creation + activation. */
function ConsentVersionsSection() {
  const { t } = useLang();
  const [kind, setKind] = useState(CONSENT_KINDS[0]);
  const versions = useAsync(() => consentVersions(kind).then((r) => r.versions), [kind]);
  const [version, setVersion] = useState(1);
  const [textEn, setTextEn] = useState("");
  const [textNe, setTextNe] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!textEn.trim()) return;
    setBusy(true);
    try {
      await createConsentVersion({
        kind,
        version,
        text_en: textEn.trim(),
        text_ne: textNe.trim() || null,
      });
      setTextEn(""); setTextNe(""); setVersion((v) => v + 1);
      toast(t(`${CK}.saved`));
      versions.retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function activate(v: ConsentVersion) {
    setBusy(true);
    try {
      await activateConsentVersion(v.id);
      toast(t(`${CK}.activated`));
      versions.retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${CK}.title`)}</h3>
      <div className="formrow inline">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t(`${CK}.kind`)}>
          {CONSENT_KINDS.map((k) => (
            <option key={k} value={k}>{t(`${CK}.kinds.${k}`)}</option>
          ))}
        </select>
        <input
          type="number" min={1} value={version}
          onChange={(e) => setVersion(Math.max(1, parseInt(e.target.value, 10) || 1))}
          aria-label={t(`${CK}.version`)} style={{ width: 90 }}
        />
      </div>
      <div className="formrow">
        <textarea value={textEn} onChange={(e) => setTextEn(e.target.value)} placeholder={t(`${CK}.textEn`)} rows={2} maxLength={20000} />
        <textarea value={textNe} onChange={(e) => setTextNe(e.target.value)} placeholder={t(`${CK}.textNe`)} rows={2} maxLength={20000} />
        <button className="btn" disabled={busy || !textEn.trim()} onClick={add}>{t(`${CK}.add`)}</button>
      </div>
      {versions.error ? <ErrorCard message={apiErrorMessage(t, versions.error)} onRetry={versions.retry} /> : null}
      {versions.data && versions.data.length === 0 && <p className="tiny muted">{t(`${CK}.empty`)}</p>}
      {versions.data && versions.data.length > 0 && (
        <ul className="list">
          {versions.data.map((v) => (
            <li key={v.id} className="listrow">
              <div style={{ flex: 1 }}>
                <strong>v{v.version}</strong>{" "}
                {v.active && <span className="chip">{t(`${CK}.activeNow`)}</span>}
                <p className="muted">{v.text_en.slice(0, 120)}</p>
              </div>
              {!v.active && (
                <button className="btn small" disabled={busy} onClick={() => activate(v)}>
                  {t(`${CK}.activate`)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A43 — schedule/clear an announcement's publish_at. */
function AnnouncementSchedule({ a, onDone }: { a: Announcement & { publish_at?: string | null }; onDone: () => void }) {
  const { t } = useLang();
  const [value, setValue] = useState(a.publish_at ? a.publish_at.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);

  async function save(clear: boolean) {
    setBusy(true);
    try {
      await scheduleAnnouncement(a.id, clear ? null : new Date(value).toISOString());
      if (clear) setValue("");
      toast(t(`${K4}.schedule.saved`));
      onDone();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <p className="tiny muted" style={{ margin: "0 0 4px" }}>
        {a.publish_at
          ? `${t(`${K4}.schedule.scheduledFor`)}: ${a.publish_at.slice(0, 16).replace("T", " ")}`
          : t(`${K4}.schedule.notScheduled`)}
      </p>
      <div className="rowflex" style={{ gap: 8 }}>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t(`${K4}.schedule.title`)}
          style={{ flex: 1 }}
        />
        <button className="btn small" style={{ width: "auto", margin: 0 }} disabled={busy || !value} onClick={() => save(false)}>
          {t(`${K4}.schedule.save`)}
        </button>
        <button className="btn small" style={{ width: "auto", margin: 0 }} disabled={busy || !a.publish_at} onClick={() => save(true)}>
          {t(`${K4}.schedule.clear`)}
        </button>
      </div>
    </div>
  );
}

const ROLES = ["doctor", "pharmacy", "coach", "admin"];

/**
 * Admin batch-2 (008) toolkit: role permission editor (A12), announcements
 * (A13), session viewer/revoker (A14), login-attempt log (A15), coupons
 * (A16), system health (A17), storage usage (A18), backup log (A19) and
 * notification templates (A20).
 */
export default function AdminTools() {
  const { t } = useLang();
  const K = "p12b.admin";

  // ---- A12 role permissions ----
  const [permRole, setPermRole] = useState("doctor");
  const perms = useAsync(() => adminApi.getRolePermissions(permRole).then((r) => r.permissions), [permRole]);
  const [permInput, setPermInput] = useState("");
  async function togglePerm(p: { permission: string; granted: boolean }) {
    try {
      const next = (perms.data ?? []).map((x) => ({ permission: x.permission, granted: x.permission === p.permission ? !x.granted : x.granted }));
      await adminApi.setRolePermissions(permRole, next);
      perms.retry();
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function addPerm() {
    const permission = permInput.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{2,60}$/.test(permission)) { toast(t(`${K}.permInvalid`)); return; }
    try {
      const next = (perms.data ?? []).map((x) => ({ permission: x.permission, granted: x.granted }));
      next.push({ permission, granted: true });
      await adminApi.setRolePermissions(permRole, next);
      setPermInput("");
      perms.retry();
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- A13 announcements ----
  const announcements = useAsync(() => adminApi.listAnnouncements().then((r) => r.announcements));
  const [anTitle, setAnTitle] = useState("");
  const [anBody, setAnBody] = useState("");
  const [anLink, setAnLink] = useState("");
  async function addAnnouncement() {
    if (!anTitle.trim()) return;
    try {
      await adminApi.createAnnouncement({ title_en: anTitle.trim(), body_en: anBody.trim() || null, link: anLink.trim() || null });
      setAnTitle(""); setAnBody(""); setAnLink("");
      announcements.retry();
      toast(t(`${K}.announcementSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function toggleAnnouncement(a: Announcement) {
    try { await adminApi.updateAnnouncement(a.id, { is_active: !a.is_active }); announcements.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function removeAnnouncement(a: Announcement) {
    if (!window.confirm(t(`${K}.deleteConfirm`, { name: a.title_en }))) return;
    try { await adminApi.deleteAnnouncement(a.id); announcements.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- A14 sessions ----
  const [sessUser, setSessUser] = useState("");
  const [sessions, setSessions] = useState<{ token_hash: string; user_id: string; device: string | null; ip: string | null; created_at: string; last_seen_at: string }[] | null>(null);
  const [sessErr, setSessErr] = useState<string | null>(null);
  async function loadSessions() {
    setSessErr(null);
    try { setSessions((await adminApi.listSessions(sessUser.trim())).sessions); }
    catch (e) { setSessErr(apiErrorMessage(t, e)); setSessions(null); }
  }
  async function revokeSession(tokenHash: string) {
    if (!window.confirm(t(`${K}.revokeConfirm`))) return;
    try {
      await adminApi.revokeSession(tokenHash, sessUser.trim());
      loadSessions();
      toast(t(`${K}.sessionRevoked`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- A15 login attempts ----
  const attempts = useAsync(() => adminApi.listLoginAttempts(50).then((r) => r.attempts));

  // ---- A16 coupons ----
  const coupons = useAsync(() => adminApi.listCoupons().then((r) => r.coupons));
  const [cpCode, setCpCode] = useState("");
  const [cpKind, setCpKind] = useState<"percent" | "fixed_npr">("percent");
  const [cpValue, setCpValue] = useState("10");
  async function addCoupon() {
    if (!cpCode.trim()) return;
    try {
      await adminApi.createCoupon({ code: cpCode.trim().toUpperCase(), kind: cpKind, value: parseInt(cpValue, 10) || 0 });
      setCpCode(""); setCpValue("10");
      coupons.retry();
      toast(t(`${K}.couponSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function toggleCoupon(c: Coupon) {
    try { await adminApi.updateCoupon(c.id, !c.is_active); coupons.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- A17 health / A18 storage / A19 backups ----
  const health = useAsync(() => adminApi.getHealth());
  const storage = useAsync(() => adminApi.getStorage().then((r) => r.buckets));
  const backups = useAsync(() => adminApi.listBackups().then((r) => r.backups));
  const [bkLabel, setBkLabel] = useState("");
  const [bkStatus, setBkStatus] = useState("ok");
  async function addBackup() {
    if (!bkLabel.trim()) return;
    try {
      await adminApi.recordBackup({ label: bkLabel.trim(), status: bkStatus });
      setBkLabel("");
      backups.retry();
      toast(t(`${K}.backupSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }

  // ---- A20 notification templates ----
  const templates = useAsync(() => adminApi.listNotificationTemplates().then((r) => r.templates));
  const [tpName, setTpName] = useState("");
  const [tpTitle, setTpTitle] = useState("");
  async function addTemplate() {
    if (!tpName.trim() || !tpTitle.trim()) return;
    try {
      await adminApi.createNotificationTemplate({ name: tpName.trim(), title_en: tpTitle.trim() });
      setTpName(""); setTpTitle("");
      templates.retry();
      toast(t(`${K}.templateSaved`));
    } catch (e) { toast(apiErrorMessage(t, e)); }
  }
  async function removeTemplate(x: NotificationTemplate) {
    if (!window.confirm(t(`${K}.deleteConfirm`, { name: x.name }))) return;
    try { await adminApi.deleteNotificationTemplate(x.id); templates.retry(); }
    catch (e) { toast(apiErrorMessage(t, e)); }
  }

  return (
    <div className="page">
      <h1>{t(`${K}.title`)}</h1>

      {/* A12 role permissions */}
      <section>
        <h2>{t(`${K}.permissions`)}</h2>
        <div className="formrow inline">
          <select value={permRole} onChange={(e) => setPermRole(e.target.value)} aria-label={t(`${K}.role`)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={permInput} onChange={(e) => setPermInput(e.target.value)} placeholder={t(`${K}.permPh`)} />
          <button className="btn" onClick={addPerm}>{t("common.add")}</button>
        </div>
        {perms.error ? <ErrorCard message={apiErrorMessage(t, perms.error)} onRetry={perms.retry} /> : null}
        {perms.data && perms.data.length === 0 && <EmptyState title={t(`${K}.noPerms`)} />}
        {perms.data && perms.data.length > 0 && (
          <ul className="list">
            {perms.data.map((p) => (
              <li key={p.permission} className="listrow">
                <code>{p.permission}</code>
                <button className={`btn small${p.granted ? "" : " danger"}`} onClick={() => togglePerm(p)}>
                  {p.granted ? t("common.on") : t("common.off")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A13 announcements */}
      <section>
        <h2>{t(`${K}.announcements`)}</h2>
        <div className="formrow">
          <input value={anTitle} onChange={(e) => setAnTitle(e.target.value)} placeholder={t(`${K}.anTitlePh`)} maxLength={200} />
          <textarea value={anBody} onChange={(e) => setAnBody(e.target.value)} placeholder={t(`${K}.anBodyPh`)} rows={2} maxLength={2000} />
          <input value={anLink} onChange={(e) => setAnLink(e.target.value)} placeholder={t(`${K}.anLinkPh`)} maxLength={500} />
          <button className="btn" disabled={!anTitle.trim()} onClick={addAnnouncement}>{t(`${K}.publish`)}</button>
        </div>
        {announcements.error ? <ErrorCard message={apiErrorMessage(t, announcements.error)} onRetry={announcements.retry} /> : null}
        {announcements.data && (
          <ul className="list">
            {announcements.data.map((a) => (
              <li key={a.id} className="listrow">
                <div style={{ flex: 1 }}>
                  <strong>{a.title_en}</strong>{" "}
                  <span className={`chip${a.is_active ? "" : " muted"}`}>{a.is_active ? t("common.on") : t("common.off")}</span>
                  {a.body_en && <p className="muted">{a.body_en.slice(0, 120)}</p>}
                  <AnnouncementSchedule a={a as Announcement & { publish_at?: string | null }} onDone={() => announcements.retry()} />
                </div>
                <div className="rowflex">
                  <button className="btn small" onClick={() => toggleAnnouncement(a)}>{a.is_active ? t(`${K}.deactivate`) : t(`${K}.activate`)}</button>
                  <button className="btn small danger" onClick={() => removeAnnouncement(a)}>{t("common.delete")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A45 consent versions */}
      <section>
        <ConsentVersionsSection />
      </section>

      {/* A14 sessions */}
      <section>
        <h2>{t(`${K}.sessions`)}</h2>
        <div className="formrow inline">
          <input value={sessUser} onChange={(e) => setSessUser(e.target.value)} placeholder={t(`${K}.sessUserPh`)} />
          <button className="btn" disabled={!sessUser.trim()} onClick={loadSessions}>{t(`${K}.load`)}</button>
        </div>
        {sessErr ? <ErrorCard message={sessErr} /> : null}
        {sessions && sessions.length === 0 && <EmptyState title={t(`${K}.noSessions`)} />}
        {sessions && sessions.length > 0 && (
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.token_hash} className="listrow">
                <div>
                  <code>{s.token_hash}</code>
                  <p className="muted">{s.device ?? "—"} · {s.ip ?? "—"} · {s.last_seen_at.slice(0, 16).replace("T", " ")}</p>
                </div>
                <button className="btn small danger" onClick={() => revokeSession(s.token_hash)}>{t(`${K}.revoke`)}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A15 login attempts */}
      <section>
        <h2>{t(`${K}.loginAttempts`)}</h2>
        {attempts.error ? <ErrorCard message={apiErrorMessage(t, attempts.error)} onRetry={attempts.retry} /> : null}
        {attempts.data && (
          <ul className="list">
            {attempts.data.map((a) => (
              <li key={a.id} className="listrow">
                <div>
                  <code>{a.email ?? a.phone ?? "—"}</code>
                  <p className="muted">{a.ip ?? "—"} · {a.created_at.slice(0, 16).replace("T", " ")}</p>
                </div>
                <span className={`chip${a.success ? "" : " warn"}`}>{a.success ? t(`${K}.ok`) : t(`${K}.failed`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A16 coupons */}
      <section>
        <h2>{t(`${K}.coupons`)}</h2>
        <div className="formrow inline">
          <input value={cpCode} onChange={(e) => setCpCode(e.target.value)} placeholder={t(`${K}.couponCodePh`)} maxLength={40} />
          <select value={cpKind} onChange={(e) => setCpKind(e.target.value as "percent" | "fixed_npr")}>
            <option value="percent">%</option>
            <option value="fixed_npr">NPR</option>
          </select>
          <input value={cpValue} onChange={(e) => setCpValue(e.target.value)} inputMode="numeric" style={{ width: 80 }} aria-label={t(`${K}.couponValue`)} />
          <button className="btn" disabled={!cpCode.trim()} onClick={addCoupon}>{t("common.add")}</button>
        </div>
        {coupons.error ? <ErrorCard message={apiErrorMessage(t, coupons.error)} onRetry={coupons.retry} /> : null}
        {coupons.data && (
          <ul className="list">
            {coupons.data.map((c) => (
              <li key={c.id} className="listrow">
                <div>
                  <strong><code>{c.code}</code></strong>{" "}
                  <span className="muted">{c.kind === "percent" ? `${c.value}%` : `NPR ${c.value}`} · {t(`${K}.used`, { n: c.used_count })}</span>
                </div>
                <button className={`btn small${c.is_active ? "" : " danger"}`} onClick={() => toggleCoupon(c)}>
                  {c.is_active ? t(`${K}.deactivate`) : t(`${K}.activate`)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A17 health */}
      <section>
        <h2>{t(`${K}.health`)}</h2>
        {health.error ? <ErrorCard message={apiErrorMessage(t, health.error)} onRetry={health.retry} /> : null}
        {health.data && (
          <div className="statgrid">
            <StatCard label={t(`${K}.dbOk`)} value={health.data.db_ok ? t(`${K}.ok`) : t(`${K}.failed`)} />
            <StatCard label={t(`${K}.dbLatency`)} value={`${health.data.db_latency_ms}ms`} />
            <StatCard label={t(`${K}.audit1h`)} value={String(health.data.audit_events_1h)} />
          </div>
        )}
      </section>

      {/* A18 storage */}
      <section>
        <h2>{t(`${K}.storage`)}</h2>
        {storage.error ? <ErrorCard message={apiErrorMessage(t, storage.error)} onRetry={storage.retry} /> : null}
        {storage.data && (
          <div className="statgrid">
            {storage.data.map((b) => (
              <StatCard key={b.bucket} label={b.bucket} value={String(b.files)} />
            ))}
          </div>
        )}
      </section>

      {/* A19 backups */}
      <section>
        <h2>{t(`${K}.backups`)}</h2>
        <div className="formrow inline">
          <input value={bkLabel} onChange={(e) => setBkLabel(e.target.value)} placeholder={t(`${K}.backupLabelPh`)} maxLength={200} />
          <select value={bkStatus} onChange={(e) => setBkStatus(e.target.value)}>
            <option value="ok">{t(`${K}.ok`)}</option>
            <option value="failed">{t(`${K}.failed`)}</option>
            <option value="running">{t(`${K}.running`)}</option>
          </select>
          <button className="btn" disabled={!bkLabel.trim()} onClick={addBackup}>{t(`${K}.record`)}</button>
        </div>
        {backups.error ? <ErrorCard message={apiErrorMessage(t, backups.error)} onRetry={backups.retry} /> : null}
        {backups.data && (
          <ul className="list">
            {backups.data.map((b) => (
              <li key={b.id} className="listrow">
                <div><strong>{b.label}</strong><p className="muted">{b.created_at.slice(0, 16).replace("T", " ")}{b.note ? ` · ${b.note}` : ""}</p></div>
                <span className={`chip${b.status === "ok" ? "" : " warn"}`}>{b.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A20 notification templates */}
      <section>
        <h2>{t(`${K}.templates`)}</h2>
        <div className="formrow inline">
          <input value={tpName} onChange={(e) => setTpName(e.target.value)} placeholder={t(`${K}.templateNamePh`)} maxLength={120} />
          <input value={tpTitle} onChange={(e) => setTpTitle(e.target.value)} placeholder={t(`${K}.templateTitlePh`)} maxLength={200} />
          <button className="btn" disabled={!tpName.trim() || !tpTitle.trim()} onClick={addTemplate}>{t("common.add")}</button>
        </div>
        {templates.error ? <ErrorCard message={apiErrorMessage(t, templates.error)} onRetry={templates.retry} /> : null}
        {templates.data && (
          <ul className="list">
            {templates.data.map((x) => (
              <li key={x.id} className="listrow">
                <div><strong><code>{x.name}</code></strong><p className="muted">{x.title_en}</p></div>
                <button className="btn small danger" onClick={() => removeTemplate(x)}>{t("common.delete")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
