import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionBoundary } from "../components/ui";

/** P-13: one crashing profile widget must never white-screen the page. */

function Boom(): never {
  throw new Error("widget exploded");
}

describe("SectionBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(
      <SectionBoundary>
        <p>healthy widget</p>
      </SectionBoundary>,
    );
    expect(screen.getByText("healthy widget")).toBeTruthy();
  });

  it("swallows a throwing child and keeps sibling sections alive", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React logs the boundary catch
    try {
      render(
        <div>
          <SectionBoundary>
            <Boom />
          </SectionBoundary>
          <p>sibling section</p>
        </div>,
      );
      expect(screen.queryByText("widget exploded")).toBeNull();
      expect(screen.getByText("sibling section")).toBeTruthy();
    } finally {
      (console.error as unknown as { mockRestore: () => void }).mockRestore();
    }
  });
});
