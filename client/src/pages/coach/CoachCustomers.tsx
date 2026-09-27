/**
 * Problem 4 (v14): assigned-customers list page for the coach.
 * Route: /coach/customers (wired by the parent). Rows link to
 * /coach/customers/:id (the per-customer progress view).
 *
 * Labels: reuses existing coachDash.* keys; genuinely new labels are plain
 * English literals (listed in the v14 report for EN/NE translation).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { coachP14Api } from "./coachP14";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import { AvailabilityToggle } from "./CoachBatch3";
import type { AssignedCustomer } from "../../api/types";

const DAY_MS = 86_400_000;

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / DAY_MS));
}

type Filter = "all" | "due" | "quiet";

const FILTERS: Filter[] = ["all", "due", "quiet"];

function filterLabel(t: (key: string) => string, f: Filter): string {
  return f === "all" ? t("v14coach.filterAll") : f === "due" ? t("v14coach.filterDue") : t("v14coach.filterQuiet");
}

export default function CoachCustomers() {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [assignId, setAssignId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const { data, error, loading, retry } = useAsync(
    () => coachP14Api.listCustomers(submittedQ || undefined).then((r) => r.customers),
    [submittedQ],
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;
  const customers = useMemo(() => data ?? [], [data]);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => {
    if (filter === "all") return customers;
    if (filter === "due") {
      return customers.filter((c) => c.next_followup_at && c.next_followup_at.slice(0, 10) <= today);
    }
    return customers.filter((c) => {
      const d = daysSince(c.last_checkin_at);
      return d === null || d >= 7;
    });
  }, [customers, filter, today]);

  async function assign() {
    const id = assignId.trim();
    if (!id || assigning) return;
    setAssigning(true);
    try {
      await coachP14Api.assignCustomer(id);
      setAssignId("");
      toast(t("v14coach.assigned"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setAssigning(false);
    }
  }

  const customerName = (c: AssignedCustomer) => c.name || c.phone || t("coachDash.customer");

  return (
    <div className="screen">
      <h1>{t("v14coach.myCustomers")}</h1>
      <p className="muted tiny">{t("v14coach.myCustomersSub")}</p>

      <AvailabilityToggle />

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}

      {!loading && !error && (
        <>
          <div className="statgrid">
            <StatCard label={t("coachDash.customers")} value={String(customers.length)} icon={<Icon.user size={26} />} />
            <StatCard
              label={t("v14coach.statDue")}
              value={String(customers.filter((c) => c.next_followup_at && c.next_followup_at.slice(0, 10) <= today).length)}
              icon={<Icon.clock size={26} />}
            />
            <StatCard
              label={t("v14coach.statAttention")}
              value={String(customers.filter((c) => { const d = daysSince(c.last_checkin_at); return d === null || d >= 7; }).length)}
              icon={<Icon.alert size={26} />}
            />
          </div>

          <form
            className="rowflex"
            style={{ gap: 8, margin: "12px 0" }}
            onSubmit={(e) => { e.preventDefault(); setSubmittedQ(q); }}
          >
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("v14coach.searchPh")}
              aria-label="Search customers"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-g btn-s">{t("v14coach.search")}</button>
          </form>

          <div className="tabrow" role="tablist" aria-label="Customer filters">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`tab${filter === f ? " on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {filterLabel(t, f)}
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <EmptyState icon={<Icon.user size={32} />} title={t("coachDash.empty")} />
          )}
          {filtered.map((c) => {
            const d = daysSince(c.last_checkin_at);
            const overdue = c.next_followup_at != null && c.next_followup_at.slice(0, 10) <= today;
            return (
              <div className="card" key={c.id}>
                <Link
                  to={`/coach/customers/${c.id}`}
                  className="dashlink"
                  style={{ width: "100%", textAlign: "left", cursor: "pointer", margin: 0 }}
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
                </Link>
                <div className="rowflex" style={{ marginTop: 8, flexWrap: "wrap" }}>
                  <span className="chip grey">
                    {t("coachDash.lastCheckin")}: {d === null ? t("coachDash.never") : t("coachDash.daysAgo", { n: d })}
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

          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>{t("v14coach.assignTitle")}</h3>
            <p className="tiny muted">{t("v14coach.assignSub")}</p>
            <div className="rowflex" style={{ gap: 8 }}>
              <input
                type="text"
                value={assignId}
                onChange={(e) => setAssignId(e.target.value)}
                placeholder={t("v14coach.assignPh")}
                aria-label={t("v14coach.assignPh")}
                style={{ flex: 1 }}
              />
              <button className="btn btn-p btn-s" disabled={!assignId.trim() || assigning} onClick={assign}>
                {t("v14coach.assign")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
