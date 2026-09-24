import { useState } from "react";
import { coachApi } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLang } from "../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, NoticeBox, StatCard, apiErrorMessage, toast } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";
import enDict from "../i18n/en.json";
import neDict from "../i18n/ne.json";
import type { AssignedCustomer, Nudge } from "../api/types";

interface Card { title: string; body: string }

/** Existing customer-facing habit-coach content (unchanged v3 behavior). */
function CustomerCoachView() {
  const { t, lang } = useLang();
  const dict = lang === "ne" ? neDict : enDict;
  const cards = (dict as unknown as { coach: { cards: Card[]; nudges: string[] } }).coach.cards;
  const nudges = (dict as unknown as { coach: { cards: Card[]; nudges: string[] } }).coach.nudges;

  return (
    <div className="screen">
      <h1>{t("coach.title")}</h1>
      <p className="muted">{t("coach.sub")}</p>

      <NoticeBox tone="notice" title="">
        <p className="tiny">{t("coach.disclaimer")}</p>
      </NoticeBox>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("coach.nudgesTitle")}</h3>
        {nudges.map((n, i) => (
          <p key={i} className="tiny" style={{ margin: "8px 0" }}>
            <span style={{ color: "var(--green)", verticalAlign: "-3px", marginRight: 6 }}>
              <Icon.leaf size={14} />
            </span>
            {n}
          </p>
        ))}
      </div>

      <h3>{t("coach.educationTitle")}</h3>
      {cards.map((c, i) => (
        <div className="card" key={i}>
          <b>{c.title}</b>
          <p className="muted tiny">{c.body}</p>
        </div>
      ))}
    </div>
  );
}

function nudgeText(n: Nudge, lang: "ne" | "en"): string {
  return lang === "ne" ? n.title_ne : n.title_en;
}

/**
 * Follow-up composer: builds a habit-support message from the customer's
 * rule-based nudges. No send endpoint exists in v1, so the message is
 * copied to the clipboard for the coach to send from their usual channel —
 * the UI says exactly that. Habit framing only, never medical advice.
 */
function FollowupComposer({ customer }: { customer: AssignedCustomer }) {
  const { t, lang } = useLang();
  const [draft, setDraft] = useState("");
  const { data, error, loading, retry } = useAsync(
    () => coachApi.getNudges(customer.id).then((r) => r.nudges),
    [customer.id],
  );

  async function copy() {
    const text = draft.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(t("coachDash.copied"));
    } catch {
      // Clipboard unavailable (older webview): select-and-copy fallback.
      const ta = document.getElementById("coach-draft") as HTMLTextAreaElement | null;
      ta?.select();
      try {
        document.execCommand("copy");
        toast(t("coachDash.copied"));
      } catch {
        toast(t("coachDash.copyFailed"));
      }
    }
  }

  const name = customer.name || customer.phone || t("coachDash.customer");
  const errMsg = error ? apiErrorMessage(t, error) : null;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("coachDash.composer")}</h3>
      <p className="tiny muted">{t("coachDash.composerFor", { name })}</p>
      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <p className="muted tiny">{t("coachDash.noNudges")}</p>
      )}
      {(data ?? []).map((n) => (
        <div className="rowflex" key={n.id} style={{ margin: "6px 0" }}>
          <span className="tiny">{nudgeText(n, lang)}</span>
          <span className="spacer" />
          <button className="btn btn-g" onClick={() => setDraft((d) => (d ? `${d}\n` : "") + nudgeText(n, lang))}>
            {t("coachDash.useNudge")}
          </button>
        </div>
      ))}
      <label className="fl" htmlFor="coach-draft">{t("coachDash.message")}</label>
      <textarea
        id="coach-draft"
        rows={4}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("coachDash.composerPh")}
      />
      <div className="btn-row">
        <button className="btn btn-p" disabled={!draft.trim()} onClick={copy}>
          {t("coachDash.copy")}
        </button>
      </div>
      <p className="tiny muted">{t("coachDash.copyNote")}</p>
      <NoticeBox tone="notice" title="">
        <p className="tiny">{t("coach.disclaimer")}</p>
      </NoticeBox>
    </div>
  );
}

/** Coach landing: assigned customers + follow-up composer. */
function CoachDashboard({ focusFollowups = false }: { focusFollowups?: boolean }) {
  const { t } = useLang();
  const [selected, setSelected] = useState<AssignedCustomer | null>(null);
  const { data, error, loading, retry } = useAsync(() =>
    coachApi
      .listCustomers()
      .then((r) => r.customers)
      .catch((e) => {
        if ((e as { status?: number }).status === 404) return null; // server hasn't shipped it
        throw e;
      }),
  );

  const customers = data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const due = customers.filter((c) => c.next_followup_at && c.next_followup_at.slice(0, 10) <= today);
  const errMsg = error ? apiErrorMessage(t, error) : null;

  return (
    <div className="screen">
      <h1>{t("coachDash.title")}</h1>
      <p className="muted tiny">{t("coachDash.sub")}</p>

      <NoticeBox tone="notice" title="">
        <p className="tiny">{t("coach.disclaimer")}</p>
      </NoticeBox>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}
      {data === null && !loading && (
        <EmptyState icon={<Icon.user size={32} />} title={t("coachDash.unavailable")} />
      )}

      {data !== null && !loading && (
        <>
          <div className="statgrid">
            <StatCard label={t("coachDash.customers")} value={String(customers.length)} icon={<Icon.user size={26} />} />
            <StatCard label={t("coachDash.followupsDue")} value={String(due.length)} icon={<Icon.clock size={26} />} />
          </div>

          {!focusFollowups && (
            <>
              <h3>{t("coachDash.customers")}</h3>
              {customers.length === 0 && (
                <EmptyState icon={<Icon.user size={32} />} title={t("coachDash.empty")} />
              )}
              {customers.map((c) => (
                <button
                  key={c.id}
                  className="dashlink"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                  onClick={() => setSelected(selected?.id === c.id ? null : c)}
                  aria-expanded={selected?.id === c.id}
                >
                  <Icon.user size={20} />
                  <span>
                    {c.name || c.phone || t("coachDash.customer")}
                    <br />
                    <span className="tiny muted">
                      {c.plan_status ? `${t("coachDash.plan")}: ${c.plan_status}` : ""}
                      {c.last_checkin_at ? ` · ${t("coachDash.lastCheckin")}: ${c.last_checkin_at.slice(0, 10)}` : ""}
                    </span>
                  </span>
                  <span className="spacer">›</span>
                </button>
              ))}
              {selected && <FollowupComposer customer={selected} />}
            </>
          )}

          {(focusFollowups || customers.length > 0) && (
            <>
              <h3>{t("coachDash.followups")}</h3>
              {due.length === 0 && (
                <EmptyState icon={<Icon.clock size={32} />} title={t("coachDash.noDue")} />
              )}
              {due.map((c) => (
                <div className="card" key={c.id}>
                  <div className="rowflex">
                    <Icon.clock size={20} />
                    <div>
                      <b>{c.name || c.phone || t("coachDash.customer")}</b>
                      <br />
                      <span className="tiny muted">
                        {t("coachDash.followupDueOn")}: {(c.next_followup_at ?? "").slice(0, 10)}
                      </span>
                    </div>
                    <span className="spacer" />
                    <button className="btn btn-s" onClick={() => setSelected(c)}>
                      {t("coachDash.compose")}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * /coach is shared: coaches get the dashboard, customers keep the
 * v3 habit-coach content (the guard allows both roles on this path).
 */
export default function Coach() {
  const { role } = useAuth();
  if (role === "coach") return <CoachDashboard />;
  return <CustomerCoachView />;
}

/** /coach/followups — coach-only follow-up view. */
export function CoachFollowups() {
  const { role } = useAuth();
  if (role !== "coach") return <CustomerCoachView />;
  return <CoachDashboard focusFollowups />;
}
