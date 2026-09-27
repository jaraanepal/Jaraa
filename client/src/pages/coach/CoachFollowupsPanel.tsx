/**
 * Problem 4 (v14): overall follow-ups manager for the coach.
 * Mounted in the /coach/followups view (see Coach.tsx). Upcoming +
 * completed across all assigned customers, with per-row "mark complete".
 * Status filter tabs: pending / completed / cancelled.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { coachP14Api, type CoachFollowupRow } from "./coachP14";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

type StatusFilter = "pending" | "completed" | "cancelled";

const TABS: StatusFilter[] = ["pending", "completed", "cancelled"];

function FollowupRow({ f, onDone }: { f: CoachFollowupRow; onDone: () => void }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);

  async function complete() {
    setBusy(true);
    try {
      await coachP14Api.completeFollowup(f.id);
      toast("Follow-up completed");
      onDone();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const overdue = f.status === "pending" && Date.parse(f.scheduled_for) <= Date.now();
  return (
    <div className="card" key={f.id}>
      <div className="rowflex">
        <span style={{ color: overdue ? "var(--bad)" : "var(--green)" }}>
          <Icon.clock size={20} />
        </span>
        <div style={{ flex: 1 }}>
          <b>
            <Link to={`/coach/customers/${f.customer_id}`} className="tiny" style={{ fontSize: 15 }}>
              {f.customer_name ?? f.customer_id.slice(0, 8)}
            </Link>
          </b>
          <br />
          <span className="tiny muted">
            {f.scheduled_for.slice(0, 16).replace("T", " ")}
            {overdue ? ` · ${t("v14coach.overdue")}` : null}
            {f.note && ` — ${f.note}`}
          </span>
        </div>
        {f.status === "pending" && (
          <button className="btn btn-s btn-p" disabled={busy} onClick={complete}>
            Mark complete
          </button>
        )}
      </div>
    </div>
  );
}

export function CoachFollowupsPanel() {
  const { t } = useLang();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const { data, error, loading, retry } = useAsync(
    () => coachP14Api.listFollowups(status).then((r) => r.followups),
    [status],
  );
  const errMsg = error ? apiErrorMessage(t, error) : null;

  return (
    <div style={{ marginTop: 16 }}>
      <h2>Follow-ups</h2>
      <p className="tiny muted">{t("v14coach.panelSub")}</p>

      <div className="tabrow" role="tablist" aria-label="Follow-up status">
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            className={`tab${status === s ? " on" : ""}`}
            onClick={() => setStatus(s)}
          >
            {s === "pending" ? t("v14coach.upcoming") : s === "completed" ? t("v14coach.completed") : t("v14coach.cancelled")}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={retry} />}
      {!loading && !error && (data ?? []).length === 0 && (
        <EmptyState icon={<Icon.clock size={32} />} title={t("v14coach.noFu")} />
      )}
      {(data ?? []).map((f) => (
        <FollowupRow key={f.id} f={f} onDone={retry} />
      ))}
    </div>
  );
}
