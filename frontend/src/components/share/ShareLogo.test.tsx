import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ShareLogo from "./ShareLogo";

// Smoke test proving the @testing-library/react + jsdom harness renders a
// React 19 component. ShareLogo is purely presentational (no context/router
// deps), so it's a safe canary for the test setup.
describe("ShareLogo", () => {
  it("renders the logo image with accessible alt text", () => {
    render(<ShareLogo />);
    const img = screen.getByAltText("Asclepius");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/logo.svg");
  });

  it("applies the size preset classes (default sm)", () => {
    render(<ShareLogo />);
    expect(screen.getByAltText("Asclepius")).toHaveClass("h-6", "w-6");
  });

  it("applies the lg size preset when requested", () => {
    render(<ShareLogo size="lg" />);
    expect(screen.getByAltText("Asclepius")).toHaveClass("h-16", "w-16");
  });
});
