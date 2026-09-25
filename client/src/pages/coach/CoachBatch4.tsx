// Batch-4 coach UI (C28–C45). All labels come from p12d.coach.*.
// Habit-only coaching — nothing medical/diagnostic.
// (Certificate display + customer survey form belong to the customer slice;
//  this file only exposes the coach-side tools.)
import { useState } from "react";
import { coachApi } from "../../api/client";
import {
  coachB4Api,
  type CustomerTag,
  type InactiveCustomer,
  type JourneyStage,
  type Milestone,
} from "../../api/b4coach";
import { useLang } from "../../i18n/LanguageContext";
import {
  Chip, EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage, toast,
} from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { AssignedCustomer } from "../../api/types";

/* ---------------- C36/C44: composer hints ---------------- */

/**
 * Quiet-hours + content-language hints for the nudge composer. Renders only
 * when the customer payload actually carries the fields — the server does not
 * populate them yet, so the composer silently shows no hint rather than
 * inventing one.
 */
export function ComposerHints({ customer }: { customer?: AssignedCustomer | null }) {
  const { t } = useLang();
  if (!customer) return null;
  // Narrow once so the i18n param type (string | number) is satisfied.
  const quietFrom = customer.quiet_from ?? undefined;
  const quietTo = customer.quiet_to ?? undefined;
  const lang = customer.content_language ?? undefined;
  if ((!quietFrom || !quietTo) && !lang) return null;
  return (
    <div style={{ margin: "8px 0" }}>
      {quietFrom && quietTo && (
        <p className="tiny muted" style={{ margin: "4px 0" }}>
          🔇 {t("p12d.coach.quietHoursHint", { from: quietFrom, to: quietTo })}
        </p>
      )}
      {lang && (
        <p className="tiny muted" style={{ margin: "4px 0" }}>
          🌐 {t("p12d.coach.langHint", { lang })}
        </p>
      )}
    </div>
  );
}

/* ---------------- C29: feedback aggregate card ---------------- */

export function FeedbackAggregateCard() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.feedbackAggregate().then((r) => r.feedback), [],
  );
  const err = error ? apiErrorMessage(t, error) : null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("p12d.coach.feedbackTitle")}</h3>
      <p className="tiny muted">{t("p12d.coach.feedbackSub")}</p>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && data && (
        data.avg === null ? (
          <p className="tiny muted">{t("p12d.coach.feedbackNone")}</p>
        ) : (
          <div className="statgrid">
            <StatCard label={t("p12d.coach.feedbackAvg")} value={data.avg.toFixed(1)} icon={<Icon.chat size={26} />} />
            <StatCard label={t("p12d.coach.feedbackCount")} value={String(data.count)} icon={<Icon.user size={26} />} />
          </div>
        )
      )}
    </div>
  );
}

/* ---------------- C31: nudge stats card ---------------- */

export function NudgeStatsCard() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.nudgeStats().then((r) => r.stats), [],
  );
  const err = error ? apiErrorMessage(t, error) : null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>📨</h3>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && data && (
        <>
          <div className="statgrid">
            <StatCard label="✓" value={String(data.sent)} icon={<Icon.check size={26} />} />
            <StatCard label="⏳" value={String(data.pending)} icon={<Icon.clock size={26} />} />
          </div>
          {/* Honest: open rates are not tracked — scheduled_nudges has sent_at only. */}
          <p className="tiny muted">{t("p12d.coach.nudgeStatsNote")}</p>
        </>
      )}
    </div>
  );
}

/* ---------------- C37: weekly report card ---------------- */

export function WeeklyReportCard() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.weeklyReport().then((r) => r.report), [],
  );
  const err = error ? apiErrorMessage(t, error) : null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("p12d.coach.reportTitle")}</h3>
      {!loading && !error && data && (
        <p className="tiny muted">{t("p12d.coach.reportSub", { week: data.weekStart })}</p>
      )}
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && data && (
        <div className="statgrid">
          <StatCard label={t("p12d.coach.reportNotes")} value={String(data.notes)} icon={<Icon.doc size={26} />} />
          <StatCard label={t("p12d.coach.reportNudges")} value={String(data.nudges)} icon={<Icon.bell size={26} />} />
          <StatCard label={t("p12d.coach.reportEscalations")} value={String(data.escalations)} icon={<Icon.alert size={26} />} />
        </div>
      )}
    </div>
  );
}

/* ---------------- C30: streak freeze ---------------- */

export function StreakFreezeAction({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function freeze() {
    if (!date || busy) return;
    setBusy(true);
    try {
      await coachB4Api.createStreakFreeze(customerId, date);
      toast(t("p12d.coach.freezeDone"));
    } catch (e) {
      const status = (e as { status?: number }).status;
      toast(status === 409 ? t("p12d.coach.freezeMonthUsed") : apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>❄️ {t("p12d.coach.freezeTitle")}</h3>
      <p className="tiny muted">{t("p12d.coach.freezeSub")}</p>
      <div className="rowflex" style={{ flexWrap: "wrap", gap: 8 }}>
        <label className="fl" htmlFor="freeze-date" style={{ margin: 0 }}>
          {t("p12d.coach.freezeDateLabel")}
        </label>
        <input id="freeze-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn-p btn-s" disabled={!date || busy} onClick={freeze}>
          {t("p12d.coach.freezeBtn")}
        </button>
      </div>
    </div>
  );
}

/* ---------------- C32: customer tags ---------------- */

export function CustomerTags({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const [draft, setDraft] = useState("");
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.listTags(customerId).then((r) => r.tags), [customerId],
  );
  const err = error ? apiErrorMessage(t, error) : null;

  async function add() {
    const tag = draft.trim();
    if (!tag) return;
    try {
      await coachB4Api.addTag(customerId, tag);
      setDraft("");
      toast(t("p12d.coach.tagsAdded"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function remove(tag: CustomerTag) {
    try {
      await coachB4Api.removeTag(customerId, tag.tag);
      toast(t("p12d.coach.tagsRemoved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🏷️ {t("p12d.coach.tagsTitle")}</h3>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && (
        <>
          <div className="rowflex" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {(data ?? []).map((tag) => (
              <span key={tag.id} className="chip">
                {tag.tag}
                <button
                  type="button"
                  className="linklike"
                  style={{ marginLeft: 6 }}
                  onClick={() => remove(tag)}
                  aria-label={`${t("p12.common.delete")}: ${tag.tag}`}
                >
                  ×
                </button>
              </span>
            ))}
            {(data ?? []).length === 0 && <span className="tiny muted">{t("p12d.coach.tagsEmpty")}</span>}
          </div>
          <div className="rowflex" style={{ gap: 8 }}>
            <input
              type="text"
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("p12d.coach.tagsAddPh")}
              aria-label={t("p12d.coach.tagsTitle")}
              style={{ flex: 1 }}
            />
            <button className="btn btn-p btn-s" disabled={!draft.trim()} onClick={add}>
              {t("p12d.coach.tagsAdd")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- C34: handovers ---------------- */

export function HandoversTab({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const [toCoach, setToCoach] = useState("");
  const [note, setNote] = useState("");
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.listHandovers(customerId).then((r) => r.handovers), [customerId],
  );
  const err = error ? apiErrorMessage(t, error) : null;

  async function add() {
    if (!note.trim()) return;
    try {
      await coachB4Api.createHandover(customerId, {
        ...(toCoach.trim() ? { to_coach_id: toCoach.trim() } : {}),
        note: note.trim(),
      });
      setNote("");
      setToCoach("");
      toast(t("p12d.coach.handoverAdded"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>🤝 {t("p12d.coach.handoverTitle")}</h3>
        <p className="tiny muted">{t("p12d.coach.handoverSub")}</p>
        <label className="fl" htmlFor="ho-to">{t("p12d.coach.handoverToPh")}</label>
        <input id="ho-to" type="text" value={toCoach} onChange={(e) => setToCoach(e.target.value)} placeholder={t("p12d.coach.handoverToPh")} />
        <label className="fl" htmlFor="ho-note">{t("p12d.coach.handoverNotePh")}</label>
        <textarea id="ho-note" rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={t("p12d.coach.handoverNotePh")} />
        <button className="btn btn-p btn-s" disabled={!note.trim()} onClick={add}>
          {t("p12d.coach.handoverAdd")}
        </button>
      </div>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.user size={32} />} title={t("p12d.coach.handoverEmpty")} />
      )}
      {(data ?? []).map((h) => (
        <div className="card" key={h.id}>
          <p className="tiny" style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{h.note}</p>
          <p className="tiny muted" style={{ margin: "4px 0" }}>
            {h.created_at.slice(0, 10)}
            {h.to_coach_id ? ` → ${h.to_coach_id.slice(0, 8)}` : ""}
          </p>
        </div>
      ))}
    </>
  );
}

/* ---------------- C38: milestones timeline ---------------- */

const MILESTONE_ICON: Record<Milestone["kind"], string> = {
  badge: "🏅",
  goal: "🎯",
  challenge: "🏁",
};

export function MilestonesTimeline({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.milestones(customerId).then((r) => r.milestones), [customerId],
  );
  const err = error ? apiErrorMessage(t, error) : null;
  const label = (k: Milestone["kind"]) =>
    k === "badge" ? t("p12d.coach.milestoneBadge")
      : k === "goal" ? t("p12d.coach.milestoneGoal")
        : t("p12d.coach.milestoneChallenge");
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🌟 {t("p12d.coach.milestonesTitle")}</h3>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <p className="tiny muted">{t("p12d.coach.milestonesEmpty")}</p>
      )}
      {(data ?? []).map((m, i) => (
        <div className="rowflex" key={`${m.kind}-${m.at}-${i}`} style={{ margin: "6px 0" }}>
          <span style={{ fontSize: 18, width: 30 }}>{MILESTONE_ICON[m.kind] ?? "•"}</span>
          <div>
            <b className="tiny">{label(m.kind)}</b>
            <br />
            <span className="tiny muted">{m.title} · {m.at.slice(0, 10)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- C41: journey stage badge ---------------- */

const JOURNEY_TONE: Record<JourneyStage, "grey" | "gold" | undefined> = {
  new: "gold",
  active: undefined,
  returning: "gold",
  dormant: "grey",
};

export function JourneyStageBadge({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.journey(customerId).then((r) => r.stage), [customerId],
  );
  const err = error ? apiErrorMessage(t, error) : null;
  const label = (s: JourneyStage) =>
    s === "new" ? t("p12d.coach.journeyNew")
      : s === "active" ? t("p12d.coach.journeyActive")
        : s === "returning" ? t("p12d.coach.journeyReturning")
          : t("p12d.coach.journeyDormant");
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🧭 {t("p12d.coach.journeyTitle")}</h3>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && data && (
        <>
          <Chip tone={JOURNEY_TONE[data]}>{label(data)}</Chip>
          <p className="tiny muted" style={{ marginTop: 8 }}>{t("p12d.coach.journeyRule")}</p>
        </>
      )}
    </div>
  );
}

/* ---------------- C45: challenge survey results ---------------- */

export function ChallengeSurveysView() {
  const { t } = useLang();
  const [challengeId, setChallengeId] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const { data, error, loading, retry } = useAsync(
    () => (asked ? coachB4Api.challengeSurveys(asked).then((r) => r.surveys) : Promise.resolve(null)),
    [asked],
  );
  const err = error ? apiErrorMessage(t, error) : null;
  const avg = data && data.length
    ? (data.reduce((a, s) => a + s.q1_rating, 0) / data.length).toFixed(1)
    : null;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>📊 {t("p12d.coach.surveysTitle")}</h3>
      <p className="tiny muted">{t("p12d.coach.surveysSub")}</p>
      <div className="rowflex" style={{ gap: 8 }}>
        <input
          type="text"
          value={challengeId}
          onChange={(e) => setChallengeId(e.target.value)}
          placeholder={t("p12d.coach.challengePickPh")}
          aria-label={t("p12d.coach.challengePickPh")}
          style={{ flex: 1 }}
        />
        <button className="btn btn-p btn-s" disabled={!challengeId.trim()} onClick={() => setAsked(challengeId.trim())}>
          {t("p12d.coach.surveysViewBtn")}
        </button>
      </div>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && asked && data && (
        <>
          {avg !== null && (
            <p className="tiny" style={{ marginTop: 8 }}>
              <b>{t("p12d.coach.surveysAvg")}: {avg}</b> · {data.length} {t("p12d.coach.surveysCount")}
            </p>
          )}
          {data.length === 0 && <p className="tiny muted">{t("p12d.coach.surveysEmpty")}</p>}
          {data.map((s) => (
            <div key={s.id} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <span className="tiny">{"★".repeat(s.q1_rating)}{"☆".repeat(5 - s.q1_rating)}</span>
              {s.q2_text && <p className="tiny muted" style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{s.q2_text}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- C35: inactive attention list ---------------- */

export function InactiveTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.inactive().then((r) => r.inactive), [],
  );
  const err = error ? apiErrorMessage(t, error) : null;
  return (
    <>
      <h3>{t("p12d.coach.inactiveTitle")}</h3>
      <p className="tiny muted">{t("p12d.coach.inactiveSub")}</p>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.check size={32} />} title={t("p12d.coach.inactiveEmpty")} />
      )}
      {(data ?? []).map((c: InactiveCustomer) => (
        <div className="card" key={c.user_id}>
          <div className="rowflex">
            <span style={{ color: "var(--bad)" }}><Icon.clock size={20} /></span>
            <div>
              <b>{c.name ?? c.user_id.slice(0, 8)}</b>
              <br />
              <span className="tiny muted">{t("p12d.coach.inactiveDays", { n: c.days_missed })}</span>
            </div>
            <span className="spacer" />
            <Chip tone="red">{t("p12d.coach.inactiveDays", { n: c.days_missed })}</Chip>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------- C33: bulk nudge composer ---------------- */

export function BulkNudgeComposer() {
  const { t } = useLang();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyNe, setBodyNe] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [busy, setBusy] = useState(false);
  const customers = useAsync(
    () =>
      coachApi
        .listCustomers()
        .then((r) => r.customers)
        .catch((e) => {
          if ((e as { status?: number }).status === 404) return null;
          throw e;
        }),
    [],
  );
  const list = customers.data ?? [];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function send() {
    const manualIds = manual.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const ids = [...new Set([...selected, ...manualIds])];
    if (ids.length === 0) {
      toast(t("p12d.coach.bulkPickOne"));
      return;
    }
    if (!bodyEn.trim() || !sendAt) return;
    const iso = new Date(sendAt).toISOString();
    if (Date.parse(iso) <= Date.now()) {
      toast(t("p12.coach.sendAt"));
      return;
    }
    setBusy(true);
    try {
      const r = await coachB4Api.bulkNudge({
        customer_ids: ids,
        ...(titleEn.trim() ? { title_en: titleEn.trim() } : {}),
        body_en: bodyEn.trim(),
        ...(bodyNe.trim() ? { body_ne: bodyNe.trim() } : {}),
        send_at: iso,
      });
      toast(`${t("p12d.coach.bulkSent")} (${r.sent})`);
      setSelected(new Set());
      setManual("");
      setTitleEn("");
      setBodyEn("");
      setBodyNe("");
      setSendAt("");
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>{t("p12d.coach.bulkTitle")}</h3>
      <p className="tiny muted">{t("p12d.coach.bulkSub")}</p>
      <div className="card">
        <p className="tiny" style={{ fontWeight: 700, margin: "0 0 6px" }}>
          {selected.size} {t("p12d.coach.bulkSelected")}
        </p>
        {customers.loading && <Loading />}
        {list.length > 0 && (
          <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 8 }}>
            {list.map((c) => (
              <label key={c.id} className="rowflex tiny" style={{ margin: "4px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span>{c.name || c.phone || c.id.slice(0, 8)}</span>
              </label>
            ))}
          </div>
        )}
        <label className="fl" htmlFor="bulk-manual">IDs</label>
        <input
          id="bulk-manual"
          type="text"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="id1, id2"
        />
        <label className="fl" htmlFor="bulk-title">{t("p12d.coach.bulkTitlePh")}</label>
        <input id="bulk-title" type="text" value={titleEn} maxLength={200} onChange={(e) => setTitleEn(e.target.value)} placeholder={t("p12d.coach.bulkTitlePh")} />
        <label className="fl" htmlFor="bulk-en">{t("p12d.coach.bulkBodyPh")}</label>
        <textarea id="bulk-en" rows={3} value={bodyEn} maxLength={500} onChange={(e) => setBodyEn(e.target.value)} placeholder={t("p12d.coach.bulkBodyPh")} />
        <label className="fl" htmlFor="bulk-ne">{t("p12d.coach.bulkBodyNePh")}</label>
        <textarea id="bulk-ne" rows={2} value={bodyNe} maxLength={500} onChange={(e) => setBodyNe(e.target.value)} placeholder={t("p12d.coach.bulkBodyNePh")} />
        <label className="fl" htmlFor="bulk-at">{t("p12d.coach.bulkSendAt")}</label>
        <input id="bulk-at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
        <button className="btn btn-p" disabled={busy || !bodyEn.trim() || !sendAt} onClick={send}>
          {t("p12d.coach.bulkSend")}
        </button>
      </div>
    </>
  );
}

/* ---------------- C42: escalation outcome ---------------- */

export function EscalationOutcomePanel() {
  const { t } = useLang();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, loading, retry } = useAsync(
    () => coachApi.listEscalations("resolved").then((r) => r.escalations), [],
  );
  const err = error ? apiErrorMessage(t, error) : null;

  async function save(id: string) {
    const outcome = (drafts[id] ?? "").trim();
    if (!outcome || busy) return;
    setBusy(id);
    try {
      await coachB4Api.setEscalationOutcome(id, outcome);
      toast(t("p12d.coach.outcomeSaved"));
      setDrafts((d) => ({ ...d, [id]: "" }));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h3>📝 {t("p12d.coach.outcomeTitle")}</h3>
      <p className="tiny muted">{t("p12d.coach.outcomeSub")}</p>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.check size={32} />} title={t("p12d.coach.outcomeEmpty")} />
      )}
      {(data ?? []).map((e) => (
        <div className="card" key={e.id}>
          <p className="tiny" style={{ margin: "4px 0" }}><b>{t("p12d.coach.outcomeReason")}:</b> {e.reason}</p>
          <p className="tiny muted" style={{ margin: "4px 0" }}>{e.created_at.slice(0, 10)}</p>
          <label className="fl" htmlFor={`oc-${e.id}`}>{t("p12d.coach.outcomePh")}</label>
          <input
            id={`oc-${e.id}`}
            type="text"
            value={drafts[e.id] ?? ""}
            maxLength={500}
            onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
            placeholder={t("p12d.coach.outcomePh")}
          />
          <button className="btn btn-p btn-s" disabled={!(drafts[e.id] ?? "").trim() || busy === e.id} onClick={() => save(e.id)}>
            {t("p12d.coach.outcomeSave")}
          </button>
        </div>
      ))}
    </>
  );
}

/* ---------------- C43: peer tips ---------------- */

export function PeerTipsTab() {
  const { t } = useLang();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { data, error, loading, retry } = useAsync(
    () => coachB4Api.listTips().then((r) => r.tips), [],
  );
  const err = error ? apiErrorMessage(t, error) : null;

  async function add() {
    if (!title.trim() || !body.trim()) return;
    try {
      await coachB4Api.createTip({ title: title.trim(), body: body.trim() });
      setTitle("");
      setBody("");
      toast(t("p12d.coach.tipsAdded"));
      retry();
    } catch (e) {
      const status = (e as { status?: number }).status;
      toast(status === 400 ? t("p12d.coach.tipsPiiRejected") : apiErrorMessage(t, e));
    }
  }

  async function del(id: string) {
    if (!window.confirm(t("p12.common.delete"))) return;
    try {
      await coachB4Api.deleteTip(id);
      toast(t("p12d.coach.tipsDeleted"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <>
      <h3>💡 {t("p12d.coach.tipsTitle")}</h3>
      <p className="tiny muted">{t("p12d.coach.tipsSub")}</p>
      <div className="card">
        <label className="fl" htmlFor="tip-title">{t("p12d.coach.tipsTitlePh")}</label>
        <input id="tip-title" type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("p12d.coach.tipsTitlePh")} />
        <label className="fl" htmlFor="tip-body">{t("p12d.coach.tipsBodyPh")}</label>
        <textarea id="tip-body" rows={3} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder={t("p12d.coach.tipsBodyPh")} />
        <button className="btn btn-p btn-s" disabled={!title.trim() || !body.trim()} onClick={add}>
          {t("p12d.coach.tipsAdd")}
        </button>
      </div>
      {loading && <Loading />}
      {err && <ErrorCard message={err} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("p12d.coach.tipsEmpty")} />
      )}
      {(data ?? []).map((tip) => (
        <div className="card" key={tip.id}>
          <div className="rowflex">
            <b className="tiny">{tip.title}</b>
            <span className="spacer" />
            <button className="btn btn-g btn-s" onClick={() => del(tip.id)}>
              {t("p12.common.delete")}
            </button>
          </div>
          <p className="tiny muted" style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{tip.body}</p>
          <p className="tiny muted" style={{ margin: 0 }}>{tip.created_at.slice(0, 10)}</p>
        </div>
      ))}
    </>
  );
}

/* ---------------- section: tabs + customer picker ---------------- */

const B4_TABS = ["overview", "customer", "bulk", "inactive", "tips"] as const;
const B4_TAB_LABEL: Record<(typeof B4_TABS)[number], string> = {
  overview: "p12d.coach.tabOverview",
  customer: "p12d.coach.tabCustomer",
  bulk: "p12d.coach.tabBulk",
  inactive: "p12d.coach.tabInactive",
  tips: "p12d.coach.tabTips",
};

/**
 * Batch-4 coach tools, mounted below the batch 1–3 tools. Self-contained:
 * own customer picker (dropdown with manual-ID fallback + tag filter),
 * nothing existing is touched.
 */
export function CoachBatch4Tools() {
  const { t } = useLang();
  const [tab, setTab] = useState<(typeof B4_TABS)[number]>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [filteredIds, setFilteredIds] = useState<string[] | null>(null);

  const customers = useAsync(
    () =>
      coachApi
        .listCustomers()
        .then((r) => r.customers)
        .catch((e) => {
          if ((e as { status?: number }).status === 404) return null;
          throw e;
        }),
    [],
  );
  const list: AssignedCustomer[] = customers.data ?? [];
  const pickerErr = customers.error ? apiErrorMessage(t, customers.error) : null;
  const customerId = selectedId ?? (manualId.trim() || null);
  const visible = filteredIds === null ? list : list.filter((c) => filteredIds.includes(c.id));

  async function applyTagFilter() {
    const tag = tagFilter.trim();
    if (!tag) {
      setFilteredIds(null);
      return;
    }
    try {
      const keep: string[] = [];
      for (const c of list) {
        const tags = await coachB4Api.listTags(c.id).then((r) => r.tags);
        if (tags.some((x) => x.tag === tag.toLowerCase())) keep.push(c.id);
      }
      setFilteredIds(keep);
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2>{t("p12d.coach.sectionTitle")}</h2>

      <div className="card">
        <label className="fl" htmlFor="b4-cust-pick">{t("p12d.coach.selectCustomerPh")}</label>
        {customers.loading && <Loading />}
        {pickerErr && <ErrorCard message={pickerErr} />}
        {list.length > 0 && (
          <>
            <select
              id="b4-cust-pick"
              value={selectedId ?? ""}
              onChange={(e) => {
                setSelectedId(e.target.value || null);
                setManualId("");
              }}
            >
              <option value="">{t("p12d.coach.selectCustomerPh")}</option>
              {visible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <div className="rowflex" style={{ gap: 8, marginTop: 8 }}>
              <input
                type="text"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder={t("p12d.coach.tagsFilterPh")}
                aria-label={t("p12d.coach.tagsFilterPh")}
                style={{ flex: 1 }}
              />
              <button className="btn btn-g btn-s" onClick={applyTagFilter}>
                {t("p12d.coach.tagsFilterBtn")}
              </button>
              {filteredIds !== null && (
                <button className="btn btn-g btn-s" onClick={() => { setFilteredIds(null); setTagFilter(""); }}>
                  ×
                </button>
              )}
            </div>
          </>
        )}
        {list.length === 0 && !customers.loading && (
          <input
            type="text"
            value={manualId}
            onChange={(e) => {
              setManualId(e.target.value);
              setSelectedId(null);
            }}
            placeholder={t("p12d.coach.selectCustomerPh")}
            aria-label={t("p12d.coach.selectCustomerPh")}
          />
        )}
      </div>

      <div className="tabrow" role="tablist">
        {B4_TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`tab${tab === k ? " on" : ""}`}
            onClick={() => setTab(k)}
          >
            {t(B4_TAB_LABEL[k])}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <FeedbackAggregateCard />
          <WeeklyReportCard />
          <NudgeStatsCard />
        </>
      )}

      {tab === "customer" && (
        customerId ? (
          <>
            <JourneyStageBadge customerId={customerId} />
            <StreakFreezeAction customerId={customerId} />
            <CustomerTags customerId={customerId} />
            <MilestonesTimeline customerId={customerId} />
            <HandoversTab customerId={customerId} />
            <ChallengeSurveysView />
          </>
        ) : (
          <EmptyState icon={<Icon.user size={32} />} title={t("p12d.coach.selectCustomerPh")} />
        )
      )}

      {tab === "bulk" && <BulkNudgeComposer />}

      {tab === "inactive" && <InactiveTab />}

      {tab === "tips" && <PeerTipsTab />}

      {/* C42: escalation outcome recording lives under its own heading so it
          stays visible regardless of the tab above. */}
      <EscalationOutcomePanel />
    </div>
  );
}
