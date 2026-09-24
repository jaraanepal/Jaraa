import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "../i18n/LanguageContext";
import { FlagsProvider } from "../auth/FlagsContext";
import Teleconsult from "../pages/Teleconsult";
import en from "../i18n/en.json";

/**
 * The FlagsContext fetches GET /flags (real shape: { flags: [{key, is_enabled}] })
 * and falls back to DEFAULT_FLAGS (teleconsult_booking: false) when unavailable.
 */
function stubFlags(enabled: boolean) {
  const payload = { flags: [{ key: "teleconsult_booking", is_enabled: enabled }] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      // api/client.request() consumes res.text(), not res.json().
      text: async () => JSON.stringify(payload),
    })),
  );
}

beforeEach(() => {
  localStorage.setItem("jaraa:lang", "en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("jaraa:lang");
});

function renderPage() {
  return render(
    <LanguageProvider>
      <FlagsProvider>
        <Teleconsult />
      </FlagsProvider>
    </LanguageProvider>,
  );
}

describe("teleconsult flag-aware rendering", () => {
  it("shows the disabled UI while teleconsult_booking is OFF", async () => {
    stubFlags(false);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: en.teleconsult.disabledTitle })).toBeInTheDocument();
    });
    expect(screen.queryByText(en.teleconsult.book)).not.toBeInTheDocument();
  });

  it("shows the booking UI when teleconsult_booking is ON", async () => {
    stubFlags(true);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(en.teleconsult.book)).toBeInTheDocument();
    });
    expect(screen.queryByText(en.teleconsult.disabledTitle)).not.toBeInTheDocument();
  });

  it("falls back to disabled UI when the flags endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: en.teleconsult.disabledTitle })).toBeInTheDocument();
    });
  });
});
