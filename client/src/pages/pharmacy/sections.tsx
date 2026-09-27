// Jaraa v14 — Problem 2: pharmacy tool-area section pages.
//
// Each of the 14 pharmacy dashboard tools becomes a full sidebar-linked page:
// a thin wrapper that renders the section title + description and the existing
// Pharmacy page deep-linked to the matching tab via `initialTab`.
// Every page carries exactly one enhancement over its current tab state
// (CSV export, alert banner, bulk download, or copy-summary) — all client-side,
// backed by the existing pharmacy APIs, and styled with theme vars only.
// Widgets that find no data render nothing: empty states stay honest, never
// invented rows.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Pharmacy, { type PharmacyTabKey } from "../Pharmacy";
import { shopApi } from "../../api/client";
import { pharmacyB3Api } from "../../api/b3pharmacy";
import { pharmacyB4Api } from "../../api/b4pharmacy";
import { useLang } from "../../i18n/LanguageContext";
import { NoticeBox, apiErrorMessage, toast } from "../../components/ui";
import type { OrderStatus } from "../../api/types";

/* ---------------- shared helpers ---------------- */

type CsvCell = string | number | null | undefined;

function downloadCsv(filename: string, rows: CsvCell[][]) {
  const esc = (v: CsvCell) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ACTIONABLE: OrderStatus[] = ["pending_payment", "paid", "packed", "shipped"];

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Page shell: section title + description + optional enhancement + the tab. */
function SectionPage({
  tab,
  titleKey,
  subKey,
  enhance,
}: {
  tab: PharmacyTabKey;
  titleKey: string;
  subKey: string;
  enhance?: ReactNode;
}) {
  const { t } = useLang();
  return (
    <div className="screen">
      <h1>{t(titleKey)}</h1>
      <p className="muted tiny">{t(subKey)}</p>
      {enhance}
      <Pharmacy initialTab={tab} />
    </div>
  );
}

/* ---------------- Queue ---------------- */

/** Enhancement: export the actionable queue as CSV (id, date, customer, totals). */
function QueueCsvExport() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { orders } = await shopApi.pharmacyOrders();
      const open = orders.filter((o) => ACTIONABLE.includes(o.status));
      downloadCsv(`jaraa-queue-${todayStr()}.csv`, [
        ["order_id", "date", "customer", "phone", "city", "total_npr", "payment", "status"],
        ...open.map((o) => [
          o.id,
          o.created_at.slice(0, 10),
          o.shipping_address?.name ?? "",
          o.shipping_address?.phone ?? "",
          o.shipping_address?.city ?? "",
          o.total_npr,
          o.payment_method,
          o.status,
        ] as CsvCell[]),
      ]);
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12.admin.exportCsv")} — {t("pharmacy.queueTitle")}
      </button>
    </div>
  );
}

export function PharmacyQueuePage() {
  return (
    <SectionPage
      tab="queue"
      titleKey="pharmacy.queueTitle"
      subKey="pharmacy.sub"
      enhance={<QueueCsvExport />}
    />
  );
}

/* ---------------- Stock ---------------- */

/** Enhancement: low-stock alert banner (kits at/below their threshold). */
function LowStockBanner() {
  const { t } = useLang();
  const [low, setLow] = useState<Array<{ name: string; stock: number }> | null>(null);
  useEffect(() => {
    shopApi
      .listPharmacyKits()
      .then((r) => {
        const kits = r.kits as Array<{
          id: string;
          name: string;
          stock?: number;
          low_stock_threshold?: number | null;
        }>;
        setLow(
          kits
            .filter((k) => (k.stock ?? 0) <= (k.low_stock_threshold ?? 5))
            .map((k) => ({ name: k.name, stock: k.stock ?? 0 })),
        );
      })
      .catch(() => setLow(null));
  }, []);
  if (!low || low.length === 0) return null;
  return (
    <NoticeBox tone="flag" title={t("p12.pharmacy.lowStock")}>
      <p className="tiny">{low.map((k) => `${k.name} (${k.stock})`).join(" · ")}</p>
    </NoticeBox>
  );
}

export function PharmacyStockPage() {
  return (
    <SectionPage
      tab="stock"
      titleKey="p12.pharmacy.adjustStock"
      subKey="p12.pharmacy.lowStock"
      enhance={<LowStockBanner />}
    />
  );
}

/* ---------------- Manifest ---------------- */

/** Enhancement: download today's manifest as CSV (the tab only offers print). */
function ManifestCsvExport() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const m = await pharmacyB4Api.getManifest(undefined, todayStr());
      downloadCsv(`jaraa-manifest-${m.date}.csv`, [
        ["order_id", "customer", "city", "phone", "total_npr", "status"],
        ...m.orders.map((o) => [
          o.id,
          o.shipping_address?.name ?? "",
          o.shipping_address?.city ?? "",
          o.shipping_address?.phone ?? "",
          o.total_npr,
          o.status,
        ] as CsvCell[]),
      ]);
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12.admin.exportCsv")} — {t("p12d.pharmacy.tabManifest")}
      </button>
    </div>
  );
}

export function PharmacyManifestPage() {
  return (
    <SectionPage
      tab="manifest"
      titleKey="p12d.pharmacy.tabManifest"
      subKey="p12d.pharmacy.manifestSub"
      enhance={<ManifestCsvExport />}
    />
  );
}

/* ---------------- Expiry ---------------- */

/** Enhancement: urgency banner for batches expiring within 7 days (nearest first). */
function ExpiryAlertBanner() {
  const { t } = useLang();
  const [info, setInfo] = useState<{ count: number; soonest: number | null } | null>(null);
  useEffect(() => {
    pharmacyB4Api
      .getExpiringBatches(7)
      .then((r) => {
        const days = r.batches
          .map((b) => b.days_left)
          .filter((d): d is number => d !== null && d >= 0);
        setInfo({ count: r.batches.length, soonest: days.length ? Math.min(...days) : null });
      })
      .catch(() => setInfo(null));
  }, []);
  if (!info || info.count === 0) return null;
  return (
    <NoticeBox tone="flag" title={t("p12d.pharmacy.expiryTitle")}>
      <p className="tiny">
        {info.count} ·{" "}
        {info.soonest !== null
          ? t("p12d.pharmacy.expiresIn", { n: info.soonest })
          : t("p12d.pharmacy.expirySub")}
      </p>
    </NoticeBox>
  );
}

export function PharmacyExpiryPage() {
  return (
    <SectionPage
      tab="expiry"
      titleKey="p12d.pharmacy.tabExpiry"
      subKey="p12d.pharmacy.expirySub"
      enhance={<ExpiryAlertBanner />}
    />
  );
}

/* ---------------- Claims ---------------- */

/** Enhancement: export all courier claims as CSV. */
function ClaimsCsvExport() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { claims } = await pharmacyB4Api.listCourierClaims();
      downloadCsv(`jaraa-claims-${todayStr()}.csv`, [
        ["claim_id", "date", "courier", "order", "amount_npr", "reason", "status"],
        ...claims.map((c) => [
          c.id,
          c.created_at.slice(0, 10),
          c.courier_name,
          c.order_id ?? "",
          c.amount_npr,
          c.reason,
          c.status,
        ] as CsvCell[]),
      ]);
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12.admin.exportCsv")} — {t("p12d.pharmacy.tabClaims")}
      </button>
    </div>
  );
}

export function PharmacyClaimsPage() {
  return (
    <SectionPage
      tab="claims"
      titleKey="p12d.pharmacy.tabClaims"
      subKey="p12d.pharmacy.claimsSub"
      enhance={<ClaimsCsvExport />}
    />
  );
}

/* ---------------- Holidays ---------------- */

/** Enhancement: banner with the next non-dispatch day (if any upcoming). */
function NextHolidayBanner() {
  const { t } = useLang();
  const [next, setNext] = useState<{ date: string; label: string } | null>(null);
  useEffect(() => {
    pharmacyB4Api
      .listHolidays()
      .then((r) => {
        const today = todayStr();
        const upcoming = r.holidays
          .filter((h) => h.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        setNext(upcoming ? { date: upcoming.date, label: upcoming.label } : null);
      })
      .catch(() => setNext(null));
  }, []);
  if (!next) return null;
  return (
    <NoticeBox tone="notice" title={t("p12d.pharmacy.holidaysTitle")}>
      <p className="tiny">
        {next.date} · {next.label}
      </p>
    </NoticeBox>
  );
}

export function PharmacyHolidaysPage() {
  return (
    <SectionPage
      tab="holidays"
      titleKey="p12d.pharmacy.tabHolidays"
      subKey="p12d.pharmacy.holidaysSub"
      enhance={<NextHolidayBanner />}
    />
  );
}

/* ---------------- Reports ---------------- */

/** Enhancement: bulk-download the last 3 monthly fulfilment CSVs in one tap. */
function ReportsBulkDownload() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        // eslint-disable-next-line no-await-in-loop
        await pharmacyB4Api.downloadMonthlyCsv(month);
      }
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12d.pharmacy.reportsDownload")} × 3
      </button>
    </div>
  );
}

export function PharmacyReportsPage() {
  return (
    <SectionPage
      tab="reports"
      titleKey="p12d.pharmacy.tabReports"
      subKey="p12d.pharmacy.reportsSub"
      enhance={<ReportsBulkDownload />}
    />
  );
}

/* ---------------- Fulfilment performance (insights) ---------------- */

/** Enhancement: copy today's dispatch summary to the clipboard (share with staff). */
function PerformanceSummaryCopy() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { orders } = await shopApi.pharmacyOrders();
      const today = todayStr();
      const todays = orders.filter((o) => o.created_at.slice(0, 10) === today);
      const delivered = todays.filter((o) => o.status === "delivered").length;
      const open = todays.filter((o) => ACTIONABLE.includes(o.status)).length;
      const text =
        `${t("p12.pharmacy.dispatch")} ${today}: ` +
        `${t("p12.pharmacy.delivered")} ${delivered}, ` +
        `${t("p12c.pharmacy.pending")} ${open}`;
      try {
        await navigator.clipboard.writeText(text);
        toast(t("coachDash.copied"));
      } catch {
        toast(t("coachDash.copyFailed"));
      }
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("coachDash.copy")} — {t("p12.pharmacy.dispatch")}
      </button>
    </div>
  );
}

export function PharmacyPerformancePage() {
  return (
    <SectionPage
      tab="insights"
      titleKey="p12.pharmacy.performance"
      subKey="p12.pharmacy.dispatch"
      enhance={<PerformanceSummaryCopy />}
    />
  );
}

/* ---------------- Quarantine ---------------- */

/** Enhancement: export the full quarantine list as CSV. */
function QuarantineCsvExport() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { entries } = await pharmacyB3Api.listQuarantine();
      downloadCsv(`jaraa-quarantine-${todayStr()}.csv`, [
        ["entry_id", "date", "kit_id", "qty", "reason", "status"],
        ...entries.map((e) => [
          e.id,
          e.created_at.slice(0, 10),
          e.kit_id,
          e.qty,
          e.reason ?? "",
          e.status,
        ] as CsvCell[]),
      ]);
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12.admin.exportCsv")} — {t("p12c.pharmacy.quarantineTitle")}
      </button>
    </div>
  );
}

export function PharmacyQuarantinePage() {
  return (
    <SectionPage
      tab="quarantine"
      titleKey="p12c.pharmacy.quarantineTitle"
      subKey="p12c.pharmacy.quarantineSub"
      enhance={<QuarantineCsvExport />}
    />
  );
}

/* ---------------- Shift summary ---------------- */

/** Enhancement: copy today's shift summary to the clipboard for handover. */
function ShiftSummaryCopy() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await pharmacyB3Api.getShiftSummary(todayStr());
      const text =
        `${t("p12c.pharmacy.shiftTitle")} ${s.date}: ` +
        `${t("p12c.pharmacy.handled")} ${s.handled}, ` +
        `${t("p12c.pharmacy.pending")} ${s.pending}, ` +
        `${t("p12c.pharmacy.codOrders")} ${s.cod_orders}`;
      try {
        await navigator.clipboard.writeText(text);
        toast(t("coachDash.copied"));
      } catch {
        toast(t("coachDash.copyFailed"));
      }
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("coachDash.copy")} — {t("p12c.pharmacy.shiftTitle")}
      </button>
    </div>
  );
}

export function PharmacyShiftPage() {
  return (
    <SectionPage
      tab="shift"
      titleKey="p12c.pharmacy.shiftTitle"
      subKey="p12c.pharmacy.shiftSub"
      enhance={<ShiftSummaryCopy />}
    />
  );
}

/* ---------------- Couriers ---------------- */

/** Enhancement: export courier performance as CSV. */
function CouriersCsvExport() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { couriers } = await pharmacyB3Api.getCourierPerformance();
      downloadCsv(`jaraa-couriers-${todayStr()}.csv`, [
        ["courier", "orders", "delivered", "delivery_rate_pct"],
        ...couriers.map((c) => [
          c.courier,
          c.orders,
          c.delivered,
          c.orders > 0 ? Math.round((c.delivered / c.orders) * 100) : 0,
        ] as CsvCell[]),
      ]);
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12.admin.exportCsv")} — {t("p12c.pharmacy.courierTitle")}
      </button>
    </div>
  );
}

export function PharmacyCouriersPage() {
  return (
    <SectionPage
      tab="couriers"
      titleKey="p12c.pharmacy.courierTitle"
      subKey="p12c.pharmacy.courierSub"
      enhance={<CouriersCsvExport />}
    />
  );
}

/* ---------------- Returns ---------------- */

/** Enhancement: export return-rate analytics as CSV (reasons flattened). */
function ReturnsCsvExport() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { kits } = await pharmacyB3Api.getReturnAnalytics();
      downloadCsv(`jaraa-returns-${todayStr()}.csv`, [
        ["kit_id", "kit_name", "returns", "reasons"],
        ...kits.map((k) => [
          k.kit_id,
          k.kit_name,
          k.returns,
          Object.entries(k.reasons ?? {})
            .map(([r, n]) => `${r}: ${n}`)
            .join("; "),
        ] as CsvCell[]),
      ]);
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12.admin.exportCsv")} — {t("p12c.pharmacy.returnsTitle")}
      </button>
    </div>
  );
}

export function PharmacyReturnsPage() {
  return (
    <SectionPage
      tab="returns"
      titleKey="p12c.pharmacy.returnsTitle"
      subKey="p12c.pharmacy.returnsSub"
      enhance={<ReturnsCsvExport />}
    />
  );
}

/* ---------------- Packaging ---------------- */

/** Enhancement: low-packaging-material alert banner (at/below threshold). */
function PackagingLowBanner() {
  const { t } = useLang();
  const [low, setLow] = useState<Array<{ name: string; qty: number }> | null>(null);
  useEffect(() => {
    pharmacyB3Api
      .listPackaging()
      .then((r) =>
        setLow(
          r.materials
            .filter((m) => m.qty <= m.low_threshold)
            .map((m) => ({ name: m.name, qty: m.qty })),
        ),
      )
      .catch(() => setLow(null));
  }, []);
  if (!low || low.length === 0) return null;
  return (
    <NoticeBox tone="flag" title={t("p12c.pharmacy.packagingTitle")}>
      <p className="tiny">{low.map((m) => `${m.name} (${m.qty})`).join(" · ")}</p>
    </NoticeBox>
  );
}

export function PharmacyPackagingPage() {
  return (
    <SectionPage
      tab="packaging"
      titleKey="p12c.pharmacy.packagingTitle"
      subKey="p12c.pharmacy.packagingSub"
      enhance={<PackagingLowBanner />}
    />
  );
}

/* ---------------- COD reconciliation ---------------- */

/** Enhancement: export today's COD reconciliation (per-order chips) as CSV. */
function CodCsvExport() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await pharmacyB3Api.getCodReconciliation(todayStr());
      downloadCsv(`jaraa-cod-${r.date}.csv`, [
        ["order_id", "order_no", "total_npr", "status", "collected"],
        ...r.orders.map((o) => [
          o.id,
          o.order_no,
          o.total_npr,
          o.status,
          o.collected ? "yes" : "no",
        ] as CsvCell[]),
      ]);
      toast(t("p12d.doctor.exportOk"));
    } catch (e) {
      toast(apiErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rowflex" style={{ margin: "8px 0" }}>
      <button className="btn btn-s" disabled={busy} onClick={() => void go()}>
        {t("p12.admin.exportCsv")} — {t("p12c.pharmacy.codTitle")}
      </button>
    </div>
  );
}

export function PharmacyCodPage() {
  return (
    <SectionPage
      tab="cod"
      titleKey="p12c.pharmacy.codTitle"
      subKey="p12c.pharmacy.codSub"
      enhance={<CodCsvExport />}
    />
  );
}
