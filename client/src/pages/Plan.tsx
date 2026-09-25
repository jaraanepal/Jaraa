import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { meApi, shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, NoticeBox, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import { ReviewRequestPanel, RoutinesTab } from "../components/b3customer";
import { RemindersPanel, UsageLogPanel } from "../components/b4customer";
import type { Kit, Plan as PlanT, PlanItemKind } from "../api/types";

const KIND_ICON: Record<PlanItemKind, "check" | "box" | "video" | "doc"> = {
  habit: "check",
  product: "box",
  consult: "video",
  referral: "doc",
};

export default function Plan() {
  const { t, lang } = useLang();
  const [plan, setPlan] = useState<PlanT | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // P-8: prescribed kits resolved to full kit details.
  const [prescribedKits, setPrescribedKits] = useState<Kit[]>([]);
  // U1: rescan due date drives the reminder card at the top.
  const [rescanDue, setRescanDue] = useState<string | null>(null);
  // U12: past approved plan versions.
  const [history, setHistory] = useState<PlanT[]>([]);
  const [histId, setHistId] = useState<string>("");
  // Batch-3 (009): plan vs routine-library tab.
  const [b3Tab, setB3Tab] = useState<"plan" | "routines">("plan");

  useEffect(() => {
    // U1: next_rescan_due_on lives on the progress bundle.
    meApi.getProgress().then(
      (p) => setRescanDue(p.next_rescan_due_on ?? null),
      () => setRescanDue(null),
    );
    meApi.planHistory().then((r) => setHistory(r.plans)).catch(() => setHistory([]));
    meApi
      .getPlan()
      .then((p) => {
        setPlan(p);
        setLoading(false);
        // Resolve prescribed kit IDs to kit details (images, price).
        const kitIds = [...new Set(
          (p?.items ?? []).map((i) => i.kit_id).filter((x): x is string => !!x)
        )];
        if (kitIds.length) {
          Promise.allSettled(kitIds.map((id) => shopApi.getKit(id))).then((results) => {
            setPrescribedKits(
              results
                .filter((r): r is PromiseFulfilledResult<Kit> => r.status === "fulfilled")
                .map((r) => r.value)
            );
          });
        }
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  }, [t]);

  if (loading) return <Loading />;

  const empty = !plan || plan.status !== "approved";
  const shownPlan = histId ? history.find((h) => h.id === histId) ?? plan : plan;

  // U1: rescan reminder — overdue (past due date, red) or due within 7 days (amber).
  let rescanState: "overdue" | "due" | null = null;
  let rescanDays = 0;
  if (rescanDue) {
    const due = new Date(rescanDue.slice(0, 10));
    const today = new Date(new Date().toISOString().slice(0, 10));
    rescanDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (rescanDays < 0) rescanState = "overdue";
    else if (rescanDays <= 7) rescanState = "due";
  }

  return (
    <div className="screen">
      <h1>{t("plan.title")}</h1>
      {error && <ErrorCard message={error} />}

      {/* U1: rescan reminder card */}
      {rescanState && (
        <div
          className="card"
          style={{
            border: `2px solid ${rescanState === "overdue" ? "var(--bad)" : "var(--gold)"}`,
            borderRadius: 12,
          }}
        >
          <div className="rowflex">
            <span style={{ color: rescanState === "overdue" ? "var(--bad)" : "var(--gold)" }}>
              <Icon.clock size={24} />
            </span>
            <div>
              <b>{rescanState === "overdue" ? t("p12.customer.rescanOverdue") : t("p12.customer.rescanDue")}</b>
              <br />
              <span className="tiny muted">{rescanDue?.slice(0, 10)}</span>
            </div>
            <span className="spacer" />
            <Link className="btn btn-p btn-s" to="/scan" style={{ textDecoration: "none" }}>
              {t("p12.customer.rescanCta")}
            </Link>
          </div>
        </div>
      )}

      {/* U12: plan version history */}
      {history.length > 1 && (
        <div className="rowflex" style={{ margin: "8px 0" }}>
          <label className="tiny muted" htmlFor="planver">{t("p12b.customer.planVersion")}</label>
          <select id="planver" value={histId} onChange={(e) => setHistId(e.target.value)}>
            <option value="">{t("p12b.customer.currentPlan")}</option>
            {history.map((h) => (
              <option key={h.id} value={h.id}>{h.created_at.slice(0, 10)}</option>
            ))}
          </select>
        </div>
      )}

      {/* U22/U29: plan ↔ routine-library tabs */}
      <div className="btn-row" role="tablist" aria-label={t("plan.title")}>
        <button
          role="tab" aria-selected={b3Tab === "plan"}
          className={`btn btn-s ${b3Tab === "plan" ? "btn-p" : "btn-g"}`}
          onClick={() => setB3Tab("plan")}
        >
          {t("plan.title")}
        </button>
        <button
          role="tab" aria-selected={b3Tab === "routines"}
          className={`btn btn-s ${b3Tab === "routines" ? "btn-p" : "btn-g"}`}
          onClick={() => setB3Tab("routines")}
        >
          {t("p12c.customer.u29_routines.title")}
        </button>
      </div>

      {b3Tab === "routines" ? (
        <RoutinesTab />
      ) : (
        <>

      {empty && !error && (
        <div className="card center">
          <h3>{t("plan.emptyTitle")}</h3>
          <p className="muted">{t("plan.emptyBody")}</p>
        </div>
      )}

      {!empty && shownPlan && (
        <>
          {shownPlan.review_notes && (
            <NoticeBox tone="ok" title={t("plan.reviewNotes")}>
              <p>{shownPlan.review_notes}</p>
            </NoticeBox>
          )}

          {(["habit", "product", "consult", "referral"] as PlanItemKind[]).map((kind) => {
            const items = shownPlan.items.filter((i) => i.kind === kind);
            if (!items.length) return null;
            return (
              <div className="card" key={kind}>
                <h3 style={{ marginTop: 0 }}>{t(`plan.itemKinds.${kind}`)}</h3>
                {items
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((item) => (
                    <div className="rowflex" key={item.id} style={{ margin: "10px 0", alignItems: "flex-start" }}>
                      <span style={{ color: "var(--green)" }}>{Icon[KIND_ICON[kind]]({ size: 22 })}</span>
                      <div>
                        <b>{lang === "ne" ? item.title_ne : item.title_en}</b>
                        {item.detail && <><br /><span className="tiny muted">{item.detail}</span></>}
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}

          {shownPlan.rescan_due_on && (
            <p className="tiny muted">
              {t("plan.rescanDue")} {shownPlan.rescan_due_on.slice(0, 10)}
            </p>
          )}

          {/* P-8: kits prescribed by the doctor — order through the normal shop checkout */}
          {prescribedKits.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t("plan.prescribedTitle")}</h3>
              <p className="tiny muted">{t("plan.prescribedSub")}</p>
              {prescribedKits.map((kit) => (
                <div key={kit.id} className="rowflex" style={{ margin: "12px 0", alignItems: "center", gap: 12 }}>
                  {kit.images?.[0] ? (
                    <img
                      src={kit.images[0]}
                      alt={kit.name}
                      style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ color: "var(--green)" }}><Icon.box size={40} /></span>
                  )}
                  <div style={{ flex: 1 }}>
                    <b>{kit.name}</b>
                    <br />
                    <span className="tiny muted">NPR {kit.total_npr}</span>
                  </div>
                  <Link
                    className="btn btn-p"
                    to={`/kits/${kit.id}`}
                    style={{ textDecoration: "none", padding: "8px 16px", fontSize: 13 }}
                  >
                    {t("plan.orderKit")}
                  </Link>
                </div>
              ))}
            </div>
          )}

          <Link className="btn btn-p" to="/kits" style={{ textDecoration: "none", textAlign: "center" }}>
            {t("plan.kitCta")}
          </Link>

          {/* U22: appointment-free follow-up review request */}
          <ReviewRequestPanel />
        </>
      )}

      {/* U40: kit reminders + U42: product usage log (batch 4) — plan-independent */}
      <RemindersPanel />
      <UsageLogPanel />
        </>
      )}
    </div>
  );
}
