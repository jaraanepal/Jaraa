/**
 * Problem 4 (v14): CoachCustomers list page render test.
 * fetch is stubbed per URL; asserts customer rows render and link to
 * /coach/customers/:id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "../i18n/LanguageContext";
import CoachCustomers from "../pages/coach/CoachCustomers";

const now = new Date().toISOString();

const CUSTOMERS = [
  {
    id: "c1",
    name: "Asha Sharma",
    phone: "+9779800000001",
    plan_status: "approved",
    last_checkin_at: now,
    next_followup_at: null,
    assigned_at: now,
  },
  {
    id: "c2",
    name: null,
    phone: "+9779800000002",
    plan_status: null,
    last_checkin_at: null,
    next_followup_at: null,
    assigned_at: now,
  },
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const json = (body: unknown) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      });
      if (url.includes("/coach/availability")) return json({ availability: null });
      if (url.includes("/coach/customers")) return json({ customers: CUSTOMERS });
      return json({ ok: true });
    }),
  );
}

beforeEach(() => {
  localStorage.setItem("jaraa:lang", "en");
  stubFetch();
});

afterEach(() => {
  localStorage.removeItem("jaraa:lang");
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <CoachCustomers />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe("CoachCustomers page", () => {
  it("renders assigned customers with links to their detail pages", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Asha Sharma")).toBeInTheDocument());
    // customer without a name falls back to phone
    expect(screen.getByText("+9779800000002")).toBeInTheDocument();

    const ashaLink = screen.getByText("Asha Sharma").closest("a");
    expect(ashaLink?.getAttribute("href")).toBe("/coach/customers/c1");
  });

  it("shows the stat cards and the assign form", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Asha Sharma")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Search name or phone")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Customer user ID")).toBeInTheDocument();
  });
});
