import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_4XX_PER_WINDOW,
  WINDOW_MS,
  installFourxxGuard,
  isBudgetError,
  resetFourxxBudget,
} from "./fourxxBudget";
import { banCounted, fakeAdapter } from "@/test/fakeAdapter";

function guardedClient(status: number) {
  const { adapter, calls } = fakeAdapter(() => ({ status }));
  const client = axios.create({ adapter });
  installFourxxGuard(client);
  return { client, calls };
}

describe("4xx budget", () => {
  beforeEach(() => {
    resetFourxxBudget();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetFourxxBudget();
  });

  it("caps 401/403/404 sent within the window", async () => {
    for (const status of [401, 403, 404]) {
      resetFourxxBudget();
      const { client, calls } = guardedClient(status);
      const results = [];
      for (let i = 0; i < 20; i++) {
        results.push(await client.get("/x").catch((e) => e));
      }
      expect(banCounted(calls)).toBe(MAX_4XX_PER_WINDOW);
      expect(results.filter(isBudgetError)).toHaveLength(
        20 - MAX_4XX_PER_WINDOW,
      );
    }
  });

  it("does not count other statuses", async () => {
    const { client, calls } = guardedClient(500);
    for (let i = 0; i < 20; i++) await client.get("/x").catch(() => {});
    expect(calls).toHaveLength(20);
  });

  it("is shared between clients and reopens when the window slides", async () => {
    const a = guardedClient(401);
    const b = guardedClient(200);
    for (let i = 0; i < MAX_4XX_PER_WINDOW; i++)
      await a.client.get("/x").catch(() => {});
    await expect(b.client.get("/y")).rejects.toSatisfy(isBudgetError);
    expect(b.calls).toHaveLength(0);
    vi.advanceTimersByTime(WINDOW_MS);
    await expect(b.client.get("/y")).resolves.toBeTruthy();
    expect(b.calls).toHaveLength(1);
  });
});
