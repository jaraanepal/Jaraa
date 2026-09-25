import { useEffect, useMemo, useState } from "react";
import { shopApi } from "../api/client";
import { pharmacyB3Api } from "../api/b3pharmacy";
import type {
  OrderNote, PackagingMaterial, QuarantineEntry, QuarantineStatus, ShiftSummary,
} from "../api/b3pharmacy";
import { useLang } from "../i18n/LanguageContext";
import { Chip, EmptyState, ErrorCard, Loading, NoticeBox, StatCard, apiErrorMessage, toast } from "../components/ui";
import { useAsync } from "../components/useAsync";
import { Icon } from "../components/icons";
import type { Order, OrderStatus } from "../api/types";
import { OrderBatchTools, PharmacyInsightsTab, PharmacyStockTab } from "./pharmacy/PharmacyBatch";
import { pharmacyB4Api } from "../api/b4pharmacy";
import type {
  AttemptStatus,
  CourierClaim,
  DeliveryProof,
  DispatchHoliday,
  ExpiringBatch,
  Manifest,
  RefundRequest,
  Substitution,
} from "../api/b4pharmacy";

const PIPELINE: OrderStatus[] = ["pending_payment", "paid", "packed", "shipped", "delivered"];
/** Next actionable status per current status (pharmacy fulfilment advance). */
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; labelKey: string }>> = {
  paid: { to: "packed", labelKey: "pharmacy.markPacked" },
  packed: { to: "shipped", labelKey: "pharmacy.markShipped" },
  shipped: { to: "delivered", labelKey: "pharmacy.markDelivered" },
};

const ACTIONABLE: OrderStatus[] = ["pending_payment", "paid", "packed", "shipped"];
const HOURS_24 = 24 * 3_600_000;

/** Priority = cash-on-delivery (collect on delivery) or sitting > 24h. */
function isPriority(o: Order, now: number): boolean {
  return o.payment_method === "cod" || now - Date.parse(o.created_at) > HOURS_24;
}

function customerName(o: Order): string {
  return o.shipping_address?.name ?? "";
}

/* ================= Batch-3 (009) pharmacy tabs & order tools ================= */

/** Order with the P23 pack-timer fields (present on the shop contract order). */
type PackableOrder = Order & { pack_started_at?: string | null; pack_completed_at?: string | null };

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** P23: "Start packing" turns into a live elapsed timer with "Mark packed". */
function OrderPackTimer({ order, onUpdate }: { order: PackableOrder; onUpdate: (o: Order) => void }) {
  const { t } = useLang();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const started = !!order.pack_started_at;
  const done = !!order.pack_completed_at;

  useEffect(() => {
    if (!started || done) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [started, done, order.pack_started_at]);

  const run = async (fn: (id: string) => Promise<{ order: Order }>) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn(order.id);
      onUpdate(r.order);
      toast(t("p12c.pharmacy.saved"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  if (!started) {
    return (
      <div style={{ marginTop: 12 }}>
        <p className="tiny muted" style={{ margin: "0 0 6px" }}>{t("p12c.pharmacy.packStartHint")}</p>
        <button className="btn btn-s" disabled={busy} onClick={() => void run(pharmacyB3Api.packStart)}>
          {busy ? "…" : t("p12c.pharmacy.packStartBtn")}
        </button>
      </div>
    );
  }
  const end = order.pack_completed_at ? Date.parse(order.pack_completed_at) : now;
  return (
    <div className="rowflex" style={{ marginTop: 12 }}>
      <span className="chip amber">
        {t("p12c.pharmacy.packElapsed")}: {fmtElapsed(end - Date.parse(order.pack_started_at as string))}
      </span>
      {!done && (
        <button className="btn btn-s" disabled={busy} onClick={() => void run(pharmacyB3Api.packComplete)}>
          {busy ? "…" : t("p12c.pharmacy.packCompleteBtn")}
        </button>
      )}
    </div>
  );
}

/** P27: internal notes thread under the handover notes, composer at the bottom. */
function OrderInternalNotes({ order }: { order: Order }) {
  const { t } = useLang();
  const [notes, setNotes] = useState<OrderNote[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pharmacyB3Api.listOrderNotes(order.id).then((r) => setNotes(r.notes)).catch(() => {});
  }, [order.id]);

  const add = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const r = await pharmacyB3Api.addOrderNote(order.id, v);
      setNotes((p) => [...p, r.note]);
      setText("");
      toast(t("p12c.pharmacy.noteAdded"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12c.pharmacy.notesTitle2")}</h4>
      {notes.length === 0 && <p className="tiny muted">{t("p12c.pharmacy.notesEmpty")}</p>}
      {notes.map((n) => (
        <p key={n.id} className="tiny" style={{ margin: "6px 0" }}>
          <span className="muted">{n.created_at.slice(0, 16).replace("T", " ")} · </span>
          {n.note}
        </p>
      ))}
      <div className="rowflex" style={{ marginTop: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("p12c.pharmacy.notePh")}
          maxLength={2000}
          style={{ flex: 1, minWidth: 120 }}
        />
        <button className="btn btn-s" disabled={busy || !text.trim()} onClick={() => void add()}>
          {t("p12c.pharmacy.noteAddBtn")}
        </button>
      </div>
    </div>
  );
}

const QUARANTINE_STATUS_KEY: Record<QuarantineStatus, string> = {
  quarantined: "p12c.pharmacy.stQuarantined",
  released: "p12c.pharmacy.stReleased",
  written_off: "p12c.pharmacy.stWrittenOff",
};
const QUARANTINE_FILTERS: Array<"all" | QuarantineStatus> = ["all", "quarantined", "released", "written_off"];

/** P19: damaged-stock quarantine — list + report-damage + release/write-off. */
function QuarantineTab() {
  const { t } = useLang();
  const [filter, setFilter] = useState<"all" | QuarantineStatus>("quarantined");
  const [kits, setKits] = useState<Array<{ id: string; name: string }>>([]);
  const { data, error, loading, retry } = useAsync(
    () => pharmacyB3Api.listQuarantine(filter === "all" ? undefined : filter).then((r) => r.entries),
    [filter],
  );
  const [kitId, setKitId] = useState("");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    shopApi.listPharmacyKits().then((r) => setKits(r.kits.map((k) => ({ id: k.id, name: k.name })))).catch(() => {});
  }, []);

  const kitName = (id: string) => kits.find((k) => k.id === id)?.name ?? id.slice(0, 8);

  const report = async () => {
    const n = Number(qty);
    if (!kitId || !Number.isInteger(n) || n <= 0 || busy) return;
    setBusy(true);
    try {
      await pharmacyB3Api.createQuarantine({ kit_id: kitId, qty: n, reason: reason.trim() || undefined });
      setKitId("");
      setQty("1");
      setReason("");
      toast(t("p12c.pharmacy.saved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (entry: QuarantineEntry, status: QuarantineStatus) => {
    if (acting) return;
    if (status === "written_off" && !window.confirm(t("p12c.pharmacy.writeOffBtn"))) return;
    setActing(entry.id);
    try {
      await pharmacyB3Api.setQuarantineStatus(entry.id, status);
      toast(t("p12c.pharmacy.saved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setActing(null);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const entries = data ?? [];

  return (
    <div>
      <h3>{t("p12c.pharmacy.quarantineTitle")}</h3>
      <p className="muted tiny">{t("p12c.pharmacy.quarantineSub")}</p>

      <div className="card">
        <div style={{ display: "grid", gap: 8 }}>
          <label className="fl" htmlFor="q-kit">{t("p12c.pharmacy.kitLabel")}</label>
          <select id="q-kit" value={kitId} onChange={(e) => setKitId(e.target.value)}>
            <option value="">—</option>
            {kits.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <label className="fl" htmlFor="q-qty">{t("p12c.pharmacy.qtyLabel")}</label>
              <input id="q-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div style={{ flex: 2 }}>
              <label className="fl" htmlFor="q-reason">{t("p12c.pharmacy.reasonLabel")}</label>
              <input id="q-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("p12c.pharmacy.reasonPh")} />
            </div>
          </div>
          <button className="btn primary" disabled={busy || !kitId} onClick={() => void report()}>
            {t("p12c.pharmacy.quarantineBtn")}
          </button>
        </div>
      </div>

      <div style={{ margin: "8px 0" }}>
        {QUARANTINE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${filter === f ? " gold" : ""}`}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {f === "all" ? t("pharmacy.filterAll") : t(QUARANTINE_STATUS_KEY[f])}
          </button>
        ))}
      </div>

      {entries.length === 0 && <EmptyState icon={<Icon.box size={32} />} title={t("p12c.pharmacy.quarantineEmpty")} />}
      {entries.map((e) => (
        <div className="card" key={e.id}>
          <div className="rowflex">
            <div>
              <b>{kitName(e.kit_id)}</b>
              <br />
              <span className="tiny muted">
                {t("p12c.pharmacy.qtyLabel")}: {e.qty}
                {e.reason ? ` · ${t("p12c.pharmacy.reasonLabel")}: ${e.reason}` : ""}
              </span>
            </div>
            <span className="spacer" />
            <span className="chip">{t(QUARANTINE_STATUS_KEY[e.status])}</span>
          </div>
          {e.status === "quarantined" && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn btn-s" disabled={acting === e.id} onClick={() => void setStatus(e, "released")}>
                {t("p12c.pharmacy.releaseBtn")}
              </button>
              <button className="btn btn-s" disabled={acting === e.id} onClick={() => void setStatus(e, "written_off")}>
                {t("p12c.pharmacy.writeOffBtn")}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** P20: shift handover summary — handled / pending / COD + handover notes timeline. */
function ShiftTab() {
  const { t } = useLang();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const { data, error, loading, retry } = useAsync(
    () => pharmacyB3Api.getShiftSummary(date),
    [date],
  );

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const s: ShiftSummary | null = data;

  return (
    <div>
      <h3>{t("p12c.pharmacy.shiftTitle")}</h3>
      <p className="muted tiny">{t("p12c.pharmacy.shiftSub")}</p>
      <label className="fl" htmlFor="shift-date">{t("p12c.pharmacy.dateLabel")}</label>
      <input id="shift-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      {s && (
        <>
          <div className="statgrid" style={{ marginTop: 12 }}>
            <StatCard label={t("p12c.pharmacy.handled")} value={String(s.handled)} icon={<Icon.check size={26} />} />
            <StatCard label={t("p12c.pharmacy.pending")} value={String(s.pending)} icon={<Icon.clock size={26} />} />
            <StatCard label={t("p12c.pharmacy.codOrders")} value={String(s.cod_orders)} icon={<Icon.truck size={26} />} />
          </div>
          <h4>{t("p12c.pharmacy.notesTitle")}</h4>
          {s.handover_notes.length === 0 && <p className="tiny muted">—</p>}
          {s.handover_notes.map((n) => (
            <p key={n.id} className="tiny" style={{ margin: "6px 0" }}>
              <span className="muted">{n.created_at.slice(0, 16).replace("T", " ")} · <span className="kbd">{n.order_id.slice(0, 8)}</span></span>
              <br />
              {n.note}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

/** P21: courier performance — orders / delivered / delivery-rate bars. */
function CouriersTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => pharmacyB3Api.getCourierPerformance(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const couriers = data?.couriers ?? [];

  return (
    <div>
      <h3>{t("p12c.pharmacy.courierTitle")}</h3>
      <p className="muted tiny">{t("p12c.pharmacy.courierSub")}</p>
      {couriers.length === 0 && <p className="tiny muted">—</p>}
      {couriers.map((c) => {
        const rate = c.orders > 0 ? c.delivered / c.orders : 0;
        return (
          <div className="card" key={c.courier}>
            <div className="rowflex">
              <b>{c.courier === "unassigned" ? t("p12c.pharmacy.unassigned") : c.courier}</b>
              <span className="spacer" />
              <span className="tiny muted">
                {t("p12c.pharmacy.ordersCol")}: {c.orders} · {t("p12c.pharmacy.deliveredCol")}: {c.delivered}
              </span>
            </div>
            <div className="rowflex" style={{ marginTop: 6 }}>
              <div style={{ flex: 1, height: 8, background: "var(--line)", borderRadius: 4 }}>
                <div style={{ width: `${Math.round(rate * 100)}%`, height: "100%", background: "var(--green)", borderRadius: 4 }} />
              </div>
              <span className="tiny muted">{t("p12c.pharmacy.rateCol")}: {Math.round(rate * 100)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** P22: return-rate analytics — ranked kits with expandable reason chips. */
function ReturnsTab() {
  const { t } = useLang();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, error, loading, retry } = useAsync(() => pharmacyB3Api.getReturnAnalytics(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const kits = data?.kits ?? [];

  return (
    <div>
      <h3>{t("p12c.pharmacy.returnsTitle")}</h3>
      <p className="muted tiny">{t("p12c.pharmacy.returnsSub")}</p>
      {kits.length === 0 && <p className="tiny muted">—</p>}
      {kits.map((k, i) => {
        const reasons = Object.entries(k.reasons ?? {});
        const open = expanded === k.kit_id;
        return (
          <div className="card" key={k.kit_id}>
            <div className="rowflex">
              <span className="chip">#{i + 1}</span>
              <b>{k.kit_name}</b>
              <span className="spacer" />
              <Chip tone="red">{t("p12c.pharmacy.returnsCol")}: {k.returns}</Chip>
            </div>
            <button className="btn btn-s" style={{ marginTop: 8 }} onClick={() => setExpanded(open ? null : k.kit_id)} aria-expanded={open}>
              {t("p12c.pharmacy.reasonsTitle")} ({reasons.length})
            </button>
            {open && (
              <div style={{ marginTop: 8 }}>
                {reasons.map(([reason, n]) => (
                  <span className="chip" key={reason} style={{ marginRight: 6 }}>
                    {reason === "unspecified" ? t("p12c.pharmacy.unspecified") : reason}: {n}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** P24: packaging materials — stock list, low-stock badges, add/edit/delete. */
function PackagingTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => pharmacyB3Api.listPackaging(), []);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await pharmacyB3Api.createPackaging({
        name: name.trim(),
        qty: qty.trim() === "" ? 0 : Number(qty),
        unit: unit.trim() || undefined,
        low_threshold: threshold.trim() === "" ? 0 : Number(threshold),
      });
      setName("");
      setQty("");
      setUnit("");
      setThreshold("");
      toast(t("p12c.pharmacy.saved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const saveQty = async (m: PackagingMaterial) => {
    const n = Number(qtys[m.id] ?? m.qty);
    if (!Number.isInteger(n) || n < 0 || acting) return;
    setActing(m.id);
    try {
      await pharmacyB3Api.updatePackaging(m.id, { qty: n });
      toast(t("p12c.pharmacy.saved"));
      setQtys((p) => {
        const next = { ...p };
        delete next[m.id];
        return next;
      });
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setActing(null);
    }
  };

  const remove = async (m: PackagingMaterial) => {
    if (acting) return;
    if (!window.confirm(t("p12c.pharmacy.deleteConfirm"))) return;
    setActing(m.id);
    try {
      await pharmacyB3Api.deletePackaging(m.id);
      toast(t("p12c.pharmacy.deleted"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setActing(null);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;
  const materials = data?.materials ?? [];

  return (
    <div>
      <h3>{t("p12c.pharmacy.packagingTitle")}</h3>
      <p className="muted tiny">{t("p12c.pharmacy.packagingSub")}</p>

      <div className="card">
        <div style={{ display: "grid", gap: 8 }}>
          <label className="fl" htmlFor="pm-name">{t("p12c.pharmacy.nameLabel")}</label>
          <input id="pm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("p12c.pharmacy.namePh")} />
          <div className="rowflex">
            <div style={{ flex: 1 }}>
              <label className="fl" htmlFor="pm-qty">{t("p12c.pharmacy.qtyLabel")}</label>
              <input id="pm-qty" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="fl" htmlFor="pm-unit">{t("p12c.pharmacy.unitLabel")}</label>
              <input id="pm-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t("p12c.pharmacy.unitPh")} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="fl" htmlFor="pm-thr">{t("p12c.pharmacy.thresholdLabel")}</label>
              <input id="pm-thr" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
          </div>
          <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void add()}>
            {t("p12c.pharmacy.addMaterialBtn")}
          </button>
        </div>
      </div>

      {materials.length === 0 && <EmptyState icon={<Icon.box size={32} />} title={t("p12c.pharmacy.packagingEmpty")} />}
      {materials.map((m) => {
        const low = m.qty <= m.low_threshold;
        const qtyVal = qtys[m.id] ?? String(m.qty);
        return (
          <div className="card" key={m.id}>
            <div className="rowflex" style={{ flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <b>{m.name}</b>
                <br />
                <span className="tiny muted">
                  {m.unit ? `${m.unit} · ` : ""}
                  {t("p12c.pharmacy.thresholdLabel")}: {m.low_threshold}
                  {low && <span style={{ marginLeft: 6 }}><Chip tone="red">{t("p12c.pharmacy.lowBadge")}</Chip></span>}
                </span>
              </div>
              <input
                type="number"
                min={0}
                value={qtyVal}
                onChange={(e) => setQtys((p) => ({ ...p, [m.id]: e.target.value }))}
                style={{ width: 72 }}
                aria-label={t("p12c.pharmacy.qtyLabel")}
              />
              <button className="btn btn-s" disabled={acting === m.id} onClick={() => void saveQty(m)}>
                {t("p12.common.save")}
              </button>
              <button className="btn btn-s btn-g" disabled={acting === m.id} onClick={() => void remove(m)}>
                {t("p12.common.delete")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** P25: COD reconciliation — expected vs collected with per-order chips. */
function CodTab() {
  const { t } = useLang();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const { data, error, loading, retry } = useAsync(
    () => pharmacyB3Api.getCodReconciliation(date),
    [date],
  );

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;

  return (
    <div>
      <h3>{t("p12c.pharmacy.codTitle")}</h3>
      <p className="muted tiny">{t("p12c.pharmacy.codSub")}</p>
      <label className="fl" htmlFor="cod-date">{t("p12c.pharmacy.dateLabel")}</label>
      <input id="cod-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      {data && (
        <>
          <div className="statgrid" style={{ marginTop: 12 }}>
            <StatCard label={t("p12c.pharmacy.expected")} value={`NPR ${data.expected_npr}`} icon={<Icon.truck size={26} />} />
            <StatCard label={t("p12c.pharmacy.collected")} value={`NPR ${data.collected_npr}`} icon={<Icon.check size={26} />} />
            <StatCard label={t("p12c.pharmacy.totalCol")} value={`NPR ${data.expected_npr - data.collected_npr}`} icon={<Icon.clock size={26} />} />
          </div>
          {data.orders.length === 0 && <EmptyState icon={<Icon.box size={32} />} title={t("p12c.pharmacy.codEmpty")} />}
          {data.orders.map((o) => (
            <div className="card" key={o.id}>
              <div className="rowflex">
                <div>
                  <b className="kbd">{o.order_no}</b>
                  <br />
                  <span className="tiny muted">NPR {o.total_npr} · {o.status}</span>
                </div>
                <span className="spacer" />
                <span className={`chip${o.collected ? " gold" : ""}`}>
                  {o.collected ? t("p12c.pharmacy.collected") : t("p12c.pharmacy.pending")}
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** P26: per-kit low-stock threshold editor, rendered inside the Stock view. */
function StockThresholdEditor() {
  const { t } = useLang();
  const { data, error, retry } = useAsync(() => shopApi.listPharmacyKits(), []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const kits = (data?.kits ?? []) as Array<{
    id: string; name: string; stock?: number; low_stock_threshold?: number | null;
  }>;

  const save = async (kitId: string) => {
    const n = Number(values[kitId]);
    if (!Number.isInteger(n) || n < 0 || busy) return;
    setBusy(kitId);
    try {
      await pharmacyB3Api.setKitThreshold(kitId, n);
      toast(t("p12c.pharmacy.thresholdSaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorCard message={apiErrorMessage(t, error)} onRetry={retry} />;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{t("p12c.pharmacy.thresholdLabel")}</h3>
      <p className="muted tiny">{t("p12c.pharmacy.thresholdHint")}</p>
      {kits.map((k) => {
        const current = values[k.id] ?? String(k.low_stock_threshold ?? 5);
        const low = (k.stock ?? 0) <= (k.low_stock_threshold ?? 5);
        return (
          <div className="rowflex" key={k.id} style={{ margin: "10px 0", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <b>{k.name}</b>
              <br />
              <span className="tiny muted">
                {t("p12c.pharmacy.qtyLabel")}: {k.stock ?? 0}
                {low && <span style={{ marginLeft: 6 }}><Chip tone="red">{t("p12c.pharmacy.lowBadge")}</Chip></span>}
              </span>
            </div>
            <input
              type="number"
              min={0}
              value={current}
              onChange={(e) => setValues((p) => ({ ...p, [k.id]: e.target.value }))}
              style={{ width: 80 }}
              aria-label={t("p12c.pharmacy.thresholdLabel")}
            />
            <button className="btn btn-s" disabled={busy === k.id} onClick={() => void save(k.id)}>
              {busy === k.id ? "…" : t("p12c.pharmacy.thresholdSaveBtn")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Fulfilment queue for the pharmacy / fulfilment role.
 * Cosmetic kit orders only — prescription commerce stays hidden while the
 * prescription_commerce flag is OFF (enforced server-side).
 */
/* ================= Batch-4 (010) pharmacy: P28–P45 ================= */

/** P40 — notice banner with published announcements. */
function AnnouncementsBanner() {
  const { lang } = useLang();
  const { data } = useAsync(() => pharmacyB4Api.getAnnouncements(), []);
  const list = data?.announcements ?? [];
  if (list.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      {list.map((a) => (
        <NoticeBox key={a.id} tone="notice" title={lang === "ne" && a.title_ne ? a.title_ne : a.title_en}>
          {(lang === "ne" && a.body_ne ? a.body_ne : a.body_en) && (
            <p className="tiny">{lang === "ne" && a.body_ne ? a.body_ne : a.body_en}</p>
          )}
        </NoticeBox>
      ))}
    </div>
  );
}

/** P32 — per-courier daily pickup manifest with a print view. */
function ManifestTab() {
  const { t } = useLang();
  const today = new Date().toISOString().slice(0, 10);
  const [courier, setCourier] = useState("");
  const [date, setDate] = useState(today);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setManifest(await pharmacyB4Api.getManifest(courier.trim() || undefined, date));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="manifest-sheet">
      <h3 style={{ margin: "12px 0 4px" }}>{t("p12d.pharmacy.manifestTitle")}</h3>
      <p className="muted tiny">{t("p12d.pharmacy.manifestSub")}</p>
      <div className="rowflex">
        <input
          value={courier}
          onChange={(e) => setCourier(e.target.value)}
          placeholder={t("p12d.pharmacy.manifestCourierPh")}
          aria-label={t("p12d.pharmacy.manifestCourierPh")}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t("p12d.pharmacy.manifestDate")}
        />
        <button className="btn primary btn-s" disabled={loading} onClick={() => void load()}>
          {t("p12d.pharmacy.manifestLoad")}
        </button>
        {manifest && (
          <button className="btn btn-s" onClick={() => window.print()}>
            {t("p12d.pharmacy.manifestPrint")}
          </button>
        )}
      </div>
      {error && <ErrorCard message={error} onRetry={() => void load()} />}
      {manifest && (
        <>
          <div className="rowflex" style={{ margin: "12px 0" }}>
            <b>{manifest.date}</b>
            {manifest.courier && <span className="chip">{manifest.courier}</span>}
            <span className="spacer" />
            <span className="chip gold">{t("p12d.pharmacy.manifestTotal")}: {manifest.total}</span>
          </div>
          {manifest.orders.length === 0 && (
            <p className="tiny muted">{t("p12d.pharmacy.manifestEmpty")}</p>
          )}
          {manifest.orders.map((o) => (
            <div className="card" key={o.id}>
              <div className="rowflex">
                <div>
                  <b className="kbd">{o.id}</b>
                  <br />
                  <span className="tiny muted">
                    {o.shipping_address?.name} · {o.shipping_address?.city} · NPR {o.total_npr}
                  </span>
                </div>
                <span className="spacer" />
                <span className="chip">{o.status}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** P36-alt — kit batches expiring soon. */
function ExpiryTab() {
  const { t } = useLang();
  const [days, setDays] = useState("60");
  const [ask, setAsk] = useState("60");
  const { data, error, loading, retry } = useAsync(
    () => pharmacyB4Api.getExpiringBatches(Number(ask) || 60),
    [ask],
  );
  const rows = data?.batches ?? [];
  return (
    <div>
      <h3 style={{ margin: "12px 0 4px" }}>{t("p12d.pharmacy.expiryTitle")}</h3>
      <p className="muted tiny">{t("p12d.pharmacy.expirySub")}</p>
      <div className="rowflex">
        <input
          value={days}
          onChange={(e) => setDays(e.target.value)}
          inputMode="numeric"
          placeholder={t("p12d.pharmacy.expiryDays")}
          aria-label={t("p12d.pharmacy.expiryDays")}
          style={{ width: 90 }}
        />
        <button
          className="btn primary btn-s"
          onClick={() => {
            const n = Number(days);
            if (Number.isInteger(n) && n >= 1 && n <= 365) setAsk(String(n));
          }}
        >
          {t("p12d.pharmacy.expiryLoad")}
        </button>
      </div>
      {loading && <Loading />}
      {error ? <p className="tiny" style={{ color: "var(--red)" }}>{apiErrorMessage(t, error)} <button className="btn btn-s" onClick={retry}>retry</button></p> : null}
      {!loading && !error && rows.length === 0 && (
        <p className="tiny muted">{t("p12d.pharmacy.expiryEmpty")}</p>
      )}
      {rows.map((b: ExpiringBatch) => (
        <div className="card" key={b.id}>
          <div className="rowflex">
            <div>
              <b>{b.kit_name}</b>
              <br />
              <span className="tiny muted">
                {b.batch_no ?? "—"} · {b.expiry ?? "—"} · qty {b.qty}
              </span>
            </div>
            <span className="spacer" />
            <Chip
              tone={
                b.days_left !== null && b.days_left < 0
                  ? "red"
                  : b.days_left !== null && b.days_left <= 7
                    ? "gold"
                    : undefined
              }
            >
              {b.days_left === null
                ? "—"
                : b.days_left < 0
                  ? t("p12d.pharmacy.expiredAgo", { n: -b.days_left })
                  : t("p12d.pharmacy.expiresIn", { n: b.days_left })}
            </Chip>
          </div>
        </div>
      ))}
    </div>
  );
}

/** P45 — courier damage claims. */
type ClaimStatus = CourierClaim["status"];

function ClaimsTab() {
  const { t } = useLang();
  const [filter, setFilter] = useState<"all" | ClaimStatus>("all");
  const { data, error, loading, retry } = useAsync(
    () => pharmacyB4Api.listCourierClaims(filter === "all" ? undefined : filter),
    [filter],
  );
  const [courier, setCourier] = useState("");
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const claims = data?.claims ?? [];
  const STATUS_KEY: Record<ClaimStatus, string> = {
    open: "p12d.pharmacy.claimOpen",
    filed: "p12d.pharmacy.claimFiled",
    settled: "p12d.pharmacy.claimSettled",
  };

  const add = async () => {
    const c = courier.trim();
    const r = reason.trim();
    const n = amount.trim() === "" ? 0 : Number(amount);
    if (!c || !r || busy || !Number.isFinite(n) || n < 0) return;
    setBusy(true);
    try {
      await pharmacyB4Api.createCourierClaim({
        courier_name: c,
        order_id: orderId.trim() || null,
        amount_npr: n,
        reason: r,
      });
      setCourier(""); setOrderId(""); setAmount(""); setReason("");
      toast(t("p12d.pharmacy.claimSaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (c: CourierClaim, status: ClaimStatus) => {
    if (acting) return;
    setActing(c.id);
    try {
      await pharmacyB4Api.setCourierClaimStatus(c.id, status);
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <h3 style={{ margin: "12px 0 4px" }}>{t("p12d.pharmacy.claimsTitle")}</h3>
      <p className="muted tiny">{t("p12d.pharmacy.claimsSub")}</p>
      <div className="card">
        <div className="rowflex" style={{ flexWrap: "wrap" }}>
          <input
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            placeholder={t("p12d.pharmacy.claimCourierPh")}
            aria-label={t("p12d.pharmacy.claimCourier")}
            style={{ flex: "1 1 160px" }}
          />
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder={t("p12d.pharmacy.claimOrder")}
            aria-label={t("p12d.pharmacy.claimOrder")}
            style={{ flex: "1 1 160px" }}
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={t("p12d.pharmacy.claimAmount")}
            aria-label={t("p12d.pharmacy.claimAmount")}
            style={{ width: 110 }}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("p12d.pharmacy.claimReasonPh")}
            aria-label={t("p12d.pharmacy.claimReasonPh")}
            style={{ flex: "2 1 200px" }}
          />
          <button className="btn primary btn-s" disabled={busy} onClick={() => void add()}>
            {t("p12d.pharmacy.claimAdd")}
          </button>
        </div>
      </div>
      <div className="rowflex" style={{ margin: "8px 0" }}>
        {(["all", "open", "filed", "settled"] as const).map((s) => (
          <button
            key={s}
            className={`btn btn-s ${filter === s ? "primary" : ""}`}
            onClick={() => setFilter(s)}
          >
            {s === "all" ? t("common.all") : t(STATUS_KEY[s])}
          </button>
        ))}
      </div>
      {loading && <Loading />}
      {error ? <p className="tiny" style={{ color: "var(--red)" }}>{apiErrorMessage(t, error)} <button className="btn btn-s" onClick={retry}>retry</button></p> : null}
      {!loading && !error && claims.length === 0 && (
        <p className="tiny muted">{t("p12d.pharmacy.claimEmpty")}</p>
      )}
      {claims.map((c: CourierClaim) => (
        <div className="card" key={c.id}>
          <div className="rowflex">
            <div>
              <b>{c.courier_name}</b>
              <br />
              <span className="tiny muted">
                {t("p12d.pharmacy.claimAmount")}: NPR {c.amount_npr}
                {c.order_id ? ` · ${c.order_id.slice(0, 8)}` : ""}
              </span>
              <br />
              <span className="tiny">{c.reason}</span>
            </div>
            <span className="spacer" />
            <Chip tone={c.status === "settled" ? "gold" : c.status === "filed" ? undefined : "red"}>
              {t(STATUS_KEY[c.status])}
            </Chip>
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            {c.status === "open" && (
              <button className="btn btn-s" disabled={!!acting} onClick={() => void setStatus(c, "filed")}>
                {t("p12d.pharmacy.claimMarkFiled")}
              </button>
            )}
            {c.status !== "settled" && (
              <button className="btn btn-s" disabled={!!acting} onClick={() => void setStatus(c, "settled")}>
                {t("p12d.pharmacy.claimMarkSettled")}
              </button>
            )}
            {c.status !== "open" && (
              <button className="btn btn-s" disabled={!!acting} onClick={() => void setStatus(c, "open")}>
                {t("p12d.pharmacy.claimMarkOpen")}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** P44 — non-dispatch days. */
function HolidaysTab() {
  const { t } = useLang();
  const { data, error, loading, retry } = useAsync(() => pharmacyB4Api.listHolidays(), []);
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const holidays = data?.holidays ?? [];

  const add = async () => {
    const l = label.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !l || busy) return;
    setBusy(true);
    try {
      await pharmacyB4Api.createHoliday({ date, label: l });
      setDate(""); setLabel("");
      toast(t("p12d.pharmacy.holidaySaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: DispatchHoliday) => {
    if (!window.confirm(t("p12d.pharmacy.holidayDeleteConfirm"))) return;
    try {
      await pharmacyB4Api.deleteHoliday(h.id);
      toast(t("p12d.pharmacy.holidayDeleted"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    }
  };

  return (
    <div>
      <h3 style={{ margin: "12px 0 4px" }}>{t("p12d.pharmacy.holidaysTitle")}</h3>
      <p className="muted tiny">{t("p12d.pharmacy.holidaysSub")}</p>
      <div className="rowflex">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t("p12d.pharmacy.holidayDate")}
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("p12d.pharmacy.holidayLabelPh")}
          aria-label={t("p12d.pharmacy.holidayLabel")}
          maxLength={120}
          style={{ flex: 1, minWidth: 140 }}
        />
        <button className="btn primary btn-s" disabled={busy} onClick={() => void add()}>
          {t("p12d.pharmacy.holidayAdd")}
        </button>
      </div>
      {loading && <Loading />}
      {error ? <p className="tiny" style={{ color: "var(--red)" }}>{apiErrorMessage(t, error)} <button className="btn btn-s" onClick={retry}>retry</button></p> : null}
      {!loading && !error && holidays.length === 0 && (
        <p className="tiny muted">{t("p12d.pharmacy.holidaysEmpty")}</p>
      )}
      {holidays.map((h: DispatchHoliday) => (
        <div className="rowflex card" key={h.id}>
          <b>{h.date}</b>
          <span className="tiny muted">{h.label}</span>
          <span className="spacer" />
          <button className="btn btn-s" onClick={() => void remove(h)}>
            {t("p12d.pharmacy.holidayDelete")}
          </button>
        </div>
      ))}
    </div>
  );
}

/** P37 — monthly fulfilment CSV. */
function ReportsTab() {
  const { t } = useLang();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const dl = async () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || busy) return;
    setBusy(true);
    try {
      await pharmacyB4Api.downloadMonthlyCsv(month);
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <h3 style={{ margin: "12px 0 4px" }}>{t("p12d.pharmacy.reportsTitle")}</h3>
      <p className="muted tiny">{t("p12d.pharmacy.reportsSub")}</p>
      <div className="rowflex">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label={t("p12d.pharmacy.reportsMonth")}
        />
        <button className="btn primary btn-s" disabled={busy} onClick={() => void dl()}>
          {t("p12d.pharmacy.reportsDownload")}
        </button>
      </div>
    </div>
  );
}

/** P29 — advance every visible queue order one step (grouped per target status). */
function BulkAdvance({ orders, onDone }: { orders: Order[]; onDone: () => void }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<OrderStatus, string[]>();
    for (const o of orders) {
      const step = NEXT[o.status];
      if (!step) continue;
      const arr = m.get(step.to) ?? [];
      arr.push(o.id);
      m.set(step.to, arr);
    }
    return [...m.entries()];
  }, [orders]);
  const total = groups.reduce((s, [, ids]) => s + ids.length, 0);
  if (total === 0) return null;
  const run = async () => {
    if (busy || !window.confirm(t("p12d.pharmacy.bulkConfirm", { n: total }))) return;
    setBusy(true);
    try {
      let advanced = 0;
      for (const [status, ids] of groups) {
        const r = await pharmacyB4Api.bulkUpdateStatus(ids, status);
        advanced += r.updated.length;
      }
      toast(t("p12d.pharmacy.bulkDone", { n: advanced }));
      onDone();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="rowflex">
        <div>
          <b>{t("p12d.pharmacy.bulkTitle")}</b>
          <br />
          <span className="tiny muted">{t("p12d.pharmacy.bulkHint")}</span>
        </div>
        <span className="spacer" />
        <button className="btn primary btn-s" disabled={busy} onClick={() => void run()}>
          {t("p12d.pharmacy.bulkBtn")} ({total})
        </button>
      </div>
    </div>
  );
}

/** P42 — server-backed order search (ID fragment, customer name, phone). */
function OrderServerSearch() {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const v = q.trim();
    if (v.length < 2 || busy) return;
    setBusy(true);
    try {
      setResults((await pharmacyB4Api.searchOrders(v)).orders);
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="rowflex">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void go();
          }}
          placeholder={t("p12d.pharmacy.serverSearchPh")}
          aria-label={t("p12d.pharmacy.serverSearchPh")}
          style={{ flex: 1, minWidth: 140 }}
        />
        <button className="btn primary btn-s" disabled={busy || q.trim().length < 2} onClick={() => void go()}>
          {t("p12d.pharmacy.serverSearchBtn")}
        </button>
      </div>
      <p className="muted tiny" style={{ margin: "6px 0 0" }}>{t("p12d.pharmacy.serverSearchHint")}</p>
      {results && (
        <div style={{ marginTop: 8 }}>
          {results.length === 0 && (
            <p className="tiny muted">{t("p12d.pharmacy.serverSearchEmpty")}</p>
          )}
          {results.map((o) => (
            <div className="rowflex" key={o.id} style={{ margin: "6px 0" }}>
              <div>
                <b className="kbd">{o.id.slice(0, 8)}</b>
                <br />
                <span className="tiny muted">
                  {o.shipping_address?.name} · {o.shipping_address?.phone} · NPR {o.total_npr}
                </span>
              </div>
              <span className="spacer" />
              <span className="chip">{o.status}</span>
              {o.shipping_address?.phone && (
                <a className="btn btn-s" href={`tel:${o.shipping_address.phone}`}>
                  <Icon.phone size={14} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** P33 — physical stock count (variance = counted − system). */
function StockCountPanel() {
  const { t } = useLang();
  const [kits, setKits] = useState<Array<{ id: string; name: string; stock?: number }>>([]);
  const [kitId, setKitId] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: counts, retry } = useAsync(
    () => (kitId ? pharmacyB4Api.listStockCounts(kitId).then((r) => r.counts) : Promise.resolve([])),
    [kitId],
  );

  const refreshKits = () => {
    shopApi
      .listPharmacyKits()
      .then((r) => setKits(r.kits.map((k) => ({ id: k.id, name: k.name, stock: k.stock }))))
      .catch(() => {});
  };
  useEffect(refreshKits, []);
  const kit = kits.find((k) => k.id === kitId);

  const save = async () => {
    const n = Number(qty);
    if (!kitId || !Number.isInteger(n) || n < 0 || busy) return;
    setBusy(true);
    try {
      const r = await pharmacyB4Api.countStock(kitId, n);
      toast(t("p12d.pharmacy.countSaved", { n: r.count.variance }));
      setQty("");
      refreshKits();
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>{t("p12d.pharmacy.countTitle")}</h3>
      <p className="muted tiny">{t("p12d.pharmacy.countSub")}</p>
      <div className="rowflex">
        <select
          value={kitId}
          onChange={(e) => setKitId(e.target.value)}
          aria-label={t("p12d.pharmacy.countKit")}
          style={{ flex: 1, minWidth: 140 }}
        >
          <option value="">—</option>
          {kits.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name} ({k.stock ?? 0})
            </option>
          ))}
        </select>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="numeric"
          placeholder={t("p12d.pharmacy.countCountedQty")}
          aria-label={t("p12d.pharmacy.countCountedQty")}
          style={{ width: 110 }}
        />
        <button className="btn primary btn-s" disabled={busy} onClick={() => void save()}>
          {t("p12d.pharmacy.countBtn")}
        </button>
      </div>
      {kit && (
        <p className="tiny muted">
          {t("p12d.pharmacy.variance")}: {kit.stock ?? 0} (system)
        </p>
      )}
      {(counts?.length ?? 0) > 0 && (
        <>
          <h4 style={{ margin: "10px 0 4px" }}>{t("p12d.pharmacy.countHistory")}</h4>
          {counts!.map((c) => (
            <p key={c.id} className="tiny" style={{ margin: "4px 0" }}>
              <span className="muted">{c.created_at.slice(0, 16).replace("T", " ")}</span>{" "}
              {c.counted_qty} ({t("p12d.pharmacy.variance")}:{" "}
              <b style={{ color: c.variance < 0 ? "var(--red)" : undefined }}>
                {c.variance > 0 ? `+${c.variance}` : c.variance}
              </b>)
            </p>
          ))}
        </>
      )}
    </div>
  );
}

/** P41 — kits auto-hidden because stock hit 0 (P33 auto-hide indicator). */
function AutoHideIndicator() {
  const { t } = useLang();
  const { data } = useAsync(() => shopApi.listPharmacyKits(), []);
  const hidden = (data?.kits ?? []).filter((k) => (k.stock ?? 0) === 0 && !k.is_active);
  if (hidden.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>{t("p12d.pharmacy.autoHidden")}</h3>
      <p className="muted tiny">{t("p12d.pharmacy.autoHiddenMsg")}</p>
      {hidden.map((k) => (
        <div className="rowflex" key={k.id} style={{ margin: "8px 0" }}>
          <b>{k.name}</b>
          <span className="spacer" />
          <Chip tone="red">{t("p12d.pharmacy.autoHidden")}</Chip>
        </div>
      ))}
    </div>
  );
}

/** P31 — delivery attempts. */
function OrderAttempts({ order }: { order: Order }) {
  const { t } = useLang();
  const { data, retry } = useAsync(
    () => pharmacyB4Api.listAttempts(order.id).then((r) => r.attempts),
    [order.id],
  );
  const [status, setStatus] = useState<AttemptStatus>("failed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const STATUS_KEY: Record<AttemptStatus, string> = {
    failed: "p12d.pharmacy.attemptFailed",
    rescheduled: "p12d.pharmacy.attemptRescheduled",
    delivered: "p12d.pharmacy.attemptDelivered",
  };
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await pharmacyB4Api.createAttempt(order.id, { status, note: note.trim() || undefined });
      setNote("");
      toast(t("p12d.pharmacy.attemptSaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  const attempts = data ?? [];
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12d.pharmacy.attemptsTitle")}</h4>
      {attempts.length === 0 && <p className="tiny muted">{t("p12d.pharmacy.attemptsEmpty")}</p>}
      {attempts.map((a) => (
        <p key={a.id} className="tiny" style={{ margin: "6px 0" }}>
          <span className="chip">{t(STATUS_KEY[a.status])}</span>{" "}
          <span className="muted">{a.created_at.slice(0, 16).replace("T", " ")}</span>
          {a.note ? <><br />{a.note}</> : null}
        </p>
      ))}
      <div className="rowflex" style={{ marginTop: 8 }}>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AttemptStatus)}
          aria-label={t("p12d.pharmacy.attemptsTitle")}
        >
          {(Object.keys(STATUS_KEY) as AttemptStatus[]).map((s) => (
            <option key={s} value={s}>{t(STATUS_KEY[s])}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("p12d.pharmacy.attemptNotePh")}
          maxLength={500}
          style={{ flex: 1, minWidth: 120 }}
        />
        <button className="btn btn-s" disabled={busy} onClick={() => void add()}>
          {t("p12d.pharmacy.attemptAdd")}
        </button>
      </div>
    </div>
  );
}

/** P38 — kit substitutions. */
function OrderSubstitutions({ order }: { order: Order }) {
  const { t } = useLang();
  const { data, retry } = useAsync(
    () => pharmacyB4Api.listSubstitutions(order.id).then((r) => r.substitutions),
    [order.id],
  );
  const [kits, setKits] = useState<Array<{ id: string; name: string }>>([]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    shopApi
      .listPharmacyKits()
      .then((r) => setKits(r.kits.map((k) => ({ id: k.id, name: k.name }))))
      .catch(() => {});
  }, []);
  const kitName = (id: string | null) => (id ? kits.find((k) => k.id === id)?.name ?? id.slice(0, 8) : "—");
  const add = async () => {
    const r = reason.trim();
    if (!r || busy) return;
    setBusy(true);
    try {
      await pharmacyB4Api.createSubstitution(order.id, {
        from_kit_id: fromId || null,
        to_kit_id: toId || null,
        reason: r,
      });
      setFromId(""); setToId(""); setReason("");
      toast(t("p12d.pharmacy.substSaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  const subs = data ?? [];
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12d.pharmacy.substTitle")}</h4>
      {subs.length === 0 && <p className="tiny muted">{t("p12d.pharmacy.substEmpty")}</p>}
      {subs.map((s: Substitution) => (
        <p key={s.id} className="tiny" style={{ margin: "6px 0" }}>
          <b>{kitName(s.from_kit_id)} → {kitName(s.to_kit_id)}</b>{" "}
          <span className="muted">{s.created_at.slice(0, 16).replace("T", " ")}</span>
          <br />
          {s.reason}
        </p>
      ))}
      <div className="rowflex" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <select value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label={t("p12d.pharmacy.countKit")} style={{ flex: "1 1 120px" }}>
          <option value="">—</option>
          {kits.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>
        <select value={toId} onChange={(e) => setToId(e.target.value)} aria-label={t("p12d.pharmacy.countKit")} style={{ flex: "1 1 120px" }}>
          <option value="">—</option>
          {kits.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("p12d.pharmacy.substReasonPh")}
          maxLength={500}
          style={{ flex: "2 1 160px" }}
        />
        <button className="btn btn-s" disabled={busy || !reason.trim()} onClick={() => void add()}>
          {t("p12d.pharmacy.substAdd")}
        </button>
      </div>
    </div>
  );
}

/** P39 — delivery photo proof. */
function OrderProofs({ order }: { order: Order }) {
  const { t } = useLang();
  const { data, retry } = useAsync(
    () => pharmacyB4Api.listProofs(order.id).then((r) => r.proofs),
    [order.id],
  );
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      await pharmacyB4Api.uploadProof(order.id, file, note.trim() || undefined);
      setFile(null);
      setNote("");
      toast(t("p12d.pharmacy.proofSaved"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  const proofs = data ?? [];
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12d.pharmacy.proofTitle")}</h4>
      {proofs.length === 0 && <p className="tiny muted">{t("p12d.pharmacy.proofEmpty")}</p>}
      {proofs.length > 0 && (
        <div className="rowflex" style={{ flexWrap: "wrap" }}>
          {proofs.map((p: DeliveryProof) =>
            p.url ? (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.url}
                  alt={t("p12d.pharmacy.proofTitle")}
                  style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8 }}
                />
              </a>
            ) : null,
          )}
        </div>
      )}
      <div className="rowflex" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label={t("p12d.pharmacy.proofUpload")}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("p12d.pharmacy.proofNotePh")}
          maxLength={500}
          style={{ flex: "1 1 140px" }}
        />
        <button className="btn btn-s" disabled={busy || !file} onClick={() => void upload()}>
          {t("p12d.pharmacy.proofUpload")}
        </button>
      </div>
    </div>
  );
}

/** P43 — flag the order for admin refund approval. */
function OrderRefundRequest({ order }: { order: Order }) {
  const { t } = useLang();
  const { data, retry } = useAsync(
    () =>
      pharmacyB4Api
        .listRefundRequests()
        .then((r) => r.requests.filter((x) => x.order_id === order.id)),
    [order.id],
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const existing = (data ?? [])[0] as RefundRequest | undefined;
  const STATUS_KEY: Record<RefundRequest["status"], string> = {
    pending: "p12d.pharmacy.refundPending",
    approved: "p12d.pharmacy.refundApproved",
    rejected: "p12d.pharmacy.refundRejected",
  };
  const send = async () => {
    const r = reason.trim();
    if (!r || busy) return;
    setBusy(true);
    try {
      await pharmacyB4Api.createRefundRequest(order.id, r);
      setReason("");
      toast(t("p12d.pharmacy.refundSent"));
      retry();
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: "12px 0 6px" }}>{t("p12d.pharmacy.refundTitle")}</h4>
      {existing ? (
        <p className="tiny">
          <span className="chip">{t("p12d.pharmacy.refundStatus", { s: t(STATUS_KEY[existing.status]) })}</span>
          <br />
          <span className="muted">{existing.reason}</span>
        </p>
      ) : (
        <div className="rowflex" style={{ marginTop: 8 }}>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("p12d.pharmacy.refundReasonPh")}
            maxLength={500}
            style={{ flex: 1, minWidth: 120 }}
          />
          <button className="btn btn-s" disabled={busy || !reason.trim()} onClick={() => void send()}>
            {t("p12d.pharmacy.refundBtn")}
          </button>
        </div>
      )}
    </div>
  );
}

/** P28/P30/P31/P34/P35/P38/P39/P43 — per-order Batch-4 tools. */
function OrderB4Tools({ order, onUpdate }: { order: Order; onUpdate: (o: Order) => void }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const phone = order.shipping_address?.phone;

  const toggleRush = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await pharmacyB4Api.setRush(order.id, !order.is_rush);
      onUpdate(r.order);
      toast(t("p12d.pharmacy.rushSet"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const reverify = async () => {
    if (busy || !window.confirm(t("p12d.pharmacy.reverifyHint"))) return;
    setBusy(true);
    try {
      await pharmacyB4Api.reverifyChecks(order.id);
      toast(t("p12d.pharmacy.reverifyDone"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      {order.delivery_instructions && (
        <p className="tiny" style={{ margin: "4px 0" }}>
          <b>{t("p12d.pharmacy.deliveryInstructions")}: </b>
          {order.delivery_instructions}
        </p>
      )}
      <div className="btn-row" style={{ marginTop: 8 }}>
        {phone && (
          <a className="btn btn-s" href={`tel:${phone}`}>
            <Icon.phone size={14} /> {t("p12d.pharmacy.callCustomer")}
          </a>
        )}
        <button
          className="btn btn-s"
          disabled={busy}
          onClick={() => void toggleRush()}
          aria-pressed={!!order.is_rush}
        >
          {order.is_rush ? (
            <>
              <Chip tone="red">{t("p12d.pharmacy.rushTag")}</Chip>{" "}
            </>
          ) : null}
          {order.is_rush ? t("p12d.pharmacy.rushOff") : t("p12d.pharmacy.rushOn")}
        </button>
        <button className="btn btn-s btn-g" disabled={busy} onClick={() => void reverify()}>
          {t("p12d.pharmacy.reverify")}
        </button>
      </div>
      <OrderAttempts order={order} />
      <OrderSubstitutions order={order} />
      <OrderProofs order={order} />
      <OrderRefundRequest order={order} />
    </div>
  );
}

export default function Pharmacy() {
  const { t } = useLang();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "priority" | OrderStatus>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [kitNames, setKitNames] = useState<Record<string, string>>({});
  // Batch-1: Queue | Stock | Insights tabs. Batch-3 adds: Quarantine | Shift |
  // Couriers | Returns | Packaging | COD.
  const [tab, setTab] = useState<
    "queue" | "stock" | "insights" | "quarantine" | "shift" | "couriers" | "returns" | "packaging" | "cod"
    | "manifest" | "expiry" | "claims" | "holidays" | "reports"
  >("queue");

  const onOrderUpdate = (updated: Order) =>
    setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));

  const load = () => {
    setLoading(true);
    shopApi
      .pharmacyOrders()
      .then((r) => {
        setOrders(r.orders);
        setLoading(false);
      })
      .catch((e) => {
        setError(apiErrorMessage(t, e));
        setLoading(false);
      });
  };
  useEffect(load, [t]);

  const advance = async (o: Order) => {
    const step = NEXT[o.status];
    if (!step || updating) return;
    setUpdating(o.id);
    setNotice(null);
    try {
      const updated = await shopApi.updatePharmacyOrder(o.id, step.to);
      setOrders((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
      setNotice(t("pharmacy.updated"));
    } catch (e) {
      setError(apiErrorMessage(t, e));
    } finally {
      setUpdating(null);
    }
  };

  const toggleExpand = async (o: Order) => {
    if (expanded === o.id) {
      setExpanded(null);
      return;
    }
    setExpanded(o.id);
    if (!kitNames[o.kit_id]) {
      try {
        const kit = await shopApi.getKit(o.kit_id);
        setKitNames((prev) => ({ ...prev, [o.kit_id]: kit.name }));
      } catch {
        // Honest fallback: the id is still shown; never invent a name.
      }
    }
  };

  // Queue = orders that still need action; delivered/cancelled/refunded
  // are recent history. Empty states say "nothing yet" — never invented rows.
  // P34: rush orders surface first, then oldest first (server also sorts this way).
  const now = Date.now();
  const actionable = useMemo(
    () =>
      orders
        .filter((o) => ACTIONABLE.includes(o.status))
        .sort((a, b) => (b.is_rush ? 1 : 0) - (a.is_rush ? 1 : 0) || a.created_at.localeCompare(b.created_at)),
    [orders],
  );
  const history = useMemo(
    () =>
      orders
        .filter((o) => ["delivered", "cancelled", "refunded"].includes(o.status))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5),
    [orders],
  );
  const priorityCount = useMemo(
    () => actionable.filter((o) => isPriority(o, now)).length,
    [actionable, now],
  );

  const q = search.trim().toLowerCase();
  const filtered = actionable.filter((o) => {
    if (statusFilter === "priority" && !isPriority(o, now)) return false;
    if (statusFilter !== "all" && statusFilter !== "priority" && o.status !== statusFilter) return false;
    if (!q) return true;
    const hay = `${customerName(o)} ${o.shipping_address?.phone ?? ""} ${o.shipping_address?.city ?? ""} ${o.id} ${o.kit_id}`.toLowerCase();
    return hay.includes(q);
  });

  if (loading) return <Loading />;

  const count = (s: OrderStatus) => orders.filter((o) => o.status === s).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayNew = orders.filter((o) => o.created_at.slice(0, 10) === today).length;
  const deliveredToday = orders.filter(
    (o) => o.status === "delivered" && o.created_at.slice(0, 10) === today,
  ).length;

  const filters: Array<{ key: "all" | "priority" | OrderStatus; label: string }> = [
    { key: "all", label: t("pharmacy.filterAll") },
    { key: "priority", label: t("pharmacy.filterPriority") },
    { key: "pending_payment", label: t("orders.status.pending_payment") },
    { key: "paid", label: t("orders.status.paid") },
    { key: "packed", label: t("orders.status.packed") },
    { key: "shipped", label: t("orders.status.shipped") },
  ];

  return (
    <div className="screen">
      <h1>{t("pharmacy.title")}</h1>
      <p className="muted tiny">{t("pharmacy.sub")}</p>
      <AnnouncementsBanner />
      {error && <ErrorCard message={error} />}
      {notice && (
        <NoticeBox tone="ok" title="">
          <p className="tiny">{notice}</p>
        </NoticeBox>
      )}

      {!error && (
        <div className="statgrid">
          <StatCard label={t("pharmacy.statAwaiting")} value={String(count("paid"))} icon={<Icon.box size={26} />} />
          <StatCard label={t("pharmacy.statInTransit")} value={String(count("shipped"))} icon={<Icon.truck size={26} />} />
          <StatCard label={t("pharmacy.statDeliveredToday")} value={String(deliveredToday)} icon={<Icon.check size={26} />} />
          <StatCard label={t("pharmacy.statToday")} value={String(todayNew)} icon={<Icon.clock size={26} />} />
        </div>
      )}

      {/* Batch-1 tabs: Queue | Stock | Insights; Batch-3 tabs: Quarantine | Shift | Couriers | Returns | Packaging | COD;
          Batch-4 tabs: Manifest | Expiry | Claims | Holidays | Reports */}
      <div className="tabrow" role="tablist" aria-label={t("pharmacy.title")}>
        {(["queue", "stock", "manifest", "expiry", "claims", "holidays", "reports", "insights", "quarantine", "shift", "couriers", "returns", "packaging", "cod"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`tab${tab === k ? " on" : ""}`}
            onClick={() => setTab(k)}
          >
            {k === "queue"
              ? t("pharmacy.queueTitle")
              : k === "stock"
                ? t("p12.pharmacy.adjustStock")
                : k === "manifest"
                  ? t("p12d.pharmacy.tabManifest")
                  : k === "expiry"
                    ? t("p12d.pharmacy.tabExpiry")
                    : k === "claims"
                      ? t("p12d.pharmacy.tabClaims")
                      : k === "holidays"
                        ? t("p12d.pharmacy.tabHolidays")
                        : k === "reports"
                          ? t("p12d.pharmacy.tabReports")
                          : k === "insights"
                            ? t("p12.pharmacy.performance")
                            : k === "quarantine"
                              ? t("p12c.pharmacy.quarantineTitle")
                              : k === "shift"
                                ? t("p12c.pharmacy.shiftTitle")
                                : k === "couriers"
                                  ? t("p12c.pharmacy.courierTitle")
                                  : k === "returns"
                                    ? t("p12c.pharmacy.returnsTitle")
                                    : k === "packaging"
                                      ? t("p12c.pharmacy.packagingTitle")
                                      : t("p12c.pharmacy.codTitle")}
          </button>
        ))}
      </div>

      {tab === "stock" && (<><PharmacyStockTab /><StockThresholdEditor /><StockCountPanel /><AutoHideIndicator /></>)}
      {tab === "manifest" && <ManifestTab />}
      {tab === "expiry" && <ExpiryTab />}
      {tab === "claims" && <ClaimsTab />}
      {tab === "holidays" && <HolidaysTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "insights" && <PharmacyInsightsTab orders={orders} />}
      {tab === "quarantine" && <QuarantineTab />}
      {tab === "shift" && <ShiftTab />}
      {tab === "couriers" && <CouriersTab />}
      {tab === "returns" && <ReturnsTab />}
      {tab === "packaging" && <PackagingTab />}
      {tab === "cod" && <CodTab />}

      {tab === "queue" && (
      <>
      <h3>{t("pharmacy.queueTitle")}</h3>

      {/* Batch-4 P42: server-backed order search; P29: bulk advance of the visible queue */}
      <OrderServerSearch />
      <BulkAdvance orders={filtered} onDone={load} />

      {actionable.length > 0 && (
        <>
          <label className="fl" htmlFor="pharmacy-search">{t("pharmacy.searchLabel")}</label>
          <input
            id="pharmacy-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("pharmacy.searchPh")}
            autoComplete="off"
          />
          <div style={{ margin: "8px 0" }}>
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`chip${statusFilter === f.key ? " gold" : ""}`}
                style={statusFilter === f.key ? { border: "2px solid var(--gold)", padding: "2px 8px" } : undefined}
                onClick={() => setStatusFilter(f.key)}
                aria-pressed={statusFilter === f.key}
              >
                {f.label}
                {f.key === "priority" && priorityCount > 0 ? ` (${priorityCount})` : ""}
              </button>
            ))}
          </div>
        </>
      )}

      {actionable.length === 0 && !error && (
        <EmptyState icon={<Icon.truck size={32} />} title={t("pharmacy.empty")} />
      )}
      {actionable.length > 0 && filtered.length === 0 && (
        <EmptyState icon={<Icon.box size={32} />} title={t("pharmacy.noMatch")} />
      )}

      {filtered.map((o) => {
        const idx = PIPELINE.indexOf(o.status);
        const step = NEXT[o.status];
        const prio = isPriority(o, now);
        const isOpen = expanded === o.id;
        const waitingHours = Math.max(0, Math.floor((now - Date.parse(o.created_at)) / 3_600_000));
        return (
          <div
            className="card"
            key={o.id}
            style={prio ? { border: "2px solid var(--gold)", borderRadius: 12 } : undefined}
          >
            <div className="rowflex">
              <span style={{ color: "var(--green)" }}><Icon.truck size={24} /></span>
              <div>
                <b className="kbd">{o.id}</b>
                <br />
                <span className="tiny muted">
                  {t("pharmacy.customer")}: {o.shipping_address ? `${o.shipping_address.name} • ${o.shipping_address.city}` : "—"}
                  {"  "}• NPR {o.total_npr} ({o.payment_method.toUpperCase()})
                </span>
                <br />
                {prio && (
                  <span className="chip gold">
                    {t("pharmacy.priorityTag")}
                    {waitingHours > 24 ? ` • ${t("pharmacy.waitingHours", { hours: waitingHours })}` : ""}
                  </span>
                )}
                {o.payment_method === "cod" && <span className="chip amber">{t("pharmacy.codTag")}</span>}
                {o.is_rush && <Chip tone="red">{t("p12d.pharmacy.rushTag")}</Chip>}
              </div>
              <span className="spacer" />
              <span className="chip">{t(`orders.status.${o.status}`)}</span>
            </div>
            <div className="stepper" aria-hidden="true" style={{ margin: "10px 0 0" }}>
              {PIPELINE.map((s, i) => (
                <span
                  key={s}
                  className={idx >= 0 && i < idx ? "done" : s === o.status ? "cur" : ""}
                  title={t(`orders.status.${s}`)}
                />
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn btn-g" onClick={() => void toggleExpand(o)} aria-expanded={isOpen}>
                {isOpen ? t("pharmacy.hideDetails") : t("pharmacy.showDetails")}
              </button>
              {step && (
                <button className="btn primary" disabled={updating === o.id} onClick={() => advance(o)}>
                  {updating === o.id ? "…" : t(step.labelKey)}
                </button>
              )}
            </div>
            {isOpen && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <h4 style={{ margin: "0 0 6px" }}>{t("pharmacy.detailItems")}</h4>
                <p className="tiny" style={{ margin: "4px 0" }}>
                  <b>{kitNames[o.kit_id] ?? `${t("pharmacy.kit")} ${o.kit_id.slice(0, 8)}`}</b>
                  <br />
                  <span className="muted">
                    {t("pharmacy.subtotal")}: NPR {o.subtotal_npr} · {t("pharmacy.shipping")}: NPR {o.shipping_npr} ·{" "}
                    <b>{t("pharmacy.total")}: NPR {o.total_npr}</b>
                  </span>
                </p>
                <h4 style={{ margin: "12px 0 6px" }}>{t("pharmacy.detailAddress")}</h4>
                {o.shipping_address ? (
                  <p className="tiny" style={{ margin: "4px 0" }}>
                    {o.shipping_address.name}
                    <br />
                    <span className="muted">
                      {o.shipping_address.address_line}, {o.shipping_address.city}
                      <br />
                      {t("pharmacy.phone")}: {o.shipping_address.phone}
                    </span>
                  </p>
                ) : (
                  <p className="tiny muted">—</p>
                )}
                <h4 style={{ margin: "12px 0 6px" }}>{t("pharmacy.detailPayment")}</h4>
                <p className="tiny" style={{ margin: "4px 0" }}>
                  <span className="chip">{o.payment_method.toUpperCase()}</span>
                  <br />
                  <span className="muted">
                    {o.payment_method === "cod" ? t("pharmacy.codNote") : t(`orders.status.${o.status}`)}
                  </span>
                </p>
                <h4 style={{ margin: "12px 0 6px" }}>{t("pharmacy.detailTimeline")}</h4>
                <p className="tiny muted" style={{ margin: "4px 0" }}>
                  {t("pharmacy.placedOn")}: {o.created_at.slice(0, 16).replace("T", " ")}
                </p>
                {/* Batch-1 P4–P8: courier, address checklist, returns, damage, handover */}
                <OrderBatchTools order={o} onUpdate={onOrderUpdate} />
                {/* Batch-3 P23: pick/pack timer; P27: internal notes */}
                <OrderPackTimer order={o as PackableOrder} onUpdate={onOrderUpdate} />
                <OrderInternalNotes order={o} />
                {/* Batch-4 P28–P43: re-verify, attempts, substitutions, proof, refund, rush, tel: shortcut */}
                <OrderB4Tools order={o} onUpdate={onOrderUpdate} />
              </div>
            )}
          </div>
        );
      })}

      {history.length > 0 && (
        <>
          <h3>{t("pharmacy.historyTitle")}</h3>
          {history.map((o) => (
            <div className="card" key={o.id}>
              <div className="rowflex">
                <div>
                  <b className="kbd">{o.id.slice(0, 8)}</b>
                  <br />
                  <span className="tiny muted">
                    {o.created_at.slice(0, 10)} · {o.payment_method.toUpperCase()} · NPR {o.total_npr}
                  </span>
                </div>
                <span className="spacer" />
                <span className="chip">{t(`orders.status.${o.status}`)}</span>
              </div>
            </div>
          ))}
        </>
      )}
      </>
      )}
    </div>
  );
}
