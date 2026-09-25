/**
 * Batch 4 (010) customer UI blocks: U30–U47 + C28/C45 customer-side support.
 *
 * Each block is a self-contained card/section. Pages import only the blocks
 * they need; nothing here touches routing (App.tsx is integration-owned).
 * All copy is bilingual via p12d.customer.* — never hardcoded.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";
import { customerB4Api } from "../api/b4customer";
import type {
  ChallengeCertificate,
  KitReminder,
  KitUsage,
  OwnSession,
  ReorderSuggestion,
} from "../api/b4customer";
import { meApi, notificationsApi, shopApi } from "../api/client";
import { Chip, EmptyState, ErrorCard, Loading, Modal, NoticeBox, apiErrorMessage, toast } from "./ui";
import { Icon } from "./icons";

const K = "p12d.customer";

/* ================================ U31: streak ================================ */

/** Streak card: consecutive check-in days (server-computed). */
export function StreakCard() {
  const { t } = useLang();
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    customerB4Api.getStreak().then((r) => setDays(r.days)).catch(() => setDays(null));
  }, []);
  if (days === null) return null;
  return (
    <section className="card" aria-label={t(`${K}.streakTitle`)}>
      <div className="rowflex">
        <span style={{ color: "var(--gold)" }}><Icon.clock size={28} /></span>
        <div>
          <b>{t(`${K}.streakTitle`)}</b>
          <br />
          <span className="tiny muted">{t(`${K}.streakDays`, { n: days })}</span>
        </div>
        <span className="spacer" />
        <Link className="linklike" to="/progress">{t(`${K}.streakCta`)}</Link>
      </div>
    </section>
  );
}

/* ================================ U41: reorder ================================ */

/** Reorder suggestions: kits whose latest order is 60+ days old. */
export function ReorderCard() {
  const { t } = useLang();
  const [items, setItems] = useState<ReorderSuggestion[] | null>(null);
  useEffect(() => {
    customerB4Api.getReorderSuggestions().then((r) => setItems(r.suggestions ?? [])).catch(() => setItems([]));
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <section className="card" aria-label={t(`${K}.reorderTitle`)}>
      <h3 style={{ marginTop: 0 }}>{t(`${K}.reorderTitle`)}</h3>
      {items.map((s) => (
        <div className="rowflex" key={s.kit_id} style={{ margin: "10px 0" }}>
          <span style={{ color: "var(--green)" }}><Icon.box size={22} /></span>
          <div style={{ flex: 1 }}>
            <b>{s.kit_name}</b>
            <br />
            <span className="tiny muted">{t(`${K}.reorderLast`, { date: s.ordered_at.slice(0, 10) })}</span>
          </div>
          <Link className="btn btn-s btn-p" to={`/kits/${s.kit_id}`} style={{ textDecoration: "none" }}>
            {t(`${K}.reorderCta`)}
          </Link>
        </div>
      ))}
    </section>
  );
}

/* ================================ U33: price drops ================================ */

/** Price-drop alerts: recent price_drop notifications for wishlisted kits. */
export function PriceDropCard() {
  const { t, lang } = useLang();
  const [drops, setDrops] = useState<{ id: string; title: string; body: string; link: string | null; created_at: string }[] | null>(null);
  useEffect(() => {
    notificationsApi
      .list(20, 0)
      .then((r) =>
        setDrops(
          (r.notifications ?? [])
            .filter((n) => n.type === "price_drop")
            .slice(0, 3)
            .map((n) => ({
              id: n.id,
              title: lang === "ne" ? n.title_ne ?? n.title_en : n.title_en,
              body: lang === "ne" ? n.body_ne ?? n.body_en ?? "" : n.body_en ?? "",
              link: n.link ?? null,
              created_at: n.created_at,
            })),
        ),
      )
      .catch(() => setDrops([]));
  }, [lang]);
  if (!drops || drops.length === 0) return null;
  return (
    <section className="card" aria-label={t(`${K}.priceDropTitle`)}
      style={{ border: "2px solid var(--gold)", borderRadius: 12 }}>
      <div className="rowflex">
        <span style={{ color: "var(--gold)" }}><Icon.bell size={24} /></span>
        <h3 style={{ margin: 0 }}>{t(`${K}.priceDropTitle`)}</h3>
      </div>
      {drops.map((d) => (
        <div className="rowflex" key={d.id} style={{ margin: "10px 0" }}>
          <div style={{ flex: 1 }}>
            <b>{d.title}</b>
            <br />
            <span className="tiny muted">{d.body}</span>
          </div>
          {d.link && (
            <Link className="btn btn-s" to={d.link} style={{ textDecoration: "none" }}>
              {t(`${K}.priceDropCta`)}
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}

/* ================================ U34: tracking ================================ */

/** Order tracking: courier name + tracking id (both already on the order). */
export function TrackingInfo({ order }: { order: { courier_name?: string | null; tracking_id?: string | null } }) {
  const { t } = useLang();
  if (!order.courier_name && !order.tracking_id) return null;
  return (
    <div className="rowflex" style={{ marginTop: 10, gap: 8 }}>
      <span style={{ color: "var(--green)" }}><Icon.truck size={20} /></span>
      <span className="tiny">
        {order.courier_name && <><b>{t(`${K}.trackingCourier`)}</b> {order.courier_name} </>}
        {order.tracking_id && <><b>{t(`${K}.trackingId`)}</b> <span className="kbd">{order.tracking_id}</span></>}
      </span>
    </div>
  );
}

/* ================================ U39: offline banner ================================ */

/** Offline banner: shown only while the browser reports no connectivity. */
export function OfflineBanner() {
  const { t } = useLang();
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  if (online) return null;
  return (
    <div role="alert" className="card" style={{ border: "2px solid var(--bad)", borderRadius: 12 }}>
      <div className="rowflex">
        <span style={{ color: "var(--bad)" }}><Icon.alert size={22} /></span>
        <b>{t(`${K}.offlineMsg`)}</b>
      </div>
    </div>
  );
}

/* ================================ U30: profile completion ================================ */

const COMPLETION_FIELDS = [
  "name", "age_band", "gender", "photo_url",
  "addresses", "delivery_instructions", "content_language", "default_payment",
] as const;

/** Profile completion meter (8 additive fields; no fake weighting). */
export function ProfileCompletion() {
  const { t } = useLang();
  const [pct, setPct] = useState<number | null>(null);
  useEffect(() => {
    meApi.getProfile().then((p) => {
      const got = COMPLETION_FIELDS.filter((f) => {
        switch (f) {
          case "name": return !!p.name?.trim();
          case "age_band": return !!p.age_band;
          case "gender": return !!p.gender;
          case "photo_url": return !!p.photo_url;
          case "addresses": return (p.addresses ?? []).length > 0;
          case "delivery_instructions": return !!p.delivery_instructions?.trim();
          case "content_language": return !!(p as { content_language?: string | null }).content_language;
          case "default_payment": return !!(p as { default_payment?: string | null }).default_payment;
          default: return false;
        }
      }).length;
      setPct(Math.round((got / COMPLETION_FIELDS.length) * 100));
    }).catch(() => setPct(null));
  }, []);
  if (pct === null) return null;
  return (
    <div className="card" aria-label={t(`${K}.completionTitle`)}>
      <div className="rowflex">
        <b>{t(`${K}.completionTitle`)}</b>
        <span className="spacer" />
        <b>{pct}%</b>
      </div>
      <div style={{ height: 8, borderRadius: 6, background: "var(--line)", overflow: "hidden", marginTop: 8 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--green)" }} />
      </div>
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>{t(`${K}.completionHint`)}</p>
    </div>
  );
}

/* ================================ U30/U46: preferences ================================ */

/** Content-language + default-payment preferences (saved to the profile). */
export function PreferencesCard() {
  const { t } = useLang();
  const [contentLang, setContentLang] = useState("");
  const [defaultPay, setDefaultPay] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    meApi.getProfile().then((p) => {
      setContentLang((p as { content_language?: string | null }).content_language ?? "");
      setDefaultPay((p as { default_payment?: string | null }).default_payment ?? "");
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);
  async function save() {
    setSaving(true);
    try {
      await customerB4Api.savePreferences({
        content_language: (contentLang || null) as "ne" | "en" | null,
        default_payment: (defaultPay || null) as "esewa" | "khalti" | "cod" | null,
      });
      toast(t(`${K}.prefsSaved`));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }
  if (!loaded) return null;
  return (
    <div className="card">
      <h2>{t(`${K}.prefsTitle`)}</h2>
      <label className="fl" htmlFor="b4-clang">{t(`${K}.contentLang`)}</label>
      <select id="b4-clang" value={contentLang} onChange={(e) => setContentLang(e.target.value)}>
        <option value="">{t(`${K}.notSet`)}</option>
        <option value="ne">नेपाली</option>
        <option value="en">English</option>
      </select>
      <label className="fl" htmlFor="b4-dpay">{t(`${K}.defaultPay`)}</label>
      <select id="b4-dpay" value={defaultPay} onChange={(e) => setDefaultPay(e.target.value)}>
        <option value="">{t(`${K}.notSet`)}</option>
        <option value="esewa">{t(`${K}.payEsewa`)}</option>
        <option value="khalti">{t(`${K}.payKhalti`)}</option>
        <option value="cod">{t(`${K}.payCod`)}</option>
      </select>
      <button className="btn btn-p" disabled={saving} onClick={save}>
        {saving ? t("common.loading") : t("common.save")}
      </button>
    </div>
  );
}

/* ================================ U32: referrals ================================ */

/** Referral card: own code + honest empty join list (no join tracking exists). */
export function ReferralCard() {
  const { t } = useLang();
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    customerB4Api.getReferrals().then((r) => setCode(r.code)).catch(() => setCode(null));
  }, []);
  if (code === null) return null;
  return (
    <div className="card">
      <h2>{t(`${K}.referralTitle`)}</h2>
      <div className="rowflex">
        <span className="kbd" style={{ fontSize: 18 }}>{code}</span>
        <span className="spacer" />
        <button
          className="btn btn-s"
          onClick={() => {
            try {
              void navigator.clipboard?.writeText(code);
              toast(t(`${K}.copied`));
            } catch { /* clipboard unavailable */ }
          }}
        >
          {t(`${K}.copyCode`)}
        </button>
      </div>
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>{t(`${K}.referralHint`)}</p>
    </div>
  );
}

/* ================================ U37: feedback ================================ */

/** App feedback: 1–5 star rating + optional message. */
export function FeedbackForm() {
  const { t } = useLang();
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  async function send() {
    if (rating < 1 || sending) return;
    setSending(true);
    try {
      await customerB4Api.postFeedback(rating, message);
      setDone(true);
      setRating(0);
      setMessage("");
      toast(t(`${K}.feedbackSent`));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="card">
      <h2>{t(`${K}.feedbackTitle`)}</h2>
      <p className="tiny muted" style={{ marginTop: 0 }}>{t(`${K}.feedbackHint`)}</p>
      <div role="radiogroup" aria-label={t(`${K}.feedbackTitle`)} className="rowflex" style={{ gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} / 5`}
            className="btn btn-s"
            style={{
              minWidth: 48, minHeight: 48, fontSize: 20,
              background: rating >= n ? "var(--gold)" : undefined,
              color: rating >= n ? "#fff" : undefined,
            }}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>
      <label className="fl" htmlFor="b4-fbmsg">{t(`${K}.feedbackMsg`)}</label>
      <textarea
        id="b4-fbmsg" value={message} onChange={(e) => setMessage(e.target.value)}
        placeholder={t(`${K}.feedbackMsgPh`)} rows={3} maxLength={2000}
      />
      <button className="btn btn-p" disabled={rating < 1 || sending} onClick={send}>
        {sending ? t("common.loading") : t(`${K}.feedbackSend`)}
      </button>
      {done && <p className="tiny" style={{ color: "var(--green)" }}>{t(`${K}.feedbackSent`)}</p>}
    </div>
  );
}

/* ================================ U36: consent history ================================ */

/** Consent history: every consent record, newest first. */
export function ConsentHistory() {
  const { t } = useLang();
  const [items, setItems] = useState<{ id: string; type: string; version: string; granted: boolean; created_at: string }[] | null>(null);
  useEffect(() => {
    customerB4Api.listConsents().then((r) => setItems(r.consents ?? [])).catch(() => setItems([]));
  }, []);
  if (items === null) return null;
  return (
    <div className="card">
      <h2>{t(`${K}.consentsTitle`)}</h2>
      {items.length === 0 && <p className="muted tiny">{t(`${K}.consentsEmpty`)}</p>}
      {items.map((c) => (
        <div className="rowflex" key={c.id} style={{ margin: "8px 0" }}>
          <div style={{ flex: 1 }}>
            <b className="tiny">{c.type} · {c.version}</b>
            <br />
            <span className="tiny muted">{c.created_at.slice(0, 10)}</span>
          </div>
          <Chip tone={c.granted ? "gold" : "grey"}>
            {c.granted ? t(`${K}.consentGranted`) : t(`${K}.consentDenied`)}
          </Chip>
        </div>
      ))}
    </div>
  );
}

/* ================================ U45: sessions ================================ */

/** Own sessions: recent sign-ins as id fingerprints (no token material). */
export function SessionsCard() {
  const { t } = useLang();
  const [sessions, setSessions] = useState<OwnSession[] | null>(null);
  useEffect(() => {
    customerB4Api.listSessions().then((r) => setSessions(r.sessions ?? [])).catch(() => setSessions([]));
  }, []);
  if (sessions === null) return null;
  return (
    <div className="card">
      <h2>{t(`${K}.sessionsTitle`)}</h2>
      <p className="tiny muted" style={{ marginTop: 0 }}>{t(`${K}.sessionsHint`)}</p>
      {sessions.length === 0 && <p className="muted tiny">{t(`${K}.sessionsEmpty`)}</p>}
      {sessions.map((s) => (
        <div className="rowflex" key={s.id} style={{ margin: "8px 0" }}>
          <span style={{ color: "var(--green)" }}><Icon.lock size={18} /></span>
          <span className="tiny">
            <span className="kbd">{s.id}</span>
            <span className="muted"> · {s.created_at.slice(0, 16).replace("T", " ")}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ================================ U40: kit reminders ================================ */

/** Kit reminders: create / done-toggle / delete. */
export function RemindersPanel() {
  const { t } = useLang();
  const [items, setItems] = useState<KitReminder[] | null>(null);
  const [label, setLabel] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    customerB4Api.listKitReminders()
      .then((r) => setItems(r.reminders ?? []))
      .catch((e) => { setError(apiErrorMessage(t, e)); setItems([]); });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    const cleanLabel = label.trim();
    const dt = Date.parse(when);
    if (!cleanLabel || Number.isNaN(dt) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await customerB4Api.createKitReminder({
        label_en: cleanLabel.slice(0, 200),
        remind_at: new Date(dt).toISOString(),
      });
      setItems((v) => [...(v ?? []), row].sort((a, b) => a.remind_at.localeCompare(b.remind_at)));
      setLabel("");
      setWhen("");
      toast(t(`${K}.reminderCreated`));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: KitReminder) {
    try {
      const row = await customerB4Api.setKitReminderDone(r.id, !r.done);
      setItems((v) => (v ?? []).map((x) => (x.id === r.id ? row : x)));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

  async function remove(r: KitReminder) {
    if (!window.confirm(t(`${K}.reminderDeleteConfirm`))) return;
    try {
      await customerB4Api.deleteKitReminder(r.id);
      setItems((v) => (v ?? []).filter((x) => x.id !== r.id));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

  return (
    <div className="card">
      <h2>{t(`${K}.remindersTitle`)}</h2>
      {error && <ErrorCard message={error} onRetry={() => setError(null)} />}
      <label className="fl" htmlFor="b4-rlabel">{t(`${K}.reminderLabel`)}</label>
      <input
        id="b4-rlabel" type="text" value={label} maxLength={200}
        onChange={(e) => setLabel(e.target.value)} placeholder={t(`${K}.reminderLabelPh`)}
      />
      <label className="fl" htmlFor="b4-rwhen">{t(`${K}.reminderWhen`)}</label>
      <input id="b4-rwhen" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      <button className="btn btn-p" disabled={!label.trim() || !when || busy} onClick={create}>
        {busy ? t("common.loading") : t(`${K}.reminderAdd`)}
      </button>
      {items === null && <Loading />}
      {items !== null && items.length === 0 && <p className="muted tiny">{t(`${K}.remindersEmpty`)}</p>}
      {(items ?? []).map((r) => (
        <div className="rowflex" key={r.id} style={{ margin: "10px 0", alignItems: "flex-start" }}>
          <input
            type="checkbox" checked={r.done} onChange={() => toggle(r)}
            aria-label={r.label_en}
            style={{ width: 28, height: 28, minHeight: 28 }}
          />
          <div style={{ flex: 1 }}>
            <b style={r.done ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{r.label_en}</b>
            <br />
            <span className="tiny muted">{r.remind_at.slice(0, 16).replace("T", " ")}</span>
          </div>
          <button className="btn btn-g btn-s" onClick={() => remove(r)} aria-label={t("common.delete")}>×</button>
        </div>
      ))}
    </div>
  );
}

/* ================================ U42: kit usage log ================================ */

/** Kit usage log: log one use + recent history. */
export function UsageLogPanel() {
  const { t } = useLang();
  const [items, setItems] = useState<KitUsage[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    customerB4Api.listKitUsages(10)
      .then((r) => setItems(r.usages ?? []))
      .catch((e) => { setError(apiErrorMessage(t, e)); setItems([]); });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function log() {
    const clean = note.trim();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await customerB4Api.logKitUsage({ note: clean || undefined });
      setItems((v) => [row, ...(v ?? [])].slice(0, 10));
      setNote("");
      toast(t(`${K}.usageLogged`));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>{t(`${K}.usageTitle`)}</h2>
      {error && <ErrorCard message={error} onRetry={() => setError(null)} />}
      <label className="fl" htmlFor="b4-unote">{t(`${K}.usageNote`)}</label>
      <input
        id="b4-unote" type="text" value={note} maxLength={2000}
        onChange={(e) => setNote(e.target.value)} placeholder={t(`${K}.usageNotePh`)}
      />
      <button className="btn btn-p" disabled={busy} onClick={log}>
        {busy ? t("common.loading") : t(`${K}.usageLog`)}
      </button>
      {items === null && <Loading />}
      {items !== null && items.length === 0 && <p className="muted tiny">{t(`${K}.usageEmpty`)}</p>}
      {(items ?? []).map((u) => (
        <p className="tiny" key={u.id} style={{ margin: "8px 0" }}>
          <b>{u.used_at.slice(0, 16).replace("T", " ")}</b>
          {u.note && <span className="muted"> — {u.note}</span>}
        </p>
      ))}
    </div>
  );
}

/* ================================ U47: text size ================================ */

type TextSize = "small" | "medium" | "large";
const TEXT_PX: Record<TextSize, number> = { small: 14, medium: 16, large: 18 };

/** Apply a persisted base font size (U47). */
export function applyTextSize(s: TextSize) {
  try {
    document.documentElement.style.fontSize = `${TEXT_PX[s]}px`;
    localStorage.setItem("jaraa:text-size", s);
  } catch { /* ignore */ }
}

/** Text-size control: small / medium / large, persisted per device. */
export function TextSizeControl() {
  const { t } = useLang();
  const [size, setSize] = useState<TextSize>(() => {
    try {
      const s = localStorage.getItem("jaraa:text-size");
      return s === "small" || s === "large" ? s : "medium";
    } catch {
      return "medium";
    }
  });
  function pick(s: TextSize) {
    setSize(s);
    applyTextSize(s);
  }
  return (
    <div className="card">
      <h2>{t(`${K}.textSizeTitle`)}</h2>
      <div className="btn-row" role="radiogroup" aria-label={t(`${K}.textSizeTitle`)}>
        {(["small", "medium", "large"] as const).map((s) => (
          <button
            key={s} role="radio" aria-checked={size === s}
            className={`btn btn-s ${size === s ? "btn-p" : "btn-g"}`}
            onClick={() => pick(s)}
          >
            {t(`${K}.textSize.${s}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================================ U38: tour replay ================================ */

const TOUR_KEY = "jaraa:tour:seen:v1";

/** Short guided tour of the app's main sections (no fake progress — a walkthrough). */
export function AppTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLang();
  const [step, setStep] = useState(0);
  const steps = [0, 1, 2, 3, 4];
  if (!open) return null;
  return (
    <Modal onClose={onClose}>
      <h2>{t(`${K}.tourTitle`)}</h2>
      <p className="tiny muted">{t(`${K}.tourStep`, { n: step + 1, total: steps.length })}</p>
      <h3 style={{ marginTop: 0 }}>{t(`${K}.tour.${step}.title`)}</h3>
      <p>{t(`${K}.tour.${step}.body`)}</p>
      <div className="btn-row">
        {step > 0 && (
          <button className="btn btn-g" onClick={() => setStep(step - 1)}>
            {t(`${K}.tourBack`)}
          </button>
        )}
        {step < steps.length - 1 ? (
          <button className="btn btn-p" onClick={() => setStep(step + 1)}>
            {t(`${K}.tourNext`)}
          </button>
        ) : (
          <button
            className="btn btn-p"
            onClick={() => {
              try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ }
              onClose();
            }}
          >
            {t(`${K}.tourDone`)}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Replay button + first-run auto-show of the app tour. */
export function TourReplay() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === "1"; } catch { /* ignore */ }
    if (!seen) setOpen(true);
  }, []);
  return (
    <>
      <button className="btn btn-s" onClick={() => setOpen(true)}>
        {t(`${K}.tourReplay`)}
      </button>
      <AppTour open={open} onClose={() => {
        try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ }
        setOpen(false);
      }} />
    </>
  );
}

/* ================================ U44: export with photos ================================ */

/** Data export incl. the signed profile-photo URL (U8 export + photo link). */
export function DataExportCard() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  async function exportAll() {
    setBusy(true);
    try {
      const [profile, progress, orders] = await Promise.all([
        meApi.getProfile(),
        meApi.getProgress(),
        shopApi.listMyOrders(),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        profile,
        progress,
        orders: orders.orders,
        // The signed photo URL is included as-is; it expires (server-signed).
        photo_url_note: t(`${K}.exportPhotoNote`),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jaraa-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(t(`${K}.exportDone`));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <h2>{t(`${K}.exportTitle`)}</h2>
      <p className="tiny muted" style={{ marginTop: 0 }}>{t(`${K}.exportHint`)}</p>
      <button className="btn btn-p" disabled={busy} onClick={exportAll}>
        {busy ? t("common.loading") : t(`${K}.exportDownload`)}
      </button>
    </div>
  );
}

/* ================================ C28: challenge certificate ================================ */

/** Challenge completion certificate: view + print for a completed assignment. */
export function CertificateCard({ assignmentId }: { assignmentId: string }) {
  const { t, lang } = useLang();
  const [cert, setCert] = useState<ChallengeCertificate | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function view() {
    setError(null);
    try {
      const r = await customerB4Api.getCertificate(assignmentId);
      setCert(r.certificate);
      setOpen(true);
    } catch (e) {
      setError(apiErrorMessage(t, e));
    }
  }

  function printCert() {
    if (!cert) return;
    const title = lang === "ne" ? cert.challenge_title_ne ?? cert.challenge_title_en : cert.challenge_title_en;
    const w = window.open("", "_blank", "width=700,height=500");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t(`${K}.certTitle`)}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#1d3b2a}
.frame{border:6px double #2e7d4f;border-radius:16px;padding:48px 32px}
h1{margin:0 0 8px}.sub{color:#5a7a66}</style></head><body>
<div class="frame"><h1>${t(`${K}.certTitle`)}</h1>
<p class="sub">Jaraa · ${t(`${K}.certSub`)}</p>
<h2>${title}</h2>
<p>${t(`${K}.certAwardedTo`)}: <b>${cert.customer_name ?? "—"}</b></p>
<p class="sub">${t(`${K}.certCompletedOn`)}: ${cert.completed_at.slice(0, 10)}</p>
</div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <>
      <button className="btn btn-s btn-g" onClick={view}>
        {t(`${K}.certView`)}
      </button>
      {error && <p className="tiny" style={{ color: "var(--bad)" }}>{error}</p>}
      {open && cert && (
        <Modal onClose={() => setOpen(false)}>
          <div className="center" style={{ border: "4px double var(--green)", borderRadius: 16, padding: 24 }}>
            <span style={{ color: "var(--gold)" }}><Icon.plan size={40} /></span>
            <h2 style={{ margin: "8px 0" }}>{t(`${K}.certTitle`)}</h2>
            <p className="tiny muted">Jaraa · {t(`${K}.certSub`)}</p>
            <h3>{lang === "ne" ? cert.challenge_title_ne ?? cert.challenge_title_en : cert.challenge_title_en}</h3>
            <p>{t(`${K}.certAwardedTo`)}: <b>{cert.customer_name ?? "—"}</b></p>
            <p className="tiny muted">{t(`${K}.certCompletedOn`)}: {cert.completed_at.slice(0, 10)}</p>
            <div className="btn-row" style={{ justifyContent: "center" }}>
              <button className="btn btn-p btn-s" onClick={printCert}>{t(`${K}.certPrint`)}</button>
              <button className="btn btn-g btn-s" onClick={() => setOpen(false)}>{t("common.close")}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ================================ C45: end-of-challenge survey ================================ */

/** End-of-challenge survey: 1–5 rating + free text (one per assignment). */
export function SurveyForm({ assignmentId, onDone }: { assignmentId: string; onDone?: () => void }) {
  const { t } = useLang();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating < 1 || sending) return;
    setSending(true);
    setError(null);
    try {
      await customerB4Api.submitChallengeSurvey(assignmentId, rating, text);
      setDone(true);
      toast(t(`${K}.surveySent`));
      onDone?.();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "conflict") setDone(true);
      else setError(apiErrorMessage(t, e));
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return <NoticeBox tone="ok" title={t(`${K}.surveyDoneTitle`)}><p className="tiny" style={{ margin: 0 }}>{t(`${K}.surveySent`)}</p></NoticeBox>;
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K}.surveyTitle`)}</h3>
      <p className="tiny muted">{t(`${K}.surveyHint`)}</p>
      {error && <ErrorCard message={error} onRetry={() => setError(null)} />}
      <label className="fl">{t(`${K}.surveyQ1`)}</label>
      <div role="radiogroup" aria-label={t(`${K}.surveyQ1`)} className="rowflex" style={{ gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} / 5`}
            className="btn btn-s"
            style={{
              minWidth: 48, minHeight: 48, fontSize: 20,
              background: rating >= n ? "var(--gold)" : undefined,
              color: rating >= n ? "#fff" : undefined,
            }}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>
      <label className="fl" htmlFor={`b4-surv-${assignmentId}`}>{t(`${K}.surveyQ2`)}</label>
      <textarea
        id={`b4-surv-${assignmentId}`} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={t(`${K}.surveyQ2Ph`)} rows={3} maxLength={1000}
      />
      <button className="btn btn-p" disabled={rating < 1 || sending} onClick={submit}>
        {sending ? t("common.loading") : t(`${K}.surveySubmit`)}
      </button>
    </div>
  );
}

/* ================================ U43: printable adherence report ================================ */

export interface AdherenceReportData {
  adherencePct: number;
  streakDays: number;
  checkins: { created_at: string; shedding_estimate?: number | null; note?: string | null }[];
  rootHistory: { version: number; generated_at: string }[];
}

/** Printable adherence report: opens a print-friendly window (no fake data). */
export function PrintReportButton({ data }: { data: AdherenceReportData }) {
  const { t, lang } = useLang();
  function print() {
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    const rows = data.checkins.slice(0, 30).map((c) =>
      `<tr><td>${c.created_at.slice(0, 10)}</td><td>${c.shedding_estimate ?? "—"}</td><td>${(c.note ?? "").replace(/</g, "&lt;")}</td></tr>`,
    ).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t(`${K}.reportTitle`)}</title>
<style>body{font-family:system-ui,sans-serif;color:#222;padding:32px}h1{color:#1d3b2a}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:left}
.meta{color:#666;font-size:13px}</style></head><body>
<h1>Jaraa — ${t(`${K}.reportTitle`)}</h1>
<p class="meta">${new Date().toISOString().slice(0, 10)} · ${lang === "ne" ? "नेपाली" : "English"}</p>
<p><b>${t(`${K}.reportAdherence`)}</b>: ${data.adherencePct.toFixed(0)}% · <b>${t(`${K}.streakTitle`)}</b>: ${t(`${K}.streakDays`, { n: data.streakDays })}</p>
<h2>${t(`${K}.reportCheckins`)}</h2>
<table><tr><th>${t(`${K}.reportDate`)}</th><th>${t(`${K}.reportShedding`)}</th><th>${t(`${K}.reportNote`)}</th></tr>${rows}</table>
<p class="meta">${t(`${K}.reportDisclaimer`)}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }
  return (
    <button className="btn btn-s" onClick={print}>
      {t(`${K}.reportPrint`)}
    </button>
  );
}

/** Wishlist price-drop empty state: shown when the card has no alerts. */
export function PriceDropEmpty() {
  const { t } = useLang();
  return <EmptyState icon={<Icon.bell size={32} />} title={t(`${K}.priceDropEmpty`)} />;
}
