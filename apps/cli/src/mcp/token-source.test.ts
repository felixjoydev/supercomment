import { describe, expect, it, vi } from "vitest";

import {
  RefreshingTokenSource,
  makeRefreshingFetch,
  type RefreshFn,
} from "./token-source.js";

// Fixed "now": 1e12 ms (unix second 1_000_000_000).
const NOW_MS = 1_000_000_000_000;
const NOW_S = 1_000_000_000;
const now = () => NOW_MS;

describe("RefreshingTokenSource", () => {
  it("returns the stored token when it is comfortably fresh", async () => {
    const refreshFn = vi.fn();
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S + 3600 },
      { now, refreshFn: refreshFn as unknown as RefreshFn },
    );
    expect(await src.getAccessToken()).toBe("A1");
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it("refreshes + persists when within the expiry margin", async () => {
    const refreshFn: RefreshFn = async () => ({
      accessToken: "A2",
      refreshToken: "R2",
      expiresAt: NOW_S + 3600,
    });
    const persisted: { accessToken: string; refreshToken: string }[] = [];
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S + 30 },
      { now, refreshFn, persist: async (t) => void persisted.push(t) },
    );
    expect(await src.getAccessToken()).toBe("A2");
    expect(persisted).toEqual([{ accessToken: "A2", refreshToken: "R2" }]);
    // Subsequent calls use the new (fresh) token without refreshing again.
    expect(await src.getAccessToken()).toBe("A2");
  });

  it("does NOT refresh when there is no refresh token (env/manual binding)", async () => {
    const refreshFn = vi.fn();
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A-old", expiresAt: NOW_S - 999 }, // expired, but no refresh token
      { now, refreshFn: refreshFn as unknown as RefreshFn },
    );
    expect(await src.getAccessToken()).toBe("A-old");
    expect(refreshFn).not.toHaveBeenCalled();
  });

  it("refreshes when the expiry is unknown but a refresh token exists", async () => {
    const refreshFn = vi.fn(async () => ({
      accessToken: "A2",
      refreshToken: "R2",
    }));
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A1", refreshToken: "R1" }, // no expiresAt
      { now, refreshFn },
    );
    expect(await src.getAccessToken()).toBe("A2");
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent refreshes into a single request", async () => {
    let calls = 0;
    const refreshFn: RefreshFn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: "A2", refreshToken: "R2", expiresAt: NOW_S + 3600 };
    };
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S - 1 },
      { now, refreshFn },
    );
    const [a, b, c] = await Promise.all([
      src.getAccessToken(),
      src.getAccessToken(),
      src.getAccessToken(),
    ]);
    expect([a, b, c]).toEqual(["A2", "A2", "A2"]);
    expect(calls).toBe(1);
  });

  it("adopts a newer on-disk token (a concurrent process refreshed) without refreshing itself", async () => {
    const refreshFn = vi.fn();
    const reload = vi.fn(async () => ({
      accessToken: "A-disk",
      refreshToken: "R-disk",
      expiresAt: NOW_S + 3600,
    }));
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S - 1 }, // ours stale
      { now, refreshFn: refreshFn as unknown as RefreshFn, reload },
    );
    expect(await src.getAccessToken()).toBe("A-disk");
    expect(refreshFn).not.toHaveBeenCalled(); // no rotation — we used the winner's
  });

  it("recovers from a failed refresh by adopting the winner's on-disk token", async () => {
    let reloadCalls = 0;
    const reload = async () => {
      reloadCalls += 1;
      // Before our refresh: disk still stale. After our refresh fails (the
      // concurrent winner rotated the token): disk now carries a fresh pair.
      return reloadCalls === 1
        ? { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S - 1 }
        : { accessToken: "A-winner", refreshToken: "R-winner", expiresAt: NOW_S + 3600 };
    };
    const refreshFn: RefreshFn = async () => {
      throw new Error("refresh_token already used (reuse)");
    };
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S - 1 },
      { now, refreshFn, reload },
    );
    expect(await src.getAccessToken()).toBe("A-winner"); // no error surfaced
  });

  it("throws only when the refresh fails AND the on-disk token is also stale", async () => {
    const reload = async () => ({
      accessToken: "A-old",
      refreshToken: "R-old",
      expiresAt: NOW_S - 1,
    });
    const refreshFn: RefreshFn = async () => {
      throw new Error("session revoked");
    };
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon",
      { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S - 1 },
      { now, refreshFn, reload },
    );
    await expect(src.getAccessToken()).rejects.toThrow("session revoked");
  });
});

describe("makeRefreshingFetch", () => {
  it("injects a fresh bearer + the anon apikey on every request", async () => {
    const src = new RefreshingTokenSource(
      "https://ref.supabase.co",
      "anon-key",
      { accessToken: "A1", refreshToken: "R1", expiresAt: NOW_S + 3600 },
      { now },
    );
    let seen: Headers | undefined;
    const baseFetch = (async (_input: unknown, init: RequestInit) => {
      seen = new Headers(init.headers);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const wrapped = makeRefreshingFetch(src, "anon-key", baseFetch);
    await wrapped("https://ref.supabase.co/rest/v1/comments");
    expect(seen?.get("authorization")).toBe("Bearer A1");
    expect(seen?.get("apikey")).toBe("anon-key");
  });
});
