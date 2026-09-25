import { useState } from "react";
import { adminApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

/**
 * A3: refund list + issue form. The issue form takes the order's id
 * (the client Order type has no order_no field, so the id is the
 * canonical identifier) plus amount and reason.
 */
export default function AdminRefunds() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() =>
    adminApi.listRefunds().then((r) => r.refunds),
  );
  const listError = error ? apiErrorMessage(t, error) : null;

  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function issue() {
    const amt = Number(amount);
    if (!orderId.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setBusy(true);
    setFormError(null);
    try {
      await adminApi.createRefund(orderId.trim(), amt, reason.trim() || undefined);
      toast(t("p12.admin.refundDone"));
      setOrderId("");
      setAmount("");
      setReason("");
      retry();
    } catch (e) {
      setFormError(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const refunds = data ?? [];
  const total = refunds.reduce((s, r) => s + r.amount_npr, 0);

  return (
    <div className="screen">
      <h1>{t("p12.admin.refunds")}</h1>
      <p className="muted tiny">{t("p12.admin.refundsTotal")}: NPR {total}</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.admin.issueRefund")}</h3>
        {formError && <ErrorCard message={formError} />}
        <label className="fl" htmlFor="rf-order">{t("p12.admin.orderIdPh")}</label>
        <input
          id="rf-order"
          type="text"
          placeholder={t("p12.admin.orderIdPh")}
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
        />
        <div className="rowflex" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label className="fl" htmlFor="rf-amount">{t("p12.admin.amountPh")}</label>
            <input
              id="rf-amount"
              type="number"
              min={1}
              placeholder={t("p12.admin.amountPh")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div style={{ flex: 2, minWidth: 160 }}>
            <label className="fl" htmlFor="rf-reason">{t("p12.admin.reasonPh")}</label>
            <input
              id="rf-reason"
              type="text"
              placeholder={t("p12.admin.reasonPh")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-p"
          disabled={busy || !orderId.trim() || !(Number(amount) > 0)}
          onClick={issue}
        >
          {busy ? t("common.loading") : t("p12.admin.issueRefund")}
        </button>
      </div>

      {loading && <Loading />}
      {listError && <ErrorCard message={listError} onRetry={retry} />}

      {!loading && !error && refunds.length === 0 && (
        <EmptyState icon={<Icon.box size={32} />} title={t("p12.admin.noRefunds")} />
      )}

      {refunds.map((r) => (
        <div className="card" key={r.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <b>NPR {r.amount_npr}</b>
              <div className="tiny muted kbd">{r.order_id.slice(0, 8)}</div>
              {r.reason && <div className="tiny" style={{ marginTop: 2 }}>{r.reason}</div>}
              <div className="tiny muted">{r.created_at.slice(0, 10)}</div>
            </div>
            <span className="chip">{t("p12.admin.refund")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
