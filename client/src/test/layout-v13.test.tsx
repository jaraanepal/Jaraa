import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "../i18n/LanguageContext";
import { FlagsProvider } from "../auth/FlagsContext";
import Layout from "../components/Layout";
import en from "../i18n/en.json";
/* jsdom never evaluates media queries, so the CSS-rule assertions below read
   the real stylesheet from disk (vitest runs in Node, so fs is available). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
/* vitest runs with cwd = client/, so this always resolves to src/styles.css */
const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
import type { Role } from "../api/types";

/**
 * v13: fluid responsive shell + desktop sidebar for ALL roles + iPhone
 * safe-area header. DOM assertions use the same auth mock pattern as
 * layout.test.tsx / layout-v12.test.tsx; CSS assertions read the raw
 * stylesheet text because jsdom does not evaluate media queries.
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

/** Everything from "@media (min-width: 1024px)" to end of file = desktop rules. */
const desktopCss = css.slice(css.indexOf("@media (min-width: 1024px)"));
/** The last 768px block (v13 tablet shell) up to the desktop block. */
const tabletCss = css.slice(css.lastIndexOf("@media (min-width: 768px)"), css.indexOf("@media (min-width: 1024px)"));

describe("v13 desktop sidebar for every role", () => {
  it("renders the sidebar with customer links for the customer role", () => {
    const { container } = renderApp("customer");
    const side = container.querySelector("aside.sidenav");
    expect(side).not.toBeNull();
    const links = within(side as HTMLElement)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    expect(links).toContain(en.nav.scan);
    expect(links).toContain(en.nav.orders);
    expect(links).not.toContain(en.nav.admin);
  });

  it("renders the sidebar with staff links for staff roles", () => {
    const { container, unmount } = renderApp("pharmacy");
    const side = container.querySelector("aside.sidenav");
    expect(side).not.toBeNull();
    const links = within(side as HTMLElement)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    expect(links).toContain(en.nav.pharmacy);
    unmount();
    const r2 = renderApp("coach");
    const side2 = r2.container.querySelector("aside.sidenav");
    expect(side2).not.toBeNull();
    expect(
      within(side2 as HTMLElement)
        .getAllByRole("link")
        .map((a) => a.textContent ?? ""),
    ).toContain(en.nav.coach);
    r2.unmount();
  });

  it("marks the current route active in the sidebar", () => {
    authState.role = "customer";
    const { container } = render(
      <MemoryRouter initialEntries={["/scan"]}>
        <LanguageProvider>
          <FlagsProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/scan" element={<div>scan page</div>} />
              </Route>
            </Routes>
          </FlagsProvider>
        </LanguageProvider>
      </MemoryRouter>,
    );
    const side = container.querySelector("aside.sidenav");
    expect(side).not.toBeNull();
    const active = (side as HTMLElement).querySelectorAll("a.active");
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain(en.nav.scan);
  });
});

describe("v13 bottom nav visibility rules", () => {
  it("hides the bottom nav at ≥1024px for every role", () => {
    expect(desktopCss).toMatch(/\.bottomnav\s*\{\s*display:\s*none/);
  });

  it("keeps the bottom nav visible below 1024px (base rule is flex, tablet does not hide it)", () => {
    // base (mobile-first) rule
    expect(css).toMatch(/\.bottomnav\s*\{\s*position:\s*fixed[^}]*display:\s*flex/);
    // tablet block widens it but never hides it
    expect(tabletCss).toMatch(/\.bottomnav\s*\{\s*max-width:\s*none/);
    expect(tabletCss).not.toMatch(/\.bottomnav\s*\{\s*display:\s*none/);
    // still rendered in the DOM for mobile/tablet
    renderApp("customer");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("hides the hamburger on desktop (sidebar replaces the drawer)", () => {
    expect(desktopCss).toMatch(/\.hamburger\s*\{\s*display:\s*none/);
  });
});

describe("v13 fluid desktop layout", () => {
  it("makes the app full-viewport with a fluid content column on desktop", () => {
    expect(desktopCss).toMatch(/\.app\s*\{\s*max-width:\s*none/);
    expect(desktopCss).toMatch(/\.deskcol\s+\.main\s*\{[^}]*max-width:\s*min\(1280px/);
  });

  it("makes the sidebar sticky below the header", () => {
    expect(desktopCss).toMatch(/\.sidenav\s*\{[^}]*display:\s*flex/);
    expect(desktopCss).toMatch(/\.sidenav\s*\{[^}]*position:\s*sticky/);
  });
});

describe("v13 iPhone safe-area (Problem 1, no regression)", () => {
  it("keeps env(safe-area-inset-top) on the topbar", () => {
    expect(css).toMatch(/\.topbar\s*\{[^}]*env\(safe-area-inset-top\)/);
  });

  it("keeps env(safe-area-inset-bottom) on the bottom nav", () => {
    expect(css).toMatch(/\.bottomnav\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  });
});
