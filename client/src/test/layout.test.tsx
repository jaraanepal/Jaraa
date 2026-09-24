import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "../i18n/LanguageContext";
import { FlagsProvider } from "../auth/FlagsContext";
import Layout from "../components/Layout";
import en from "../i18n/en.json";
import type { Role } from "../api/types";

/**
 * Controllable auth state — Layout only reads useAuth(), so we mock the
 * context module (AuthContext.tsx itself is owned by another worker).
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
  const payload = { flags: [{ key: "teleconsult_booking", is_enabled: false }] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
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

function renderApp(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LanguageProvider>
        <FlagsProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<div>home page</div>} />
              <Route path="/scan" element={<div>scan page</div>} />
              <Route path="/profile" element={<div>profile page</div>} />
            </Route>
          </Routes>
        </FlagsProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function bottomNavLabels(): string[] {
  const nav = screen.getByRole("navigation", { name: "Primary" });
  return within(nav).getAllByRole("link").map((a) => a.textContent ?? "");
}

describe("bottom nav (Problem 2)", () => {
  it("has EXACTLY Home / Progress / Kits / Profile, in that order, for a customer", () => {
    renderApp();
    expect(bottomNavLabels()).toEqual([
      en.nav.home,
      en.nav.progress,
      en.nav.kits,
      en.nav.profile,
    ]);
  });

  it("does not put Scan / Plan / Orders / staff links in the bottom nav", () => {
    renderApp();
    const labels = bottomNavLabels();
    for (const k of [en.nav.scan, en.nav.plan, en.nav.orders, en.nav.doctor, en.nav.admin]) {
      expect(labels).not.toContain(k);
    }
  });

  it("keeps Profile last even for staff roles", () => {
    authState.role = "admin";
    renderApp();
    const labels = bottomNavLabels();
    expect(labels).toHaveLength(4);
    expect(labels[3]).toBe(en.nav.profile);
  });
});

describe("left drawer (Problem 2)", () => {
  it("opens from the hamburger and closes on Escape", async () => {
    renderApp();
    expect(screen.queryByRole("dialog", { name: en.nav.menu })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.nav.menu }));
    expect(screen.getByRole("dialog", { name: en.nav.menu })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: en.nav.menu })).not.toBeInTheDocument();
    });
  });

  it("closes on backdrop click", async () => {
    const { container } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: en.nav.menu }));
    expect(screen.getByRole("dialog", { name: en.nav.menu })).toBeInTheDocument();
    const backdrop = container.querySelector(".drawer-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: en.nav.menu })).not.toBeInTheDocument();
    });
  });

  it("closes on navigation", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: en.nav.menu }));
    const dialog = screen.getByRole("dialog", { name: en.nav.menu });
    fireEvent.click(within(dialog).getByRole("link", { name: en.nav.scan }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: en.nav.menu })).not.toBeInTheDocument();
    });
    expect(screen.getByText("scan page")).toBeInTheDocument();
  });

  it("holds the non-bottom-nav links plus a settings section for a customer", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: en.nav.menu }));
    const dialog = screen.getByRole("dialog", { name: en.nav.menu });
    for (const k of [en.nav.scan, en.nav.plan, en.nav.orders, en.teleconsult.title]) {
      expect(within(dialog).getByRole("link", { name: k })).toBeInTheDocument();
    }
    expect(within(dialog).getByText(en.nav.settings)).toBeInTheDocument();
  });

  it("hides all staff links from customers", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: en.nav.menu }));
    const dialog = screen.getByRole("dialog", { name: en.nav.menu });
    for (const k of [en.nav.doctor, en.nav.admin, en.nav.pharmacy, en.nav.coach]) {
      expect(within(dialog).queryByRole("link", { name: k })).not.toBeInTheDocument();
    }
  });

  it("shows only the matching staff link per role", () => {
    const cases: Array<[Role, string]> = [
      ["doctor", en.nav.doctor],
      ["admin", en.nav.admin],
      ["pharmacy", en.nav.pharmacy],
      ["coach", en.nav.coach],
    ];
    for (const [role, label] of cases) {
      authState.role = role;
      const { unmount } = renderApp();
      fireEvent.click(screen.getByRole("button", { name: en.nav.menu }));
      const dialog = screen.getByRole("dialog", { name: en.nav.menu });
      expect(within(dialog).getByRole("link", { name: label })).toBeInTheDocument();
      for (const [otherRole, otherLabel] of cases) {
        if (otherRole === role) continue;
        expect(within(dialog).queryByRole("link", { name: otherLabel })).not.toBeInTheDocument();
      }
      unmount();
    }
  });
});
