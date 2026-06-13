import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Modal from "./Modal";

// Modal guards the interaction contract that tsc/build cannot: it renders
// into a portal, shows children only while open, and closes on Escape and
// backdrop click but NOT on clicks inside the panel.
describe("Modal", () => {
  it("renders children when open", () => {
    render(
      <Modal open onClose={() => {}}>
        <p>Modal body</p>
      </Modal>,
    );
    expect(screen.getByText("Modal body")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>Modal body</p>
      </Modal>,
    );
    expect(screen.queryByText("Modal body")).not.toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Modal body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose on Escape when closeOnEscape is false", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} closeOnEscape={false}>
        <p>Modal body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Modal body</p>
      </Modal>,
    );
    // The backdrop is the presentation wrapper around the dialog panel.
    const panel = screen.getByRole("dialog");
    const backdrop = panel.parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when the panel itself is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Modal body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT call onClose on backdrop click when closeOnBackdropClick is false", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} closeOnBackdropClick={false}>
        <p>Modal body</p>
      </Modal>,
    );
    const panel = screen.getByRole("dialog");
    const backdrop = panel.parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the title and footer slots", () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="My Title"
        footer={<button>Footer action</button>}
      >
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByText("My Title")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Footer action" }),
    ).toBeInTheDocument();
  });
});
