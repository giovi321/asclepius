import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffDelay, usePolling, type PollingOptions } from "./polling";

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

function Poller({
  fn,
  ...opts
}: PollingOptions & { fn: () => Promise<unknown> }) {
  usePolling(fn, opts);
  return null;
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

const TWO_MINUTES = 120_000;

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("polls at the interval while requests succeed", async () => {
    const fn = vi.fn(async () => {});
    render(<Poller fn={fn} intervalMs={4000} />);
    await advance(TWO_MINUTES);
    expect(fn).toHaveBeenCalledTimes(30);
  });

  for (const status of [401, 403, 404]) {
    it(`stops for good after a ${status} and never retries it`, async () => {
      const fn = vi.fn(async () => {
        throw httpError(status);
      });
      const onStop = vi.fn();
      render(<Poller fn={fn} intervalMs={4000} immediate onStop={onStop} />);
      await advance(10 * TWO_MINUTES);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledWith(status, expect.anything());
    });
  }

  it("stops when a 401 arrives after earlier successes", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n > 3) throw httpError(401);
    });
    render(<Poller fn={fn} intervalMs={4000} />);
    await advance(TWO_MINUTES);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("honours a custom stop list", async () => {
    const fn = vi.fn(async () => {
      throw httpError(410);
    });
    render(<Poller fn={fn} intervalMs={5000} stopOn={[410]} immediate />);
    await advance(TWO_MINUTES);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially on other errors", async () => {
    const fn = vi.fn(async () => {
      throw httpError(500);
    });
    render(<Poller fn={fn} intervalMs={4000} immediate />);
    // t=0, then +8s, +16s, +32s, +64s -> 5 calls by t=120s.
    await advance(TWO_MINUTES);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("resets the backoff after a success", async () => {
    let fail = true;
    const fn = vi.fn(async () => {
      if (fail) throw new Error("network");
    });
    render(<Poller fn={fn} intervalMs={1000} immediate />);
    await advance(0); // t=0 fail, next in 2s
    await advance(2000); // t=2s fail, next in 4s
    expect(fn).toHaveBeenCalledTimes(2);
    fail = false;
    await advance(4000); // t=6s success, next in 1s
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("pauses while the tab is hidden and resumes when visible", async () => {
    const fn = vi.fn(async () => {});
    render(<Poller fn={fn} intervalMs={4000} />);
    await advance(8000);
    expect(fn).toHaveBeenCalledTimes(2);
    setVisibility("hidden");
    await advance(10 * TWO_MINUTES);
    expect(fn).toHaveBeenCalledTimes(2);
    setVisibility("visible");
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(3);
    await advance(4000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does not resume a stopped poll when the tab becomes visible", async () => {
    const fn = vi.fn(async () => {
      throw httpError(401);
    });
    render(<Poller fn={fn} intervalMs={4000} immediate />);
    await advance(0);
    setVisibility("hidden");
    setVisibility("visible");
    await advance(TWO_MINUTES);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("makes no request while disabled", async () => {
    const fn = vi.fn(async () => {});
    render(<Poller fn={fn} intervalMs={4000} immediate enabled={false} />);
    await advance(TWO_MINUTES);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("backoffDelay", () => {
  it("doubles per failure and caps", () => {
    expect(backoffDelay(4000, 0)).toBe(4000);
    expect(backoffDelay(4000, 1)).toBe(8000);
    expect(backoffDelay(4000, 3)).toBe(32000);
    expect(backoffDelay(4000, 20)).toBe(120000);
  });
});
