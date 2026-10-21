import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The public reverse proxy bans an IP after 10 responses with status
// 401/403/404 within 2 minutes. These tests replay the share surface
// against a fake backend and count what actually reaches the network.
//
// Incident 2026-10-21: a share document page with a pending region
// translation polled GET /api/share/documents/302 every 4s; once the
// session died every poll was a 401 and the 10th banned the IP.

vi.mock("@/components/share/ShareDocumentViewer", () => ({
  default: () => null,
}));

import shareApi, { resetShareSessionEnded } from "@/api/shareClient";
import { resetFourxxBudget } from "@/api/fourxxBudget";
import { ShareSessionProvider } from "@/contexts/ShareSessionContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ToastProvider } from "@/contexts/ToastContext";
import ShareDashboardPage from "./ShareDashboardPage";
import ShareDocumentPage from "./ShareDocumentPage";
import ShareLandingPage from "./ShareLandingPage";
import ShareWaitingPage from "./ShareWaitingPage";
import { banCounted, fakeAdapter, type FakeReply } from "@/test/fakeAdapter";

const TWO_MINUTES = 120_000;

function isoIn(ms: number) {
  // Backend format: naive UTC, no trailing Z.
  return new Date(Date.now() + ms).toISOString().replace("Z", "");
}

function mePayload(sessionMs = 60 * 60 * 1000) {
  return {
    recipient_label: "Dr. Test",
    patient_name: "Patient",
    share_expires_at: isoIn(24 * 60 * 60 * 1000),
    session_expires_at: isoIn(sessionMs),
    documents: [],
    translate_rate_limit: {
      per_share_per_hour: 10,
      used_in_last_hour: 0,
      remaining_in_last_hour: 10,
      debounce_seconds_remaining: 0,
    },
    default_translation_language: "English",
    allowed_translation_languages: ["English"],
  };
}

const docWithPendingTranslation = {
  id: 302,
  doc_type: "lab",
  event_date: null,
  issued_date: null,
  date_received: null,
  doctor_name: null,
  facility_name: null,
  specialty_display: null,
  summary_en: null,
  summary_original: null,
  notes: null,
  language_source: null,
  ocr_text: null,
  ocr_text_en: null,
  page_count: 1,
  original_filename: "report.pdf",
  has_file: true,
  lab_results: [],
  medications: [],
  vaccinations: [],
  region_translations: [
    {
      id: 1,
      page: 1,
      ocr_text: "x",
      translated_text: null,
      has_thumbnail: false,
      target_language: "English",
      created_at: "2026-10-21T09:00:00",
    },
  ],
};

function renderShare(path: string) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/share"
              element={
                <ShareSessionProvider>
                  <Outlet />
                </ShareSessionProvider>
              }
            >
              <Route index element={<ShareLandingPage />} />
              <Route path="dashboard" element={<ShareDashboardPage />} />
              <Route path="documents/:id" element={<ShareDocumentPage />} />
              <Route path="waiting" element={<ShareWaitingPage />} />
              <Route path=":token" element={<ShareLandingPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const originalAdapter = shareApi.defaults.adapter;

function useBackend(handler: (method: string, url: string) => FakeReply) {
  const fake = fakeAdapter(handler);
  shareApi.defaults.adapter = fake.adapter;
  return fake.calls;
}

describe("share surface never loops on 4xx", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetShareSessionEnded();
    resetFourxxBudget();
    setVisibility("visible");
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
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: vi.fn() });
  });
  afterEach(() => {
    shareApi.defaults.adapter = originalAdapter;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetShareSessionEnded();
    resetFourxxBudget();
    setVisibility("visible");
  });

  it("replays the 2026-10-21 incident: one 401 stops the translation poll", async () => {
    let sessionAlive = true;
    const calls = useBackend((_method, url) => {
      if (url === "/me") return { status: 200, data: mePayload() };
      if (url === "/heartbeat")
        return { status: 200, data: { active: sessionAlive } };
      if (url === "/documents/302")
        return sessionAlive
          ? { status: 200, data: docWithPendingTranslation }
          : { status: 401, data: { detail: "Share session expired" } };
      return { status: 200 };
    });

    renderShare("/share/documents/302");
    await advance(0);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();

    // A few successful polls, then the session dies server-side.
    await advance(10_000);
    const before = calls.filter((c) => c.url === "/documents/302").length;
    expect(before).toBeGreaterThan(1);
    sessionAlive = false;

    await advance(3 * TWO_MINUTES);
    expect(banCounted(calls)).toBe(1);
    expect(calls.filter((c) => c.url === "/documents/302").length).toBe(
      before + 1,
    );
    expect(screen.getByText("Session no longer active")).toBeInTheDocument();
  });

  it("ends the session from a heartbeat reporting inactive, with zero 4xx", async () => {
    let sessionAlive = true;
    const calls = useBackend((_method, url) => {
      if (url === "/me") return { status: 200, data: mePayload() };
      if (url === "/heartbeat")
        return { status: 200, data: { active: sessionAlive } };
      return { status: 200 };
    });
    renderShare("/share/dashboard");
    await advance(0);
    expect(screen.getByText("Patient")).toBeInTheDocument();
    sessionAlive = false;
    await advance(61_000);
    expect(screen.getByText("Session expired")).toBeInTheDocument();
    const after = calls.length;
    await advance(10 * TWO_MINUTES);
    expect(calls.length).toBe(after);
    expect(banCounted(calls)).toBe(0);
  });

  it("ends the session locally at its expiry time without a request", async () => {
    const calls = useBackend((_method, url) => {
      if (url === "/me") return { status: 200, data: mePayload(30_000) };
      if (url === "/documents/302")
        return { status: 200, data: docWithPendingTranslation };
      return { status: 200, data: { active: true } };
    });
    renderShare("/share/documents/302");
    await advance(0);
    await advance(31_000);
    expect(screen.getByText("Session expired")).toBeInTheDocument();
    const after = calls.length;
    await advance(3 * TWO_MINUTES);
    expect(calls.length).toBe(after);
    expect(banCounted(calls)).toBe(0);
  });

  it("a deep link without a session costs exactly one 401", async () => {
    const calls = useBackend(() => ({ status: 401 }));
    renderShare("/share/documents/302");
    await advance(3 * TWO_MINUTES);
    expect(calls.map((c) => c.url)).toEqual(["/me"]);
    expect(screen.getByText("Session no longer active")).toBeInTheDocument();
  });

  it("the landing page does not probe /me", async () => {
    const calls = useBackend(() => ({
      status: 200,
      data: { delivery: "manual" },
    }));
    renderShare("/share/abc123");
    await advance(TWO_MINUTES);
    expect(calls.map((c) => c.url)).toEqual(["/abc123/info"]);
  });

  it("does not poll while the tab is hidden", async () => {
    const calls = useBackend((_method, url) => {
      if (url === "/me") return { status: 200, data: mePayload() };
      if (url === "/documents/302")
        return { status: 200, data: docWithPendingTranslation };
      return { status: 200, data: { active: true } };
    });
    renderShare("/share/documents/302");
    await advance(0);
    setVisibility("hidden");
    const before = calls.length;
    await advance(TWO_MINUTES);
    expect(calls.length).toBe(before);
  });

  for (const status of [401, 403, 404]) {
    it(`waiting page stops claiming after a ${status}`, async () => {
      const calls = useBackend(() => ({ status }));
      renderShare("/share/waiting");
      await advance(TWO_MINUTES);
      expect(calls.filter((c) => c.url === "/claim")).toHaveLength(1);
    });
  }

  it("waiting page backs off on server errors", async () => {
    const calls = useBackend(() => ({ status: 503 }));
    renderShare("/share/waiting");
    await advance(TWO_MINUTES);
    // 5s fixed polling would be 24; backoff: t=0,10,30,70 -> 4.
    expect(calls.filter((c) => c.url === "/claim").length).toBeLessThanOrEqual(
      5,
    );
  });
});
