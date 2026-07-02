import { describe, expect, it, vi } from "vitest";

import {
  REVIEW_SESSION_STORAGE_KEY,
  anonSignIn,
  clearSession,
  exchangeReviewToken,
  getTurnstileToken,
  hasRestorableSession,
  isExpired,
  persistSession,
  readTokenFromHash,
  refreshAccessToken,
  restoreSession,
  shouldRefreshOnRestore,
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

describe("restoreSession — domain guard (origin)", () => {
  const WITH_ORIGIN: PersistedSession = {
    ...SESSION,
    origin: "https://felixjoy.me",
  };

  it("restores when the expected origin matches the stored origin", () => {
    const storage = fakeStorage();
    persistSession(WITH_ORIGIN, storage);
    expect(restoreSession(storage, "https://felixjoy.me")).toEqual(WITH_ORIGIN);
  });

  it("refuses a session stored for a different origin", () => {
    const storage = fakeStorage();
    persistSession(WITH_ORIGIN, storage);
    expect(restoreSession(storage, "https://evil.example")).toBeNull();
  });

  it("allows a legacy session that has no stored origin", () => {
    const storage = fakeStorage();
    persistSession(SESSION, storage); // no origin field
    expect(restoreSession(storage, "https://felixjoy.me")).toEqual(SESSION);
  });

  it("skips the guard entirely when no expected origin is passed", () => {
    const storage = fakeStorage();
    persistSession(WITH_ORIGIN, storage);
    expect(restoreSession(storage)).toEqual(WITH_ORIGIN);
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

describe("hasRestorableSession (full review-session lifetime)", () => {
  it("is false when there is no persisted session", () => {
    expect(hasRestorableSession(null)).toBe(false);
  });

  it("is true when the access token is still valid", () => {
    expect(hasRestorableSession({ ...SESSION, expiresAt: 10_000 }, 1_000)).toBe(
      true,
    );
  });

  it("is true when the access token is expired but a refresh token exists", () => {
    expect(
      hasRestorableSession(
        { ...SESSION, expiresAt: 1_000, refreshToken: "r" },
        5_000,
      ),
    ).toBe(true);
  });

  it("is false when expired AND there is no refresh token", () => {
    expect(
      hasRestorableSession(
        { ...SESSION, expiresAt: 1_000, refreshToken: "" },
        5_000,
      ),
    ).toBe(false);
  });
});

describe("shouldRefreshOnRestore", () => {
  it("is true when expired and a refresh token is present", () => {
    expect(
      shouldRefreshOnRestore({ expiresAt: 1_000, refreshToken: "r" }, 5_000, 0),
    ).toBe(true);
  });

  it("is false when the access token is still valid", () => {
    expect(
      shouldRefreshOnRestore({ expiresAt: 10_000, refreshToken: "r" }, 1_000, 0),
    ).toBe(false);
  });

  it("is false when there is no refresh token, even if expired", () => {
    expect(
      shouldRefreshOnRestore({ expiresAt: 1_000, refreshToken: "" }, 5_000, 0),
    ).toBe(false);
  });

  it("treats a near-expiry token as refreshable within the skew window", () => {
    expect(
      shouldRefreshOnRestore(
        { expiresAt: 3_000, refreshToken: "r" },
        1_000,
        2_000,
      ),
    ).toBe(true);
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
      canSendToAgent: false, // absent in the response → false (Phase 2)
    });
  });

  it("exchangeReviewToken parses canSendToAgent for a permitted member (Phase 2)", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () =>
      okResponse({
        previewId: "pid",
        role: "member",
        displayName: "Dev",
        canSendToAgent: true,
      }),
    );
    const result = await exchangeReviewToken({
      backendOrigin: "https://app.supercomment.dev",
      accessToken: "a",
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.role).toBe("member");
    expect(result.canSendToAgent).toBe(true);
  });

  it("exchangeReviewToken includes turnstileToken in the body only when provided", async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => okResponse({ previewId: "pid" }));
    await exchangeReviewToken({
      backendOrigin: "https://app.supercomment.dev",
      accessToken: "access-jwt",
      token: "tok",
      turnstileToken: "ts-123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.body).toBe(
      JSON.stringify({ token: "tok", turnstileToken: "ts-123" }),
    );
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

describe("getTurnstileToken (U4, injected DOM seams)", () => {
  interface FakeElement {
    style: Record<string, string>;
    removed: boolean;
    remove(): void;
  }
  function fakeDoc(): { doc: { createElement: () => FakeElement; body: { appendChild: () => void } }; created: FakeElement[] } {
    const created: FakeElement[] = [];
    return {
      created,
      doc: {
        createElement: () => {
          const el: FakeElement = {
            style: {},
            removed: false,
            remove() {
              this.removed = true;
            },
          };
          created.push(el);
          return el;
        },
        body: { appendChild: () => {} },
      },
    };
  }
  type TurnstileWin = {
    turnstile?: unknown;
    setTimeout(handler: () => void, ms: number): number;
    clearTimeout(id: number): void;
  };
  function fakeWin(turnstile?: unknown): TurnstileWin {
    return {
      turnstile,
      setTimeout: (fn: () => void, ms: number): number =>
        globalThis.setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number): void => {
        globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
      },
    };
  }
  // getTurnstileToken's option types are structural; cast the fakes through.
  const call = (opts: Record<string, unknown>) =>
    getTurnstileToken(opts as Parameters<typeof getTurnstileToken>[0]);

  it("resolves null when no site key is configured (dev path)", async () => {
    expect(await call({ siteKey: null })).toBeNull();
    expect(await call({ siteKey: "" })).toBeNull();
    expect(await call({ siteKey: undefined })).toBeNull();
  });

  it("resolves the token when the widget callback fires", async () => {
    const { doc } = fakeDoc();
    const turnstile = {
      render: (_c: unknown, p: { callback?: (t: string) => void }) => {
        p.callback?.("tok-123");
      },
    };
    const token = await call({
      siteKey: "site",
      doc,
      win: fakeWin(turnstile),
      loadScript: async () => {},
    });
    expect(token).toBe("tok-123");
  });

  it("resolves null when the turnstile global never appears after load", async () => {
    const { doc } = fakeDoc();
    expect(
      await call({
        siteKey: "site",
        doc,
        win: fakeWin(undefined),
        loadScript: async () => {},
      }),
    ).toBeNull();
  });

  it("resolves null when the script load fails", async () => {
    const { doc } = fakeDoc();
    expect(
      await call({
        siteKey: "site",
        doc,
        win: fakeWin({ render: () => {} }),
        loadScript: async () => {
          throw new Error("blocked");
        },
      }),
    ).toBeNull();
  });

  it("resolves null when render throws", async () => {
    const { doc } = fakeDoc();
    const turnstile = {
      render: () => {
        throw new Error("boom");
      },
    };
    expect(
      await call({
        siteKey: "site",
        doc,
        win: fakeWin(turnstile),
        loadScript: async () => {},
      }),
    ).toBeNull();
  });

  it("resolves null via the error-callback", async () => {
    const { doc } = fakeDoc();
    const turnstile = {
      render: (_c: unknown, p: { "error-callback"?: () => void }) => {
        p["error-callback"]?.();
      },
    };
    expect(
      await call({
        siteKey: "site",
        doc,
        win: fakeWin(turnstile),
        loadScript: async () => {},
      }),
    ).toBeNull();
  });

  it("resolves null on timeout when no callback fires", async () => {
    const { doc, created } = fakeDoc();
    const turnstile = { render: () => {} };
    const token = await call({
      siteKey: "site",
      doc,
      win: fakeWin(turnstile),
      loadScript: async () => {},
      timeoutMs: 10,
    });
    expect(token).toBeNull();
    // the hidden container is cleaned up
    expect(created[0]?.removed).toBe(true);
  });
});
