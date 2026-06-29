import { describe, expect, it, vi } from "vitest";

import {
  REVIEW_SESSION_STORAGE_KEY,
  anonSignIn,
  clearSession,
  exchangeReviewToken,
  isExpired,
  persistSession,
  readTokenFromHash,
  refreshAccessToken,
  restoreSession,
  stripTokenFromHash,
  type PersistedSession,
  type SessionStorageLike,
} from "./session.js";

/** A Map-backed sessionStorage double (node-safe). */
function fakeStorage(seed: Record<string, string> = {}): SessionStorageLike {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const SESSION: PersistedSession = {
  accessToken: "access-jwt",
  refreshToken: "refresh-jwt",
  previewId: "00000000-0000-0000-0000-000000000123",
  role: "guest",
  displayName: "Guest",
  expiresAt: 1_000_000,
};

describe("readTokenFromHash", () => {
  it("extracts the token from a bare #sc_token fragment", () => {
    expect(readTokenFromHash({ hash: "#sc_token=abc123" })).toBe("abc123");
  });

  it("url-decodes the token value", () => {
    expect(readTokenFromHash({ hash: "#sc_token=a%2Bb%2Fc" })).toBe("a+b/c");
  });

  it("finds the token among other hash params (hash-router safe)", () => {
    expect(
      readTokenFromHash({ hash: "#/route?x=1&sc_token=tok&y=2" }),
    ).toBe("tok");
  });

  it("returns null when there is no token", () => {
    expect(readTokenFromHash({ hash: "" })).toBeNull();
    expect(readTokenFromHash({ hash: "#/some/route" })).toBeNull();
    expect(readTokenFromHash({ hash: "#sc_token=" })).toBeNull();
  });
});

describe("stripTokenFromHash", () => {
  it("removes sc_token via replaceState, preserving pathname + search", () => {
    const replaceState = vi.fn();
    stripTokenFromHash({
      location: { pathname: "/app", search: "?a=1", hash: "#sc_token=secret" },
      history: { replaceState },
    });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/app?a=1");
  });

  it("keeps other hash params and drops only the token", () => {
    const replaceState = vi.fn();
    stripTokenFromHash({
      location: { pathname: "/", search: "", hash: "#a=1&sc_token=secret&b=2" },
      history: { state: { keep: true }, replaceState },
    });
    expect(replaceState).toHaveBeenCalledWith({ keep: true }, "", "/#a=1&b=2");
  });

  it("does nothing when the hash is empty", () => {
    const replaceState = vi.fn();
    stripTokenFromHash({
      location: { pathname: "/", search: "", hash: "" },
      history: { replaceState },
    });
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("never throws when history.replaceState throws", () => {
    expect(() =>
      stripTokenFromHash({
        location: { pathname: "/", search: "", hash: "#sc_token=x" },
        history: {
          replaceState: () => {
            throw new Error("blocked");
          },
        },
      }),
    ).not.toThrow();
  });
});

describe("persist / restore / clear", () => {
  it("round-trips a session through storage", () => {
    const storage = fakeStorage();
    persistSession(SESSION, storage);
    expect(storage.getItem(REVIEW_SESSION_STORAGE_KEY)).toContain("access-jwt");
    expect(restoreSession(storage)).toEqual(SESSION);
  });

  it("returns null when nothing is stored", () => {
    expect(restoreSession(fakeStorage())).toBeNull();
  });

  it("returns null for malformed / incomplete stored JSON", () => {
    expect(
      restoreSession(fakeStorage({ [REVIEW_SESSION_STORAGE_KEY]: "not json" })),
    ).toBeNull();
    expect(
      restoreSession(
        fakeStorage({
          [REVIEW_SESSION_STORAGE_KEY]: JSON.stringify({ accessToken: "x" }),
        }),
      ),
    ).toBeNull();
  });

  it("clears the persisted session", () => {
    const storage = fakeStorage();
    persistSession(SESSION, storage);
    clearSession(storage);
    expect(restoreSession(storage)).toBeNull();
  });
});

describe("isExpired", () => {
  it("is true at/after the expiry instant", () => {
    expect(isExpired(1000, 1000)).toBe(true);
    expect(isExpired(1000, 2000)).toBe(true);
  });

  it("is false before expiry", () => {
    expect(isExpired(2000, 1000)).toBe(false);
  });

  it("treats a near-expiry token as expired within the skew window", () => {
    // expiresAt 1000ms out, but a 2000ms skew → considered expired now.
    expect(isExpired(3000, 1000, 2000)).toBe(true);
    expect(isExpired(5000, 1000, 2000)).toBe(false);
  });

  it("fails closed for a non-finite expiry", () => {
    expect(isExpired(Number.NaN, 1000)).toBe(true);
  });
});

describe("network steps (injected fetch seam)", () => {
  type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

  function okResponse(body: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  }

  function headersOf(init: RequestInit): Record<string, string> {
    return (init.headers as Record<string, string> | undefined) ?? {};
  }

  it("anonSignIn POSTs /auth/v1/signup with the apikey and normalises tokens", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () =>
      okResponse({
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        user: { id: "anon-uid" },
      }),
    );
    const tokens = await anonSignIn({
      supabaseUrl: "https://x.supabase.co/",
      anonKey: "anon-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://x.supabase.co/auth/v1/signup");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(headersOf(init).apikey).toBe("anon-key");
    expect(tokens.accessToken).toBe("a");
    expect(tokens.refreshToken).toBe("r");
    expect(tokens.userId).toBe("anon-uid");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("exchangeReviewToken POSTs the token with the anon bearer", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () =>
      okResponse({
        previewId: "pid",
        role: "guest",
        displayName: "Guest",
      }),
    );
    const result = await exchangeReviewToken({
      backendOrigin: "https://app.supercomment.dev",
      accessToken: "access-jwt",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://app.supercomment.dev/api/review-token/exchange");
    expect(headersOf(init).authorization).toBe("Bearer access-jwt");
    expect(init.body).toBe(JSON.stringify({ token: "tok" }));
    expect(result).toEqual({
      previewId: "pid",
      role: "guest",
      displayName: "Guest",
    });
  });

  it("exchangeReviewToken throws when the server omits a previewId", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => okResponse({ role: "guest" }));
    await expect(
      exchangeReviewToken({
        backendOrigin: "https://app.supercomment.dev",
        accessToken: "a",
        token: "t",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/exchange_missing_preview/);
  });

  it("refreshAccessToken POSTs the refresh grant and re-normalises tokens", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () =>
      okResponse({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }),
    );
    const tokens = await refreshAccessToken({
      supabaseUrl: "https://x.supabase.co",
      anonKey: "anon-key",
      refreshToken: "r1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://x.supabase.co/auth/v1/token?grant_type=refresh_token",
    );
    expect(init.body).toBe(JSON.stringify({ refresh_token: "r1" }));
    expect(tokens.accessToken).toBe("a2");
    expect(tokens.refreshToken).toBe("r2");
  });
});
