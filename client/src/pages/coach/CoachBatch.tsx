import { useState } from "react";
import { coachApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { adherence14, checkinDays } from "../Progress";
import type { AssignedCustomer, Challenge, Checkin } from "../../api/types";
import {
  CustomerB3Tabs,
  EscalationSlaInfo,
  LeaderboardTab,
  MissedTab,
  RecurringComposer,
  SatisfactionTab,
} from "./CoachBatch3";
import { ComposerHints } from "./CoachBatch4";

const DAY_MS = 86_400_000;

/** C2/C3: adherence = % of last 14 days with a check-in; streak = consecutive days to today. */
function streak(checkins: Checkin[]): number {
  const days = checkinDays(checkins);
  const key = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  let s = 0;
  let cursor = Date.now();
  if (!days.has(key(cursor))) cursor -= DAY_MS; // streak may end yesterday
  while (days.has(key(cursor))) {
    s++;
    cursor -= DAY_MS;
  }
  return s;
}

/** C1–C3 + C5 + C8: per-customer coaching panel driven by a customer id. */
function CustomerPanel({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const checkins = useAsync(() => coachApi.listCustomerCheckins(customerId).then((r) => r.checkins), [customerId]);
  const notes = useAsync(() => coachApi.listCustomerNotes(customerId).then((r) => r.notes), [customerId]);
  const satisfaction = useAsync(() => coachApi.listSatisfaction(customerId).then((r) => r.ratings), [customerId]);

  const list = checkins.data ?? [];
  const days = checkinDays(list);
  const checkinErr = checkins.error ? apiErrorMessage(t, checkins.error) : null;
  const notesErr = notes.error ? apiErrorMessage(t, notes.error) : null;
  const satErr = satisfaction.error ? apiErrorMessage(t, satisfaction.error) : null;

  async function addNote() {
    if (!note.trim()) return;
    try {
      await coachApi.addCustomerNote(customerId, note.trim());
      setNote("");
      toast(t("p12.coach.noteAdded"));
      notes.retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function logRating() {
    if (rating < 1 || rating > 5) return;
    try {
      await coachApi.addSatisfaction(customerId, rating, comment.trim() || undefined);
      setRating(0);
      setComment("");
      toast(t("p12.coach.ratingSaved"));
      satisfaction.retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <>
      {/* C1: check-in review */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.coach.checkins")}</h3>
        {checkins.loading && <Loading />}
        {checkinErr && <ErrorCard message={checkinErr} onRetry={checkins.retry} />}
        {!checkins.loading && list.length === 0 && <p className="tiny muted">{t("p12.coach.noCheckins")}</p>}
        {list.slice(0, 10).map((c) => (
          <p key={c.id} className="tiny" style={{ margin: "8px 0" }}>
            <b>{c.created_at.slice(0, 10)}</b>
            {c.shedding_estimate != null && <span className="muted"> — {c.shedding_estimate}/100</span>}
            {c.note && <span className="muted"> — {c.note}</span>}
          </p>
        ))}
      </div>

      {/* C2/C3: adherence + streak */}
      {!checkins.loading && (
        <div className="statgrid">
          <StatCard label={t("p12.coach.adherence")} value={`${Math.round(adherence14(list))}%`} icon={<Icon.chart size={26} />} />
          <StatCard label={t("p12.coach.streak")} value={`${streak(list)} ${t("p12.coach.days")}`} icon={<Icon.clock size={26} />} />
        </div>
      )}
      {!checkins.loading && list.length > 0 && (
        <div className="card">
          {Array.from({ length: 14 }, (_, i) => {
            const d = new Date(Date.now() - (13 - i) * DAY_MS);
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            return (
              <span
                key={k}
                title={k}
                style={{
                  display: "inline-block",
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  margin: 2,
                  background: days.has(k) ? "var(--green)" : "var(--line)",
                }}
              />
            );
          })}
          <p className="tiny muted">{t("p12.coach.adherence")} · {t("p12.coach.days")}</p>
        </div>
      )}

      {/* C5: timestamped notes */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.coach.notes")}</h3>
        {notes.loading && <Loading />}
        {notesErr && <ErrorCard message={notesErr} onRetry={notes.retry} />}
        {!notes.loading && (notes.data ?? []).length === 0 && <p className="tiny muted">{t("p12.coach.noNotes")}</p>}
        {(notes.data ?? []).map((n) => (
          <p key={n.id} className="tiny" style={{ margin: "8px 0" }}>
            <span className="muted">{n.created_at.slice(0, 16).replace("T", " ")}</span>
            <br />
            {n.note}
          </p>
        ))}
        <label className="fl" htmlFor="coach-note">{t("p12.coach.notePh")}</label>
        <textarea id="coach-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("p12.coach.notePh")} />
        <button className="btn btn-s btn-p" disabled={!note.trim()} onClick={addNote}>
          {t("p12.coach.addNote")}
        </button>
      </div>

      {/* C8: satisfaction */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.coach.satisfaction")}</h3>
        {satisfaction.loading && <Loading />}
        {satErr && <ErrorCard message={satErr} onRetry={satisfaction.retry} />}
        {!satisfaction.loading && (satisfaction.data ?? []).length === 0 && (
          <p className="tiny muted">{t("p12.coach.noRatings")}</p>
        )}
        {(satisfaction.data ?? []).map((r) => (
          <p key={r.id} className="tiny" style={{ margin: "8px 0" }}>
            <b>{"★".repeat(Math.max(0, Math.min(5, r.rating)))}</b>
            <span className="muted"> · {r.created_at.slice(0, 10)}</span>
            {r.comment && (
              <>
                <br />
                {r.comment}
              </>
            )}
          </p>
        ))}
        <div className="rowflex" role="group" aria-label={t("p12.coach.logRating")} style={{ gap: 4, margin: "8px 0" }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              className={`btn btn-s${rating >= s ? " btn-p" : " btn-g"}`}
              onClick={() => setRating(s)}
              aria-pressed={rating === s}
              aria-label={`${s}/5`}
            >
              ★
            </button>
          ))}
        </div>
        <label className="fl" htmlFor="coach-rating-comment">{t("p12.coach.commentPh")}</label>
        <input id="coach-rating-comment" type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("p12.coach.commentPh")} />
        <button className="btn btn-s btn-p" disabled={rating < 1} onClick={logRating}>
          {t("p12.coach.logRating")}
        </button>
      </div>
    </>
  );
}

/** C4: challenge library — create + assign to the picked customer. */
function ChallengesTab({ customerId }: { customerId: string | null }) {
  const { t, lang } = useLang();
  const [titleEn, setTitleEn] = useState("");
  const [titleNe, setTitleNe] = useState("");
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [desc, setDesc] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const { data, error, loading, retry } = useAsync(() => coachApi.listChallenges().then((r) => r.challenges), []);
  const chErr = error ? apiErrorMessage(t, error) : null;

  async function create() {
    if (!titleEn.trim()) return;
    try {
      await coachApi.createChallenge({
        title_en: titleEn.trim(),
        ...(titleNe.trim() ? { title_ne: titleNe.trim() } : {}),
        days,
        ...(desc.trim() ? { [lang === "ne" ? "description_ne" : "description_en"]: desc.trim() } : {}),
      });
      setTitleEn("");
      setTitleNe("");
      setDesc("");
      toast(t("p12.coach.challengeCreated"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function assign(ch: Challenge) {
    if (!customerId || assigning) return;
    setAssigning(ch.id);
    try {
      await coachApi.assignChallenge(ch.id, customerId);
      toast(t("p12.coach.challengeAssigned"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setAssigning(null);
    }
  }

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.coach.newChallenge")}</h3>
        <label className="fl" htmlFor="ch-title-en">Title (EN)</label>
        <input id="ch-title-en" type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
        <label className="fl" htmlFor="ch-title-ne">Title (NE)</label>
        <input id="ch-title-ne" type="text" value={titleNe} onChange={(e) => setTitleNe(e.target.value)} />
        <label className="fl" htmlFor="ch-days">{t("p12.coach.challengeDays")}</label>
        <select id="ch-days" value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 14 | 30)}>
          <option value={7}>{t("p12.coach.day7")}</option>
          <option value={14}>{t("p12.coach.day14")}</option>
          <option value={30}>{t("p12.coach.day30")}</option>
        </select>
        <label className="fl" htmlFor="ch-desc">{t("p12.coach.messagePh")}</label>
        <textarea id="ch-desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="btn btn-p" disabled={!titleEn.trim()} onClick={create}>
          {t("p12.coach.newChallenge")}
        </button>
      </div>

      <h3>{t("p12.coach.challenges")}</h3>
      {loading && <Loading />}
      {chErr && <ErrorCard message={chErr} onRetry={retry} />}
      {!loading && (data ?? []).length === 0 && <EmptyState icon={<Icon.plan size={32} />} title={t("p12.coach.challenges")} />}
      {(data ?? []).map((ch) => (
        <div className="card" key={ch.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <b>{lang === "ne" ? ch.title_ne ?? ch.title_en : ch.title_en}</b>
              <br />
              <span className="tiny muted">
                {ch.days === 7 ? t("p12.coach.day7") : ch.days === 14 ? t("p12.coach.day14") : t("p12.coach.day30")}
                {" · "}
                {ch.created_at.slice(0, 10)}
              </span>
            </div>
            <button
              className="btn btn-s btn-p"
              disabled={!customerId || assigning === ch.id}
              title={customerId ? undefined : t("p12.coach.selectCustomer")}
              onClick={() => void assign(ch)}
            >
              {t("p12.coach.assign")}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/** C7: scheduled reminders — schedule, send now, delete. */
function RemindersTab({ customerId }: { customerId: string | null }) {
  const { t } = useLang();
  const [userId, setUserId] = useState("");
  const [msgEn, setMsgEn] = useState("");
  const [msgNe, setMsgNe] = useState("");
  const [sendAt, setSendAt] = useState("");
  const { data, error, loading, retry } = useAsync(() => coachApi.listScheduledNudges().then((r) => r.nudges), []);
  const nudgeErr = error ? apiErrorMessage(t, error) : null;

  const target = userId.trim() || customerId || "";

  // C36/C44: quiet-hours + content-language hints for the scheduled-nudge
  // composer. The customer list payload does not carry prefs yet, so the
  // hints render only when the data is actually present — never invented.
  const customerList = useAsync(
    () =>
      coachApi
        .listCustomers()
        .then((r) => r.customers)
        .catch((e) => {
          if ((e as { status?: number }).status === 404) return [];
          throw e;
        }),
    [],
  );
  const hintCustomer = (customerList.data ?? []).find((c) => c.id === target) ?? null;

  async function schedule() {
    if (!target || !msgEn.trim() || !sendAt) return;
    const iso = new Date(sendAt).toISOString();
    if (Date.parse(iso) <= Date.now()) {
      toast(t("p12.coach.sendAt"));
      return;
    }
    try {
      await coachApi.scheduleNudge({
        user_id: target,
        message_en: msgEn.trim(),
        ...(msgNe.trim() ? { message_ne: msgNe.trim() } : {}),
        send_at: iso,
      });
      setMsgEn("");
      setMsgNe("");
      setSendAt("");
      toast(t("p12.coach.reminderScheduled"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function sendNow(id: string) {
    try {
      await coachApi.sendScheduledNudge(id);
      toast(t("p12.coach.reminderSent"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function del(id: string) {
    if (!window.confirm(t("p12.coach.reminderDeleted"))) return;
    try {
      await coachApi.deleteScheduledNudge(id);
      toast(t("p12.coach.reminderDeleted"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.coach.newReminder")}</h3>
        <label className="fl" htmlFor="rn-user">Customer user ID</label>
        <input
          id="rn-user"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={customerId ?? t("p12.coach.selectCustomer")}
        />
        <label className="fl" htmlFor="rn-en">{t("p12.coach.messagePh")}</label>
        <textarea id="rn-en" rows={3} value={msgEn} onChange={(e) => setMsgEn(e.target.value)} placeholder={t("p12.coach.messagePh")} />
        <label className="fl" htmlFor="rn-ne">{t("p12.coach.messageNePh")}</label>
        <textarea id="rn-ne" rows={2} value={msgNe} onChange={(e) => setMsgNe(e.target.value)} placeholder={t("p12.coach.messageNePh")} />
        <label className="fl" htmlFor="rn-at">{t("p12.coach.sendAt")}</label>
        <input id="rn-at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
        {/* C36/C44: quiet-hours + language hints when the customer payload carries them. */}
        <ComposerHints customer={hintCustomer} />
        <button className="btn btn-p" disabled={!target || !msgEn.trim() || !sendAt} onClick={schedule}>
          {t("p12.coach.schedule")}
        </button>
      </div>

      <h3>{t("p12.coach.reminders")}</h3>
      {loading && <Loading />}
      {nudgeErr && <ErrorCard message={nudgeErr} onRetry={retry} />}
      {!loading && (data ?? []).length === 0 && <p className="tiny muted">{t("p12.coach.noReminders")}</p>}
      {(data ?? []).map((n) => (
        <div className="card" key={n.id}>
          <p className="tiny" style={{ margin: "4px 0" }}>{n.message_en}</p>
          {n.message_ne && <p className="tiny muted" style={{ margin: "4px 0" }}>{n.message_ne}</p>}
          <div className="rowflex" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <span className={`chip ${n.sent_at ? "grey" : "gold"}`}>
              {n.sent_at ? n.sent_at.slice(0, 16).replace("T", " ") : `${t("p12.coach.dueNow")}: ${n.send_at.slice(0, 16).replace("T", " ")}`}
            </span>
            <span className="spacer" />
            {!n.sent_at && (
              <>
                <button className="btn btn-s btn-p" onClick={() => void sendNow(n.id)}>
                  {t("p12.coach.sendNow")}
                </button>
                <button className="btn btn-s btn-g" onClick={() => void del(n.id)}>
                  {t("p12.common.delete")}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/** C6: escalations — status-filtered list + escalate form. */
function EscalationsTab({ customerId }: { customerId: string | null }) {
  const { t } = useLang();
  const [status, setStatus] = useState<"all" | "open" | "acknowledged" | "resolved">("open");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const { data, error, loading, retry } = useAsync(
    () => coachApi.listEscalations(status === "all" ? undefined : status).then((r) => r.escalations),
    [status],
  );
  const escErr = error ? apiErrorMessage(t, error) : null;

  const target = userId.trim() || customerId || "";

  async function escalate() {
    if (!target || !reason.trim()) return;
    try {
      await coachApi.escalateCustomer(target, reason.trim());
      setReason("");
      toast(t("p12.coach.escalateDone"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  const tone = (s: string): "red" | "gold" | "grey" => (s === "open" ? "red" : s === "acknowledged" ? "gold" : "grey");

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.coach.escalate")}</h3>
        <label className="fl" htmlFor="esc-user">Customer user ID</label>
        <input
          id="esc-user"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={customerId ?? t("p12.coach.selectCustomer")}
        />
        <label className="fl" htmlFor="esc-reason">{t("p12.coach.escalateReasonPh")}</label>
        <textarea id="esc-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("p12.coach.escalateReasonPh")} />
        <button className="btn btn-p" disabled={!target || !reason.trim()} onClick={escalate}>
          {t("p12.coach.escalate")}
        </button>
      </div>

      <div className="rowflex" style={{ margin: "12px 0" }}>
        <label className="fl" htmlFor="esc-status" style={{ margin: 0 }}>{t("p12.coach.escalations")}</label>
        <select id="esc-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {(["all", "open", "acknowledged", "resolved"] as const).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {loading && <Loading />}
      {escErr && <ErrorCard message={escErr} onRetry={retry} />}
      {!loading && (data ?? []).length === 0 && <p className="tiny muted">{t("p12.coach.escalations")}: —</p>}
      {(data ?? []).map((e) => (
        <div className="card" key={e.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <b className="kbd">{e.customer_id.slice(0, 8)}</b>
              <br />
              <span className="tiny">{e.reason}</span>
              <br />
              <span className="tiny muted">{e.created_at.slice(0, 10)}</span>
            </div>
            <Chip tone={tone(e.status)}>{e.status}</Chip>
          </div>
          {/* Batch-3 (C20): SLA columns — timing not tracked by schema; honest nulls. */}
          <EscalationSlaInfo createdAt={e.created_at} status={e.status} />
        </div>
      ))}
    </>
  );
}

/** C9: published education articles, bilingual titles/bodies. */
function KnowledgeTab() {
  const { t, lang } = useLang();
  const { data, error, loading, retry } = useAsync(() => coachApi.listArticles().then((r) => r.articles), []);

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;

  const articles = data ?? [];
  return (
    <>
      <h3>{t("p12.coach.knowledge")}</h3>
      {articles.length === 0 && <EmptyState icon={<Icon.book size={32} />} title={t("p12.coach.noArticles")} />}
      {articles.map((a) => (
        <div className="card" key={a.id}>
          <b>{lang === "ne" ? a.title_ne ?? a.title_en : a.title_en}</b>
          <p className="tiny" style={{ margin: "8px 0 0", whiteSpace: "pre-line" }}>
            {lang === "ne" ? a.body_ne ?? a.body_en : a.body_en}
          </p>
        </div>
      ))}
    </>
  );
}

const TABS = ["customers", "challenges", "reminders", "escalations", "missed", "analytics", "leaderboard", "knowledge"] as const;

/* Batch-3 tab labels (C19–C22, C25); batch-1 tabs keep their p12.coach labels. */
const B3_TAB_LABEL: Record<string, string> = {
  leaderboard: "p12c.coach.leaderboardTitle",
  missed: "p12c.coach.missedTitle",
  analytics: "p12c.coach.satisfactionTitle",
};

/**
 * Batch-1 coach tools: customer picker + check-ins/adherence/notes/
 * satisfaction (C1–C3, C5, C8), challenges (C4), reminders (C7),
 * escalations (C6), knowledge base (C9). Mounted below the existing
 * dashboard — nothing existing is touched.
 */
export function CoachBatchTools() {
  const { t } = useLang();
  const [tab, setTab] = useState<(typeof TABS)[number]>("customers");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");

  const { data, error, loading } = useAsync(
    () =>
      coachApi
        .listCustomers()
        .then((r) => r.customers)
        .catch((e) => {
          if ((e as { status?: number }).status === 404) return null; // server hasn't shipped it
          throw e;
        }),
    [],
  );

  const customers: AssignedCustomer[] | null = data ?? null;
  const pickerErr = error ? apiErrorMessage(t, error) : null;
  const customerId = selectedId ?? (manualId.trim() || null);
  const tabLabel = (k: (typeof TABS)[number]) =>
    B3_TAB_LABEL[k] ? t(B3_TAB_LABEL[k]) : k === "customers" ? t("p12.coach.checkins") : t(`p12.coach.${k}`);

  return (
    <div style={{ marginTop: 24 }}>
      <h2>{t("p12.coach.checkins")}</h2>

      {/* Customer picker: dropdown when the assignment list works, manual user-id fallback when it 404s/is empty. */}
      <div className="card">
        <label className="fl" htmlFor="coach-cust-pick">{t("p12.coach.selectCustomer")}</label>
        {loading && <Loading />}
        {pickerErr && <ErrorCard message={pickerErr} />}
        {customers && customers.length > 0 && (
          <select
            id="coach-cust-pick"
            value={selectedId ?? ""}
            onChange={(e) => {
              setSelectedId(e.target.value || null);
              setManualId("");
            }}
          >
            <option value="">{t("p12.coach.selectCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.phone || c.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
        {(!customers || customers.length === 0) && !loading && (
          <input
            type="text"
            value={manualId}
            onChange={(e) => {
              setManualId(e.target.value);
              setSelectedId(null);
            }}
            placeholder={t("p12.coach.selectCustomer")}
            aria-label={t("p12.coach.selectCustomer")}
          />
        )}
        {customers && customers.length > 0 && selectedId && (
          <p className="tiny muted" style={{ margin: "6px 0 0" }}>
            {t("p12.coach.selectCustomer")}: <span className="kbd">{selectedId.slice(0, 8)}</span> —{" "}
            <button className="linklike" onClick={() => setSelectedId(null)}>
              {t("p12.common.close")}
            </button>
          </p>
        )}
      </div>

      <div className="tabrow" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`tab${tab === k ? " on" : ""}`}
            onClick={() => setTab(k)}
          >
            {tabLabel(k)}
          </button>
        ))}
      </div>

      {tab === "customers" &&
        (customerId ? (
          <>
            <CustomerPanel customerId={customerId} />
            {/* Batch-3 customer detail: progress compare (C23), onboarding (C24), adherence (C27). */}
            <CustomerB3Tabs customerId={customerId} />
          </>
        ) : (
          <EmptyState icon={<Icon.user size={32} />} title={t("p12.coach.selectCustomer")} />
        ))}
      {tab === "challenges" && <ChallengesTab customerId={customerId} />}
      {tab === "reminders" && (
        <>
          <RemindersTab customerId={customerId} />
          {/* Batch-3 recurring nudges (C21). */}
          <RecurringComposer customerId={customerId} />
        </>
      )}
      {tab === "escalations" && <EscalationsTab customerId={customerId} />}
      {tab === "missed" && <MissedTab />}
      {tab === "analytics" && <SatisfactionTab />}
      {tab === "leaderboard" && <LeaderboardTab />}
      {tab === "knowledge" && <KnowledgeTab />}
    </div>
  );
}
