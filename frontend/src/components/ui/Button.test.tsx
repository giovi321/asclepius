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
      "hover:bg-primary/90",
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
      "hover:bg-destructive/90",
    );
  });

  it("renders ghost variant (no border, accent hover)", () => {
    render(<Button variant="ghost">Close</Button>);
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn).toHaveClass("hover:bg-accent");
    expect(btn).not.toHaveClass("border");
  });

  it("applies the size scale", () => {
    render(
      <Button size="md" data-testid="md">
        Wide
      </Button>,
    );
    expect(screen.getByTestId("md")).toHaveClass("px-4", "py-2");
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

  it("merges extra className over the variant", () => {
    render(<Button className="w-full">Full</Button>);
    expect(screen.getByRole("button", { name: "Full" })).toHaveClass("w-full");
  });
});
