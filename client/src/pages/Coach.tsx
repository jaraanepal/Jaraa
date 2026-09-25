import { useEffect, useState } from "react";
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

const MAX_DRAFT = 500;
const DAY_MS = 86_400_000;

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

async function copyText(text: string, okMsg: string, failMsg: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast(failMsg);
  }
}

/**
 * Nudge library: coach-authored habit nudges grouped by category.
 * These are reusable templates, not customer data — one tap copies them,
 * and when a follow-up message is open they can be added to the draft.
 */
const LIB_CATS = [
  { key: "nutrition", titleKey: "coachDash.libCatNutrition", icon: <Icon.leaf size={16} /> },
  { key: "sleep", titleKey: "coachDash.libCatSleep", icon: <Icon.clock size={16} /> },
  { key: "haircare", titleKey: "coachDash.libCatHaircare", icon: <Icon.user size={16} /> },
] as const;

function NudgeLibrary({ onUse }: { onUse?: (text: string) => void }) {
  const { t, lang } = useLang();
  const dict = lang === "ne" ? neDict : enDict;
  const lib = (dict as unknown as { coachDash: { library: Record<string, string[]> } }).coachDash.library;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("coachDash.libTitle")}</h3>
      <p className="tiny muted">{t("coachDash.libSub")}</p>
      {LIB_CATS.map((c) => {
        const items: string[] = lib[c.key] ?? [];
        return (
          <div key={c.key} style={{ marginTop: 10 }}>
            <p className="tiny" style={{ fontWeight: 700, margin: "8px 0 4px" }}>
              <span style={{ color: "var(--green)", verticalAlign: "-3px", marginRight: 6 }}>{c.icon}</span>
              {t(c.titleKey)}
            </p>
            {items.map((text, i) => (
              <div className="rowflex" key={i} style={{ margin: "6px 0" }}>
                <span className="tiny">{text}</span>
                <span className="spacer" />
                <button
                  className="btn btn-g btn-s"
                  onClick={() => void copyText(text, t("coachDash.copied"), t("coachDash.copyFailed"))}
                >
                  {t("coachDash.copyNudge")}
                </button>
                {onUse && (
                  <button className="btn btn-p btn-s" onClick={() => onUse(text)}>
                    {t("coachDash.addToMsg")}
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Follow-up composer: builds a habit-support message from the customer's
 * rule-based nudges plus the coach's nudge library and message templates.
 * No send endpoint exists in v1, so the message is copied to the clipboard
 * for the coach to send from their usual channel — the UI says exactly that.
 * Habit framing only, never medical advice.
 */
function FollowupComposer({
  customer,
  libAdd,
}: {
  customer: AssignedCustomer;
  libAdd?: { text: string; nonce: number } | null;
}) {
  const { t, lang } = useLang();
  const [draft, setDraft] = useState("");
  const { data, error, loading, retry } = useAsync(
    () => coachApi.getNudges(customer.id).then((r) => r.nudges),
    [customer.id],
  );

  const name = customer.name || customer.phone || t("coachDash.customer");

  // Text added from the nudge library (rendered above the customer list).
  useEffect(() => {
    if (libAdd && libAdd.nonce > 0) {
      setDraft((d) => (`${d ? `${d}\n` : ""}${libAdd.text}`).slice(0, MAX_DRAFT));
    }
  }, [libAdd]);

  const append = (text: string) => setDraft((d) => (`${d ? `${d}\n` : ""}${text}`).slice(0, MAX_DRAFT));

  async function copy() {
    const text = draft.trim();
    if (!text) return;
    await copyText(text, t("coachDash.copied"), t("coachDash.copyFailed"));
  }

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
          <button className="btn btn-g btn-s" onClick={() => append(nudgeText(n, lang))}>
            {t("coachDash.useNudge")}
          </button>
        </div>
      ))}

      <p className="tiny" style={{ fontWeight: 700, margin: "12px 0 4px" }}>{t("coachDash.templatesTitle")}</p>
      <div style={{ margin: "4px 0 8px" }}>
        <button className="chip" onClick={() => append(t("coachDash.tplGreeting", { name }))}>
          {t("coachDash.tplGreetingLabel")}
        </button>
        <button className="chip" onClick={() => append(t("coachDash.tplCheckin"))}>
          {t("coachDash.tplCheckinLabel")}
        </button>
        <button className="chip" onClick={() => append(t("coachDash.tplEncourage"))}>
          {t("coachDash.tplEncourageLabel")}
        </button>
      </div>

      <label className="fl" htmlFor="coach-draft">{t("coachDash.message")}</label>
      <textarea
        id="coach-draft"
        rows={4}
        maxLength={MAX_DRAFT}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("coachDash.composerPh")}
      />
      <p className="tiny muted" style={{ textAlign: "right", margin: "2px 0" }}>
        {t("coachDash.charCount", { n: draft.length, max: MAX_DRAFT })}
      </p>
      <div className="btn-row">
        <button className="btn btn-p" disabled={!draft.trim()} onClick={copy}>
          {t("coachDash.copy")}
        </button>
        <button className="btn btn-g" disabled={!draft} onClick={() => setDraft("")}>
          {t("coachDash.clear")}
        </button>
      </div>
      <p className="tiny muted">{t("coachDash.copyNote")}</p>
      <NoticeBox tone="notice" title="">
        <p className="tiny">{t("coach.disclaimer")}</p>
      </NoticeBox>
    </div>
  );
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / DAY_MS));
}

/** Coach landing: today's focus, customers, nudge library, follow-up composer. */
function CoachDashboard({ focusFollowups = false }: { focusFollowups?: boolean }) {
  const { t } = useLang();
  const [selected, setSelected] = useState<AssignedCustomer | null>(null);
  const [libAdd, setLibAdd] = useState<{ text: string; nonce: number } | null>(null);
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
  const due = customers
    .filter((c) => c.next_followup_at && c.next_followup_at.slice(0, 10) <= today)
    .sort((a, b) => (a.next_followup_at ?? "").localeCompare(b.next_followup_at ?? ""));
  // Attention queue: overdue follow-ups first, then customers with no
  // check-in in 7+ days. Computed only from fetched fields — no invention.
  const focus = [
    ...due,
    ...customers.filter((c) => {
      if (due.includes(c)) return false;
      const d = daysSince(c.last_checkin_at);
      return d === null || d >= 7;
    }),
  ];
  const errMsg = error ? apiErrorMessage(t, error) : null;

  const customerName = (c: AssignedCustomer) => c.name || c.phone || t("coachDash.customer");

  const selectForCompose = (c: AssignedCustomer) => {
    setSelected(c);
    document.getElementById("coach-draft")?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

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
            <StatCard label={t("coachDash.attention")} value={String(focus.length)} icon={<Icon.alert size={26} />} />
          </div>

          <h3>{t("coachDash.focusTitle")}</h3>
          {focus.length === 0 && (
            <EmptyState icon={<Icon.check size={32} />} title={t("coachDash.focusNone")} />
          )}
          {focus.slice(0, 5).map((c) => {
            const overdue = due.includes(c);
            const d = daysSince(c.last_checkin_at);
            return (
              <div className="card" key={c.id}>
                <div className="rowflex">
                  <span style={{ color: overdue ? "var(--bad)" : "var(--gold)" }}>
                    <Icon.clock size={20} />
                  </span>
                  <div>
                    <b>{customerName(c)}</b>
                    <br />
                    <span className="tiny muted">
                      {overdue
                        ? `${t("coachDash.overdue")}: ${(c.next_followup_at ?? "").slice(0, 10)}`
                        : d === null
                          ? t("coachDash.neverCheckedIn")
                          : t("coachDash.daysSinceCheckin", { n: d })}
                    </span>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn-s btn-p" onClick={() => selectForCompose(c)}>
                    {t("coachDash.compose")}
                  </button>
                </div>
              </div>
            );
          })}

          {!focusFollowups && (
            <>
              <h3>{t("coachDash.libSection")}</h3>
              <NudgeLibrary
                onUse={
                  selected ? (text) => setLibAdd((p) => ({ text, nonce: (p?.nonce ?? 0) + 1 })) : undefined
                }
              />

              <h3>{t("coachDash.customers")}</h3>
              {customers.length === 0 && (
                <EmptyState icon={<Icon.user size={32} />} title={t("coachDash.empty")} />
              )}
              {customers.map((c) => {
                const isOpen = selected?.id === c.id;
                const d = daysSince(c.last_checkin_at);
                const overdue = c.next_followup_at != null && c.next_followup_at.slice(0, 10) <= today;
                return (
                  <div className="card" key={c.id}>
                    <button
                      type="button"
                      className="dashlink"
                      style={{ width: "100%", textAlign: "left", cursor: "pointer", margin: 0, border: "none", background: "none", padding: 0 }}
                      onClick={() => setSelected(isOpen ? null : c)}
                      aria-expanded={isOpen}
                    >
                      <Icon.user size={20} />
                      <span>
                        {customerName(c)}
                        <br />
                        <span className="tiny muted">
                          {c.plan_status ? `${t("coachDash.plan")}: ${c.plan_status}` : t("coachDash.noPlan")}
                        </span>
                      </span>
                      <span className="spacer">›</span>
                    </button>
                    <div className="rowflex" style={{ marginTop: 8, flexWrap: "wrap" }}>
                      <span className="chip grey">
                        {t("coachDash.lastCheckin")}: {d === null ? t("coachDash.never") : `${t("coachDash.daysAgo", { n: d })}`}
                      </span>
                      {c.next_followup_at && (
                        <span className={`chip ${overdue ? "red" : "gold"}`}>
                          {t("coachDash.followupDueOn")}: {c.next_followup_at.slice(0, 10)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {selected && <FollowupComposer customer={selected} libAdd={libAdd} />}
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
                      <b>{customerName(c)}</b>
                      <br />
                      <span className="tiny muted">
                        {t("coachDash.followupDueOn")}: {(c.next_followup_at ?? "").slice(0, 10)}
                      </span>
                    </div>
                    <span className="spacer" />
                    <button className="btn btn-s" onClick={() => selectForCompose(c)}>
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
