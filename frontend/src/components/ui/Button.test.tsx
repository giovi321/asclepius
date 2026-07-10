import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Button from "./Button";

describe("Button", () => {
  it("renders primary variant classes by default", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveClass(
      "bg-primary",
      "text-primary-foreground",
      "hover:bg-primary-hover",
    );
  });

  it("renders secondary variant classes", () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "border",
      "hover:bg-accent",
    );
  });

  it("renders danger variant classes", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground",
    );
  });

  it("renders ghost variant (no border, accent hover)", () => {
    render(<Button variant="ghost">Close</Button>);
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn).toHaveClass("hover:bg-accent");
    expect(btn).not.toHaveClass("border");
  });

  it("applies the fixed-height size scale with a coarse-pointer floor", () => {
    render(
      <Button size="md" data-testid="md">
        Wide
      </Button>,
    );
    expect(screen.getByTestId("md")).toHaveClass("h-9", "coarse:min-h-11");
  });

  it("renders the 44px lg size", () => {
    render(
      <Button size="lg" data-testid="lg">
        Tap
      </Button>,
    );
    expect(screen.getByTestId("lg")).toHaveClass("h-11");
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables the button and shows a spinner while loading", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toBeDisabled();
    expect(btn.querySelector("svg")).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges extra className over the variant", () => {
    render(<Button className="w-full">Full</Button>);
    expect(screen.getByRole("button", { name: "Full" })).toHaveClass("w-full");
  });
});
