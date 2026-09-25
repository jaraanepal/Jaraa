import { useState } from "react";
import { Link } from "react-router-dom";
import { doctorB3Api, type B3FollowUp } from "../../api/b3doctor";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage } from "../../components/ui";
import { Icon } from "../../components/icons";

function monthBounds(d: Date): { from: string; to: string } {
  const f = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return {
    from: f(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: f(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

/**
 * D23 — "Follow-up calendar": From/To date inputs (defaulting to the current
 * month) above a chronological list. Each row shows the case link, due date,
 * note, and done state.
 */
export function DoctorFollowupCalendar() {
  const { t } = useLang();
  const initial = monthBounds(new Date());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [list, setList] = useState<B3FollowUp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(f: string, tt: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await doctorB3Api.listFollowUpsRange(f, tt);
      setList(r.follow_ups);
      setApplied({ from: r.from, to: r.to });
    } catch (e) {
      setError(apiErrorMessage(t, e));
      setList(null);
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (from && to) load(from, to);
  }

  const inputStyle: React.CSSProperties = { width: "auto", minHeight: 40 };

  return (
    <div>
      <p className="muted tiny">{t("p12c.doctor.calSub")}</p>
      <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 6, margin: "8px 0" }}>
        <label className="tiny muted">
          {t("p12c.doctor.calFrom")}{" "}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={inputStyle}
            aria-label={t("p12c.doctor.calFrom")}
          />
        </label>
        <label className="tiny muted">
          {t("p12c.doctor.calTo")}{" "}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={inputStyle}
            aria-label={t("p12c.doctor.calTo")}
          />
        </label>
        <button className="btn btn-p btn-s" style={{ width: "auto", margin: 0 }} onClick={apply} disabled={loading}>
          {t("p12.common.view")}
        </button>
      </div>
      {error && <ErrorCard message={error} />}
      {loading && <Loading />}
      {!loading && !error && list !== null && list.length === 0 && (
        <EmptyState icon={<Icon.clock size={32} />} title={t("p12c.doctor.calEmpty")} />
      )}
      {!loading && list !== null && list.length > 0 && (
        <p className="tiny muted">
          {applied.from} → {applied.to} · {list.length}
        </p>
      )}
      {(list ?? []).map((f) => (
        <div className="card" key={f.id} style={{ padding: "8px 12px" }}>
          <div className="rowflex" style={{ flexWrap: "wrap", rowGap: 4 }}>
            <b className="tiny">{f.due_on}</b>
            {f.done_at ? (
              <Chip tone="grey">{t("p12.doctor.followupDone")}</Chip>
            ) : (
              <Chip tone="amber">{t("p12.doctor.followupsDue")}</Chip>
            )}
            <span className="spacer" />
            <Link className="linklike tiny" to={`/doctor/case/${f.case_id}`}>
              {t("doctor.openCase")}
            </Link>
          </div>
          {f.note && <p className="tiny" style={{ margin: "6px 0 0" }}>{f.note}</p>}
        </div>
      ))}
    </div>
  );
}
