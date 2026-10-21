import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin client must never be hit from a share page: the share
// container 404s every admin endpoint, and the public proxy's fail2ban
// jail bans an IP after a handful of 4xx responses.
const adminGet = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("@/api/client", () => ({
  default: {
    get: adminGet,
    post: adminGet,
    interceptors: { response: { use: vi.fn() } },
  },
}));

const shareGet = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("@/api/shareClient", () => ({
  default: { get: shareGet, post: shareGet },
  markShareSessionEnded: vi.fn(),
  onShareSessionEnded: vi.fn(() => () => {}),
  shareSessionEndedReason: vi.fn(() => null),
}));

import Root from "./Root";

function mockHealth(mode: "core" | "share") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "ok", mode }),
    })),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Root />
    </MemoryRouter>,
  );
}

describe("Root provider isolation", () => {
  beforeEach(() => {
    adminGet.mockClear();
    shareGet.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const mode of ["share", "core"] as const) {
    for (const path of [
      "/share/abc",
      "/share/dashboard",
      "/share/documents/1",
    ]) {
      it(`makes no admin API call on ${path} in ${mode} mode`, async () => {
        mockHealth(mode);
        renderAt(path);
        await waitFor(() =>
          expect(fetch).toHaveBeenCalledWith("/health", expect.anything()),
        );
        // Give lazy routes and provider effects a tick to fire.
        await new Promise((r) => setTimeout(r, 50));
        expect(adminGet).not.toHaveBeenCalled();
      });
    }
  }

  it("still probes admin auth on the core login route", async () => {
    mockHealth("core");
    renderAt("/login");
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith("/setup/status"));
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("does not poll pipeline status or load patients while logged out", async () => {
    // Logged out, the admin endpoints answer 401; the login page used to
    // poll /pipeline/status every 5s into them.
    mockHealth("core");
    renderAt("/login");
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith("/setup/status"));
    await new Promise((r) => setTimeout(r, 50));
    const urls = adminGet.mock.calls.map((c) => (c as unknown[])[0]);
    expect(urls).not.toContain("/pipeline/status");
    expect(urls).not.toContain("/patients");
  });

  it("does not call /api/share/me on the share landing page", async () => {
    mockHealth("share");
    renderAt("/share/abc");
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/health", expect.anything()),
    );
    await new Promise((r) => setTimeout(r, 50));
    const urls = shareGet.mock.calls.map((c) => (c as unknown[])[0]);
    expect(urls).not.toContain("/me");
  });
});
