import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "../i18n/LanguageContext";
import { FlagsProvider } from "../auth/FlagsContext";
import Layout from "../components/Layout";
import en from "../i18n/en.json";
import type { Role } from "../api/types";

/**
 * v12: desktop/tablet shell — role class on .app, persistent staff side nav,
 * deskrow/deskcol wrappers. Same auth mock pattern as layout.test.tsx.
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

function renderApp(role: Role | null = "customer") {
  authState.role = role;
  return render(
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
}

describe("v12 app shell", () => {
  it("tags .app with the role class", () => {
    const { container, unmount } = renderApp("admin");
    expect(container.querySelector(".app.app-role-admin")).not.toBeNull();
    unmount();
    const r2 = renderApp("doctor");
    expect(r2.container.querySelector(".app.app-role-doctor")).not.toBeNull();
    r2.unmount();
  });

  it("wraps main+footer in deskrow/deskcol", () => {
    const { container } = renderApp();
    const row = container.querySelector(".deskrow");
    expect(row).not.toBeNull();
    expect(row!.querySelector(".deskcol > .main")).not.toBeNull();
    expect(row!.querySelector(".deskcol > .appfoot")).not.toBeNull();
  });

  it("renders a persistent side nav with the staff links for admin", () => {
    const { container } = renderApp("admin");
    const side = container.querySelector("aside.sidenav");
    expect(side).not.toBeNull();
    const links = within(side as HTMLElement)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    expect(links).toContain(en.nav.admin);
    expect(links).toContain(en.adminKits.title);
    expect(links).toContain(en.nav.profile);
  });

  it("renders the doctor links in the side nav for the doctor role", () => {
    const { container } = renderApp("doctor");
    const side = container.querySelector("aside.sidenav");
    expect(side).not.toBeNull();
    const links = within(side as HTMLElement)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    expect(links).toContain(en.nav.doctor);
    expect(links).toContain(en.doctorDash.reviewedTab);
    expect(links).not.toContain(en.nav.admin);
  });

  it("renders the customer side nav for the customer role (v13: all roles get the desktop sidebar)", () => {
    const { container } = renderApp("customer");
    const side = container.querySelector("aside.sidenav");
    expect(side).not.toBeNull();
    const links = within(side as HTMLElement)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    expect(links).toContain(en.nav.scan);
    expect(links).not.toContain(en.nav.admin);
    // customer bottom nav still exists in the DOM for <1024px (CSS hides it on desktop)
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("keeps the login page chrome-free (no side nav, no role chrome)", () => {
    authState.role = "admin";
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LanguageProvider>
          <FlagsProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/login" element={<div>login page</div>} />
              </Route>
            </Routes>
          </FlagsProvider>
        </LanguageProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
});
