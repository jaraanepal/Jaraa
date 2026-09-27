/**
 * Problem 4 (v14): per-customer progress view for the coach.
 * Route: /coach/customers/:id (wired by the parent).
 *
 * Sections: habits adherence, challenges progress, plan adherence,
 * recent activity. Actions: send nudge now, schedule follow-up,
 * complete follow-ups. Habit accountability only — no medical/diagnostic
 * content (that is the doctor's).
 *
 * New labels are plain English literals (listed in the v14 report for
 * EN/NE translation); shared labels reuse existing i18n keys.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { coachP14Api, type CoachFollowup } from "./coachP14";
import { coachApi } from "../../api/client";
import { coachB3Api } from "../../api/b3coach";
import { coachB4Api } from "../../api/b4coach";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { adherence14, checkinDays } from "../Progress";
import type { AssignedCustomer } from "../../api/types";

const DAY_MS = 86_400_000;

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- progress sections ---------------- */

function ProgressSection({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const checkins = useAsync(() => coachP14Api.listCustomerCheckins(customerId), [customerId]);
  const adherence = useAsync(() => coachB3Api.adherenceDetail(customerId).then((r) => r.detail), [customerId]);
  const challenges = useAsync(() => coachP14Api.listCustomerChallenges(customerId).then((r) => r.assignments), [customerId]);

  const list = checkins.data ?? [];
  const days = checkinDays(list);
  const done = (challenges.data ?? []).filter((a) => a.completed_at).length;
  const adhErr = adherence.error ? apiErrorMessage(t, adherence.error) : null;
  const chErr = challenges.error ? apiErrorMessage(t, challenges.error) : null;

  return (
    <>
      <div className="statgrid">
        <StatCard
          label={t("v14coach.adherence14")}
          value={`${Math.round(adherence14(list))}%`}
          icon={<Icon.chart size={26} />}
        />
        <StatCard
          label="Challenges done"
          value={`${done}/${(challenges.data ?? []).length}`}
          icon={<Icon.plan size={26} />}
        />
      </div>

      {/* Habits adherence (checkin-dimension proxies — honest by design). */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("v14coach.habitAdherence")}</h3>
        {adherence.loading && <Loading />}
        {adhErr && <ErrorCard message={adhErr} onRetry={adherence.retry} />}
        {!adherence.loading && !adherence.error && (adherence.data ?? []).map((d) => {
          const pct = d.total > 0 ? Math.round((d.done / d.total) * 100) : 0;
          return (
            <div key={d.habit} style={{ margin: "8px 0" }}>
              <div className="rowflex">
                <span className="tiny" style={{ fontWeight: 700 }}>{d.habit.replace(/_/g, " ")}</span>
                <span className="spacer" />
                <span className="tiny muted">{d.done}/{d.total} · {pct}%</span>
              </div>
              <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                style={{ height: 8, borderRadius: 4, background: "var(--line)", marginTop: 4 }}>
                <div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: "var(--green)" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Last-14-days check-in map */}
      {!checkins.loading && list.length > 0 && (
        <div className="card">
          <div>
            {Array.from({ length: 14 }, (_, i) => {
              const d = new Date(Date.now() - (13 - i) * DAY_MS);
              const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              return (
                <span
                  key={k}
                  title={k}
                  style={{
                    display: "inline-block", width: 18, height: 18, borderRadius: 5, margin: 2,
                    background: days.has(k) ? "var(--green)" : "var(--line)",
                  }}
                />
              );
            })}
          </div>
          <p className="tiny muted">{t("v14coach.last14")}</p>
        </div>
      )}

      {/* Challenges progress */}
      <h3>{t("v14coach.challenges")}</h3>
      {challenges.loading && <Loading />}
      {chErr && <ErrorCard message={chErr} onRetry={challenges.retry} />}
      {!challenges.loading && !challenges.error && (challenges.data ?? []).length === 0 && (
        <p className="tiny muted">{t("v14coach.noChallenges")}</p>
      )}
      {(challenges.data ?? []).map((a) => (
        <div className="card" key={a.id}>
          <div className="rowflex">
            <div>
              <b className="tiny">{a.challenge?.title_en ?? a.challenge_id.slice(0, 8)}</b>
              <br />
              <span className="tiny muted">Started {a.started_at.slice(0, 10)}</span>
            </div>
            <span className="spacer" />
            <span className={`chip ${a.completed_at ? "grey" : "gold"}`}>
              {a.completed_at ? t("v14coach.doneOn", { d: a.completed_at.slice(0, 10) }) : t("v14coach.inProgress")}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------- recent activity ---------------- */

function ActivitySection({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const checkins = useAsync(() => coachP14Api.listCustomerCheckins(customerId), [customerId]);
  const notes = useAsync(() => coachApi.listCustomerNotes(customerId).then((r) => r.notes), [customerId]);
  const milestones = useAsync(() => coachB4Api.milestones(customerId).then((r) => r.milestones), [customerId]);
  const notesErr = notes.error ? apiErrorMessage(t, notes.error) : null;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("v14coach.recentActivity")}</h3>
      {checkins.loading && <Loading />}
      {(checkins.data ?? []).slice(0, 5).map((c) => (
        <p key={c.id} className="tiny" style={{ margin: "6px 0" }}>
          ✅ <b>{c.created_at.slice(0, 10)}</b> check-in
          {c.shedding_estimate != null && <span className="muted"> — shed {c.shedding_estimate}/100</span>}
          {c.note && <span className="muted"> — {c.note}</span>}
        </p>
      ))}
      {(notes.data ?? []).slice(0, 3).map((n) => (
        <p key={n.id} className="tiny" style={{ margin: "6px 0" }}>
          📝 <span className="muted">{n.created_at.slice(0, 10)}</span> — {n.note}
        </p>
      ))}
      {(milestones.data ?? []).slice(0, 5).map((m, i) => (
        <p key={`${m.kind}-${m.at}-${i}`} className="tiny" style={{ margin: "6px 0" }}>
          🌟 <span className="muted">{m.at.slice(0, 10)}</span> — {m.title}
        </p>
      ))}
      {(checkins.data ?? []).length === 0 && (notes.data ?? []).length === 0 && (milestones.data ?? []).length === 0 && !checkins.loading && (
        <p className="tiny muted">{t("v14coach.nothingYet")}</p>
      )}
      {notesErr && <p className="tiny muted">{notesErr}</p>}
    </div>
  );
}

/* ---------------- nudge action ---------------- */

function NudgeAction({ customerId, onSent }: { customerId: string; onSent: () => void }) {
  const { t } = useLang();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!msg.trim() || busy) return;
    setBusy(true);
    try {
      await coachP14Api.sendNudgeNow(customerId, msg.trim());
      setMsg("");
      toast(t("v14coach.nudgeSent"));
      onSent();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("v14coach.sendNudge")}</h3>
      <p className="tiny muted">{t("v14coach.nudgeSub")}</p>
      <label className="fl" htmlFor="nudge-msg">{t("v14coach.message")}</label>
      <textarea
        id="nudge-msg"
        rows={3}
        maxLength={500}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        placeholder={t("v14coach.nudgePh")}
      />
      <button className="btn btn-p btn-s" disabled={!msg.trim() || busy} onClick={send}>
        {t("v14coach.sendNow")}
      </button>
    </div>
  );
}

/* ---------------- follow-up actions + history ---------------- */

function FollowupsSection({ customerId }: { customerId: string }) {
  const { t } = useLang();
  const [date, setDate] = useState(() => toLocalInput(new Date(Date.now() + DAY_MS).toISOString()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const { data, error, loading, retry } = useAsync(
    () => coachP14Api.listCustomerFollowups(customerId).then((r) => r.followups),
    [customerId],
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const followups = data ?? [];
  const pending = followups.filter((f) => f.status === "pending");
  const history = followups.filter((f) => f.status !== "pending");

  async function schedule() {
    if (!date || busy) return;
    const iso = new Date(date).toISOString();
    if (Date.parse(iso) <= Date.now()) {
      toast(t("v14coach.fuFuture"));
      return;
    }
    setBusy(true);
    try {
      await coachP14Api.scheduleFollowup(customerId, { scheduled_for: iso, note: note.trim() });
      setNote("");
      toast(t("v14coach.fuScheduled"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function complete(f: CoachFollowup) {
    setCompleting(f.id);
    try {
      await coachP14Api.completeFollowup(f.id);
      toast(t("v14coach.fuCompleted"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setCompleting(null);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Follow-ups</h3>

      <label className="fl" htmlFor="fu-date">{t("v14coach.fuDate")}</label>
      <input id="fu-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="fl" htmlFor="fu-note">{t("v14coach.fuNote")}</label>
      <textarea
        id="fu-note"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Check evening routine consistency"
      />
      <button className="btn btn-p btn-s" disabled={!date || busy} onClick={schedule}>
        {t("v14coach.scheduleFu")}
      </button>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && pending.length > 0 && (
        <>
          <p className="tiny" style={{ fontWeight: 700, margin: "12px 0 4px" }}>{t("v14coach.upcoming")}</p>
          {pending.map((f) => (
            <div className="rowflex" key={f.id} style={{ margin: "6px 0" }}>
              <div>
                <b className="tiny">{f.scheduled_for.slice(0, 16).replace("T", " ")}</b>
                {f.note && (
                  <>
                    <br />
                    <span className="tiny muted">{f.note}</span>
                  </>
                )}
              </div>
              <span className="spacer" />
              <button
                className="btn btn-s btn-p"
                disabled={completing === f.id}
                onClick={() => void complete(f)}
              >
                {t("v14coach.markComplete")}
              </button>
            </div>
          ))}
        </>
      )}
      {!loading && !error && followups.length === 0 && (
        <p className="tiny muted" style={{ marginTop: 8 }}>{t("v14coach.noFollowups")}</p>
      )}
      {!loading && history.length > 0 && (
        <>
          <p className="tiny" style={{ fontWeight: 700, margin: "12px 0 4px" }}>{t("v14coach.history")}</p>
          {history.map((f) => (
            <p key={f.id} className="tiny" style={{ margin: "6px 0" }}>
              <span className={`chip ${f.status === "completed" ? "grey" : "red"}`}>{f.status}</span>{" "}
              {f.scheduled_for.slice(0, 10)}
              {f.note && <span className="muted"> — {f.note}</span>}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- page ---------------- */

export default function CoachCustomerDetail() {
  const { t } = useLang();
  const { id } = useParams<{ id: string }>();
  const [unassigning, setUnassigning] = useState(false);
  const { data, error, loading, retry } = useAsync(
    () => coachP14Api.listCustomers().then((r) => r.customers.find((c) => c.id === id) ?? null),
    [id],
  );

  const customer: AssignedCustomer | null = data ?? null;
  const name = customer?.name || customer?.phone || t("coachDash.customer");
  const pageErr = error ? apiErrorMessage(t, error) : null;

  async function unassign() {
    if (!id || unassigning) return;
    if (!window.confirm(`Remove ${name} from your customers?`)) return;
    setUnassigning(true);
    try {
      await coachP14Api.unassignCustomer(id);
      toast(t("v14coach.unassigned"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setUnassigning(false);
    }
  }

  return (
    <div className="screen">
      <Link to="/coach/customers" className="tiny">‹ My customers</Link>
      <h1 style={{ marginTop: 8 }}>{name}</h1>
      {customer?.phone && customer.name && <p className="muted tiny">{customer.phone}</p>}

      {loading && <Loading />}
      {pageErr && <ErrorCard message={pageErr} onRetry={retry} />}
      {!loading && !error && !customer && (
        <EmptyState icon={<Icon.user size={32} />} title={t("v14coach.notFound")} />
      )}

      {!loading && !error && customer && id && (
        <>
          <div className="rowflex" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
            <span className="chip grey">
              {t("coachDash.plan")}: {customer.plan_status ?? t("coachDash.noPlan")}
            </span>
            {customer.next_followup_at && (
              <span className="chip gold">
                {t("coachDash.followupDueOn")}: {customer.next_followup_at.slice(0, 10)}
              </span>
            )}
          </div>

          <ProgressSection customerId={id} />
          <ActivitySection customerId={id} />
          <NudgeAction customerId={id} onSent={() => undefined} />
          <FollowupsSection customerId={id} />

          <div className="card" style={{ marginTop: 16 }}>
            <button className="btn btn-g btn-s" disabled={unassigning} onClick={unassign}>
              {t("v14coach.unassign")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
