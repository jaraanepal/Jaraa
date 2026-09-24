import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LanguageProvider } from "../i18n/LanguageContext";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { Guard } from "../components/Guard";
import { setAccessToken } from "../api/client";
import type { Role } from "../api/types";

/**
 * P10 — session restore on app load (page refresh).
 * P11 — role-mismatch screen for logged-in users on another role's routes.
 *
 * fetch is stubbed per URL:
 *   /api/v1/auth/refresh -> { access_token, user } (or 401 for "no session")
 *   /api/v1/me/profile  -> a minimal profile
 *   /api/v1/auth/logout  -> { ok: true }
 */

const PROFILE = {
  user_id: "u-1",
  phone: "9800000001",
  age_band: "23-29",
  gender: "female",
  language: "en",
  guardian_consent: true,
  timezone: "Asia/Kathmandu",
};

function fakeJwt(role: Role): string {
  const payload = btoa(JSON.stringify({ role }));
  return `header.${payload}.sig`;
}

type RefreshMode = { kind: "ok"; role: Role } | { kind: "expired" };
let refreshMode: RefreshMode = { kind: "expired" };

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      });
      if (url.includes("/auth/refresh")) {
        if (refreshMode.kind === "expired") return json({ code: "unauthorized" }, 401);
        const role = refreshMode.role;
        return json({
          access_token: fakeJwt(role),
          user: { id: "u-1", phone: "9800000001", role },
        });
      }
      if (url.includes("/me/profile")) return json(PROFILE);
      if (url.includes("/auth/logout")) return json({ ok: true });
      return json({});
    }),
  );
}

function Probe() {
  const { isAuthed, role, authReady } = useAuth();
  return (
    <div data-testid="probe">
      {!authReady ? "restoring" : isAuthed ? `authed:${role}` : "logged-out"}
    </div>
  );
}

function renderProbe() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function renderGuarded(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <AuthProvider>
          <Routes>
            <Route path="/admin" element={<Guard><div>ADMIN CONSOLE</div></Guard>} />
            <Route path="/admin/login" element={<div>ADMIN LOGIN</div>} />
            <Route path="/doctor" element={<div>DOCTOR HOME</div>} />
            <Route path="/doctor/login" element={<div>DOCTOR LOGIN</div>} />
          </Routes>
        </AuthProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("jaraa:lang", "en");
  setAccessToken(null); // reset the in-memory token between tests
  refreshMode = { kind: "expired" };
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("P10 — session survives page refresh", () => {
  it("restores the session from the refresh cookie with no login flash", async () => {
    refreshMode = { kind: "ok", role: "doctor" };
    renderProbe();
    // authReady flips only after the restore attempt finishes.
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("authed:doctor"));
    expect(screen.queryByText("restoring")).toBeNull();
  });

  it("restores a second time after a remount (simulated refresh), for every role", async () => {
    const roles: Role[] = ["customer", "doctor", "admin", "pharmacy", "coach"];
    for (const role of roles) {
      refreshMode = { kind: "ok", role };
      const r = renderProbe();
      await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(`authed:${role}`));
      r.unmount();
      setAccessToken(null); // a real refresh wipes the in-memory token
      renderProbe(); // remount = new page load
      await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(`authed:${role}`));
      document.body.innerHTML = "";
      setAccessToken(null);
    }
  });

  it("expired/invalid refresh token -> stays logged out, gracefully", async () => {
    refreshMode = { kind: "expired" };
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("logged-out"));
  });
});

describe("P11 — role-mismatch screen", () => {
  it("a doctor opening /admin sees 'Log out first, then try.' with both actions", async () => {
    refreshMode = { kind: "ok", role: "doctor" };
    renderGuarded("/admin");
    await waitFor(() => expect(screen.getByText("Log out first, then try.")).toBeTruthy());
    expect(screen.getByText(/You're signed in as Doctor\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
    expect(screen.queryByText("ADMIN CONSOLE")).toBeNull();
  });

  it("[Go back] returns to the user's own dashboard", async () => {
    refreshMode = { kind: "ok", role: "doctor" };
    renderGuarded("/admin");
    await waitFor(() => expect(screen.getByText("Log out first, then try.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(screen.getByText("DOCTOR HOME")).toBeTruthy());
  });

  it("[Log out] signs out and lands on the attempted area's own login", async () => {
    refreshMode = { kind: "ok", role: "doctor" };
    renderGuarded("/admin");
    await waitFor(() => expect(screen.getByText("Log out first, then try.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(screen.getByText("ADMIN LOGIN")).toBeTruthy());
  });

  it("unauthenticated users still redirect to that role's login", async () => {
    refreshMode = { kind: "expired" };
    renderGuarded("/admin");
    await waitFor(() => expect(screen.getByText("ADMIN LOGIN")).toBeTruthy());
    expect(screen.queryByText("Log out first, then try.")).toBeNull();
  });
});
