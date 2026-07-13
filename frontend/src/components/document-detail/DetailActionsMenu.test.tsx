import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DetailActionsMenu, { type DetailActionsMenuProps } from "./DetailActionsMenu";

// Force the mobile Sheet branch: it renders plain <button> rows, which are
// simpler and more robust to drive than the desktop Radix menu in jsdom.
vi.mock("@/hooks/useMediaQuery", () => ({
  useBreakpoint: () => ({ isMobile: true, isDesktop: false }),
}));

function renderMenu(overrides: Partial<DetailActionsMenuProps> = {}) {
  const props: DetailActionsMenuProps = {
    imagingStudyId: null,
    onUnlinkImaging: vi.fn(),
    showPipelineActions: true,
    onReprocess: vi.fn(),
    onTranslate: vi.fn(),
    onShare: vi.fn(),
    onReplace: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <DetailActionsMenu {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("DetailActionsMenu — Replace file action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a 'Replace file...' item and calls onReplace when tapped", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const item = screen.getByRole("button", { name: /Replace file/i });
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(props.onReplace).toHaveBeenCalledTimes(1);
  });

  it("keeps Replace file available even when pipeline actions are hidden", () => {
    renderMenu({ showPipelineActions: false });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getByRole("button", { name: /Replace file/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reprocess/i })).not.toBeInTheDocument();
  });
});
