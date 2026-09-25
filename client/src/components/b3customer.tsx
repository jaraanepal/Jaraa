/**
 * Batch 3 (009) customer UI blocks: U21–U29 + leaderboard opt-in.
 *
 * Each block is a self-contained card/section. Pages import only the blocks
 * they need; nothing here touches routing (App.tsx is integration-owned).
 * All copy is bilingual via p12c.customer.* — never hardcoded.
 */
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext";
import { customerB3Api } from "../api/b3customer";
import type {
  AdherenceWeek,
  CaseMessage,
  CommunityTip,
  LoyaltyWallet,
  ReviewRequest,
  RoutineItem,
  UserCase,
} from "../api/b3customer";
import { Chip, ErrorCard, Loading, NoticeBox, apiErrorMessage, toast } from "./ui";

const K = "p12c.customer";

/* ================================ U21: case Q&A ================================ */

/** Q&A thread for one case: customer messages right, doctor replies left. */
export function CaseQaThread({ caseId }: { caseId: string }) {
  const { t } = useLang();
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    customerB3Api
      .listCaseMessages(caseId)
      .then((r) => {
        setMessages(r.messages ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };
  useEffect(load, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await customerB3Api.postCaseMessage(caseId, text.slice(0, 2000));
      setMessages((m) => [...m, msg]);
      setBody("");
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Loading />;
  return (
    <div>
      {error && <ErrorCard message={error} onRetry={load} />}
      {messages.length === 0 && <p className="muted tiny">{t(`${K}.u21_caseQa.empty`)}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.map((m) => {
          const mine = m.author_role === "customer";
          return (
            <div
              key={m.id}
              style={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "85%",
                background: mine ? "var(--green)" : "var(--card)",
                color: mine ? "#fff" : undefined,
                borderRadius: 12,
                padding: "8px 12px",
              }}
            >
              <div className="tiny" style={{ opacity: 0.75 }}>
                {mine ? t(`${K}.u21_caseQa.youLabel`) : t(`${K}.u21_caseQa.doctorLabel`)} ·{" "}
                {m.created_at.slice(0, 10)}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            </div>
          );
        })}
      </div>
      <div className="formrow" style={{ marginTop: 10 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t(`${K}.u21_caseQa.askPlaceholder`)}
          rows={2}
          maxLength={2000}
          aria-label={t(`${K}.u21_caseQa.title`)}
        />
        <button className="btn btn-p" disabled={!body.trim() || sending} onClick={send}>
          {sending ? t("common.loading") : t(`${K}.u21_caseQa.send`)}
        </button>
      </div>
    </div>
  );
}

/** My cases with a Q&A thread under each — for the Progress/status view. */
export function CaseQaSection() {
  const { t } = useLang();
  const [cases, setCases] = useState<UserCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    customerB3Api
      .listMyCases()
      .then((r) => {
        setCases(r.cases ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (cases.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K}.u21_caseQa.title`)}</h3>
      <p className="muted tiny" style={{ marginTop: 0 }}>{t(`${K}.u21_caseQa.sub`)}</p>
      {cases.map((c) => (
        <details key={c.id} style={{ margin: "10px 0" }} open={cases.length === 1}>
          <summary className="tiny">
            <b>{t(`${K}.u21_caseQa.title`)} — {c.id.slice(0, 8)}</b>{" "}
            <Chip>{c.status}</Chip>
          </summary>
          <div style={{ marginTop: 8 }}>
            <CaseQaThread caseId={c.id} />
          </div>
        </details>
      ))}
    </div>
  );
}

/* ==================== U22: follow-up review request ==================== */

/** Appointment-free review request: case picker + reason, then status list. */
export function ReviewRequestPanel() {
  const { t } = useLang();
  const [cases, setCases] = useState<UserCase[]>([]);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    customerB3Api.listReviewRequests().then((r) => setRequests(r.requests ?? [])).catch(() => {});
    customerB3Api.listMyCases().then((r) => setCases(r.cases ?? [])).catch(() => {});
  };
  useEffect(load, []);

  async function submit() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await customerB3Api.createReviewRequest(caseId || null, reason.trim() || undefined);
      setReason("");
      setCaseId("");
      toast(t(`${K}.u22_reviewRequest.success`));
      load();
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K}.u22_reviewRequest.title`)}</h3>
      <p className="muted tiny" style={{ marginTop: 0 }}>{t(`${K}.u22_reviewRequest.sub`)}</p>
      {error && <ErrorCard message={error} />}
      <label className="fl" htmlFor="rr-case">{t(`${K}.u22_reviewRequest.caseLabel`)}</label>
      <select id="rr-case" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
        <option value="">{t(`${K}.u22_reviewRequest.noCaseOption`)}</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {t(`${K}.u21_caseQa.title`)} — {c.id.slice(0, 8)} · {c.status}
          </option>
        ))}
      </select>
      <label className="fl" htmlFor="rr-reason">{t(`${K}.u22_reviewRequest.reasonLabel`)}</label>
      <textarea
        id="rr-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t(`${K}.u22_reviewRequest.reasonPlaceholder`)}
        rows={2}
        maxLength={2000}
      />
      <button className="btn btn-p" disabled={sending} onClick={submit}>
        {sending ? t("common.loading") : t(`${K}.u22_reviewRequest.submit`)}
      </button>

      {requests.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {requests.map((r) => (
            <div className="rowflex" key={r.id} style={{ margin: "8px 0" }}>
              <div className="tiny">
                <b>{r.created_at.slice(0, 10)}</b>
                {r.case_id && (
                  <span className="muted"> · {r.case_id.slice(0, 8)}</span>
                )}
                {r.reason && <div className="muted">{r.reason}</div>}
              </div>
              <span className="spacer" />
              <Chip tone={r.status === "pending" ? "amber" : undefined}>
                {t(`${K}.u22_reviewRequest.${r.status}`)}
              </Chip>
            </div>
          ))}
        </div>
      )}
      {requests.length === 0 && <p className="muted tiny">{t(`${K}.u22_reviewRequest.empty`)}</p>}
    </div>
  );
}

/* ============================ U23: community tips ============================ */

/** Approved community tips feed with the pinned non-medical disclaimer. */
export function CommunityTab() {
  const { t } = useLang();
  const [tips, setTips] = useState<CommunityTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justShared, setJustShared] = useState(false);

  const load = () => {
    customerB3Api
      .listCommunityTips()
      .then((r) => {
        setTips(r.tips ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };
  useEffect(load, [t]);

  async function share() {
    const tt = title.trim();
    const bb = body.trim();
    if (!tt || !bb || sending) return;
    setSending(true);
    setError(null);
    try {
      await customerB3Api.createCommunityTip(tt.slice(0, 120), bb.slice(0, 2000));
      setTitle("");
      setBody("");
      setJustShared(true);
      toast(t(`${K}.u23_communityTips.pendingNote`));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Loading />;
  return (
    <div>
      {/* Non-medical disclaimer pinned on top — always visible. */}
      <NoticeBox tone="notice" title={t(`${K}.u23_communityTips.title`)}>
        <p className="tiny" style={{ margin: 0 }}>{t(`${K}.u23_communityTips.disclaimer`)}</p>
      </NoticeBox>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t(`${K}.u23_communityTips.shareTitle`)}</h3>
        <p className="muted tiny">{t(`${K}.u23_communityTips.noMedicineHint`)}</p>
        {error && <ErrorCard message={error} />}
        {justShared && (
          <NoticeBox tone="ok" title={t(`${K}.u23_communityTips.statusPending`)}>
            <p className="tiny" style={{ margin: 0 }}>{t(`${K}.u23_communityTips.pendingNote`)}</p>
          </NoticeBox>
        )}
        <label className="fl" htmlFor="tip-title">{t(`${K}.u23_communityTips.tipTitleLabel`)}</label>
        <input
          id="tip-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t(`${K}.u23_communityTips.tipTitlePlaceholder`)}
          maxLength={120}
        />
        <label className="fl" htmlFor="tip-body">{t(`${K}.u23_communityTips.tipBodyLabel`)}</label>
        <textarea
          id="tip-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t(`${K}.u23_communityTips.tipBodyPlaceholder`)}
          rows={3}
          maxLength={2000}
        />
        <button className="btn btn-p" disabled={!title.trim() || !body.trim() || sending} onClick={share}>
          {sending ? t("common.loading") : t(`${K}.u23_communityTips.submit`)}
        </button>
      </div>

      <h3>{t(`${K}.u23_communityTips.title`)}</h3>
      <p className="muted tiny">{t(`${K}.u23_communityTips.sub`)}</p>
      {tips.length === 0 && <p className="muted">{t(`${K}.u23_communityTips.empty`)}</p>}
      {tips.map((tip) => (
        <div className="card" key={tip.id}>
          <b>{tip.title}</b>
          <p className="tiny" style={{ whiteSpace: "pre-wrap" }}>{tip.body}</p>
          <p className="tiny muted" style={{ margin: "4px 0 0" }}>{tip.created_at.slice(0, 10)}</p>
        </div>
      ))}
    </div>
  );
}

/* ============================ U24: adherence chart ============================ */

/** 12-bar weekly adherence chart ("Routine consistency"). */
export function AdherenceChart() {
  const { t } = useLang();
  const [history, setHistory] = useState<AdherenceWeek[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    customerB3Api
      .adherenceHistory()
      .then((r) => {
        setHistory(r.history ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  const max = Math.max(1, ...history.map((h) => h.rate));
  const anyData = history.some((h) => h.rate > 0);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K}.u24_adherence.title`)}</h3>
      <p className="muted tiny" style={{ marginTop: 0 }}>{t(`${K}.u24_adherence.sub`)}</p>
      {!anyData && <p className="muted tiny">{t(`${K}.u24_adherence.empty`)}</p>}
      {anyData && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
          {history.map((h) => (
            <div
              key={h.week}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
              title={`${h.week}: ${Math.round(h.rate * 100)}%`}
            >
              <span className="tiny" style={{ fontSize: 10 }}>{h.rate > 0 ? `${Math.round(h.rate * 100)}` : ""}</span>
              <div
                style={{
                  width: "100%",
                  height: Math.max(3, (h.rate / max) * 96),
                  background: h.rate > 0 ? "var(--green)" : "var(--card)",
                  borderRadius: 4,
                }}
              />
              <span className="tiny muted" style={{ fontSize: 9, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                {t(`${K}.u24_adherence.weekLabel`)} {h.week.slice(5)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ U25: loyalty card ============================ */

/** Loyalty wallet: balance hero, earn rule, +/- history. */
export function LoyaltyCard() {
  const { t } = useLang();
  const [wallet, setWallet] = useState<LoyaltyWallet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    customerB3Api
      .getLoyalty()
      .then((w) => {
        setWallet(w);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (!wallet) return null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K}.u25_loyalty.title`)}</h3>
      <p className="muted tiny" style={{ marginTop: 0 }}>{t(`${K}.u25_loyalty.sub`)}</p>
      <div className="center" style={{ padding: "8px 0" }}>
        <div style={{ fontSize: 34, color: "var(--green)" }}><b>{wallet.balance}</b></div>
        <div className="tiny muted">{t(`${K}.u25_loyalty.balance`)}</div>
        <div className="tiny muted" style={{ marginTop: 4 }}>{t(`${K}.u25_loyalty.earnRule`)}</div>
      </div>
      <h4>{t(`${K}.u25_loyalty.history`)}</h4>
      {(wallet.history ?? []).length === 0 && <p className="muted tiny">{t(`${K}.u25_loyalty.empty`)}</p>}
      {(wallet.history ?? []).map((e) => (
        <div className="rowflex" key={e.id} style={{ margin: "8px 0" }}>
          <b style={{ color: e.points >= 0 ? "var(--green)" : "var(--bad)" }}>
            {e.points >= 0 ? "+" : ""}{e.points}
          </b>
          <span className="tiny muted" style={{ marginLeft: 8 }}>
            {e.reason ?? e.order_id ?? ""}
          </span>
          <span className="spacer" />
          <span className="tiny muted">{(e.created_at ?? "").slice(0, 10)}</span>
        </div>
      ))}
      <p className="tiny muted center" style={{ marginTop: 8 }}>{t(`${K}.u25_loyalty.redeemSoon`)}</p>
    </div>
  );
}

/* ============================ U26: gift fields ============================ */

/** "Send as a gift" toggle + recipient name/phone/message for checkout. */
export function GiftCheckoutFields({
  value,
  onChange,
}: {
  value: { isGift: boolean; name: string; phone: string; message: string };
  onChange: (v: { isGift: boolean; name: string; phone: string; message: string }) => void;
}) {
  const { t } = useLang();
  return (
    <div className="card" style={{ margin: "10px 0" }}>
      <label className="rowflex" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={value.isGift}
          onChange={(e) => onChange({ ...value, isGift: e.target.checked })}
          style={{ width: 28, height: 28, minHeight: 28 }}
        />
        <b>{t(`${K}.u26_gift.markAsGift`)}</b>
      </label>
      {value.isGift && (
        <div style={{ marginTop: 8 }}>
          <p className="muted tiny">{t(`${K}.u26_gift.giftThisOrder`)}</p>
          <label className="fl" htmlFor="gift-name">{t(`${K}.u26_gift.recipientNameLabel`)}</label>
          <input
            id="gift-name"
            type="text"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder={t(`${K}.u26_gift.recipientNamePlaceholder`)}
            maxLength={120}
            autoComplete="name"
          />
          <label className="fl" htmlFor="gift-phone">{t(`${K}.u26_gift.recipientPhoneLabel`)}</label>
          <input
            id="gift-phone"
            type="tel"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value.replace(/\D/g, "") })}
            placeholder={t(`${K}.u26_gift.recipientPhonePlaceholder`)}
            maxLength={10}
            autoComplete="tel"
          />
          <label className="fl" htmlFor="gift-msg">{t(`${K}.u26_gift.giftMessageLabel`)}</label>
          <textarea
            id="gift-msg"
            value={value.message}
            onChange={(e) => onChange({ ...value, message: e.target.value })}
            placeholder={t(`${K}.u26_gift.giftMessagePlaceholder`)}
            rows={2}
            maxLength={500}
          />
        </div>
      )}
    </div>
  );
}

/* ========================= U27: order issue reporter ========================= */

/** "Report an issue" expander on the order card: subject + body → dispute. */
export function OrderIssueButton({ orderId }: { orderId: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const s = subject.trim();
    const b = body.trim();
    if (!s || !b || sending) return;
    setSending(true);
    setError(null);
    try {
      await customerB3Api.reportOrderIssue(orderId, s.slice(0, 120), b.slice(0, 4000));
      setOpen(false);
      setSubject("");
      setBody("");
      toast(t(`${K}.u27_issue.success`));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-g btn-s" onClick={() => setOpen(true)}>
        {t(`${K}.u27_issue.title`)}
      </button>
    );
  }
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <b>{t(`${K}.u27_issue.title`)}</b>
      <p className="muted tiny">{t(`${K}.u27_issue.sub`)}</p>
      {error && <ErrorCard message={error} />}
      <label className="fl" htmlFor={`issue-sub-${orderId}`}>{t(`${K}.u27_issue.subjectLabel`)}</label>
      <input
        id={`issue-sub-${orderId}`}
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t(`${K}.u27_issue.subjectPlaceholder`)}
        maxLength={120}
      />
      <label className="fl" htmlFor={`issue-body-${orderId}`}>{t(`${K}.u27_issue.bodyLabel`)}</label>
      <textarea
        id={`issue-body-${orderId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t(`${K}.u27_issue.bodyPlaceholder`)}
        rows={3}
        maxLength={4000}
      />
      <div className="btn-row">
        <button
          className="btn btn-p"
          disabled={!subject.trim() || !body.trim() || sending}
          onClick={submit}
        >
          {sending ? t("common.loading") : t(`${K}.u27_issue.submit`)}
        </button>
        <button className="btn btn-g" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/* ======================= U28: photo quality self-check ======================= */

/**
 * Pre-capture photo checklist (client-only, no server).
 * Copy is strictly about photo quality — never a medical judgement.
 */
export function PhotoChecklist() {
  const { t } = useLang();
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K}.u28_qualityCheck.title`)}</h3>
      <p className="muted tiny" style={{ marginTop: 0 }}>{t(`${K}.u28_qualityCheck.sub`)}</p>
      <ul style={{ margin: "8px 0", paddingLeft: 20 }} className="tiny">
        <li>{t(`${K}.u28_qualityCheck.lightingLabel`)}</li>
        <li>{t(`${K}.u28_qualityCheck.blurLabel`)}</li>
        <li>{t(`${K}.u28_qualityCheck.framingLabel`)}</li>
      </ul>
      <p className="tiny muted" style={{ margin: "4px 0 0" }}>{t(`${K}.u28_qualityCheck.retakeHint`)}</p>
    </div>
  );
}

/* ============================ U29: routine library ============================ */

/** Medication-free routine cards (category chip, bilingual title/body). */
export function RoutinesTab() {
  const { t, lang } = useLang();
  const [routines, setRoutines] = useState<RoutineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    customerB3Api
      .listRoutines()
      .then((r) => {
        setRoutines(r.routines ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  }, [t]);

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={error} />;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(`${K}.u29_routines.title`)}</h3>
      <p className="muted tiny" style={{ marginTop: 0 }}>{t(`${K}.u29_routines.sub`)}</p>
      {routines.length === 0 && <p className="muted">{t(`${K}.u29_routines.empty`)}</p>}
      {routines.map((r) => (
        <div className="card" key={r.id} style={{ margin: "10px 0" }}>
          <div className="rowflex">
            <b>{lang === "ne" && r.title_ne ? r.title_ne : r.title_en}</b>
            {r.category && <span className="chip">{r.category}</span>}
          </div>
          <p className="tiny" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
            {lang === "ne" && r.body_ne ? r.body_ne : r.body_en}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ======================= leaderboard opt-in (C19) ======================= */

/** Streak-board opt-in toggle; off by default (privacy-safe). */
export function LeaderboardOptIn() {
  const { t } = useLang();
  const [optIn, setOptIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    customerB3Api
      .getLeaderboardOptIn()
      .then((r) => {
        setOptIn(r.opt_in);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function toggle() {
    if (!loaded || saving) return;
    const next = !optIn;
    setSaving(true);
    try {
      const r = await customerB3Api.setLeaderboardOptIn(next);
      setOptIn(r.opt_in);
      toast(t(`${K}.leaderboard.saved`));
    } catch {
      /* keep the old value; the toggle stays where it was */
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;
  return (
    <label className="rowflex" style={{ margin: "8px 0", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={optIn}
        onChange={toggle}
        style={{ width: 28, height: 28, minHeight: 28 }}
        aria-label={t(`${K}.leaderboard.optInLabel`)}
      />
      <span>
        <b>{t(`${K}.leaderboard.optInLabel`)}</b>
        <br />
        <span className="tiny muted">{t(`${K}.leaderboard.optInSub`)}</span>
      </span>
    </label>
  );
}
