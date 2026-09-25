import { useEffect, useState } from "react";
import { shopApi } from "../../api/client";
import { useLang } from "../../i18n/LanguageContext";
import { Chip, ErrorCard, Loading, StatCard, apiErrorMessage, toast } from "../../components/ui";
import { useAsync } from "../../components/useAsync";
import { Icon } from "../../components/icons";
import type { DamageReport, HandoverNote, Kit, Order, OrderCheck } from "../../api/types";

/** P2: per-kit stock stepper. */
function StockRow({ kit, onChanged }: { kit: Kit; onChanged: () => void }) {
  const { t } = useLang();
  const [delta, setDelta] = useState("");
  const [busy, setBusy] = useState(false);
  const stock = kit.stock ?? 0;

  async function apply(d: number) {
    if (busy || d === 0) return;
    setBusy(true);
    try {
      await shopApi.adjustKitStock(kit.id, d);
      toast(t("p12.pharmacy.stockUpdated"));
      onChanged();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
      setDelta("");
    }
  }

  return (
    <div className="rowflex" style={{ margin: "10px 0", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 140 }}>
        <b>{kit.name}</b>
        <br />
        <span className="tiny muted">
          NPR {kit.total_npr} ·{" "}
          {stock <= 5 ? (
            <Chip tone="red">{t("p12.pharmacy.stockLeft", { n: stock })}</Chip>
          ) : (
            t("p12.pharmacy.stockLeft", { n: stock })
          )}
        </span>
      </div>
      <div className="btn-row" style={{ gap: 4 }}>
        {[-5, -1, 1, 5].map((d) => (
          <button key={d} className="btn btn-g btn-s" disabled={busy} onClick={() => void apply(d)}>
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>
      <div className="rowflex" style={{ gap: 4 }}>
        <input
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="±"
          aria-label={t("p12.pharmacy.adjustStock")}
          style={{ width: 64 }}
        />
        <button className="btn btn-s" disabled={busy || delta.trim() === ""} onClick={() => void apply(Number(delta))}>
          {t("p12.common.save")}
        </button>
      </div>
    </div>
  );
}

/** P1 + P2: stock alerts + adjustment tab. */
export function PharmacyStockTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => shopApi.listPharmacyKits().then((r) => r.kits), []);

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;

  const kits = data ?? [];
  const low = kits.filter((k) => (k.stock ?? 0) <= 5);

  return (
    <>
      {/* P1: low-stock alerts */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.pharmacy.lowStock")}</h3>
        {low.length === 0 && <p className="tiny muted">—</p>}
        {low.map((k) => (
          <div className="rowflex" key={k.id} style={{ margin: "8px 0" }}>
            <span style={{ color: "var(--bad)" }}><Icon.alert size={18} /></span>
            <b>{k.name}</b>
            <span className="spacer" />
            <Chip tone="red">{t("p12.pharmacy.stockLeft", { n: k.stock ?? 0 })}</Chip>
          </div>
        ))}
      </div>

      {/* P2: stock adjust for every kit */}
      <h3>{t("p12.pharmacy.adjustStock")}</h3>
      <div className="card">
        {kits.length === 0 && <p className="tiny muted">—</p>}
        {kits.map((k) => (
          <StockRow key={k.id} kit={k} onChanged={retry} />
        ))}
      </div>
    </>
  );
}

/** P3 + P9: dispatch summary + fulfilment performance, computed client-side. */
export function PharmacyInsightsTab({ orders }: { orders: Order[] }) {
  const { t } = useLang();
  const today = new Date().toISOString().slice(0, 10);
  const todays = orders.filter((o) => o.created_at.slice(0, 10) === today);
  const delivered = orders.filter((o) => o.status === "delivered");

  // P3: today's orders grouped by status.
  const byStatus = new Map<string, number>();
  for (const o of todays) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);

  // P9: honest fulfilment metrics from real fields only.
  // avgFulfil = mean created_at -> updated_at for delivered orders, labelled
  // as the "fulfilment cycle": updated_at is the last state change, not a
  // guaranteed delivery timestamp.
  const fulfilCycles = delivered
    .filter((o) => o.updated_at)
    .map((o) => Date.parse(o.updated_at as string) - Date.parse(o.created_at))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgFulfilHrs =
    fulfilCycles.length > 0 ? fulfilCycles.reduce((a, b) => a + b, 0) / fulfilCycles.length / 3_600_000 : null;
  // Open = still needs action: anything not delivered/cancelled/refunded.
  const open = orders.filter((o) => !["delivered", "cancelled", "refunded"].includes(o.status));
  const openAges = open
    .map((o) => Date.now() - Date.parse(o.created_at))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgOpenHrs =
    openAges.length > 0 ? openAges.reduce((a, b) => a + b, 0) / openAges.length / 3_600_000 : null;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekDelivered = delivered.filter((o) => o.updated_at && Date.parse(o.updated_at) >= weekAgo).length;

  return (
    <>
      {/* P3: today's dispatch by status */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.pharmacy.dispatch")}</h3>
        {todays.length === 0 && <p className="tiny muted">—</p>}
        {[...byStatus.entries()].map(([s, n]) => (
          <div className="rowflex" key={s} style={{ margin: "6px 0" }}>
            <span className="tiny">{t(`orders.status.${s}`)}</span>
            <span className="spacer" />
            <Chip tone="grey">{n}</Chip>
          </div>
        ))}
      </div>

      {/* P9: performance — computed client-side from real fields only. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("p12.pharmacy.performance")}</h3>
        <div className="statgrid">
          <StatCard label={t("p12.pharmacy.delivered")} value={String(delivered.length)} icon={<Icon.check size={26} />} />
          <StatCard
            label={t("p12.pharmacy.avgFulfil")}
            value={avgFulfilHrs != null ? `${avgFulfilHrs.toFixed(1)}h` : "—"}
            icon={<Icon.clock size={26} />}
          />
          <StatCard
            label={t("p12.pharmacy.avgOpenAge")}
            value={avgOpenHrs != null ? `${avgOpenHrs.toFixed(1)}h` : "—"}
            icon={<Icon.box size={26} />}
          />
          <StatCard label={t("p12.pharmacy.thisWeek")} value={String(weekDelivered)} icon={<Icon.truck size={26} />} />
        </div>
        <p className="tiny muted">{t("p12.pharmacy.avgFulfilNote")}</p>
      </div>
    </>
  );
}

/** P5: one checklist row (name/phone/address), immutable once checked. */
function CheckRow({
  label,
  check,
  busy,
  onCheck,
}: {
  label: string;
  check?: OrderCheck;
  busy: boolean;
  onCheck: () => void;
}) {
  const { t } = useLang();
  return (
    <label className="rowflex" style={{ margin: "8px 0", cursor: check ? "default" : "pointer" }}>
      <input
        type="checkbox"
        checked={!!check}
        disabled={!!check || busy}
        onChange={() => onCheck()}
        style={{ width: 22, height: 22, minHeight: 22, flex: "none" }}
        aria-label={label}
      />
      <span className="tiny">
        <b>{label}</b>
        {check && (
          <>
            <br />
            <span className="muted">
              {check.checked_by ?? t("p12.pharmacy.checkSaved")} · {check.checked_at.slice(0, 16).replace("T", " ")}
            </span>
          </>
        )}
      </span>
    </label>
  );
}

const CHECK_TYPES = ["name", "phone", "address"] as const;

/**
 * P4–P8: per-order fulfilment tools shown inside the expanded order card.
 * Lazy-loads checklist/damage/handover when the order is expanded; every
 * mutation reports success or the real API error — never invented state.
 */
export function OrderBatchTools({ order, onUpdate }: { order: Order; onUpdate: (o: Order) => void }) {
  const { t } = useLang();
  const [courier, setCourier] = useState(order.courier_name ?? "");
  const [tracking, setTracking] = useState(order.tracking_id ?? "");
  const [savingCourier, setSavingCourier] = useState(false);
  const [checks, setChecks] = useState<OrderCheck[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [damage, setDamage] = useState("");
  const [damages, setDamages] = useState<DamageReport[]>([]);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<HandoverNote[]>([]);

  const loadExtras = () => {
    shopApi.listOrderChecks(order.id).then((r) => setChecks(r.checks)).catch(() => {});
    shopApi.listDamageReports(order.id).then((r) => setDamages(r.reports)).catch(() => {});
    shopApi.listHandoverNotes(order.id).then((r) => setNotes(r.notes)).catch(() => {});
  };
  // Lazy-load checklist/damage/handover only when the order card expands.
  useEffect(loadExtras, [order.id]);

  async function saveCourier() {
    setSavingCourier(true);
    try {
      const r = await shopApi.setOrderCourier(
        order.id,
        courier.trim() || null,
        tracking.trim() || null,
      );
      onUpdate(r.order);
      toast(t("p12.pharmacy.courierSaved"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setSavingCourier(false);
    }
  }

  async function doCheck(checkType: (typeof CHECK_TYPES)[number]) {
    if (checks.some((c) => c.check_type === checkType) || checking) return;
    setChecking(checkType);
    try {
      const r = await shopApi.addOrderCheck(order.id, checkType);
      setChecks((p) => [...p, r.check]);
      toast(t("p12.pharmacy.checkSaved"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setChecking(null);
    }
  }

  async function markReturned() {
    if (!reason.trim() || returning) return;
    if (!window.confirm(t("p12.pharmacy.markReturned"))) return;
    setReturning(true);
    try {
      const r = await shopApi.returnOrder(order.id, reason.trim());
      onUpdate(r.order);
      setReason("");
      toast(t("p12.pharmacy.returnDone"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setReturning(false);
    }
  }

  async function logDamage() {
    if (!damage.trim()) return;
    try {
      const r = await shopApi.addDamageReport(order.id, damage.trim());
      setDamages((p) => [...p, r.report]);
      setDamage("");
      toast(t("p12.pharmacy.damageLogged"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    try {
      const r = await shopApi.addHandoverNote(order.id, note.trim());
      setNotes((p) => [...p, r.note]);
      setNote("");
      toast(t("p12.pharmacy.noteAdded"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      {/* P4: courier + tracking */}
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12.pharmacy.courier")}</h4>
      <div className="rowflex" style={{ gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          value={courier}
          onChange={(e) => setCourier(e.target.value)}
          placeholder={t("p12.pharmacy.courierPh")}
          aria-label={t("p12.pharmacy.courierPh")}
          style={{ flex: 1, minWidth: 120 }}
        />
        <input
          type="text"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder={t("p12.pharmacy.trackingPh")}
          aria-label={t("p12.pharmacy.trackingPh")}
          style={{ flex: 1, minWidth: 120 }}
        />
        <button className="btn btn-s btn-p" disabled={savingCourier} onClick={saveCourier}>
          {t("p12.pharmacy.saveCourier")}
        </button>
      </div>

      {/* P5: address verification checklist */}
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12.pharmacy.addrCheck")}</h4>
      {CHECK_TYPES.map((ct) => (
        <CheckRow
          key={ct}
          label={t(`p12.pharmacy.check${ct[0].toUpperCase()}${ct.slice(1)}`)}
          check={checks.find((c) => c.check_type === ct)}
          busy={checking !== null}
          onCheck={() => void doCheck(ct)}
        />
      ))}

      {/* P6: returns */}
      {order.status !== "cancelled" && order.status !== "refunded" && (
        <>
          <h4 style={{ margin: "12px 0 6px" }}>{t("p12.pharmacy.markReturned")}</h4>
          <div className="rowflex" style={{ gap: 8 }}>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("p12.pharmacy.returnReasonPh")}
              aria-label={t("p12.pharmacy.returnReasonPh")}
              style={{ flex: 1 }}
            />
            <button className="btn btn-s" disabled={returning || !reason.trim()} onClick={markReturned}>
              {t("p12.pharmacy.markReturned")}
            </button>
          </div>
        </>
      )}

      {/* P7: damage log */}
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12.pharmacy.damage")}</h4>
      {damages.length === 0 && <p className="tiny muted">{t("p12.pharmacy.noDamage")}</p>}
      {damages.map((d) => (
        <p key={d.id} className="tiny" style={{ margin: "6px 0" }}>
          {d.description}
          <br />
          <span className="muted">{d.reporter_id ?? ""} · {d.created_at.slice(0, 16).replace("T", " ")}</span>
        </p>
      ))}
      <div className="rowflex" style={{ gap: 8 }}>
        <input
          type="text"
          value={damage}
          onChange={(e) => setDamage(e.target.value)}
          placeholder={t("p12.pharmacy.damagePh")}
          aria-label={t("p12.pharmacy.damagePh")}
          style={{ flex: 1 }}
        />
        <button className="btn btn-s btn-g" disabled={!damage.trim()} onClick={logDamage}>
          {t("p12.pharmacy.logDamage")}
        </button>
      </div>

      {/* P8: handover notes */}
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12.pharmacy.handover")}</h4>
      {notes.length === 0 && <p className="tiny muted">{t("p12.pharmacy.noNotes")}</p>}
      {notes.map((n) => (
        <p key={n.id} className="tiny" style={{ margin: "6px 0" }}>
          {n.note}
          <br />
          <span className="muted">{n.author_id ?? ""} · {n.created_at.slice(0, 16).replace("T", " ")}</span>
        </p>
      ))}
      <div className="rowflex" style={{ gap: 8 }}>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("p12.pharmacy.handoverPh")}
          aria-label={t("p12.pharmacy.handoverPh")}
          style={{ flex: 1 }}
        />
        <button className="btn btn-s btn-g" disabled={!note.trim()} onClick={addNote}>
          {t("p12.pharmacy.addNote")}
        </button>
      </div>
    </div>
  );
}
