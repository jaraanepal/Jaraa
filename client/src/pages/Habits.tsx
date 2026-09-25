import { useState } from "react";
import { meApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";

/** Day (local date string YYYY-MM-DD) a check-in was created on. */
function checkinDay(iso: string): string {
  const d = new Date(Date.parse(iso));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * U2 — "Today's habits": lists the customer's plan items of kind
 * "habit" with checkboxes; "Save check-in" posts one daily check-in
 * whose note joins the checked habit titles. Honest empty states:
 * no plan or no habit items => p12.customer.noHabits, never invented.
 */
export default function Habits() {
  const { t, lang } = useLang();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const { data, error, loading, retry } = useAsync(
    () =>
      Promise.all([meApi.getPlan(), meApi.listCheckins()]).then(([plan, c]) => ({
        plan,
        checkins: c.checkins,
      })),
    [],
  );

  async function saveCheckin(habitTitles: string[], planId?: string) {
    setSaving(true);
    try {
      await meApi.createCheckin({
        ...(planId ? { plan_id: planId } : {}),
        note: habitTitles.join("; "),
      });
      setChecked({});
      toast(t("p12.customer.checkinSaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  const errMsg = error ? apiErrorMessage(t, error) : null;
  if (errMsg) {
    return (
      <div className="screen">
        <ErrorCard message={errMsg} onRetry={retry} />
      </div>
    );
  }

  const plan = data?.plan ?? null;
  const habits = (plan?.items ?? []).filter((i) => i.kind === "habit").sort((a, b) => a.sort_order - b.sort_order);
  const today = checkinDay(new Date().toISOString());
  const doneToday = (data?.checkins ?? []).some((c) => checkinDay(c.created_at) === today);

  if (!plan || plan.status !== "approved" || habits.length === 0) {
    return (
      <div className="screen">
        <h1>{t("p12.customer.habitCheckin")}</h1>
        <EmptyState icon={<Icon.plan size={32} />} title={t("p12.customer.noHabits")} />
      </div>
    );
  }

  const title = (i: (typeof habits)[number]) => (lang === "ne" ? i.title_ne : i.title_en);
  const checkedIds = habits.filter((h) => checked[h.id]).map((h) => h.id);

  return (
    <div className="screen">
      <h1>{t("p12.customer.habitCheckin")}</h1>
      <p className="muted tiny">
        {doneToday ? t("p12.customer.checkinDone") : new Date().toISOString().slice(0, 10)}
      </p>

      {doneToday && (
        <div className="card" style={{ border: "2px solid var(--green)", borderRadius: 12 }}>
          <div className="rowflex">
            <span style={{ color: "var(--green)" }}><Icon.check size={22} /></span>
            <b>{t("p12.customer.checkinDone")}</b>
          </div>
        </div>
      )}

      <div className="card">
        {habits.map((h) => (
          <label key={h.id} className="rowflex" style={{ margin: "12px 0", alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!checked[h.id]}
              onChange={(e) => setChecked((p) => ({ ...p, [h.id]: e.target.checked }))}
              style={{ width: 24, height: 24, minHeight: 24, marginTop: 2, flex: "none" }}
            />
            <span>
              <b style={checked[h.id] ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                {title(h)}
              </b>
              {h.detail && (
                <>
                  <br />
                  <span className="tiny muted">{h.detail}</span>
                </>
              )}
            </span>
          </label>
        ))}
      </div>

      <button
        className="btn btn-p"
        disabled={saving || checkedIds.length === 0}
        onClick={() => saveCheckin(checkedIds.map((id) => title(habits.find((h) => h.id === id)!)), plan.id)}
      >
        {saving ? t("p12.common.loading") : t("p12.customer.checkinSaved")}
      </button>
    </div>
  );
}
