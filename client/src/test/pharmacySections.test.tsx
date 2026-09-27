// v14 Problem 2: pharmacy tool-area section pages.
// Each section renders div.screen > h1 + description + <Pharmacy initialTab> with
// the matching tab selected, and carries its enhancement widget.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageProvider } from "../i18n/LanguageContext";
import Pharmacy from "../pages/Pharmacy";
import {
  PharmacyQueuePage,
  PharmacyStockPage,
  PharmacyManifestPage,
  PharmacyExpiryPage,
  PharmacyClaimsPage,
  PharmacyHolidaysPage,
  PharmacyReportsPage,
  PharmacyPerformancePage,
  PharmacyQuarantinePage,
  PharmacyShiftPage,
  PharmacyCouriersPage,
  PharmacyReturnsPage,
  PharmacyPackagingPage,
  PharmacyCodPage,
} from "../pages/pharmacy/sections";

/* ---------- fetch stub: every pharmacy endpoint the pages touch on mount ---------- */

const payloads: Record<string, unknown> = {
  "/pharmacy/announcements": { announcements: [] },
  "/pharmacy/orders": { orders: [] },
  "/pharmacy/kits": { kits: [] },
  "/pharmacy/batches/expiring": { batches: [] },
  "/pharmacy/courier-claims": { claims: [] },
  "/pharmacy/holidays": { holidays: [] },
  "/pharmacy/shift-summary": {
    date: "2026-09-27",
    handled: 5,
    pending: 2,
    cod_orders: 1,
    handover_notes: [],
  },
  "/pharmacy/couriers/performance": { couriers: [] },
  "/pharmacy/returns/analytics": { kits: [] },
  "/pharmacy/packaging": { materials: [] },
  "/pharmacy/cod-reconciliation": {
    date: "2026-09-27",
    expected_npr: 5000,
    collected_npr: 2000,
    orders: [],
  },
  "/pharmacy/quarantine": { entries: [] },
};

const fetchCalls: string[] = [];

function stubFetch() {
  fetchCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      fetchCalls.push(url);
      // Longest-prefix match so /pharmacy/kits/counts etc. don't collide.
      const key = Object.keys(payloads)
        .filter((k) => url.includes(k))
        .sort((a, b) => b.length - a.length)[0];
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(key ? payloads[key] : {}),
        blob: async () => new Blob(["a,b\n1,2"], { type: "text/csv" }),
      };
    }),
  );
}

function renderPage(el: React.ReactElement) {
  return render(<LanguageProvider>{el}</LanguageProvider>);
}

beforeEach(() => {
  localStorage.setItem("jaraa:lang", "en");
  stubFetch();
  // jsdom has no blob-URL support; stub it for the CSV export buttons.
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => "blob:mock");
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("jaraa:lang");
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

/* ---------- the 14 section pages ---------- */

const CASES: Array<{
  name: string;
  el: React.ReactElement;
  tabName: string; // selected tab label
  h1: string; // section h1 (direct child of .screen)
  desc: string; // distinctive description fragment
}> = [
  { name: "queue", el: <PharmacyQueuePage />, tabName: "Queue", h1: "Queue", desc: "Pack and ship kit orders" },
  { name: "stock", el: <PharmacyStockPage />, tabName: "Adjust stock", h1: "Adjust stock", desc: "Low stock alerts" },
  { name: "manifest", el: <PharmacyManifestPage />, tabName: "Manifest", h1: "Manifest", desc: "per courier" },
  { name: "expiry", el: <PharmacyExpiryPage />, tabName: "Expiry", h1: "Expiry", desc: "expiring soon" },
  { name: "claims", el: <PharmacyClaimsPage />, tabName: "Claims", h1: "Claims", desc: "couriers" },
  { name: "holidays", el: <PharmacyHolidaysPage />, tabName: "Holidays", h1: "Holidays", desc: "nothing is dispatched" },
  { name: "reports", el: <PharmacyReportsPage />, tabName: "Reports", h1: "Reports", desc: "Fulfilment CSV" },
  { name: "performance", el: <PharmacyPerformancePage />, tabName: "Fulfilment performance", h1: "Fulfilment performance", desc: "Today's dispatch" },
  { name: "quarantine", el: <PharmacyQuarantinePage />, tabName: "Damaged stock quarantine", h1: "Damaged stock quarantine", desc: "Hold damaged units" },
  { name: "shift", el: <PharmacyShiftPage />, tabName: "Shift summary", h1: "Shift summary", desc: "handled and still pending" },
  { name: "couriers", el: <PharmacyCouriersPage />, tabName: "Courier performance", h1: "Courier performance", desc: "per courier" },
  { name: "returns", el: <PharmacyReturnsPage />, tabName: "Return-rate analytics", h1: "Return-rate analytics", desc: "by kit and reason" },
  { name: "packaging", el: <PharmacyPackagingPage />, tabName: "Packaging materials", h1: "Packaging materials", desc: "boxes, wraps and fillers" },
  { name: "cod", el: <PharmacyCodPage />, tabName: "COD reconciliation", h1: "COD reconciliation", desc: "Expected cash vs collected" },
];

describe("pharmacy section pages — deep-link to the right tab", () => {
  for (const c of CASES) {
    it(`${c.name}: h1 + description + selected tab`, async () => {
      const { container } = renderPage(c.el);
      // The section's own h1 is a direct child of the outer .screen wrapper.
      const h1 = container.querySelector(".screen > h1");
      expect(h1?.textContent).toBe(c.h1);
      const desc = container.querySelector(".screen > p.muted.tiny");
      expect(desc?.textContent).toContain(c.desc);
      // The deep-linked tab is the selected one in the tablist.
      const tab = await screen.findByRole("tab", { name: c.tabName, selected: true });
      expect(tab).toBeTruthy();
      // The tab's content renders (each tab renders its own h3/h4 region).
      expect(container.querySelector(".tabrow")).toBeTruthy();
    });
  }
});

/* ---------- initialTab prop behaviour ---------- */

describe("Pharmacy initialTab prop", () => {
  it("defaults to the queue tab", async () => {
    renderPage(<Pharmacy />);
    const tab = await screen.findByRole("tab", { name: "Queue", selected: true });
    expect(tab).toBeTruthy();
  });

  it("deep-links to a non-default tab (cod)", async () => {
    renderPage(<Pharmacy initialTab="cod" />);
    const tab = await screen.findByRole("tab", { name: "COD reconciliation", selected: true });
    expect(tab).toBeTruthy();
    // COD content renders: expected/collected stat cards.
    await screen.findByText("Expected cash");
  });
});

/* ---------- per-section enhancements ---------- */

describe("section enhancements", () => {
  it("queue page: export button fetches the queue and triggers a CSV download", async () => {
    renderPage(<PharmacyQueuePage />);
    const btn = await screen.findByRole("button", { name: /Export CSV — Queue/ });
    fetchCalls.length = 0;
    fireEvent.click(btn);
    await vi.waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled();
    });
    expect(fetchCalls.some((u) => u.includes("/pharmacy/orders"))).toBe(true);
  });

  it("stock page: low-stock banner names kits at/below threshold", async () => {
    payloads["/pharmacy/kits"] = {
      kits: [
        { id: "k1", name: "Hair Oil Kit", stock: 2, low_stock_threshold: 5, is_active: true },
        { id: "k2", name: "Shampoo Kit", stock: 40, low_stock_threshold: 5, is_active: true },
      ],
    };
    try {
      renderPage(<PharmacyStockPage />);
      const banner = await screen.findByText(/Hair Oil Kit \(2\)/);
      expect(banner).toBeTruthy();
      // The banner must not name the healthy kit (the tab's own kit <select>
      // also lists names, so scope the negative check to the banner).
      const bannerBox = banner.closest(".flagbox");
      expect(bannerBox?.textContent).not.toContain("Shampoo Kit");
    } finally {
      payloads["/pharmacy/kits"] = { kits: [] };
    }
  });

  it("stock page: no banner when nothing is low", async () => {
    renderPage(<PharmacyStockPage />);
    await screen.findByRole("tab", { name: "Adjust stock", selected: true });
    // The tab's own "Low stock alerts" h3 may exist, but our flag banner must not.
    expect(document.querySelector(".flagbox")).toBeNull();
  });

  it("expiry page: urgency banner appears when batches expire within 7 days", async () => {
    payloads["/pharmacy/batches/expiring"] = {
      batches: [
        {
          id: "b1",
          kit_id: "k1",
          kit_name: "Hair Oil Kit",
          batch_no: "B1",
          expiry: "2026-09-30",
          days_left: 3,
          qty: 5,
        },
      ],
    };
    try {
      renderPage(<PharmacyExpiryPage />);
      const banner = await screen.findByText(/expires in 3 days/);
      expect(banner).toBeTruthy();
    } finally {
      payloads["/pharmacy/batches/expiring"] = { batches: [] };
    }
  });

  it("holidays page: banner shows the next non-dispatch day", async () => {
    payloads["/pharmacy/holidays"] = {
      holidays: [{ id: "h1", date: "2099-01-01", label: "Test Day" }],
    };
    try {
      renderPage(<PharmacyHolidaysPage />);
      const banner = await screen.findByText(/2099-01-01/);
      expect(banner.textContent).toContain("Test Day");
    } finally {
      payloads["/pharmacy/holidays"] = { holidays: [] };
    }
  });

  it("reports page: bulk button downloads the last 3 monthly CSVs", async () => {
    renderPage(<PharmacyReportsPage />);
    const btn = await screen.findByRole("button", { name: /Download CSV × 3/ });
    fireEvent.click(btn);
    await vi.waitFor(() => {
      const csvCalls = fetchCalls.filter((u) => u.includes("monthly.csv"));
      expect(csvCalls.length).toBe(3);
    });
  });

  it("performance page: copy button present", async () => {
    renderPage(<PharmacyPerformancePage />);
    const btn = await screen.findByRole("button", { name: /Copy message — Today's dispatch/ });
    expect(btn).toBeTruthy();
  });

  it("packaging page: low-material banner names materials at/below threshold", async () => {
    payloads["/pharmacy/packaging"] = {
      materials: [
        { id: "m1", name: "Mailer box", qty: 3, unit: "pcs", low_threshold: 10, updated_at: "2026-09-27" },
        { id: "m2", name: "Bubble wrap", qty: 99, unit: "rolls", low_threshold: 10, updated_at: "2026-09-27" },
      ],
    };
    try {
      renderPage(<PharmacyPackagingPage />);
      const banner = await screen.findByText(/Mailer box \(3\)/);
      expect(banner).toBeTruthy();
      expect(screen.queryByText(/Bubble wrap \(99\)/)).toBeNull();
    } finally {
      payloads["/pharmacy/packaging"] = { materials: [] };
    }
  });

  it("each export page exposes its CSV export button", async () => {
    const cases: Array<[React.ReactElement, RegExp]> = [
      [<PharmacyManifestPage />, /Export CSV — Manifest/],
      [<PharmacyClaimsPage />, /Export CSV — Claims/],
      [<PharmacyQuarantinePage />, /Export CSV — Damaged stock quarantine/],
      [<PharmacyCouriersPage />, /Export CSV — Courier performance/],
      [<PharmacyReturnsPage />, /Export CSV — Return-rate analytics/],
      [<PharmacyCodPage />, /Export CSV — COD reconciliation/],
    ];
    for (const [el, label] of cases) {
      const { unmount } = renderPage(el);
      const btn = await screen.findByRole("button", { name: label });
      expect(btn).toBeTruthy();
      unmount();
    }
  });

  it("shift page: copy button present", async () => {
    renderPage(<PharmacyShiftPage />);
    const btn = await screen.findByRole("button", { name: /Copy message — Shift summary/ });
    expect(btn).toBeTruthy();
  });
});
