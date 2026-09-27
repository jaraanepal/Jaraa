import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "../i18n/LanguageContext";
import { FlagsProvider } from "../auth/FlagsContext";
import Layout from "../components/Layout";
import { checkAccess, matchRule } from "../lib/guards";
import type { Role } from "../api/types";

/**
 * v14 (problems 1-4): every role's sidebar lists ALL pages available to that
 * role — asserted as exact href sets so a dropped page fails loudly.
 * Guard rules are also asserted for every new v14 path.
 */
const authState: { isAuthed: boolean; role: Role | null; logout: () => Promise<void> } = {
  isAuthed: true,
  role: "customer",
  logout: async () => {},
};
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => authState,
}));

function stubFlags() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ flags: [] }),
    })),
  );
}

beforeEach(() => {
  localStorage.setItem("jaraa:lang", "en");
  authState.isAuthed = true;
  authState.role = "customer";
  stubFlags();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("jaraa:lang");
});

function sideHrefs(role: Role | null): string[] {
  authState.role = role;
  const { container, unmount } = render(
    <MemoryRouter initialEntries={["/"]}>
      <LanguageProvider>
        <FlagsProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<div>home page</div>} />
            </Route>
          </Routes>
        </FlagsProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
  const side = container.querySelector("aside.sidenav");
  expect(side).not.toBeNull();
  const hrefs = within(side as HTMLElement)
    .getAllByRole("link")
    .map((a) => a.getAttribute("href") ?? "");
  unmount();
  return hrefs;
}

const PHARMACY_PAGES = [
  "/pharmacy",
  "/pharmacy/queue",
  "/pharmacy/stock",
  "/pharmacy/manifest",
  "/pharmacy/expiry",
  "/pharmacy/claims",
  "/pharmacy/holidays",
  "/pharmacy/reports",
  "/pharmacy/performance",
  "/pharmacy/quarantine",
  "/pharmacy/shift",
  "/pharmacy/couriers",
  "/pharmacy/returns",
  "/pharmacy/packaging",
  "/pharmacy/cod",
  "/pharmacy/tools",
  "/notifications",
  "/pharmacy/profile",
];

const DOCTOR_PAGES = [
  "/doctor",
  "/doctor/reviewed",
  "/doctor/patients",
  "/doctor/followups",
  "/doctor/availability",
  "/doctor/activity",
  "/doctor/archived",
  "/doctor/second-opinions",
  "/doctor/calendar",
  "/doctor/triage-presets",
  "/doctor/digest",
  "/doctor/tools",
  "/notifications",
  "/doctor/profile",
];

const COACH_PAGES = [
  "/coach",
  "/coach/customers",
  "/coach/followups",
  "/coach/tools",
  "/notifications",
  "/coach/profile",
];

describe("v14 complete sidebars", () => {
  it("customer sidebar lists every customer page", () => {
    expect(sideHrefs("customer")).toEqual([
      "/",
      "/scan",
      "/plan",
      "/progress",
      "/kits",
      "/habits",
      "/orders",
      "/wishlist",
      "/my-challenges",
      "/referral",
      "/teleconsult",
      "/notifications",
      "/help",
      "/my-data",
      "/profile",
    ]);
  });

  it("admin sidebar lists every admin page", () => {
    expect(sideHrefs("admin")).toEqual([
      "/admin",
      "/admin/kits",
      "/admin/orders",
      "/admin/users?view=staff",
      "/admin/users",
      "/admin/flags",
      "/admin/audit",
      "/admin/broadcast",
      "/admin/refunds",
      "/admin/sla",
      "/admin/verifications",
      "/admin/finance",
      "/admin/payouts",
      "/admin/plan-templates",
      "/admin/tickets",
      "/admin/articles",
      "/admin/cases",
      "/admin/kit-analytics",
      "/admin/tools",
      "/admin/profile",
    ]);
  });

  it("doctor sidebar lists every doctor page", () => {
    expect(sideHrefs("doctor")).toEqual(DOCTOR_PAGES);
  });

  it("pharmacy sidebar lists all 14 section pages plus tools/notifications/profile", () => {
    expect(sideHrefs("pharmacy")).toEqual(PHARMACY_PAGES);
  });

  it("coach sidebar lists the full coach workflow", () => {
    expect(sideHrefs("coach")).toEqual(COACH_PAGES);
  });

  it("no parameterized detail page is a permanent sidebar item", () => {
    for (const role of ["customer", "admin", "doctor", "pharmacy", "coach"] as Role[]) {
      const hrefs = sideHrefs(role);
      expect(hrefs.filter((h) => h.includes(":") || /\/case\/|\/kits\//.test(h))).toEqual([]);
    }
  });
});

describe("v14 route guards for the new pages", () => {
  it("all pharmacy section pages are reachable by pharmacy and admin", () => {
    for (const p of PHARMACY_PAGES) {
      if (p === "/notifications") continue;
      const rule = matchRule(p);
      expect(rule, p).not.toBeNull();
      expect(rule!.roles).toContain("pharmacy");
      expect(checkAccess({ isAuthed: true, role: "pharmacy" }, p)).toBe("allow");
      expect(checkAccess({ isAuthed: true, role: "admin" }, p)).toBe("allow");
      expect(checkAccess({ isAuthed: true, role: "doctor" }, p)).toBe("forbidden");
    }
  });

  it("all doctor pages are reachable by doctor", () => {
    for (const p of DOCTOR_PAGES) {
      if (p === "/notifications") continue;
      const rule = matchRule(p);
      expect(rule, p).not.toBeNull();
      expect(rule!.roles).toContain("doctor");
      expect(checkAccess({ isAuthed: true, role: "doctor" }, p)).toBe("allow");
      expect(checkAccess({ isAuthed: true, role: "customer" }, p)).toBe("forbidden");
    }
  });

  it("coach customer pages are reachable by coach", () => {
    for (const p of ["/coach/customers", "/coach/customers/c1"]) {
      expect(checkAccess({ isAuthed: true, role: "coach" }, p)).toBe("allow");
    }
    expect(checkAccess({ isAuthed: true, role: "doctor" }, "/coach/customers")).toBe("forbidden");
  });

  it("notifications is reachable by every signed-in role", () => {
    for (const role of ["customer", "admin", "doctor", "pharmacy", "coach"] as Role[]) {
      expect(checkAccess({ isAuthed: true, role }, "/notifications")).toBe("allow");
    }
    expect(checkAccess({ isAuthed: false, role: null }, "/notifications")).toBe("login");
  });
});
