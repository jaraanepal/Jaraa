import { useState } from "react";
import { Link } from "react-router-dom";
import { doctorApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { Case } from "../../api/types";

type Tab = "queued" | "in_review";

/**
 * P-18: admin "Submitted reviews" inbox. Root Scan submissions create cases
 * with status=queued; this page lists queued + in_review cases so an admin
 * can see every submission without a doctor login. Rows link into the case
 * view (guard rule allows admins on /doctor/case).
 */
export default function AdminCases() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("queued");
  const cases = useAsync(() => doctorApi.listCases(tab, 50).then((r) => r.cases), [tab]);
  const rows: Case[] = cases.data ?? [];
  const errMsg = cases.error ? apiErrorMessage(t, cases.error) : null;

  return (
    <div className="screen">
      <h1>{t("adminCases.title")}</h1>
      <p className="muted tiny">{t("adminCases.sub")}</p>

      <div className="btn-row" role="tablist">
        {(["queued", "in_review"] as Tab[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            className={tab === s ? "btn btn-s" : "btn"}
            onClick={() => setTab(s)}
          >
            {t(`adminCases.${s === "queued" ? "queued" : "inReview"}`)}
          </button>
        ))}
      </div>

      {cases.loading && <Loading />}
      {errMsg && <ErrorCard message={errMsg} onRetry={cases.retry} />}
      {!cases.loading && !errMsg && rows.length === 0 && (
        <EmptyState icon={<Icon.doc size={32} />} title={t("adminCases.empty")} />
      )}
      {!cases.loading &&
        !errMsg &&
        rows.map((c) => (
          <Link className="dashlink" to={`/doctor/case/${c.id}`} key={c.id}>
            <Icon.doc size={20} />
            <div>
              <b>
                {t("adminCases.case")} {c.id.slice(0, 8)}
              </b>
              <br />
              <span className="tiny muted">
                {t("adminCases.patient")}: {c.user_id ? c.user_id.slice(0, 8) : "—"}
                {" · "}
                {t("adminCases.priority")}: {c.priority}
                {" · "}
                {c.created_at.slice(0, 10)}
                {c.sla_due_at && ` · ${t("adminCases.slaDue")}: ${c.sla_due_at.slice(0, 16).replace("T", " ")}`}
              </span>
            </div>
            <span className="spacer">›</span>
          </Link>
        ))}
    </div>
  );
}
