import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sheet from "./Sheet";

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onOpenChange={() => {}} title="Hidden">
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.queryByText("Body")).toBeNull();
  });

  it("renders title, description, and body when open", () => {
    render(
      <Sheet
        open
        onOpenChange={() => {}}
        title="Filters"
        description="Narrow the list"
      >
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Narrow the list")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Esc me">
        <p>Body</p>
      </Sheet>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes via the header close button", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Closable">
        <p>Body</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides the title visually but keeps it for screen readers", () => {
    render(
      <Sheet open onOpenChange={() => {}} title="SR only" hideTitle>
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByText("SR only")).toHaveClass("sr-only");
  });

  it("renders a footer bar when provided", () => {
    render(
      <Sheet
        open
        onOpenChange={() => {}}
        title="With footer"
        footer={<button type="button">Apply</button>}
      >
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });
});
