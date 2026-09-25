// Batch-3 coach UI (C19–C27). All labels come from p12c.coach.* (merged i18n).
// Degraded metrics are labelled honestly: SLA times are not tracked (schema
// has no ack/resolve timestamps) and adherence rows are checkin-dimension
// proxies, not habit-level tracking.
import { useState } from "react";
import { coachApi } from "../../api/client";
import { coachB3Api, type AdherenceRow, type RecurringNudge } from "../../api/b3coach";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

const DAY_MS = 86_400_000;

/* ---------------- C19: streak leaderboard ---------------- */

function medal(i: number): string {
  return i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
}

export function LeaderboardTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => coachB3Api.leaderboard().then((r) => r.leaderboard), []);

  return (
    <>
      <h3>{t("p12c.coach.leaderboardTitle")}</h3>
      <p className="tiny muted">{t("p12c.coach.leaderboardSub")}</p>
      {loading && <Loading />}
      {error && <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.user size={32} />} title={t("p12c.coach.leaderboardEmpty")} />
      )}
      {(data ?? []).map((row, i) => (
        <div className="card" key={row.user_id}>
          <div className="rowflex">
            <span style={{ fontSize: 20, width: 34 }}>{medal(i)}</span>
            <div>
              {/* Anonymized display only — real names never leave the server here. */}
              <b>{row.display}</b>
              <br />
              <span className="tiny muted">🔥 {t("p12c.coach.streakDays", { n: row.streak })}</span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------- C20: SLA info on escalations ---------------- */

/** SLA chips for one escalation. hours_to_ack/resolve are null (schema lacks
 *  the timestamps) — we say so, and show "open for {n}h" from created_at. */
export function EscalationSlaInfo({ createdAt, status }: { createdAt: string; status: string }) {
  const { t } = useLang();
  const { data } = useAsync(() => coachB3Api.escalationSla().then((r) => r.sla), []);
  if (data === undefined || data === null) return null;
  const hoursOpen = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 3_600_000));
  return (
    <div className="rowflex" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
      <Chip tone="grey">{t("p12c.coach.slaUnset")}</Chip>
      {status === "open" && <Chip tone="red">{t("p12c.coach.slaAge", { n: hoursOpen })}</Chip>}
    </div>
  );
}

/* ---------------- C21: recurring nudge composer ---------------- */

export function RecurringComposer({ customerId }: { customerId: string | null }) {
  const { t } = useLang();
  const [userId, setUserId] = useState("");
  const [msgEn, setMsgEn] = useState("");
  const [msgNe, setMsgNe] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [recurrence, setRecurrence] = useState<"daily" | "weekly">("daily");
  const [created, setCreated] = useState<RecurringNudge[]>([]);

  const target = userId.trim() || customerId || "";

  async function schedule() {
    if (!target || !msgEn.trim() || !sendAt) return;
    const iso = new Date(sendAt).toISOString();
    if (Date.parse(iso) <= Date.now()) {
      toast(t("p12.coach.sendAt"));
      return;
    }
    try {
      const r = await coachB3Api.createRecurringNudge({
        user_id: target,
        message_en: msgEn.trim(),
        ...(msgNe.trim() ? { message_ne: msgNe.trim() } : {}),
        send_at: iso,
        recurrence,
      });
      setCreated((c) => [r.nudge, ...c]);
      setMsgEn("");
      setMsgNe("");
      setSendAt("");
      toast(t("p12c.coach.recurringSaved"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <>
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t("p12c.coach.recurringTitle")}</h3>
        <p className="tiny muted">{t("p12c.coach.recurringSub")}</p>
        <label className="fl" htmlFor="rc-user">Customer user ID</label>
        <input
          id="rc-user"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={customerId ?? t("p12.coach.selectCustomer")}
        />
        <label className="fl" htmlFor="rc-en">{t("p12.coach.messagePh")}</label>
        <textarea id="rc-en" rows={3} value={msgEn} onChange={(e) => setMsgEn(e.target.value)} placeholder={t("p12.coach.messagePh")} />
        <label className="fl" htmlFor="rc-ne">{t("p12.coach.messageNePh")}</label>
        <textarea id="rc-ne" rows={2} value={msgNe} onChange={(e) => setMsgNe(e.target.value)} placeholder={t("p12.coach.messageNePh")} />
        <label className="fl" htmlFor="rc-at">{t("p12.coach.sendAt")}</label>
        <input id="rc-at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
        <div role="group" aria-label={t("p12c.coach.recurrence")} style={{ margin: "8px 0" }}>
          {(["daily", "weekly"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`chip${recurrence === r ? " on" : ""}`}
              aria-pressed={recurrence === r}
              onClick={() => setRecurrence(r)}
              style={{ marginRight: 6 }}
            >
              {t(`p12c.coach.${r}`)}
            </button>
          ))}
        </div>
        <button className="btn btn-p" disabled={!target || !msgEn.trim() || !sendAt} onClick={schedule}>
          {t("p12c.coach.scheduleRecurring")}
        </button>
      </div>
      {created.map((n) => (
        <div className="card" key={n.id}>
          <p className="tiny" style={{ margin: "4px 0" }}>{n.message_en}</p>
          <div className="rowflex" style={{ marginTop: 6 }}>
            <Chip tone="gold">↻ {t(`p12c.coach.${n.recurrence}`)}</Chip>
            <span className="tiny muted">{n.send_at.slice(0, 16).replace("T", " ")}</span>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------- C22: satisfaction trend ---------------- */

export function SatisfactionTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => coachB3Api.satisfactionTrend().then((r) => r.trend), []);

  const buckets = data ?? [];
  const W = 320;
  const H = 160;
  const PAD = 28;
  const maxAvg = 5;
  const pts = buckets.map((b, i) => {
    const x = buckets.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (buckets.length - 1);
    const y = H - PAD - (b.avg / maxAvg) * (H - 2 * PAD);
    return { x, y, b };
  });

  return (
    <>
      <h3>{t("p12c.coach.satisfactionTitle")}</h3>
      <p className="tiny muted">{t("p12c.coach.satisfactionSub")}</p>
      {loading && <Loading />}
      {error && <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />}
      {!loading && !error && buckets.length === 0 && (
        <EmptyState icon={<Icon.chart size={32} />} title={t("p12c.coach.noRatings")} />
      )}
      {buckets.length > 0 && (
        <div className="card">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img"
            aria-label={t("p12c.coach.satisfactionTitle")}>
            {[1, 2, 3, 4, 5].map((g) => {
              const y = H - PAD - (g / maxAvg) * (H - 2 * PAD);
              return (
                <g key={g}>
                  <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="var(--line)" strokeWidth={1} />
                  <text x={4} y={y + 4} fontSize={10} fill="var(--muted)">{g}</text>
                </g>
              );
            })}
            {pts.length > 1 && (
              <polyline
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--green)"
                strokeWidth={2.5}
              />
            )}
            {pts.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={5} fill="var(--green)" />
                <title>{`${p.b.bucket}: ${p.b.avg} (${t("p12c.coach.ratingsCount", { n: p.b.count })})`}</title>
              </g>
            ))}
          </svg>
          <div className="rowflex" style={{ flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {buckets.map((b) => (
              <span className="chip grey tiny" key={b.bucket}>
                {b.bucket.slice(5)} · {b.avg} · {t("p12c.coach.ratingsCount", { n: b.count })}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- C23: progress compare ---------------- */

function CompareTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 120 }}>
      <p className="tiny muted" style={{ margin: "0 0 4px" }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
        {value === null ? "—" : value}
      </p>
    </div>
  );
}

function ProgressCompare({ customerId }: { customerId: string }) {
  const { t, lang } = useLang();
  const { data, error, loading, retry } = useAsync(() => coachB3Api.progressCompare(customerId), [customerId]);

  const b = data?.baseline?.shedding_estimate ?? null;
  const c = data?.current?.shedding_estimate ?? null;
  const delta = b !== null && c !== null ? c - b : null;

  return (
    <>
      <h3>{t("p12c.coach.progressCompareTitle")}</h3>
      {loading && <Loading />}
      {error && <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />}
      {!loading && !error && data && b === null && c === null && (
        <EmptyState icon={<Icon.chart size={32} />} title={t("p12c.coach.noProgress")} />
      )}
      {b !== null || c !== null ? (
        <>
          <div className="rowflex" style={{ gap: 8, alignItems: "stretch" }}>
            <CompareTile label={t("p12c.coach.baseline")} value={b} />
            <span style={{ alignSelf: "center", fontSize: 22 }} aria-hidden>
              {delta === null ? "→" : delta < 0 ? "↘" : delta > 0 ? "↗" : "→"}
            </span>
            <CompareTile label={t("p12c.coach.current")} value={c} />
          </div>
          <p className="tiny muted">
            {/* Degraded-by-design caption: no medical measurement exists here. */}
            {lang === "ne"
              ? "ग्राहकले रिपोर्ट गरेको झर्ने अनुमानको आधारमा — चिकित्सा मापन होइन।"
              : "Based on customer-reported shedding estimates — not a medical measurement."}
          </p>
        </>
      ) : null}
    </>
  );
}

/* ---------------- C24: onboarding checklist ---------------- */

const DEFAULT_STEPS = [
  "profile_complete",
  "first_scan_done",
  "plan_reviewed",
  "first_kit_ordered",
  "first_checkin_done",
] as const;

function OnboardingPanel({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB3Api.getOnboarding(customerId).then((r) => r.checklist),
    [customerId],
  );
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);

  const saved = data?.steps ?? [];
  const keys = Array.from(new Set([...DEFAULT_STEPS, ...saved.map((s) => s.key)]));
  const value = draft ?? Object.fromEntries(saved.map((s) => [s.key, s.done]));

  async function save() {
    setSaving(true);
    try {
      const steps = keys.map((key) => ({ key, done: !!value[key] }));
      await coachB3Api.saveOnboarding(customerId, steps);
      toast(t("p12c.coach.onboardingSaved"));
      setDraft(null);
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h3>{t("p12c.coach.onboardingTitle")}</h3>
      <p className="tiny muted">{t("p12c.coach.onboardingSub")}</p>
      {loading && <Loading />}
      {error && <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />}
      {!loading && !error && (
        <div className="card">
          {keys.map((key) => (
            <label key={key} className="rowflex" style={{ margin: "8px 0", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!value[key]}
                onChange={(e) => setDraft((d) => ({ ...(d ?? value), [key]: e.target.checked }))}
              />
              <span className="tiny">{key}</span>
              <span className="spacer" />
              {value[key] && <Chip tone="gold">{t("p12c.coach.stepDone")}</Chip>}
            </label>
          ))}
          <button className="btn btn-p" disabled={saving} onClick={save}>
            {t("p12.common.save")}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------------- C27: adherence detail ---------------- */

const HABIT_LABEL: Record<AdherenceRow["habit"], string> = {
  daily_checkin: "p12c.coach.dailyCheckin",
  photo_logged: "p12c.coach.photoLogged",
  shedding_logged: "p12c.coach.sheddingLogged",
  note_logged: "p12c.coach.noteLogged",
};

function AdherencePanel({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => coachB3Api.adherenceDetail(customerId).then((r) => r.detail), [customerId]);

  return (
    <>
      <h3>{t("p12c.coach.adherenceTitle")}</h3>
      {/* Honest label: these are checkin dimensions, not habit-level tracking. */}
      <p className="tiny muted">{t("p12c.coach.adherenceSub")}</p>
      {loading && <Loading />}
      {error && <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />}
      {!loading && !error && (data ?? []).map((d) => {
        const pct = d.total > 0 ? Math.round((d.done / d.total) * 100) : 0;
        return (
          <div className="card" key={d.habit}>
            <div className="rowflex">
              <b className="tiny">{t(HABIT_LABEL[d.habit])}</b>
              <span className="spacer" />
              <span className="tiny muted">{t("p12c.coach.ofTotal", { done: d.done, total: d.total })}</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ height: 8, borderRadius: 4, background: "var(--line)", marginTop: 8 }}
            >
              <div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: "var(--green)" }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Per-customer batch-3 sub-tabs: progress compare (C23), onboarding (C24), adherence (C27). */
export function CustomerB3Tabs({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const [sub, setSub] = useState<"compare" | "onboarding" | "adherence">("compare");

  return (
    <div style={{ marginTop: 16 }}>
      <div className="tabrow" role="tablist">
        {(
          [
            ["compare", "p12c.coach.progressCompareTitle"],
            ["onboarding", "p12c.coach.onboardingTitle"],
            ["adherence", "p12c.coach.adherenceTitle"],
          ] as const
        ).map(([k, labelKey]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={sub === k}
            className={`tab${sub === k ? " on" : ""}`}
            onClick={() => setSub(k)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {sub === "compare" && <ProgressCompare customerId={customerId} />}
      {sub === "onboarding" && <OnboardingPanel customerId={customerId} />}
      {sub === "adherence" && <AdherencePanel customerId={customerId} />}
    </div>
  );
}

/* ---------------- C25: missed check-ins ---------------- */

export function MissedTab() {
  const { t } = useLang();
  const [days, setDays] = useState(7);
  const { data, error, loading, retry } = useAsync(() => coachB3Api.missedCheckins(days).then((r) => r.missed), [days]);
  const [nudging, setNudging] = useState<string | null>(null);

  async function nudge(userId: string) {
    setNudging(userId);
    try {
      // One-tap nudge: a one-off reminder for tomorrow morning. Bilingual
      // message; the scheduled-nudge row carries both languages.
      const sendAt = new Date(Date.now() + DAY_MS);
      sendAt.setHours(9, 0, 0, 0);
      await coachApi.scheduleNudge({
        user_id: userId,
        message_en: "We missed your daily check-in — how is your hair routine going?",
        message_ne: "तपाईंको दैनिक चेक-इन छुट्यो — तपाईंको कपालको रुटिन कस्तो चलिरहेको छ?",
        send_at: sendAt.toISOString(),
      });
      toast(t("p12.coach.reminderScheduled"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setNudging(null);
    }
  }

  return (
    <>
      <h3>{t("p12c.coach.missedTitle")}</h3>
      <p className="tiny muted">{t("p12c.coach.missedSub", { n: days })}</p>
      <div className="rowflex" style={{ margin: "8px 0" }}>
        <label className="fl" htmlFor="missed-days" style={{ margin: 0 }}>
          {t("p12c.coach.daysMissed", { n: days })}
        </label>
        <select id="missed-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
      {loading && <Loading />}
      {error && <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.check size={32} />} title={t("p12.coach.focusNone")} />
      )}
      {(data ?? []).map((m) => (
        <div className="card" key={m.user_id}>
          <div className="rowflex">
            <span style={{ color: "var(--bad)" }}>
              <Icon.alert size={20} />
            </span>
            <div>
              <b>{m.name ?? t("coachDash.customer")}</b>
              <br />
              <span className="tiny muted">
                {m.days_missed === 0 ? t("p12c.coach.neverCheckedIn") : t("p12c.coach.daysMissed", { n: m.days_missed })}
              </span>
            </div>
            <span className="spacer" />
            <button
              className="btn btn-s btn-p"
              disabled={nudging === m.user_id}
              onClick={() => void nudge(m.user_id)}
            >
              {t("coachDash.compose")}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------- C26: availability toggle ---------------- */

export function AvailabilityToggle() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(
    () => coachB3Api.getAvailability().then((r) => r.availability),
    [],
  );
  const [status, setStatus] = useState<"available" | "on_leave" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = status ?? data?.status ?? "available";
  const currentNote = note ?? data?.note ?? "";

  async function save() {
    setSaving(true);
    try {
      await coachB3Api.setAvailability(current, currentNote.trim() ? currentNote.trim() : undefined);
      toast(t("p12c.coach.availabilitySaved"));
      setStatus(null);
      setNote(null);
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (error) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="rowflex" style={{ flexWrap: "wrap", gap: 8 }}>
        <b className="tiny">{t("p12c.coach.availabilityTitle")}</b>
        <span className="spacer" />
        {(["available", "on_leave"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${current === s ? " on" : ""}`}
            aria-pressed={current === s}
            onClick={() => setStatus(s)}
            style={{ marginRight: 4 }}
          >
            {t(`p12c.coach.${s}`)}
          </button>
        ))}
      </div>
      <label className="fl" htmlFor="avail-note">{t("p12c.coach.availabilityNote")}</label>
      <input
        id="avail-note"
        type="text"
        value={currentNote}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("p12c.coach.availabilityNotePh")}
      />
      <div className="btn-row">
        <button className="btn btn-p btn-s" disabled={saving} onClick={save}>
          {t("p12.common.save")}
        </button>
      </div>
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>{t("p12c.coach.availabilitySub")}</p>
    </div>
  );
}
