import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { meApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { ErrorCard, Loading, NoticeBox, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import type { Plan as PlanT, PlanItemKind } from "../api/types";

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

  useEffect(() => {
    meApi
      .getPlan()
      .then((p) => {
        setPlan(p);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  }, [t]);

  if (loading) return <Loading />;

  const empty = !plan || plan.status !== "approved";

  return (
    <div className="screen">
      <h1>{t("plan.title")}</h1>
      {error && <ErrorCard message={error} />}

      {empty && !error && (
        <div className="card center">
          <h3>{t("plan.emptyTitle")}</h3>
          <p className="muted">{t("plan.emptyBody")}</p>
        </div>
      )}

      {!empty && plan && (
        <>
          {plan.review_notes && (
            <NoticeBox tone="ok" title={t("plan.reviewNotes")}>
              <p>{plan.review_notes}</p>
            </NoticeBox>
          )}

          {(["habit", "product", "consult", "referral"] as PlanItemKind[]).map((kind) => {
            const items = plan.items.filter((i) => i.kind === kind);
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

          {plan.rescan_due_on && (
            <p className="tiny muted">
              {t("plan.rescanDue")} {plan.rescan_due_on.slice(0, 10)}
            </p>
          )}

          <Link className="btn btn-p" to="/kits" style={{ textDecoration: "none", textAlign: "center" }}>
            {t("plan.kitCta")}
          </Link>
        </>
      )}
    </div>
  );
}
