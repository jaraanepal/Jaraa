import { useState } from "react";
import { adminApi } from "../../api/client";
import { expiringVerifications, setVerificationExpiry } from "../../api/b4admin";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";

const K4 = "p12d.admin";

type StatusFilter = "pending" | "approved" | "rejected" | "expiring";

const STATUS_TONE: Record<StatusFilter, "amber" | undefined | "red"> = {
  pending: "amber",
  approved: undefined,
  rejected: "red",
  expiring: "amber",
};

/** A33 — set/clear a verification's document expiry. */
function ExpiryControl({ id, current }: { id: string; current: string | null }) {
  const { t } = useLang();
  const [value, setValue] = useState(current ? current.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(clear: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await setVerificationExpiry(id, clear ? null : new Date(value).toISOString());
      if (clear) setValue("");
      toast(t(`${K4}.verifications.saved`));
    } catch (e) {
      setErr(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const expired = current !== null && new Date(current).getTime() < Date.now();
  return (
    <div style={{ marginTop: 8 }}>
      <p className="tiny" style={{ margin: "0 0 4px" }}>
        {current ? new Date(current).toLocaleDateString() : t(`${K4}.verifications.never`)}
        {expired && <span className="chip muted" style={{ marginLeft: 6 }}>{t(`${K4}.verifications.expired`)}</span>}
      </p>
      <div className="rowflex" style={{ gap: 8 }}>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t(`${K4}.verifications.setExpiry`)}
          style={{ flex: 1 }}
        />
        <button className="btn small" style={{ width: "auto", margin: 0 }} disabled={busy || !value} onClick={() => save(false)}>
          {t(`${K4}.verifications.setExpiry`)}
        </button>
        <button className="btn small" style={{ width: "auto", margin: 0 }} disabled={busy || !current} onClick={() => save(true)}>
          {t(`${K4}.verifications.clearExpiry`)}
        </button>
      </div>
      {err && <p className="tiny" style={{ color: "var(--red)" }}>{err}</p>}
    </div>
  );
}

/**
 * A5: staff verification queue — filter by status; pending rows get a note
 * input plus Approve/Reject decisions. A33 adds an "expiring" view plus
 * per-row document expiry controls.
 */
export default function AdminVerifications() {
  const { t } = useLang();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [days, setDays] = useState(30);
  const { data, error, loading, retry } = useAsync(
    () =>
      status === "expiring"
        ? expiringVerifications(days).then((r) => r.verifications)
        : adminApi.listVerifications(status).then((r) => r.verifications),
    [status, days],
  );
  const listError = error ? apiErrorMessage(t, error) : null;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const statusLabel = (s: StatusFilter) =>
    s === "pending" ? t("p12.admin.verifPending")
    : s === "approved" ? t("p12.admin.verifApproved")
    : s === "rejected" ? t("p12.admin.verifRejected")
    : t(`${K4}.verifications.expiringSoon`);

  async function decide(id: string, approved: boolean) {
    setBusyId(id);
    setDecideError(null);
    try {
      await adminApi.decideVerification(id, approved, notes[id]?.trim() || undefined);
      toast(t("p12.admin.verifDone"));
      setNotes((v) => ({ ...v, [id]: "" }));
      retry();
    } catch (e) {
      setDecideError(apiErrorMessage(t, e));
    } finally {
      setBusyId(null);
    }
  }

  const verifs = (data ?? []) as Array<{
    id: string; user_id: string; name?: string | null; phone?: string | null;
    requested_role: string; status: string; note?: string | null; created_at: string;
    expires_at?: string | null;
  }>;

  return (
    <div className="screen">
      <h1>{t("p12.admin.verification")}</h1>

      <div className="tabrow" style={{ flexWrap: "wrap" }}>
        {(["pending", "approved", "rejected", "expiring"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            className={`tab${status === s ? " on" : ""}`}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
          >
            {statusLabel(s)}
          </button>
        ))}
        {status === "expiring" && (
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} aria-label={t(`${K4}.verifications.days`)} style={{ width: "auto" }}>
            {[7, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>{d} {t(`${K4}.verifications.days`)}</option>
            ))}
          </select>
        )}
      </div>

      {decideError && <ErrorCard message={decideError} />}

      {loading && <Loading />}
      {listError && <ErrorCard message={listError} onRetry={retry} />}

      {!loading && !error && verifs.length === 0 && (
        <EmptyState icon={<Icon.check size={32} />} title={t("p12.admin.noVerifications")} />
      )}

      {verifs.map((v) => (
        <div className="card" key={v.id}>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <b>{v.name ?? v.phone ?? v.user_id.slice(0, 8)}</b>
              {v.phone && <div className="tiny muted kbd">{v.phone}</div>}
              <div className="tiny muted">{v.created_at.slice(0, 10)}</div>
            </div>
            <Chip tone={STATUS_TONE[v.status as StatusFilter] ?? undefined}>{v.requested_role}</Chip>
          </div>
          {v.note && <p className="tiny" style={{ margin: "6px 0 0" }}>{v.note}</p>}
          {/* A33 — document expiry control on every row */}
          <ExpiryControl id={v.id} current={v.expires_at ?? null} />
          {v.status === "pending" && (
            <div style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder={t("p12.admin.reasonPh")}
                value={notes[v.id] ?? ""}
                onChange={(e) => setNotes((pv) => ({ ...pv, [v.id]: e.target.value }))}
                aria-label={t("p12.admin.reasonPh")}
              />
              <div className="btn-row">
                <button
                  className="btn btn-p"
                  style={{ width: "auto", margin: 0 }}
                  disabled={busyId === v.id}
                  onClick={() => decide(v.id, true)}
                >
                  {busyId === v.id ? t("common.loading") : t("p12.admin.approve")}
                </button>
                <button
                  className="btn btn-g"
                  style={{ width: "auto", margin: 0 }}
                  disabled={busyId === v.id}
                  onClick={() => decide(v.id, false)}
                >
                  {t("p12.admin.reject")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
