import { useEffect, useMemo, useState } from "react";
import { shopApi } from "../api/client";
import { useLang } from "../i18n/LanguageContext";
import { EmptyState, ErrorCard, Loading, NoticeBox, StatCard, apiErrorMessage } from "../components/ui";
import { Icon } from "../components/icons";
import type { Order, OrderStatus } from "../api/types";

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

/**
 * Fulfilment queue for the pharmacy / fulfilment role.
 * Cosmetic kit orders only — prescription commerce stays hidden while the
 * prescription_commerce flag is OFF (enforced server-side).
 */
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
  const now = Date.now();
  const actionable = useMemo(() => orders.filter((o) => ACTIONABLE.includes(o.status)), [orders]);
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

      <h3>{t("pharmacy.queueTitle")}</h3>

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
    </div>
  );
}
