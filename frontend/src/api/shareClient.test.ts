import { afterEach, beforeEach, describe, expect, it } from "vitest";

import shareApi, {
  SHARE_SESSION_ENDED_CODE,
  isSessionBoundUrl,
  onShareSessionEnded,
  resetShareSessionEnded,
  shareSessionEndedReason,
} from "./shareClient";
import { resetFourxxBudget } from "./fourxxBudget";
import { fakeAdapter } from "@/test/fakeAdapter";

describe("isSessionBoundUrl", () => {
  it("treats OTP bootstrap, queue, heartbeat and logout as public", () => {
    for (const url of [
      "/abc123/info",
      "/abc123/request-otp",
      "/abc123/verify-otp",
      "/claim",
      "/queue",
      "/logout",
      "/heartbeat",
      "/api/share/claim",
    ]) {
      expect(isSessionBoundUrl(url)).toBe(false);
    }
  });

  it("treats everything else as session-bound", () => {
    for (const url of [
      "/me",
      "/documents/302",
      "/documents/302/file",
      "/documents/302/translate-region",
      "/documents/302/region-translations/1/thumbnail",
    ]) {
      expect(isSessionBoundUrl(url)).toBe(true);
    }
  });
});

describe("share client session-ended latch", () => {
  const originalAdapter = shareApi.defaults.adapter;
  beforeEach(() => {
    resetShareSessionEnded();
    resetFourxxBudget();
  });
  afterEach(() => {
    shareApi.defaults.adapter = originalAdapter;
    resetShareSessionEnded();
    resetFourxxBudget();
  });

  for (const status of [401, 403]) {
    it(`a ${status} ends the session and blocks further session requests locally`, async () => {
      const { adapter, calls } = fakeAdapter(() => ({ status }));
      shareApi.defaults.adapter = adapter;
      const seen: string[] = [];
      const unsubscribe = onShareSessionEnded((r) => seen.push(r));

      await expect(shareApi.get("/documents/302")).rejects.toBeTruthy();
      expect(shareSessionEndedReason()).toBe("unauthorized");
      expect(seen).toEqual(["unauthorized"]);

      for (let i = 0; i < 10; i++) {
        await expect(shareApi.get("/documents/302")).rejects.toMatchObject({
          code: SHARE_SESSION_ENDED_CODE,
        });
      }
      await expect(shareApi.get("/me")).rejects.toMatchObject({
        code: SHARE_SESSION_ENDED_CODE,
      });
      // Only the first request reached the network.
      expect(calls).toHaveLength(1);
      unsubscribe();
    });
  }

  it("keeps public endpoints usable after the session ended", async () => {
    const { adapter, calls } = fakeAdapter((_m, url) =>
      url === "/me" ? { status: 401 } : { status: 200 },
    );
    shareApi.defaults.adapter = adapter;
    await shareApi.get("/me").catch(() => {});
    expect(shareSessionEndedReason()).toBe("unauthorized");
    await shareApi.get("/abc/info");
    await shareApi.post("/abc/request-otp");
    await shareApi.post("/logout");
    expect(calls.map((c) => c.url)).toEqual([
      "/me",
      "/abc/info",
      "/abc/request-otp",
      "/logout",
    ]);
  });

  it("does not end the session on a 401 from a public endpoint", async () => {
    const { adapter } = fakeAdapter(() => ({ status: 401 }));
    shareApi.defaults.adapter = adapter;
    await shareApi.post("/abc/verify-otp", { code: "000000" }).catch(() => {});
    expect(shareSessionEndedReason()).toBeNull();
  });

  it("does not end the session on a 404 (document not in share)", async () => {
    const { adapter } = fakeAdapter(() => ({ status: 404 }));
    shareApi.defaults.adapter = adapter;
    await shareApi.get("/documents/999").catch(() => {});
    expect(shareSessionEndedReason()).toBeNull();
  });
});
